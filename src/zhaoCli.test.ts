import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDiffArgs, buildLineageArgs, locateExecutable } from "./zhaoCli.js";

describe("buildLineageArgs", () => {
  it("always isolates the html redirect and dbt compile to targetPathDir", () => {
    const args = buildLineageArgs({
      projectDir: "/proj",
      targetPathDir: "/tmp/zhao-abc",
      compile: true,
    });
    expect(args).toEqual([
      "lineage",
      "--project-dir",
      "/proj",
      "--compile",
      "--html",
      "/tmp/zhao-abc/discard.html",
      "--dbt-arg",
      "--target-path",
      "--dbt-arg",
      "/tmp/zhao-abc",
    ]);
  });

  it("omits --compile for a plain re-render", () => {
    const args = buildLineageArgs({
      projectDir: "/proj",
      targetPathDir: "/tmp/zhao-abc",
      compile: false,
    });
    expect(args).not.toContain("--compile");
  });

  it("appends --dbt-command when a wrapper is configured", () => {
    const args = buildLineageArgs({
      projectDir: "/proj",
      targetPathDir: "/tmp/zhao-abc",
      compile: true,
      dbtCommand: "uv run dbt",
    });
    expect(args.slice(-2)).toEqual(["--dbt-command", "uv run dbt"]);
  });

  it("also forwards --target as a --dbt-arg pair when a profile target is given", () => {
    const args = buildLineageArgs({
      projectDir: "/proj",
      targetPathDir: "/tmp/zhao-abc",
      compile: true,
      profileTarget: "ci",
    });
    expect(args).toEqual(
      expect.arrayContaining(["--dbt-arg", "--target", "--dbt-arg", "ci"]),
    );
  });

  it("omits the --target pair entirely when no profile target is given", () => {
    const args = buildLineageArgs({ projectDir: "/proj", targetPathDir: "/tmp/zhao-abc", compile: true });
    expect(args).not.toContain("--target");
  });
});

describe("buildDiffArgs", () => {
  it("points --target-path at the same targetPathDir a preceding compile used", () => {
    const args = buildDiffArgs({ projectDir: "/proj", targetPathDir: "/tmp/zhao-abc" });
    expect(args).toEqual([
      "diff",
      "--project-dir",
      "/proj",
      "--format",
      "json",
      "--dbt-arg",
      "--target-path",
      "--dbt-arg",
      "/tmp/zhao-abc",
    ]);
  });

  it("includes --against only when explicitly given", () => {
    const withAgainst = buildDiffArgs({
      projectDir: "/proj",
      targetPathDir: "/tmp/zhao-abc",
      against: "main",
    });
    expect(withAgainst).toContain("--against");
    expect(withAgainst[withAgainst.length - 1]).toBe("main");

    const withoutAgainst = buildDiffArgs({ projectDir: "/proj", targetPathDir: "/tmp/zhao-abc" });
    expect(withoutAgainst).not.toContain("--against");
  });
});

describe("locateExecutable", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "zhao-vscode-ext-cli-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds a bare command name on PATH", () => {
    const exe = join(dir, "zhao");
    writeFileSync(exe, "#!/bin/sh\necho hi\n");
    chmodSync(exe, 0o755);

    expect(locateExecutable("zhao", { PATH: dir })).toBe(exe);
  });

  it("returns null when nothing on PATH matches", () => {
    expect(locateExecutable("zhao", { PATH: dir })).toBeNull();
  });

  it("skips a same-named file on PATH that isn't executable", () => {
    writeFileSync(join(dir, "zhao"), "not executable");
    expect(locateExecutable("zhao", { PATH: dir })).toBeNull();
  });

  it("checks an explicit path directly, ignoring PATH entirely", () => {
    const exe = join(dir, "custom-zhao");
    writeFileSync(exe, "#!/bin/sh\necho hi\n");
    chmodSync(exe, 0o755);

    expect(locateExecutable(exe, { PATH: "/nonexistent" })).toBe(exe);
  });

  it("returns null for an explicit path that doesn't exist", () => {
    expect(locateExecutable(join(dir, "does-not-exist"), { PATH: dir })).toBeNull();
  });
});
