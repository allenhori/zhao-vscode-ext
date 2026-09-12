// The Preview tab's one pure, tested seam -- see the spec's "one
// testing seam" decision, mirroring `./graphEngine.ts`. No VS Code
// API, no subprocess, no filesystem access: takes the already-captured
// result of running `zhao show --output json` and turns it into a
// renderable shape (or a readable error), never throwing.

/** A successful preview: column headers and rows, exactly as
 * `zhao show --output json` already normalized them (see zhao-cli's
 * own `ShowJsonOutput` -- column order preserved, not resorted). */
export interface PreviewSuccess {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** A failed preview -- either `zhao show` itself exited non-zero (a
 * compile error, an unresolvable selector, a warehouse permissions
 * error -- zhao-cli's own error text, relayed as-is) or it exited zero
 * but its stdout wasn't the JSON shape expected (defensive: shouldn't
 * happen given zhao-cli's contract, but never silently rendered as an
 * empty table if it somehow does). */
export interface PreviewError {
  error: string;
}

export type PreviewResult = PreviewSuccess | PreviewError;

export function isPreviewError(result: PreviewResult): result is PreviewError {
  return "error" in result;
}

/**
 * Turns a captured `zhao show --output json` subprocess result into a
 * [`PreviewResult`]. Never throws -- every failure mode (non-zero exit,
 * unparseable stdout, an unexpected JSON shape) resolves to a
 * [`PreviewError`] instead.
 */
export function parsePreviewResult(exitCode: number | null, stdout: string, stderr: string): PreviewResult {
  if (exitCode !== 0) {
    return { error: stderr.trim() || stdout.trim() || "zhao show failed with no output." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { error: "zhao show's output could not be parsed as JSON." };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).columns) ||
    !Array.isArray((parsed as Record<string, unknown>).rows)
  ) {
    return { error: "zhao show returned an unexpected JSON shape." };
  }

  const { columns, rows } = parsed as { columns: unknown[]; rows: unknown[] };
  return {
    columns: columns.map(String),
    rows: rows as Record<string, unknown>[],
  };
}
