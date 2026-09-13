// Pure generation of a minimal zhao.yml for the setup wizard
// (`./zhaoYmlWizard.ts`). No VS Code API, no filesystem, no subprocess
// here -- just string-in/string-out, so the "only prompt for what's
// truly required" decision is directly unit-testable. See
// docs/configuration.md in zhao-cli for the full schema this is a
// deliberately small subset of.

export interface ZhaoYmlWizardAnswers {
  /** The one thing the wizard actually asks the user -- see
   * `runZhaoYmlWizard`'s own comment for why this is the only required
   * prompt. */
  dbtCommand: string;
  /** The repo's actual default branch (e.g. from `origin/HEAD`),
   * `null` when it couldn't be auto-detected. Only written into the
   * file when it differs from zhao's own built-in `master` default --
   * see `shouldSetAgainst`. */
  detectedDefaultBranch: string | null;
}

/** zhao-cli's own built-in default for `against` -- see
 * docs/configuration.md's "against" section in zhao-cli. Kept as a
 * named constant here (rather than a bare string literal in
 * `shouldSetAgainst`) so the one place this assumption lives is
 * unambiguous if zhao-cli's own default ever changes. */
export const ZHAO_BUILTIN_DEFAULT_AGAINST = "master";

/** Whether the wizard should actually write an `against:` line --
 * only when a default branch was detected at all, and it differs from
 * zhao's own built-in default (writing `against: master` would just be
 * a no-op restatement of the default, cluttering the file for nothing). */
export function shouldSetAgainst(detectedDefaultBranch: string | null): detectedDefaultBranch is string {
  return detectedDefaultBranch !== null && detectedDefaultBranch !== ZHAO_BUILTIN_DEFAULT_AGAINST;
}

/**
 * Generates the full `zhao.yml` file content: `dbt-command` (and,
 * commented out beneath it, `dbt-args`) always present with the agreed
 * explanatory comments; `against` present only per `shouldSetAgainst`;
 * every other documented key (`preset`, per-Rule overrides, `defer`,
 * `recommended-command`, `tool`, `log`) as a commented-out example with
 * its own explanation -- never prompted for, never given an active
 * value.
 */
export function generateZhaoYml(answers: ZhaoYmlWizardAnswers): string {
  const lines: string[] = [];

  lines.push(
    "# The command zhao runs whenever it needs to invoke dbt in this project (compiling for",
    "# lineage/preview, resolving your baseline, etc). Usually just \"dbt\" -- but if your project",
    "# runs dbt through something else (a venv/uv shim, an in-house wrapper script, a Docker",
    "# wrapper), put that here instead: e.g. \"uv run dbt\", or \"myshell custom-flag\". Whatever you",
    "# set gets a dbt subcommand appended after it exactly as-is, so use the same command you'd",
    "# type yourself right before \"compile\"/\"run\"/\"ls\".",
    `dbt-command: ${answers.dbtCommand}`,
    "",
    "# Extra flags appended after the subcommand on every dbt call zhao makes (e.g. --target,",
    "# --vars) -- separate from dbt-command above, not part of the wrapper prefix itself.",
    "# Leave commented out unless your project needs this on every invocation.",
    "# dbt-args: \"--target ci\"",
    "",
  );

  if (shouldSetAgainst(answers.detectedDefaultBranch)) {
    lines.push(
      `# Auto-detected from this repo's default branch -- the base zhao check/diff compares`,
      "# against when nothing else is given. Change or remove if this isn't the branch you",
      "# actually want as a baseline.",
      `against: ${answers.detectedDefaultBranch}`,
      "",
    );
  }

  lines.push(
    "# A named bundle of Rule severities applied before any per-Rule override below --",
    "# \"strict\" turns every warn into an error, \"lenient\" turns every error into a warn.",
    "# Omit entirely (or set \"default\") for zhao's own built-in severities, unchanged.",
    "# preset: strict",
    "",
    "# Overrides one specific Rule's severity, regardless of which preset (if any) is active.",
    "# Valid severities: error, warn, pass. See zhao-cli's docs/configuration.md for the full",
    "# Rule catalog.",
    "# rules:",
    "#   column-added: warn",
    "",
    "# Backs the \"Defer plan:\" report section: a human-readable label plus the manifest path",
    "# dbt's own --state flag needs, for when you want to see what a Change would defer against.",
    "# defer:",
    "#   target: prod",
    "#   state: artifacts/prod/manifest.json",
    "",
    "# A ready-to-run command rebuilding exactly the models a Change impacts. Unset (the",
    "# default) means no \"Recommended command:\" line is generated -- zhao has no way to know",
    "# whether your workflow wants run/build/test unless you tell it.",
    "# recommended-command:",
    "#   subcommand: run",
    "",
    "# Which Transformation Tool Adapter zhao should use -- almost never needed, since zhao",
    "# auto-detects this from your project directory. Only consulted as a fallback when",
    "# auto-detection genuinely can't tell.",
    "# tool: dbt",
    "",
    "# Settings for zhao's daily-rotating run log (target/zhao/logs/<date>.log).",
    "# log:",
    "#   level: mirror",
    "#   retention_days: 30",
    "",
  );

  return lines.join("\n");
}
