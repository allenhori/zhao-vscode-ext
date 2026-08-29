import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findNearestDbtProjectDir } from "./projectDetection.js";

describe("findNearestDbtProjectDir", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "zhao-vscode-ext-test-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds a dbt_project.yml directly alongside the file", () => {
    writeFileSync(join(root, "dbt_project.yml"), "name: fixture\n");
    const modelPath = join(root, "models", "stg_orders.sql");
    mkdirSync(join(root, "models"), { recursive: true });
    writeFileSync(modelPath, "select 1\n");

    expect(findNearestDbtProjectDir(modelPath)).toBe(root);
  });

  it("walks up through several levels to find the marker", () => {
    const deep = join(root, "models", "staging", "orders");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(root, "dbt_project.yml"), "name: fixture\n");
    const modelPath = join(deep, "stg_orders.sql");
    writeFileSync(modelPath, "select 1\n");

    expect(findNearestDbtProjectDir(modelPath)).toBe(root);
  });

  it("in a monorepo, picks the nearest marker, not a farther-up one", () => {
    const outerMarker = root;
    writeFileSync(join(outerMarker, "dbt_project.yml"), "name: outer\n");
    const innerProject = join(root, "packages", "inner_project");
    mkdirSync(join(innerProject, "models"), { recursive: true });
    writeFileSync(join(innerProject, "dbt_project.yml"), "name: inner\n");
    const modelPath = join(innerProject, "models", "stg_orders.sql");
    writeFileSync(modelPath, "select 1\n");

    expect(findNearestDbtProjectDir(modelPath)).toBe(innerProject);
  });

  it("returns null when no dbt_project.yml exists anywhere above the file", () => {
    const modelPath = join(root, "models", "stg_orders.sql");
    mkdirSync(join(root, "models"), { recursive: true });
    writeFileSync(modelPath, "select 1\n");

    expect(findNearestDbtProjectDir(modelPath)).toBeNull();
  });

  it("starts from the file's own directory, not the filesystem root, when given a bare filename", () => {
    // A relative-looking path with no directory component still resolves
    // via its containing directory, not by accident matching cwd.
    writeFileSync(join(root, "dbt_project.yml"), "name: fixture\n");
    expect(findNearestDbtProjectDir(join(root, "model.sql"))).toBe(root);
  });
});
