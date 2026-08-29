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
import { findNearestDbtProjectDir } from "./projectDetection.js";
import { findProfilesYmlPath, parseProfileTargets, readDbtProjectProfileName } from "./profilesYml.js";
import type { LineageWebviewState } from "./panel/lineageHtml.js";
import type { SettingsWebviewState } from "./sidebar/settingsHtml.js";
import { buildDiffArgs, buildLineageArgs, locateExecutable, readZhaoJson, runZhao } from "./zhaoCli.js";
import { parseFullLineageJson, parseRunMetadataJson, type RawFullLineageJson, type RawRunMetadataJson } from "./zhaoJson.js";

const WORKSPACE_STATE_PROJECT_KEY = "zhao.activeProjectDir";
const WORKSPACE_STATE_TARGET_KEY = "zhao.activeTarget";

export class LineageController implements vscode.Disposable {
  private fullLineage: FullLineageJson | null = null;
  private runMetadata: RunMetadataJson | null = null;
  private nodeTerm = "model";
  private originTerm = "source";
  private focus: string | null = null;
  private depth: number;
  private direction: Direction;
  private columnLevel = false;
  private diffHighlight = false;
  private error: string | null = null;
  private refreshing = false;
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
    this.focus = null;
    this.error = null;
    this.lastTargetPathDir = null;
    this.changeEmitter.fire();
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
    return locateExecutable(configured);
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
    if (value && !this.runMetadata) {
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
          this.runMetadata = parseRunMetadataJson(rawMetadata);
        } catch {
          // `zhao diff` failing (e.g. no resolvable Baseline yet) just
          // means no diff overlay this round -- not a fatal error for
          // the lineage view itself.
          this.runMetadata = null;
        }
      } else {
        this.runMetadata = null;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.refreshing = false;
      this.changeEmitter.fire();
    }
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
      allNodes: this.fullLineage?.nodes.map((n) => ({ id: n.id, name: n.name })) ?? [],
      focus: this.focus,
      nodeTerm: this.nodeTerm,
      originTerm: this.originTerm,
      depth: this.depth,
      direction: this.direction,
      columnLevel: this.columnLevel,
      diffHighlight: this.diffHighlight,
      missingExecutable: this.executablePath === null,
      error: this.error,
    };
  }

  async getSettingsWebviewState(): Promise<SettingsWebviewState> {
    const availableProjects = await this.findWorkspaceProjects();
    const projectDir = this.activeProjectDir;

    let availableTargets: string[] = [];
    if (projectDir) {
      try {
        const dbtProjectYaml = await vscode.workspace.fs
          .readFile(vscode.Uri.file(join(projectDir, "dbt_project.yml")))
          .then((bytes) => Buffer.from(bytes).toString("utf8"));
        const profileName = readDbtProjectProfileName(dbtProjectYaml);
        const profilesPath = profileName
          ? findProfilesYmlPath(projectDir, process.env, homedir())
          : null;
        if (profileName && profilesPath) {
          const profilesYaml = await vscode.workspace.fs
            .readFile(vscode.Uri.file(profilesPath))
            .then((bytes) => Buffer.from(bytes).toString("utf8"));
          availableTargets = parseProfileTargets(profilesYaml, profileName);
        }
      } catch {
        availableTargets = [];
      }
    }

    return {
      missingExecutable: this.executablePath === null,
      availableProjects,
      activeProject: projectDir,
      availableTargets,
      activeTarget: this.activeTarget,
    };
  }
}
