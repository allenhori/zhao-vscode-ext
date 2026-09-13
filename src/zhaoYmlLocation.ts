// Locates the repo root for the zhao.yml setup wizard's "repo root vs.
// this project" location choice. Pure filesystem walk, no VS Code API --
// mirrors `./projectDetection.ts`'s own nearest-marker-file convention
// (there: nearest `dbt_project.yml`; here: nearest `.git`, the same
// marker zhao-cli's own root/project zhao.yml layering uses -- see
// zhao-cli's docs/configuration.md "Monorepos" section).

import { existsSync } from "node:fs";
import { dirname, parse, join } from "node:path";

/**
 * Walks up from `startDir` to the filesystem root, returning the first
 * directory containing a `.git` entry -- the repo root zhao-cli itself
 * treats as the org-wide `zhao.yml` default's location. Returns `null`
 * if no ancestor (inclusive of `startDir`) has one.
 */
export function findGitRootDir(startDir: string): string | null {
  let dir = startDir;
  const { root } = parse(dir);

  while (true) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    if (dir === root) {
      return null;
    }
    dir = dirname(dir);
  }
}

/**
 * Whether `projectDir` already has a `zhao.yml` covering it -- either
 * directly (project-level) or via a root-level one at `repoRootDir`
 * (org-wide default; see `findGitRootDir`). Used by the settings
 * sidebar to decide whether to show the "Set Up zhao.yml" banner --
 * shown only when neither exists.
 */
export function hasZhaoYml(projectDir: string, repoRootDir: string | null): boolean {
  if (existsSync(join(projectDir, "zhao.yml"))) {
    return true;
  }
  return repoRootDir !== null && existsSync(join(repoRootDir, "zhao.yml"));
}
