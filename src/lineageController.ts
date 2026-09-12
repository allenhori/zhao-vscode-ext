// Owns the extension's session state (active project/target, current
// depth/direction/focus/toggles, the last-loaded lineage graph) and
// drives a refresh: invoke `zhao lineage` (and, when diff-highlight is
// on, `zhao diff`) via `./zhaoCli.ts`, translate their output via
// `./zhaoJson.ts`, and scope it via `./engine/graphEngine.ts`. Thin
// plumbing around VS Code's API (workspace state, configuration) plus
// the tested pure modules -- not unit-tested itself, per the spec's
// testing decisions.

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as vscode from "vscode";
import { buildRenderableGraph } from "./engine/graphEngine.js";
import type { Direction, FullLineageJson, RunMetadataJson } from "./engine/types.js";
import { parsePreviewResult, type PreviewResult } from "./engine/previewEngine.js";
import { findNearestDbtProjectDir, findNodeSourceFile } from "./projectDetection.js";
import { findProfilesYmlPath, parseProfileTargets, readDbtProjectProfileName } from "./profilesYml.js";
import type { LineageWebviewState } from "./panel/lineageHtml.js";
import type { SettingsWebviewState } from "./sidebar/settingsHtml.js";
import { buildDiffArgs, buildLineageArgs, buildShowArgs, locateExecutableAnywhere, readZhaoJson, runZhao } from "./zhaoCli.js";
import { parseFullLineageJson, parseRunMetadataJson, type RawFullLineageJson, type RawRunMetadataJson } from "./zhaoJson.js";

const WORKSPACE_STATE_PROJECT_KEY = "zhao.activeProjectDir";
const WORKSPACE_STATE_TARGET_KEY = "zhao.activeTarget";

export class LineageController implements vscode.Disposable {
  private fullLineage: FullLineageJson | null = null;
  private runMetadata: RunMetadataJson | null = null;
  /** A ready-to-run command rebuilding exactly the diff-highlight
   * overlay's impacted models, from zhao-cli's own
   * `recommended_command` -- `null` whenever `runMetadata` is (no diff
   * data at all) or zhao-cli didn't generate one (no
   * `recommended-command.subcommand` configured, or nothing impacted).
   * The extension never constructs this itself -- see
   * `Report::with_recommended_command`. */
  private recommendedCommand: string | null = null;
  private terminal: vscode.Terminal | null = null;
  private nodeTerm = "model";
  private originTerm = "source";
  private focus: string | null = null;
  private depth: number;
  private direction: Direction;
  private columnLevel = false;
  private diffHighlight = false;
  private error: string | null = null;
  private refreshing = false;
  /** Which of the panel's two tabs is showing -- "lineage" (the
   * existing graph) or "preview" (the new data-preview tab, added
   * alongside it in the same webview rather than a second panel
   * registration -- see the spec's "single webview, two tabs" UI
   * decision). */
  private activeTab: "lineage" | "preview" = "lineage";
  /** The node id the Preview tab is currently scoped to -- `null` before
   * anything's ever been previewed this session. */
  private previewFocus: string | null = null;
  private previewLoading = false;
  /** `null` before anything's ever been previewed, or right when a new
   * preview starts (cleared immediately so a stale result never lingers
   * on screen while the fresh one is still loading). */
  private previewResult: PreviewResult | null = null;
  /** Incremented at the start of every `previewNode` call -- an async
   * `zhao show` invocation only commits its result if this still
   * matches the generation it captured when it started. Without this,
   * two overlapping `previewNode` calls (right-click node A, then
   * quickly node B before A's slower query resolves) could let A's
   * stale result land after B's, silently showing the wrong node's
   * data with no indication anything raced. */
  private previewRequestId = 0;
  /** The `--target-path` isolation directory the last successful
   * compile used -- reused by a `compile: false` refresh (e.g. turning
   * diff-highlight on with no run metadata cached yet) instead of
   * pointing at a brand-new, never-compiled-into directory. `null`
   * until the first successful compile this session, or after the
   * active project changes. */
  private lastTargetPathDir: string | null = null;

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration("zhao");
    this.depth = config.get<number>("depth", 3);
    this.direction = config.get<Direction>("direction", "both");
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  // -- Project/target (persisted per workspace; "remembered, not locked") --

