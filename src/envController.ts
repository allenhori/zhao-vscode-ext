// Owns the environment-variable feature inside VS Code: which named set is
// active (workspace state, "remembered, not locked"), the file watchers that
// mark the lineage stale when any source changes, the Problems-panel
// diagnostics, and every sidebar edit. Thin plumbing over the tested pure
// modules (`./envConfig.ts`, `./envWrite.ts`, `./envVarScan.ts`,
// `./envGit.ts`) -- not unit-tested itself, per the spec's testing decisions.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import * as vscode from "vscode";
import { resolveEnv, type EnvDiagnostic, type ResolvedEnv } from "./envConfig.js";
import { addToGitignore, checkGitStatus } from "./envGit.js";
import { findMissingEnvVars, scanEnvVarUsages, type EnvVarUsages } from "./envVarScan.js";
import { findProfilesYmlPath } from "./profilesYml.js";
import {
  addSet,
  deleteSet,
  deleteVariable,
  hasSet,
  hasVariable,
  renameSet,
  setVariable,
} from "./envWrite.js";
import {
  collectProjectTexts,
  configFilePath,
  loadEnvInputs,
  readTextIfExists,
  SECRET_JSON,
  writeConfigText,
  ZHAO_JSON,
} from "./envWorkspace.js";

const WORKSPACE_STATE_ENV_SET_KEY = "zhao.activeEnvSet";
const SCAN_CACHE_MS = 15_000;

export interface EnvVariableView {
  name: string;
  value: string;
  secret: boolean;
  unresolved: boolean;
  /** Human label for where the winning value comes from. */
  sourceLabel: string;
  /** `false` for `.env` rows, which are shown read-only. */
  editable: boolean;
  /** The file the winning value lives in, for editing/deleting. */
  file: typeof ZHAO_JSON | typeof SECRET_JSON | null;
  /** The named set it lives in; `null` for the flat base. */
  set: string | null;
  /** `.env` file (as written in zhao.json) when read-only. */
  envFile: string | null;
  /** Lower-precedence definitions this one overrides. */
  shadowedBy: string[];
}

export interface GitWarning {
  /** Path relative to the workspace folder, as passed to `.gitignore`. */
  file: string;
  kind: "notIgnored" | "tracked";
}

export interface EnvSidebarState {
  /** `false` when no workspace folder is open: nothing can be stored. */
  available: boolean;
  sets: string[];
  activeSet: string | null;
  variables: EnvVariableView[];
  diagnostics: EnvDiagnostic[];
  requiredCount: number;
  missing: string[];
  gitWarnings: GitWarning[];
}

