// Thin plumbing around the `zhao` subprocess: building its argv (pure,
// tested below), locating the executable on PATH, running it, and
// reading back the JSON artifacts it writes. No decision-making logic
// beyond argument construction lives here -- see
// `./engine/graphEngine.ts` for the one tested seam.

import { execFile } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export interface LineageInvocation {
  projectDir: string;
  /** Where `zhao lineage --compile` isolates its `dbt compile` output --
   * a temp directory, never the project's real `target/`. Also where
   * the otherwise-unwanted default HTML export gets redirected, so
   * nothing lands in the project's real `target/zhao/lineage_graphs/`
   * either. */
  targetPathDir: string;
  /** Skips `--compile` -- reads whatever's already at `targetPathDir`
   * as-is. Used for a plain re-render (depth/direction/toggle change)
   * that doesn't need a fresh compile. */
  compile: boolean;
  dbtCommand?: string;
  /** The settings sidebar's active profile target (e.g. `"ci"`), passed
   * through to `dbt` as its own `--target`. Not to be confused with
   * `targetPathDir` (dbt's `--target-path`, an unrelated flag despite
   * the similar name) -- both are forwarded together via repeated
   * `--dbt-arg` pairs, never a single `--dbt-args` string, so neither
   * needs shell-quoting and both always compose safely. */
  profileTarget?: string;
}

/** Builds the repeated `--dbt-arg` pairs forwarded to `dbt`: always
 * `--target-path targetPathDir` (the isolation override), plus
 * `--target profileTarget` when a profile target was given. Repeated
 * `--dbt-arg` rather than one shell-word-split `--dbt-args` string, so
 * neither value needs shell-quoting and the two compose safely
 * regardless of what either contains. */
function dbtArgPairs(targetPathDir: string, profileTarget: string | undefined): string[] {
  const args = ["--dbt-arg", "--target-path", "--dbt-arg", targetPathDir];
  if (profileTarget) {
    args.push("--dbt-arg", "--target", "--dbt-arg", profileTarget);
  }
  return args;
}

/** Builds argv for `zhao lineage`, isolating its compile (when
 * requested) to `targetPathDir` -- see zhao-cli's own `--target-path`
 * isolation support. `full_lineage.json` still lands at the project's
 * real `target/zhao/full_lineage.json`, unaffected by the override --
 * only the *compiled dbt manifest* (and the otherwise-unwanted default
 * HTML export, redirected here) are isolated. */
export function buildLineageArgs(invocation: LineageInvocation): string[] {
  const args = ["lineage", "--project-dir", invocation.projectDir];
  if (invocation.compile) {
    args.push("--compile");
  }
  args.push("--html", join(invocation.targetPathDir, "discard.html"));
  args.push(...dbtArgPairs(invocation.targetPathDir, invocation.profileTarget));
  if (invocation.dbtCommand) {
    args.push("--dbt-command", invocation.dbtCommand);
  }
  return args;
}

export interface DiffInvocation {
  projectDir: string;
  /** Must match the `targetPathDir` a preceding `zhao lineage --compile`
   * used, so this reads back the identical manifest instead of
   * triggering (or failing without) a second compile. */
  targetPathDir: string;
  dbtCommand?: string;
  /** Must match the `profileTarget` that same preceding compile used --
   * see `LineageInvocation.profileTarget`. */
  profileTarget?: string;
  against?: string;
}

/** Builds argv for `zhao diff --format json`, pointed at the same
 * isolated `targetPathDir` a preceding `zhao lineage --compile` used --
 * see `buildLineageArgs`. */
export function buildDiffArgs(invocation: DiffInvocation): string[] {
  const args = ["diff", "--project-dir", invocation.projectDir, "--format", "json"];
  args.push(...dbtArgPairs(invocation.targetPathDir, invocation.profileTarget));
  if (invocation.dbtCommand) {
    args.push("--dbt-command", invocation.dbtCommand);
  }
  if (invocation.against) {
    args.push("--against", invocation.against);
  }
  return args;
}

/**
 * Resolves `configuredPath` (`zhao.executablePath`, ordinarily just
 * `"zhao"`) to an actual, runnable file: if it already looks like a
 * path (contains a separator), checked directly; otherwise scanned
 * across `PATH` the same way a shell would resolve a bare command
 * name. Returns `null` when nothing executable is found anywhere --
 * the signal the missing-executable warning banner acts on.
 */
export function locateExecutable(
  configuredPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (isAbsolute(configuredPath) || configuredPath.includes("/") || configuredPath.includes("\\")) {
    return isExecutableFile(configuredPath) ? configuredPath : null;
  }

  const pathEntries = (env.PATH ?? "").split(delimiter).filter((entry) => entry.length > 0);
  const candidateNames =
    process.platform === "win32" ? [configuredPath, `${configuredPath}.exe`, `${configuredPath}.cmd`] : [configuredPath];

  for (const dir of pathEntries) {
    for (const name of candidateNames) {
      const candidate = join(dir, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `executable args…`, always resolving (never rejecting) with the
 * captured exit code/stdout/stderr -- a non-zero exit or spawn failure
 * is a normal, expected outcome here (e.g. an unresolved lineage
 * target), for the caller to interpret, not this function. */
export function runZhao(executable: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(executable, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

/** Reads and JSON-parses a file zhao-cli wrote, e.g.
 * `<project-dir>/target/zhao/full_lineage.json`. Throws (the caller
 * surfaces the failure -- most commonly "the file doesn't exist yet
 * because no compile has run") rather than returning an optional; a
 * silently-missing lineage graph is worse than a visible error. */
export function readZhaoJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