  get activeProjectDir(): string | null {
    return this.context.workspaceState.get<string | null>(WORKSPACE_STATE_PROJECT_KEY, null);
  }

  async setActiveProjectDir(dir: string | null): Promise<void> {
    await this.context.workspaceState.update(WORKSPACE_STATE_PROJECT_KEY, dir);
    this.fullLineage = null;
    this.runMetadata = null;
    this.recommendedCommand = null;
    this.focus = null;
    this.error = null;
    this.lastTargetPathDir = null;

    // Default the active target to the new project's own first available
    // one, rather than leaving whatever the *previous* project's target
    // happened to be (which may not even exist here, or may silently
    // point at the wrong environment for this project). Only when the
    // current target isn't already valid for this project -- switching
    // back to a project you were just on keeps whatever you'd picked.
    if (dir) {
      const targets = await this.resolveAvailableTargets(dir);
      if (targets.length > 0 && !targets.includes(this.activeTarget ?? "")) {
        await this.context.workspaceState.update(WORKSPACE_STATE_TARGET_KEY, targets[0]);
      }
    }

    this.changeEmitter.fire();
  }

  /** Shows a searchable picker (VS Code's own `QuickPick` -- fuzzy-
   * filters on both the label and the full path as you type, which is
   * what makes this usable in a monorepo with many dbt projects) of
   * every dbt project already detected in the workspace, plus a
   * "Browse…" fallback for one that isn't (e.g. outside the open
   * workspace folders entirely). */
  async pickActiveProjectDir(): Promise<void> {
    const projects = await this.findWorkspaceProjects();
    const browseLabel = "$(folder-opened) Browse…";
    const items: vscode.QuickPickItem[] = [
      ...projects.map((path) => ({ label: basename(path), description: path })),
      { label: browseLabel },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a dbt project",
      matchOnDescription: true,
    });
    if (!picked) {
      return;
    }

