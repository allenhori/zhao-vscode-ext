// Thin filesystem glue around the pure env modules: where the config files
// live, reading them into `resolveEnv`'s inputs, writing them back, and
// gathering the project text the `env_var()` scan reads. All the actual
// decisions live in `./envConfig.ts`, `./envWrite.ts` and `./envVarScan.ts`.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EnvInputs } from "./envConfig.js";

export const CONFIG_DIR = ".vscode";
export const ZHAO_JSON = "zhao.json";
export const SECRET_JSON = "zhao-secret.json";

export function configFilePath(workspaceDir: string, file: typeof ZHAO_JSON | typeof SECRET_JSON): string {
  return join(workspaceDir, CONFIG_DIR, file);
}

export function readTextIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function loadEnvInputs(workspaceDir: string, activeSet: string | null): EnvInputs {
  return {
    workspaceDir,
    zhaoJson: readTextIfExists(configFilePath(workspaceDir, ZHAO_JSON)),
    secretJson: readTextIfExists(configFilePath(workspaceDir, SECRET_JSON)),
    readEnvFile: readTextIfExists,
    activeSet,
    processEnv: process.env,
  };
}

export function writeConfigText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const SCANNED_EXTENSIONS = new Set([".sql", ".yml", ".yaml"]);
const SKIPPED_DIRS = new Set(["target", "dbt_packages", "node_modules", ".git", "logs"]);
const MAX_FILES = 3000;
const MAX_FILE_BYTES = 512 * 1024;

/** The text of a dbt project's own files (config, models, macros, ...)
 * for the `env_var()` scan, bounded so a huge project can't stall the
 * sidebar. `profiles.yml` is included when it sits in the project. */
export function collectProjectTexts(projectDir: string, extraFiles: string[] = []): string[] {
  const texts: string[] = [];
  const pending = [projectDir];
  let seen = 0;
  while (pending.length > 0 && seen < MAX_FILES) {
    const dir = pending.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) {
          pending.push(full);
        }
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      if (dot === -1 || !SCANNED_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) {
        continue;
      }
      seen += 1;
      try {
        if (statSync(full).size <= MAX_FILE_BYTES) {
          texts.push(readFileSync(full, "utf8"));
        }
      } catch {
        // Unreadable file: skip, the scan is best-effort.
      }
    }
  }
  for (const file of extraFiles) {
    if (existsSync(file)) {
      const text = readTextIfExists(file);
      if (text !== null) {
        texts.push(text);
      }
    }
  }
  return texts;
}
