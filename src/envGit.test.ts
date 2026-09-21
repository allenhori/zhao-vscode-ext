import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addToGitignore, checkGitStatus } from "./envGit.js";

let dir: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zhao-envgit-"));
  mkdirSync(join(dir, ".vscode"));
  writeFileSync(join(dir, ".vscode", "zhao-secret.json"), "{}");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("checkGitStatus", () => {
  it("reports a file outside any git repository", async () => {
    // A temp dir is not inside a repo on CI/dev machines.
    expect(await checkGitStatus(dir, ".vscode/zhao-secret.json")).toEqual({
      inRepo: false,
      ignored: false,
      tracked: false,
    });
  });

  it("reports an existing, unignored, untracked file", async () => {
    git("init", "-q");

    expect(await checkGitStatus(dir, ".vscode/zhao-secret.json")).toEqual({
      inRepo: true,
      ignored: false,
      tracked: false,
    });
  });

  it("reports an ignored file", async () => {
    git("init", "-q");
    writeFileSync(join(dir, ".gitignore"), ".vscode/zhao-secret.json\n");

    expect((await checkGitStatus(dir, ".vscode/zhao-secret.json")).ignored).toBe(true);
  });

  it("reports a file that is already tracked", async () => {
    git("init", "-q");
    git("add", ".vscode/zhao-secret.json");

    expect((await checkGitStatus(dir, ".vscode/zhao-secret.json")).tracked).toBe(true);
  });
});

describe("addToGitignore", () => {
  it("creates .gitignore with the entry", () => {
    addToGitignore(dir, ".vscode/zhao-secret.json");

    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(".vscode/zhao-secret.json\n");
  });

  it("appends on its own line, even when the file lacks a trailing newline", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules");

    addToGitignore(dir, ".env");

    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("node_modules\n.env\n");
  });

  it("does not add a duplicate entry", () => {
    writeFileSync(join(dir, ".gitignore"), ".env\n");

    addToGitignore(dir, ".env");

    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(".env\n");
  });
});