    if (picked.label === browseLabel) {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Select dbt project",
        defaultUri: this.activeProjectDir ? vscode.Uri.file(this.activeProjectDir) : undefined,
      });
      if (uris?.[0]) {
        await this.setActiveProjectDir(uris[0].fsPath);
      }
      return;
    }

    await this.setActiveProjectDir(picked.description ?? picked.label);
  }

  get activeTarget(): string | null {
    return this.context.workspaceState.get<string | null>(WORKSPACE_STATE_TARGET_KEY, null);
  }

  async setActiveTarget(target: string | null): Promise<void> {
    await this.context.workspaceState.update(WORKSPACE_STATE_TARGET_KEY, target);
    this.changeEmitter.fire();
  }

  /** dbt projects found anywhere in the open workspace folders, for the
   * settings sidebar's project override dropdown. Cheap glob, not a
   * full walk -- `**​/dbt_project.yml` covers monorepos without needing
   * this extension to know their layout. */
  async findWorkspaceProjects(): Promise<string[]> {
    const found = await vscode.workspace.findFiles("**/dbt_project.yml", "**/node_modules/**", 50);
    return [...new Set(found.map((uri) => join(uri.fsPath, "..")))];
  }

  /** Walks up from `filePath` to the nearest `dbt_project.yml` and, if
   * one is found and different from the current active project, adopts
   * it -- called on active-editor change. Never overrides an explicit
   * user choice with a *worse* guess: only auto-adopts when there's
   * currently no active project at all, or the file clearly belongs to
   * a different one than what's active. */
  async autoDetectProjectForFile(filePath: string): Promise<void> {
    const detected = findNearestDbtProjectDir(filePath);
    if (detected && detected !== this.activeProjectDir) {
      await this.setActiveProjectDir(detected);
    }
    if (detected) {
      this.guessFocusForFile(filePath);
    }
  }

  /** Best-effort: matches the active file's basename (minus `.sql`) to
   * a unique model/source name in the already-loaded lineage graph.
   * Ambiguous (multiple packages with the same model name) or no match
   * leaves focus untouched -- see the panel's own focus dropdown for a
   * manual fallback. */
  private guessFocusForFile(filePath: string): void {
    if (!this.fullLineage) {
      return;
    }
    const stem = basename(filePath).replace(/\.sql$/i, "");
    const matches = this.fullLineage.nodes.filter((n) => n.name === stem);
    if (matches.length === 1) {
      this.focus = matches[0]!.id;
      this.changeEmitter.fire();
    }
  }

  // -- Executable resolution --

  get executablePath(): string | null {
    const configured = vscode.workspace.getConfiguration("zhao").get<string>("executablePath", "zhao");
    return locateExecutableAnywhere(configured);
  }

  // -- Panel-driven setters --

  setFocus(focus: string | null): void {
    this.focus = focus;
    this.changeEmitter.fire();
  }
  setDepth(depth: number): void {
    this.depth = Math.max(0, depth);
    this.changeEmitter.fire();
  }
  setDirection(direction: Direction): void {
    this.direction = direction;
    this.changeEmitter.fire();
  }
  setColumnLevel(value: boolean): void {
    this.columnLevel = value;
    this.changeEmitter.fire();
  }
  async setDiffHighlight(value: boolean): Promise<void> {
    this.diffHighlight = value;
    if (!value) {
      // The recommended-command bar isn't itself gated on diffHighlight
      // in the webview (it's meaningful on its own) -- clear it
      // explicitly so turning diff-highlight off doesn't leave a stale
      // command from the last time it was on still showing.
      this.runMetadata = null;
      this.recommendedCommand = null;
      this.changeEmitter.fire();
      return;
    }
    if (!this.runMetadata) {
      await this.refresh(false);
      return;
    }
    this.changeEmitter.fire();
  }

  // -- Refresh --

  /** Runs `zhao lineage` (and, if diff-highlight is on, `zhao diff`
   * too) against the active project, isolated to a fresh temp
   * `--target-path` -- never the project's real `target/`. `compile`
   * controls whether `--compile` is passed; a plain re-render (only a
   * depth/direction/toggle change) can skip it and re-read the last
   * compile's output instead, as long as one has actually happened yet
   * this session. */
  async refresh(compile: boolean): Promise<void> {
    if (this.refreshing) {
      // A caller (e.g. setDiffHighlight) may have already applied its
      // own state change before calling refresh() -- still notify the
      // webview of that, even though this particular refresh is a
      // no-op; the in-flight refresh's own completion will fire again
      // once it finishes.
      this.changeEmitter.fire();
      return;
    }
    const projectDir = this.activeProjectDir;
    if (!projectDir) {
      this.error = "No dbt project detected. Open a .sql file inside a dbt project, or pick one in the zhao sidebar.";
      this.changeEmitter.fire();
      return;
    }
    const executable = this.executablePath;
    if (!executable) {
      this.changeEmitter.fire();
      return;
    }

    this.refreshing = true;
    this.error = null;
    try {
      // A fresh isolation directory only when actually compiling (or
      // there's nothing to re-read yet this session) -- a `compile:
      // false` refresh with a prior successful compile reuses that
      // compile's own `targetPathDir`, since a brand-new, never-
      // compiled-into directory would have no manifest for `zhao
      // lineage` to read at all.
      const actuallyCompile = compile || this.lastTargetPathDir === null;
      const targetPathDir = actuallyCompile
        ? join(tmpdir(), `zhao-vscode-ext-${randomUUID()}`)
        : this.lastTargetPathDir!;
      if (actuallyCompile) {
        mkdirSync(targetPathDir, { recursive: true });
      }

      const lineageArgs = buildLineageArgs({
        projectDir,
        targetPathDir,
        compile: actuallyCompile,
        profileTarget: this.activeTarget ?? undefined,
      });
      const lineageResult = await runZhao(executable, lineageArgs);
      if (lineageResult.code !== 0) {
        this.error = lineageResult.stderr.trim() || "zhao lineage failed.";
        this.changeEmitter.fire();
        return;
      }
      this.lastTargetPathDir = targetPathDir;

      const fullLineagePath = join(projectDir, "target", "zhao", "full_lineage.json");
      const raw = readZhaoJson<RawFullLineageJson>(fullLineagePath);
      const { graph, nodeTerm, originTerm } = parseFullLineageJson(raw);
      this.fullLineage = graph;
      this.nodeTerm = nodeTerm;
      this.originTerm = originTerm;

      if (this.diffHighlight) {
        const diffArgs = buildDiffArgs({
          projectDir,
          targetPathDir,
          profileTarget: this.activeTarget ?? undefined,
        });
        const diffResult = await runZhao(executable, diffArgs);
        try {
          const rawMetadata = JSON.parse(diffResult.stdout) as RawRunMetadataJson;
          const parsed = parseRunMetadataJson(rawMetadata);
          this.runMetadata = parsed.runMetadata;
          this.recommendedCommand = parsed.recommendedCommand;
        } catch {
          // `zhao diff` failing (e.g. no resolvable Baseline yet) just
          // means no diff overlay this round -- not a fatal error for
          // the lineage view itself.
          this.runMetadata = null;
          this.recommendedCommand = null;
        }
      } else {
        this.runMetadata = null;
        this.recommendedCommand = null;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.refreshing = false;
      this.changeEmitter.fire();
    }
  }

  // -- Preview tab --

  setActiveTab(tab: "lineage" | "preview"): void {
    this.activeTab = tab;
    this.changeEmitter.fire();
  }

  /** Runs `zhao show` against `nodeId`, switching to the Preview tab and
   * scoping it to that node -- the right-click "Preview Data" action's
   * entry point, and also usable directly from the Preview tab's own
   * node picker. Every call re-queries fresh: no caching of a previous
   * result for the same node, matching the same "no silent stale state"
   * principle already set for lineage's manual-refresh default.
   *
   * A source has no query of its own to preview -- same rule the
   * right-click menu already enforces by disabling "Preview Data" for
   * one, re-checked here too since the Preview tab's own node picker
   * has no way to grey out a single `<option>`. */
  async previewNode(nodeId: string): Promise<void> {
    const projectDir = this.activeProjectDir;
    const node = this.fullLineage?.nodes.find((n) => n.id === nodeId);
    if (!projectDir || !node || node.kind === "source") {
      return;
    }

    // Captured *before* any `await` -- see `previewRequestId`'s own
    // comment. Any later-resolving call from an earlier click bails out
    // in `finally` below rather than overwriting a newer one's result.
    const requestId = ++this.previewRequestId;

    this.activeTab = "preview";
    this.previewFocus = nodeId;
    this.previewLoading = true;
    this.previewResult = null;
    this.changeEmitter.fire();

    const executable = this.executablePath;
    if (!executable) {
      if (requestId === this.previewRequestId) {
        this.previewLoading = false;
        this.previewResult = { error: "zhao-cli was not found on PATH." };
        this.changeEmitter.fire();
      }
      return;
    }

    let result: PreviewResult;
    try {
      const args = buildShowArgs({
        projectDir,
        target: node.name,
        profileTarget: this.activeTarget ?? undefined,
      });
      const zhaoResult = await runZhao(executable, args);
      result = parsePreviewResult(zhaoResult.code, zhaoResult.stdout, zhaoResult.stderr);
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }

    if (requestId !== this.previewRequestId) {
      // A newer `previewNode` call has already started (and possibly
      // already finished) since this one began -- discard this result
      // rather than clobber whatever the newer call already showed.
      return;
    }
    this.previewResult = result;
    this.previewLoading = false;
    this.changeEmitter.fire();
  }

  /** Right-click "Open Model File": jumps to `nodeId`'s `.sql`/`.csv`
   * source. A source has none to open -- see
   * `findNodeSourceFile`, which resolves `null` for that kind and for
   * any model/seed whose file genuinely can't be found (reported via a
   * warning, never a silent no-op). */
  async openModelFile(nodeId: string): Promise<void> {
    const projectDir = this.activeProjectDir;
    const node = this.fullLineage?.nodes.find((n) => n.id === nodeId);
    if (!projectDir || !node) {
      return;
    }
    const filePath = findNodeSourceFile(projectDir, node.kind, node.name);
    if (!filePath) {
      await vscode.window.showWarningMessage(
        node.kind === "source"
          ? `${node.name} is a source -- it has no source file of its own to open.`
          : `Could not find a source file for ${node.name}.`,
      );
      return;
    }
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
  }

  // -- Rendered state for the two webviews --

  getLineageWebviewState(): LineageWebviewState {
    const graph = this.fullLineage
      ? buildRenderableGraph(this.fullLineage, this.runMetadata, {
          focus: this.focus,
          depth: this.depth,
          direction: this.direction,
          columnLevel: this.columnLevel,
          diffHighlight: this.diffHighlight,
        })
      : null;

    return {
      graph,
      allNodes: this.fullLineage?.nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind })) ?? [],
      focus: this.focus,
      nodeTerm: this.nodeTerm,
      originTerm: this.originTerm,
      depth: this.depth,
      direction: this.direction,
      columnLevel: this.columnLevel,
      diffHighlight: this.diffHighlight,
      recommendedCommand: this.recommendedCommand,
      missingExecutable: this.executablePath === null,
      error: this.error,
      activeTab: this.activeTab,
      previewFocus: this.previewFocus,
      previewLoading: this.previewLoading,
      previewResult: this.previewResult,
    };
  }

  /** Copies `recommendedCommand` to the clipboard -- a no-op if there
   * isn't one (the panel only shows the button when there is). */
  async copyRecommendedCommand(): Promise<void> {
    if (this.recommendedCommand) {
      await vscode.env.clipboard.writeText(this.recommendedCommand);
    }
  }

  /** Types `recommendedCommand` into a reused (or freshly created)
   * integrated terminal and shows it -- deliberately does *not* press
   * Enter (`sendText`'s second argument is `false`): the user reviews
   * the command in their own real shell (aliases/direnv/venv intact)
   * and runs it themselves. No-op if there isn't one. */
  runRecommendedCommandInTerminal(): void {
    if (!this.recommendedCommand) {
      return;
    }
    if (!this.terminal || this.terminal.exitStatus !== undefined) {
      this.terminal = vscode.window.createTerminal("zhao");
    }
    this.terminal.show();
    this.terminal.sendText(this.recommendedCommand, false);
  }

  async getSettingsWebviewState(): Promise<SettingsWebviewState> {
    const projectDir = this.activeProjectDir;
    const availableTargets = projectDir ? await this.resolveAvailableTargets(projectDir) : [];

    return {
      missingExecutable: this.executablePath === null,
      activeProject: projectDir,
      availableTargets,
      activeTarget: this.activeTarget,
    };
  }

  /** The target names available under `projectDir`'s resolved
   * `profiles.yml` -- `[]` if it has no `profile:` key, no
   * `profiles.yml` can be found for it at all, or either fails to
   * read/parse. Shared by `getSettingsWebviewState` (to populate the
   * dropdown) and `setActiveProjectDir` (to default the active target
   * when switching projects). */
  private async resolveAvailableTargets(projectDir: string): Promise<string[]> {
    try {
      const dbtProjectYaml = await vscode.workspace.fs
        .readFile(vscode.Uri.file(join(projectDir, "dbt_project.yml")))
        .then((bytes) => Buffer.from(bytes).toString("utf8"));
      const profileName = readDbtProjectProfileName(dbtProjectYaml);
      const profilesPath = profileName
        ? findProfilesYmlPath(projectDir, process.env, homedir())
        : null;
      if (!profileName || !profilesPath) {
        return [];
      }
      const profilesYaml = await vscode.workspace.fs
        .readFile(vscode.Uri.file(profilesPath))
        .then((bytes) => Buffer.from(bytes).toString("utf8"));
      return parseProfileTargets(profilesYaml, profileName);
    } catch {
      return [];
    }
  }
}
