// Auto-detects which dbt project a SQL file belongs to by walking up to
// the nearest `dbt_project.yml` -- mirroring zhao-cli's own marker-file
// convention for adapter auto-detection (see zhao-cli's ADR on adapter
// auto-detection). Pure filesystem walk, no VS Code API, so it's
// directly unit-testable against a synthetic directory tree -- the only
// non-pure thing here is `existsSync` itself.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join, parse } from "node:path";

const MARKER_FILE = "dbt_project.yml";

/** Directories a project-file search never descends into -- installed
 * package copies, compiled output, and VCS/dependency metadata, none of
 * which can hold the project's *own* model/seed source files. */
const EXCLUDED_DIR_NAMES = new Set(["dbt_packages", "target", "node_modules", ".git"]);

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

/**
 * Resolves a lineage node's owning source file, for the "Open Model
 * File" right-click action -- the reverse direction from
 * `findNearestDbtProjectDir`. A source has no file of its own to open
 * (it's an external input, not something the project defines) --
 * `kind: "source"` always resolves to `null`, regardless of `name`. A
 * model resolves to a `<name>.sql`, a seed to a `<name>.csv`, found by
 * walking `projectDir` (skipping `dbt_packages`/`target`/`node_modules`/
 * `.git` -- see `EXCLUDED_DIR_NAMES`) rather than parsing
 * `dbt_project.yml`'s `model-paths`/`seed-paths` config, mirroring this
 * module's existing marker-file-over-configuration philosophy. Returns
 * the first match found (dbt itself requires model/seed names be unique
 * project-wide, so more than one real match would itself be a broken
 * project) or `null` if none exists.
 */
export function findNodeSourceFile(projectDir: string, kind: "model" | "seed" | "source", name: string): string | null {
  if (kind === "source") {
    return null;
  }
  const extension = kind === "seed" ? ".csv" : ".sql";
  return findFileNamed(projectDir, `${name}${extension}`);
}

function findFileNamed(dir: string, fileName: string): string | null {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      const found = findFileNamed(join(dir, entry.name), fileName);
      if (found) {
        return found;
      }
    } else if (entry.isFile() && entry.name === fileName) {
      return join(dir, entry.name);
    }
  }
  return null;
}
