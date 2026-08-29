// Parses just enough of dbt's `dbt_project.yml`/`profiles.yml` to
// populate the settings sidebar's active-target dropdown. Pure
// YAML-string-in, data-out functions -- locating *which* profiles.yml
// file to read (workspace-relative, `$DBT_PROFILES_DIR`, or
// `~/.dbt/profiles.yml`, in that order, matching dbt's own resolution
// order) is the one filesystem-touching piece, kept separate below.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/** The `profile:` key `dbt_project.yml` names -- which top-level key in
 * `profiles.yml` this project's connection config lives under. `null`
 * when the project's `dbt_project.yml` doesn't set one (or doesn't
 * parse as an object at all -- treated as "no target list available",
 * not an error the sidebar needs to surface). */
export function readDbtProjectProfileName(dbtProjectYamlText: string): string | null {
  const doc: unknown = parseYaml(dbtProjectYamlText);
  if (typeof doc !== "object" || doc === null) {
    return null;
  }
  const profile = (doc as Record<string, unknown>).profile;
  return typeof profile === "string" ? profile : null;
}

/** The target names available under `profileName` in `profiles.yml` --
 * i.e. `Object.keys(profiles.yml[profileName].outputs)`. Empty when the
 * profile or its `outputs` map is missing/malformed, never thrown. */
export function parseProfileTargets(profilesYamlText: string, profileName: string): string[] {
  const doc: unknown = parseYaml(profilesYamlText);
  if (typeof doc !== "object" || doc === null) {
    return [];
  }
  const profile = (doc as Record<string, unknown>)[profileName];
  if (typeof profile !== "object" || profile === null) {
    return [];
  }
  const outputs = (profile as Record<string, unknown>).outputs;
  if (typeof outputs !== "object" || outputs === null) {
    return [];
  }
  return Object.keys(outputs);
}

/** Locates `profiles.yml` the same order dbt itself resolves it: a
 * project-local `profiles.yml` first, then `$DBT_PROFILES_DIR`, then
 * `~/.dbt/profiles.yml`. Returns `null` when none of those exist. */
export function findProfilesYmlPath(
  projectDir: string,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string | null {
  const candidates = [
    join(projectDir, "profiles.yml"),
    env.DBT_PROFILES_DIR ? join(env.DBT_PROFILES_DIR, "profiles.yml") : null,
    join(homeDir, ".dbt", "profiles.yml"),
  ].filter((path): path is string => path !== null);

  return candidates.find((path) => existsSync(path)) ?? null;
}
