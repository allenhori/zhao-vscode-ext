// Auto-detects which dbt project a SQL file belongs to by walking up to
// the nearest `dbt_project.yml` -- mirroring zhao-cli's own marker-file
// convention for adapter auto-detection (see zhao-cli's ADR on adapter
// auto-detection). Pure filesystem walk, no VS Code API, so it's
// directly unit-testable against a synthetic directory tree -- the only
// non-pure thing here is `existsSync` itself.

import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";

const MARKER_FILE = "dbt_project.yml";

/**
 * Walks up from `filePath`'s containing directory to the filesystem
 * root, returning the first directory containing a `dbt_project.yml` --
 * the *nearest* one, so a monorepo with multiple dbt projects (and
 * possibly an outer marker too, e.g. a workspace-root placeholder)
 * resolves to the innermost project the file actually belongs to, not
 * whichever is farther up. Returns `null` if no directory above
 * `filePath` (inclusive of its own directory) has the marker.
 */
export function findNearestDbtProjectDir(filePath: string): string | null {
  let dir = dirname(filePath);
  const { root } = parse(dir);

  while (true) {
    if (existsSync(join(dir, MARKER_FILE))) {
      return dir;
    }
    if (dir === root) {
      return null;
    }
    dir = dirname(dir);
  }
}