export class EnvController implements vscode.Disposable {
  private stale = false;
  /** Bumped by every real change to the environment, so a compile that
   * started before a change can't mark that change as already applied. */
  private revision = 0;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("zhao-env");
  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
  private readonly configWatcher: vscode.FileSystemWatcher;
  private scanCache: { projectDir: string; at: number; usages: EnvVarUsages } | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projectDir: () => string | null,
    /** `true` once a lineage has been compiled -- only then can an env
     * change make it stale. */
    private readonly hasLineage: () => boolean,
  ) {
    this.configWatcher = vscode.workspace.createFileSystemWatcher(`**/.vscode/{${ZHAO_JSON},${SECRET_JSON}}`);
    const onConfigChange = () => this.changed();
    this.configWatcher.onDidChange(onConfigChange);
    this.configWatcher.onDidCreate(onConfigChange);
    this.configWatcher.onDidDelete(onConfigChange);
  }

  dispose(): void {
    this.configWatcher.dispose();
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.diagnostics.dispose();
    this.changeEmitter.dispose();
  }

  // -- Where the config lives --

  /** The workspace folder holding `.vscode/zhao.json` -- the one that
   * contains the active project, else the first open folder. */
  get workspaceDir(): string | null {
    const project = this.projectDir();
    if (project) {
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project));
      if (folder) {
        return folder.uri.fsPath;
      }
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  // -- Active set --

  get activeSet(): string | null {
    return this.resolveValidated().activeSet;
  }

  async setActiveSet(name: string | null): Promise<void> {
    await this.context.workspaceState.update(WORKSPACE_STATE_ENV_SET_KEY, name);
    this.changed();
  }

  // -- Resolution --

  private resolveWith(activeSet: string | null): ResolvedEnv | null {
    const dir = this.workspaceDir;
    return dir ? resolveEnv(loadEnvInputs(dir, activeSet)) : null;
  }

  /** Resolves with the stored active set, falling back to no set when
   * that set no longer exists (deleted by hand) -- so what the sidebar
   * shows and what dbt receives always agree. */
  private resolveValidated(): { resolved: ResolvedEnv; activeSet: string | null } {
    const stored = this.context.workspaceState.get<string | null>(WORKSPACE_STATE_ENV_SET_KEY, null);
    const withStored = this.resolveWith(stored);
    if (withStored === null) {
      return { resolved: { env: {}, variables: [], availableSets: [], envFiles: [], diagnostics: [] }, activeSet: null };
    }
    if (stored !== null && !withStored.availableSets.includes(stored)) {
      return { resolved: this.resolveWith(null) ?? withStored, activeSet: null };
    }
    return { resolved: withStored, activeSet: stored };
  }

  /** The current resolved environment (no config -> empty). */
  resolve(): ResolvedEnv {
    return this.resolveValidated().resolved;
  }

  /** The variables to hand to every spawned `zhao` process. */
  spawnEnv(): Record<string, string> {
    return this.resolve().env;
  }

  /** The environment dbt will see when locating `profiles.yml` (its
   * profiles-directory variable lives in either place). */
  effectiveProcessEnv(): NodeJS.ProcessEnv {
    return { ...process.env, ...this.spawnEnv() };
  }

  // -- Stale tracking --

  get isStale(): boolean {
    return this.stale;
  }

  /** The current change counter -- capture it before a compile starts. */
  get currentRevision(): number {
    return this.revision;
  }

  /** Clears the stale flag after a compile, unless the environment
   * changed while it was running (that change is not yet applied). */
  clearStale(compiledRevision: number): void {
    if (compiledRevision === this.revision) {
      this.stale = false;
    }
  }

  /** Label for the panel's "active env" indicator, or `null` when there
   * is no environment configured at all. */
  get activeLabel(): string | null {
    const resolved = this.resolve();
    const set = this.activeSet;
    if (set !== null) {
      return set;
    }
    return resolved.variables.length > 0 ? "base" : null;
  }

  /** A source changed: reload, watch any new `.env` files, refresh the
   * Problems panel, and mark an already-compiled lineage stale -- never
   * recompile on its own (see ADR 0012). */
  changed(): void {
    this.revision += 1;
    if (this.hasLineage()) {
      this.stale = true;
    }
    this.reload();
  }

  /** Re-reads everything for display without touching the stale flag --
   * for actions (opening a file, editing `.gitignore`) that don't change
   * any variable's value. */
  private reload(): void {
    this.syncEnvFileWatchers();
    void this.refreshDiagnostics();
    this.changeEmitter.fire();
  }

  /** Starts watching and publishes Problems-panel diagnostics right away,
   * rather than waiting for the sidebar to first render. */
  start(): void {
    this.reload();
  }

  private syncEnvFileWatchers(): void {
    const wanted = new Set(this.resolve().envFiles);
    for (const [path, watcher] of this.watchers) {
      if (!wanted.has(path)) {
        watcher.dispose();
        this.watchers.delete(path);
      }
    }
    for (const path of wanted) {
      if (this.watchers.has(path)) {
        continue;
      }
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(dirname(path)), basename(path)),
      );
      const onChange = () => this.changed();
      watcher.onDidChange(onChange);
      watcher.onDidCreate(onChange);
      watcher.onDidDelete(onChange);
      this.watchers.set(path, watcher);
    }
  }

  // -- Sidebar state --

  async getSidebarState(): Promise<EnvSidebarState> {
    const dir = this.workspaceDir;
    if (!dir) {
      return {
        available: false,
        sets: [],
        activeSet: null,
        variables: [],
        diagnostics: [],
        requiredCount: 0,
        missing: [],
        gitWarnings: [],
      };
    }
    this.syncEnvFileWatchers();
    const resolved = this.resolve();
    const usages = this.scanUsages();
    const missing = findMissingEnvVars(usages, resolved.env, process.env);
    const gitWarnings = await this.computeGitWarnings(dir, resolved);
    void this.publishDiagnostics(dir, resolved, missing, gitWarnings);

    const variables: EnvVariableView[] = resolved.variables.map((variable) => {
      const fromEnvFile = variable.source.kind === "env-file";
      return {
        name: variable.name,
        value: variable.raw,
        secret: variable.secret,
        unresolved: variable.unresolved,
        sourceLabel: fromEnvFile
          ? (variable.source.file ?? ".env")
          : variable.source.kind,
        editable: !fromEnvFile,
        file: variable.source.kind === "env-file" ? null : variable.source.kind,
        set: variable.source.set,
        envFile: fromEnvFile ? (variable.source.file ?? null) : null,
        shadowedBy: variable.shadows.map((s) =>
          s.source.kind === "env-file" ? (s.source.file ?? ".env") : s.source.kind,
        ),
      };
    });

    return {
      available: true,
      sets: resolved.availableSets,
      activeSet: this.activeSet,
      variables,
      diagnostics: resolved.diagnostics,
      requiredCount: usages.required.length,
      missing,
      gitWarnings,
    };
  }

  private scanUsages(): EnvVarUsages {
    const projectDir = this.projectDir();
    if (!projectDir) {
      return { required: [], optional: [] };
    }
    const now = Date.now();
    if (this.scanCache && this.scanCache.projectDir === projectDir && now - this.scanCache.at < SCAN_CACHE_MS) {
      return this.scanCache.usages;
    }
    const profiles = findProfilesYmlPath(projectDir, this.effectiveProcessEnv(), homedir());
    const usages = scanEnvVarUsages(collectProjectTexts(projectDir, profiles ? [profiles] : []));
    this.scanCache = { projectDir, at: now, usages };
    return usages;
  }

  private async computeGitWarnings(dir: string, resolved: ResolvedEnv): Promise<GitWarning[]> {
    const candidates = new Set<string>();
    if (existsSync(configFilePath(dir, SECRET_JSON))) {
      candidates.add(relative(dir, configFilePath(dir, SECRET_JSON)));
    }
    for (const file of resolved.envFiles) {
      if (existsSync(file)) {
        candidates.add(relative(dir, file));
      }
    }
    const warnings: GitWarning[] = [];
    for (const file of candidates) {
      if (file.startsWith("..")) {
        continue;
      }
      const status = await checkGitStatus(dir, file);
      if (!status.inRepo) {
        continue;
      }
      if (status.tracked) {
        warnings.push({ file, kind: "tracked" });
      } else if (!status.ignored) {
        warnings.push({ file, kind: "notIgnored" });
      }
    }
    return warnings;
  }

  // -- Problems panel --

  private async refreshDiagnostics(): Promise<void> {
    const dir = this.workspaceDir;
    if (!dir) {
      return;
    }
    const resolved = this.resolve();
    const missing = findMissingEnvVars(this.scanUsages(), resolved.env, process.env);
    await this.publishDiagnostics(dir, resolved, missing, await this.computeGitWarnings(dir, resolved));
  }

  private async publishDiagnostics(
    dir: string,
    resolved: ResolvedEnv,
    missing: string[],
    gitWarnings: GitWarning[],
  ): Promise<void> {
    this.diagnostics.clear();
    const zhaoPath = configFilePath(dir, ZHAO_JSON);
    const secretPath = configFilePath(dir, SECRET_JSON);
    // Anchor everything on zhao.json when it exists (the file users edit
    // by hand), else the secret file; with neither there is nothing to
    // point at and the sidebar carries the messages.
    const anchor = existsSync(zhaoPath) ? zhaoPath : existsSync(secretPath) ? secretPath : null;
    if (anchor === null) {
      return;
    }
    const range = new vscode.Range(0, 0, 0, 1);
    const toSeverity = (severity: "error" | "warning") =>
      severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
    const entries: vscode.Diagnostic[] = resolved.diagnostics.map(
      (d) => new vscode.Diagnostic(range, d.message, toSeverity(d.severity)),
    );
    for (const name of missing) {
      entries.push(
        new vscode.Diagnostic(
          range,
          `${name} is read by env_var() in this dbt project but is not set in the active environment.`,
          vscode.DiagnosticSeverity.Warning,
        ),
      );
    }
    for (const warning of gitWarnings) {
      entries.push(
        new vscode.Diagnostic(
          range,
          warning.kind === "tracked"
            ? `${warning.file} may hold secrets and is already tracked by git -- ignoring it won't untrack it.`
            : `${warning.file} may hold secrets and is not in .gitignore.`,
          warning.kind === "tracked" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
        ),
      );
    }
    this.diagnostics.set(vscode.Uri.file(anchor), entries);
  }

  // -- Edits (every one writes a file; the watcher reports the change) --

  private readFiles(dir: string): { zhao: string | null; secret: string | null } {
    return {
      zhao: readTextIfExists(configFilePath(dir, ZHAO_JSON)),
      secret: readTextIfExists(configFilePath(dir, SECRET_JSON)),
    };
  }

  private write(dir: string, file: typeof ZHAO_JSON | typeof SECRET_JSON, text: string): void {
    writeConfigText(configFilePath(dir, file), text);
  }

  /** Adds or updates a variable. `secret` picks the file (and removes it
   * from the other one so it can't be defined twice); `set` is where it
   * lives (`null` = the flat base). Renames when `originalName` differs. */
  saveVariable(input: {
    name: string;
    value: string;
    secret: boolean;
    set: string | null;
    originalName?: string;
  }): string | null {
    const dir = this.workspaceDir;
    const name = input.name.trim();
    if (!dir || name.length === 0) {
      return null;
    }
    let { zhao, secret } = this.readFiles(dir);
    const rename = input.originalName !== undefined && input.originalName !== name;
    if (rename && (hasVariable(zhao, input.set, name) || hasVariable(secret, input.set, name))) {
      return `${name} already exists${input.set ? ` in ${input.set}` : ""}; pick another name.`;
    }
    if (rename && zhao !== null) {
      zhao = deleteVariable(zhao, input.set, input.originalName as string);
    }
    if (rename && secret !== null) {
      secret = deleteVariable(secret, input.set, input.originalName as string);
    }
    if (input.secret) {
      secret = setVariable(secret, input.set, name, input.value);
      if (zhao !== null) {
        zhao = deleteVariable(zhao, input.set, name);
      }
    } else {
      zhao = setVariable(zhao, input.set, name, input.value);
      if (secret !== null) {
        secret = deleteVariable(secret, input.set, name);
      }
    }
    if (zhao !== null) {
      this.write(dir, ZHAO_JSON, zhao);
    }
    if (secret !== null) {
      this.write(dir, SECRET_JSON, secret);
    }
    this.changed();
    return null;
  }

  removeVariable(file: typeof ZHAO_JSON | typeof SECRET_JSON, set: string | null, name: string): void {
    const dir = this.workspaceDir;
    const text = dir ? readTextIfExists(configFilePath(dir, file)) : null;
    if (!dir || text === null) {
      return;
    }
    this.write(dir, file, deleteVariable(text, set, name));
    this.changed();
  }

  /** Creates an empty set; returns an error message if the name is taken. */
  createSet(name: string): string | null {
    const dir = this.workspaceDir;
    const trimmed = name.trim();
    if (!dir || trimmed.length === 0) {
      return null;
    }
    const { zhao, secret } = this.readFiles(dir);
    if (hasSet(zhao, trimmed) || hasSet(secret, trimmed)) {
      return `A set named ${trimmed} already exists.`;
    }
    this.write(dir, ZHAO_JSON, addSet(zhao, trimmed));
    this.changed();
    return null;
  }

  /** Renames a set in both files; returns an error message if the new
   * name is taken. */
  async renameSet(from: string, to: string): Promise<string | null> {
    const dir = this.workspaceDir;
    const target = to.trim();
    if (!dir || target.length === 0 || target === from) {
      return null;
    }
    const { zhao, secret } = this.readFiles(dir);
    if (hasSet(zhao, target) || hasSet(secret, target)) {
      return `A set named ${target} already exists.`;
    }
    if (zhao !== null) {
      this.write(dir, ZHAO_JSON, renameSet(zhao, from, target));
    }
    if (secret !== null) {
      this.write(dir, SECRET_JSON, renameSet(secret, from, target));
    }
    if (this.context.workspaceState.get<string | null>(WORKSPACE_STATE_ENV_SET_KEY, null) === from) {
      await this.context.workspaceState.update(WORKSPACE_STATE_ENV_SET_KEY, target);
    }
    this.changed();
    return null;
  }

  async removeSet(name: string): Promise<void> {
    const dir = this.workspaceDir;
    if (!dir) {
      return;
    }
    const { zhao, secret } = this.readFiles(dir);
    if (zhao !== null) {
      this.write(dir, ZHAO_JSON, deleteSet(zhao, name));
    }
    if (secret !== null) {
      this.write(dir, SECRET_JSON, deleteSet(secret, name));
    }
    if (this.context.workspaceState.get<string | null>(WORKSPACE_STATE_ENV_SET_KEY, null) === name) {
      await this.context.workspaceState.update(WORKSPACE_STATE_ENV_SET_KEY, null);
    }
    this.changed();
  }

  /** Opens one of the extension's own files: `zhao.json`,
   * `zhao-secret.json` (created empty when asked for and absent), or a
   * `.env` file the configuration actually references -- never an
   * arbitrary path a message happens to carry. */
  async openFile(target: string): Promise<void> {
    const dir = this.workspaceDir;
    if (!dir) {
      return;
    }
    let path: string;
    if (target === ZHAO_JSON || target === SECRET_JSON) {
      path = configFilePath(dir, target);
      if (!existsSync(path)) {
        writeConfigText(path, "{}\n");
        this.reload();
      }
    } else {
      const absolute = isAbsolute(target) ? target : join(dir, target);
      if (!this.resolve().envFiles.includes(absolute)) {
        return;
      }
      path = absolute;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(path));
  }

  /** The one-click fix behind the "not git-ignored" warning -- never run
   * without the user asking for it, and only for a file the warning
   * itself named. */
  async addToGitignore(file: string): Promise<void> {
    const dir = this.workspaceDir;
    if (!dir) {
      return;
    }
    const warned = await this.computeGitWarnings(dir, this.resolve());
    if (!warned.some((warning) => warning.kind === "notIgnored" && warning.file === file)) {
      return;
    }
    addToGitignore(dir, file.split("\\").join("/"));
    this.reload();
  }
}
