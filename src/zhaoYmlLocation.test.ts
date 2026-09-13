import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findGitRootDir, hasZhaoYml } from "./zhaoYmlLocation.js";

describe("findGitRootDir", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "zhao-yml-location-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds .git in the starting directory itself", () => {
    mkdirSync(join(root, ".git"));
    expect(findGitRootDir(root)).toBe(root);
  });

  it("finds .git several levels up, from a nested project directory", () => {
    mkdirSync(join(root, ".git"));
    const nested = join(root, "services", "analytics");
    mkdirSync(nested, { recursive: true });
    expect(findGitRootDir(nested)).toBe(root);
  });

  it("returns null when no ancestor has .git", () => {
    const nested = join(root, "services", "analytics");
    mkdirSync(nested, { recursive: true });
    expect(findGitRootDir(nested)).toBeNull();
  });
});

describe("hasZhaoYml", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "zhao-yml-location-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("is false when neither the project nor the repo root has one", () => {
    expect(hasZhaoYml(root, root)).toBe(false);
  });

  it("is true when the project itself has one", () => {
    writeFileSync(join(root, "zhao.yml"), "preset: strict\n");
    expect(hasZhaoYml(root, root)).toBe(true);
  });

  it("is true when only the repo root has one", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "zhao-yml-location-root-"));
    writeFileSync(join(repoRoot, "zhao.yml"), "preset: strict\n");
    expect(hasZhaoYml(root, repoRoot)).toBe(true);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("is false when there's no repo root at all and the project has none either", () => {
    expect(hasZhaoYml(root, null)).toBe(false);
  });
});
