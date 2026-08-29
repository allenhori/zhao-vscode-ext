import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProfilesYmlPath, parseProfileTargets, readDbtProjectProfileName } from "./profilesYml.js";

describe("readDbtProjectProfileName", () => {
  it("reads the profile: key", () => {
    expect(readDbtProjectProfileName("name: fixture\nprofile: my_profile\n")).toBe("my_profile");
  });

  it("returns null when no profile key is set", () => {
    expect(readDbtProjectProfileName("name: fixture\n")).toBeNull();
  });

  it("returns null for malformed yaml that doesn't parse as an object", () => {
    expect(readDbtProjectProfileName("- just\n- a\n- list\n")).toBeNull();
  });
});

describe("parseProfileTargets", () => {
  const profilesYaml = `
my_profile:
  target: dev
  outputs:
    dev:
      type: postgres
    prod:
      type: postgres
other_profile:
  target: dev
  outputs:
    dev:
      type: postgres
`;

  it("lists the target names under the given profile's outputs", () => {
    expect(parseProfileTargets(profilesYaml, "my_profile").sort()).toEqual(["dev", "prod"]);
  });

  it("returns an empty list for a profile name that isn't present", () => {
    expect(parseProfileTargets(profilesYaml, "does_not_exist")).toEqual([]);
  });

  it("returns an empty list when outputs is missing", () => {
    expect(parseProfileTargets("my_profile:\n  target: dev\n", "my_profile")).toEqual([]);
  });
});

describe("findProfilesYmlPath", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "zhao-vscode-ext-profiles-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("prefers a project-local profiles.yml over everything else", () => {
    const projectDir = join(root, "project");
    const home = join(root, "home");
    const dbtProfilesDir = join(root, "dbt-profiles-dir");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(home, ".dbt"), { recursive: true });
    mkdirSync(dbtProfilesDir, { recursive: true });
    writeFileSync(join(projectDir, "profiles.yml"), "x: 1\n");
    writeFileSync(join(home, ".dbt", "profiles.yml"), "x: 1\n");
    writeFileSync(join(dbtProfilesDir, "profiles.yml"), "x: 1\n");

    expect(
      findProfilesYmlPath(projectDir, { DBT_PROFILES_DIR: dbtProfilesDir }, home),
    ).toBe(join(projectDir, "profiles.yml"));
  });

  it("falls back to $DBT_PROFILES_DIR when there's no project-local file", () => {
    const projectDir = join(root, "project");
    const home = join(root, "home");
    const dbtProfilesDir = join(root, "dbt-profiles-dir");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(home, ".dbt"), { recursive: true });
    mkdirSync(dbtProfilesDir, { recursive: true });
    writeFileSync(join(home, ".dbt", "profiles.yml"), "x: 1\n");
    writeFileSync(join(dbtProfilesDir, "profiles.yml"), "x: 1\n");

    expect(
      findProfilesYmlPath(projectDir, { DBT_PROFILES_DIR: dbtProfilesDir }, home),
    ).toBe(join(dbtProfilesDir, "profiles.yml"));
  });

  it("falls back to ~/.dbt/profiles.yml last", () => {
    const projectDir = join(root, "project");
    const home = join(root, "home");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(home, ".dbt"), { recursive: true });
    writeFileSync(join(home, ".dbt", "profiles.yml"), "x: 1\n");

    expect(findProfilesYmlPath(projectDir, {}, home)).toBe(join(home, ".dbt", "profiles.yml"));
  });

  it("returns null when nothing exists anywhere", () => {
    const projectDir = join(root, "project");
    const home = join(root, "home");
    mkdirSync(projectDir, { recursive: true });

    expect(findProfilesYmlPath(projectDir, {}, home)).toBeNull();
  });
});
