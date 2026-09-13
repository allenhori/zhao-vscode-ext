// The "zhao: Set Up zhao.yml" command: a minimal setup wizard, not a
// general zhao.yml editor (see the spec's out-of-scope list). Thin
// plumbing around the tested pure modules (`./zhaoYmlTemplate.ts`,
// `./zhaoYmlLocation.ts`) -- not unit-tested itself, same convention as
// `./lineageController.ts`.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { generateZhaoYml } from "./zhaoYmlTemplate.js";
import { findGitRootDir } from "./zhaoYmlLocation.js";
import type { LineageController } from "./lineageController.js";

const ZHAO_YML_FILENAME = "zhao.yml";

export async function runZhaoYmlWizard(controller: LineageController): Promise<void> {
  const projectDir = controller.activeProjectDir;
  if (!projectDir) {
    await vscode.window.showWarningMessage(
      "No dbt project detected yet -- open a .sql file inside one, or pick a project in the zhao sidebar, then try again.",
    );
    return;
  }

  const repoRootDir = findGitRootDir(projectDir);
  const repoRootChoice = repoRootDir && repoRootDir !== projectDir
    ? { label: "$(repo) Repo root", description: repoRootDir, detail: "Applies as the org-wide default for every dbt project in this repo." }
    : null;
  const projectChoice = {
    label: "$(folder) This project only",
    description: projectDir,
    detail: repoRootChoice ? "Overrides just this project's settings; everything else still inherits from the repo root." : undefined,
  };

  const locationItems = repoRootChoice ? [repoRootChoice, projectChoice] : [projectChoice];
  const picked =
    locationItems.length > 1
      ? await vscode.window.showQuickPick(locationItems, { placeHolder: "Where should zhao.yml be written?" })
      : locationItems[0];
  if (!picked) {
    return;
  }
  const writeDir = picked.description!;

  const targetPath = join(writeDir, ZHAO_YML_FILENAME);
  if (existsSync(targetPath)) {
    await vscode.window.showWarningMessage(`${targetPath} already exists -- the wizard only creates a new file, it doesn't edit an existing one.`);
    return;
  }

  // Writing at project level with a root-level zhao.yml already present:
  // show what's already there before asking anything further, so the
  // user knows what they'll be layering on top of (zhao-cli applies
  // root and project-level zhao.yml key-by-key, not one replacing the
  // other -- see zhao-cli's docs/configuration.md "Monorepos" section).
  if (writeDir === projectDir && repoRootDir) {
    const rootZhaoYmlPath = join(repoRootDir, ZHAO_YML_FILENAME);
    if (existsSync(rootZhaoYmlPath)) {
      const document = await vscode.workspace.openTextDocument(rootZhaoYmlPath);
      await vscode.window.showTextDocument(document, { preview: true });
      await vscode.window.showInformationMessage(
        `This project already inherits ${rootZhaoYmlPath} (shown above) -- only set keys here that should differ from it.`,
      );
    }
  }

  const dbtCommand = await vscode.window.showInputBox({
    prompt: "The command that runs dbt in this project",
    value: "dbt",
    placeHolder: "dbt",
  });
  if (dbtCommand === undefined) {
    return;
  }

  const content = generateZhaoYml({
    dbtCommand: dbtCommand.trim().length > 0 ? dbtCommand.trim() : "dbt",
    detectedDefaultBranch: detectDefaultBranch(writeDir),
  });

  await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), Buffer.from(content, "utf8"));
  const document = await vscode.workspace.openTextDocument(targetPath);
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.window.showInformationMessage(`Created ${targetPath}.`);
}

/**
 * Best-effort detection of the repo's actual default branch via
 * `origin/HEAD` -- returns `null` on any failure (no `origin` remote,
 * `origin/HEAD` never resolved locally, `git` itself missing) rather
 * than throwing, since this is purely an optional convenience: the
 * wizard writes no `against:` line at all when this comes back `null`.
 */
function detectDefaultBranch(repoDir: string): string | null {
  try {
    const output = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    // e.g. "refs/remotes/origin/main" -> "main".
    const match = /^refs\/remotes\/origin\/(.+)$/.exec(output);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}
