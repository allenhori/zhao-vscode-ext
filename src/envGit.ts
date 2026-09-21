// Git hygiene for the files that may hold secrets (`zhao-secret.json`,
// referenced `.env` files): is a file ignored, is it already tracked, and
// a one-click way to add it to `.gitignore`. Shells out to git itself so
// the answer matches git's own ignore rules (nested ignores, global
// excludes) instead of a hand-rolled approximation. The extension never
// edits `.gitignore` except through `addToGitignore`, on an explicit click.

import { execFile } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface GitStatus {
  inRepo: boolean;
  ignored: boolean;
  tracked: boolean;
}

/** Exit code of `git <args>` run in `cwd`, or `null` when git itself
 * couldn't be run (not installed). */
function gitExitCode(cwd: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd }, (error) => {
      if (!error) {
        resolve(0);
      } else {
        resolve(typeof error.code === "number" ? error.code : null);
      }
    });
  });
}

export async function checkGitStatus(workspaceDir: string, relativePath: string): Promise<GitStatus> {
  if ((await gitExitCode(workspaceDir, ["rev-parse", "--is-inside-work-tree"])) !== 0) {
    return { inRepo: false, ignored: false, tracked: false };
  }
  const ignored = (await gitExitCode(workspaceDir, ["check-ignore", "-q", "--", relativePath])) === 0;
  const tracked = (await gitExitCode(workspaceDir, ["ls-files", "--error-unmatch", "--", relativePath])) === 0;
  return { inRepo: true, ignored, tracked };
}

/** Appends `entry` to the workspace's `.gitignore` on its own line,
 * creating the file if needed and doing nothing if it's already listed. */
export function addToGitignore(workspaceDir: string, entry: string): void {
  const path = join(workspaceDir, ".gitignore");
  if (!existsSync(path)) {
    writeFileSync(path, `${entry}\n`);
    return;
  }
  const existing = readFileSync(path, "utf8");
  if (existing.split(/\r?\n/).includes(entry)) {
    return;
  }
  appendFileSync(path, `${existing.endsWith("\n") || existing === "" ? "" : "\n"}${entry}\n`);
}
