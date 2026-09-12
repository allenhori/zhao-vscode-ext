// Thin plumbing around the `zhao` subprocess: building its argv (pure,
// tested below), locating the executable on PATH, running it, and
// reading back the JSON artifacts it writes. No decision-making logic
// beyond argument construction lives here -- see
// `./engine/graphEngine.ts` for the one tested seam.

import { execFile, execFileSync } from "node:child_process";
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

export interface ShowInvocation {
  projectDir: string;
  /** The model/seed/source to preview -- a single bare selector, never
   * a `+`-prefixed/suffixed graph scope (see `zhao show`'s own CLI
   * docs -- it previews one resolved relation's query, not a slice of
   * the graph). */
  target: string;
  dbtCommand?: string;
  /** See `LineageInvocation.profileTarget`. */
  profileTarget?: string;
}

/** Builds argv for `zhao show <target> --output json`, always JSON
 * (never the human-readable default) -- the Preview tab always parses
 * this programmatically, never displays raw dbt terminal output.
 * Deliberately passes no `--target-path` override: unlike `zhao
 * lineage --compile`, `zhao show` runs no compile of its own to
 * isolate -- it's a live query against whatever the project's already-
 * compiled manifest describes, so there's no otherwise-unwanted
 * artifact to redirect away from the project's real `target/`. No
 * `--limit` override either -- the project's own `zhao.yml`
 * `show.default_limit` (or zhao-cli's hardcoded fallback) always
 * applies, per the spec's "no per-click limit override in v1" decision. */
export function buildShowArgs(invocation: ShowInvocation): string[] {
  const args = ["show", invocation.target, "--project-dir", invocation.projectDir, "--output", "json"];
  if (invocation.profileTarget) {
    args.push("--dbt-arg", "--target", "--dbt-arg", invocation.profileTarget);
  }
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

/** Cached across calls -- `undefined` means "not resolved yet this
 * process", `null` means "resolution was attempted and failed". A
 * user's PATH doesn't change mid-session, so shelling out on every
 * lookup would just be wasted latency for the same answer. */
let cachedShellPath: string | null | undefined;

/**
 * Resolves the user's *real*, shell-configured PATH by spawning their
 * default login shell -- not `process.env.PATH` as VS Code itself
 * already sees it.
 *
 * A GUI app launched from the Dock, Finder, or Spotlight (as opposed to
 * a `code .` from an already-configured terminal) inherits macOS's own
 * bare-minimum PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) -- it never runs
 * `~/.zshrc`/`~/.zprofile`/`~/.bash_profile`, which is where `cargo`,
 * Homebrew, `nvm`, and most other installers actually append to PATH.
 * So a `zhao` install that's genuinely on the user's PATH everywhere
 * else (any terminal, any other app) is invisible to
 * [`locateExecutable`] here even though nothing is actually
 * misconfigured. This is a well-known Electron/VS Code gap -- the
 * standard fix (the same one tools like VS Code's own integrated
 * terminal and most "fix path" utilities use) is to spawn the user's
 * shell in login+interactive mode (so its profile files actually get
 * sourced) purely to ask it what PATH it would use, then use that
 * instead of trusting the GUI process's own environment.
 *
 * Returns `null` (not a throw) on any failure -- an unusual `$SHELL`,
 * a shell that errors on startup, a timeout -- so a broken shell
 * profile degrades to "PATH resolution didn't help," never a crash;
 * [`locateExecutableAnywhere`] still falls back to whatever
 * `process.env.PATH` already had.
 */
function resolveShellPath(): string | null {
  if (cachedShellPath !== undefined) {
    return cachedShellPath;
  }
  const shell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : "/bin/zsh";
  try {
    const output = execFileSync(shell, ["-ilc", "echo -n \"$PATH\""], {
      encoding: "utf8",
      timeout: 5000,
      // A login shell's rc files often print banners/MOTD-style output
      // on stdout too -- stderr is discarded rather than surfaced,
      // since a noisy-but-successful profile shouldn't count as failure
      // here (only a non-zero exit/timeout does, via the catch below).
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = output.trim();
    cachedShellPath = trimmed.length > 0 ? trimmed : null;
  } catch {
    cachedShellPath = null;
  }
  return cachedShellPath;
}

/**
 * Like [`locateExecutable`], but when a plain search of
 * `process.env.PATH` (VS Code's own, possibly PATH-impoverished
 * environment -- see [`resolveShellPath`]) comes up empty, retries
 * once against the user's real shell-resolved PATH before giving up.
 * The env-parameterized [`locateExecutable`] itself stays a pure
 * function (directly unit-testable against a fake PATH, see
 * `zhaoCli.test.ts`) -- this wraps it with the one genuinely
 * environment-dependent, side-effecting fallback, so it's the function
 * real callers (`LineageController.executablePath`) should use instead
 * of calling `locateExecutable` directly.
 *
 * `resolveShell` is injectable (defaults to the real, process-spawning
 * [`resolveShellPath`]) purely so tests can stub the one genuinely
 * environment-dependent step without actually spawning a shell.
 */
export function locateExecutableAnywhere(
  configuredPath: string,
  env: NodeJS.ProcessEnv = process.env,
  resolveShell: () => string | null = resolveShellPath,
): string | null {
  const direct = locateExecutable(configuredPath, env);
  if (direct !== null) {
    return direct;
  }
  const shellPath = resolveShell();
  if (shellPath === null) {
    return null;
  }
  return locateExecutable(configuredPath, { ...env, PATH: shellPath });
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `executable args…`, always resolving (never rejecting) with the
 * captured exit code/stdout/stderr -- a non-zero exit or spawn failure
 * is a normal, expected outcome here (e.g. an unresolved lineage
 * target), for the caller to interpret, not this function.
 *
 * `signal`, if given, kills the subprocess when aborted -- used by
 * `LineageController.previewNode` to actually terminate a superseded
 * preview's `zhao show` invocation, not just discard its result. Without
 * this, switching between two "Preview Data" targets before the first
 * one resolves left the first's subprocess running to completion in the
 * background: wasted compute, and for an OAuth-gated warehouse target
 * (e.g. Databricks), two concurrent invocations can contend over a
 * shared local resource (the OAuth callback listener), which is a
 * real, observed way for the second one to hang. */
export function runZhao(executable: string, args: string[], signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(executable, args, { maxBuffer: 64 * 1024 * 1024, signal }, (error, stdout, stderr) => {
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
