// End-to-end proof that configured environment variables really reach dbt:
// zhao.json + a .env file are resolved by `resolveEnv`, handed to the real
// `zhao` binary through `runZhao`, and the `dbt` it launches (a stub that
// fails unless the variables are set, like a project using `env_var()`)
// sees them. Skipped when no `zhao` binary is available -- set ZHAO_BIN to
// run it against a specific build.

import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveEnv } from "./envConfig.js";
import { loadEnvInputs } from "./envWorkspace.js";
import { buildLineageArgs, runZhao } from "./zhaoCli.js";

function findZhao(): string | null {
  if (process.env.ZHAO_BIN && existsSync(process.env.ZHAO_BIN)) {
    return process.env.ZHAO_BIN;
  }
  try {
    return execFileSync("which", ["zhao"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

const ZHAO_BIN = findZhao();
const MANIFEST = join(
  import.meta.dirname,
  "..",
  "..",
  "zhao-cli",
  "crates",
  "zhao-cli",
  "tests",
  "fixtures",
  "rules_project",
  "target",
  "manifest.json",
);

describe.skipIf(ZHAO_BIN === null || !existsSync(MANIFEST))("environment variables reach dbt", () => {
  let workspace: string;
  let targetPathDir: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "zhao-env-e2e-"));
    targetPathDir = mkdtempSync(join(tmpdir(), "zhao-env-e2e-target-"));
    writeFileSync(join(workspace, "dbt_project.yml"), "name: fixture\nversion: '1.0.0'\n");
    cpSync(MANIFEST, join(workspace, "dbt_manifest_source.json"));
    // Like a project whose profiles use env_var('SF_ACCOUNT') / ('SF_PASSWORD'):
    // dbt refuses to run unless both are set.
    const stub = join(workspace, "dbt");
    writeFileSync(
      stub,
      [
        "#!/bin/sh",
        'if [ -z "$SF_ACCOUNT" ] || [ -z "$SF_PASSWORD" ]; then',
        '  echo "Env var required but not provided: SF_ACCOUNT / SF_PASSWORD" >&2',
        "  exit 2",
        "fi",
        'target_dir="target"; prev=""',
        'for arg in "$@"; do',
        '  if [ "$prev" = "--target-path" ]; then target_dir="$arg"; fi',
        '  prev="$arg"',
        "done",
        'if [ "$1" = "compile" ]; then',
        '  mkdir -p "$target_dir"',
        '  cp dbt_manifest_source.json "$target_dir/manifest.json"',
        '  echo "account=$SF_ACCOUNT" > "$target_dir/seen-env.txt"',
        "fi",
        "",
      ].join("\n"),
    );
    chmodSync(stub, 0o755);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(targetPathDir, { recursive: true, force: true });
  });

  const compile = (env: Record<string, string> | undefined) =>
    runZhao(
      ZHAO_BIN as string,
      buildLineageArgs({ projectDir: workspace, targetPathDir, compile: true, dbtCommand: join(workspace, "dbt") }),
      undefined,
      env,
    );

  it("fails without the variables (control: proves the stub really requires them)", async () => {
    const result = await compile(undefined);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Env var required but not provided");
  });

  it("succeeds with variables from zhao.json, a named set and a .env file", async () => {
    mkdirSync(join(workspace, ".vscode"));
    writeFileSync(
      join(workspace, ".vscode", "zhao.json"),
      JSON.stringify({ envFile: ".env", sets: { "client-a": { env: { SF_ACCOUNT: "acme" } } } }),
    );
    writeFileSync(join(workspace, ".env"), "SF_PASSWORD=hunter2\n");

    const resolved = resolveEnv(loadEnvInputs(workspace, "client-a"));
    const result = await compile(resolved.env);

    expect(result.code, result.stderr).toBe(0);
    expect(readSeen(targetPathDir)).toBe("account=acme");
  });

  it("uses the active set's value, so switching sets switches what dbt sees", async () => {
    mkdirSync(join(workspace, ".vscode"));
    writeFileSync(
      join(workspace, ".vscode", "zhao.json"),
      JSON.stringify({
        env: { SF_PASSWORD: "pw" },
        sets: { "client-a": { env: { SF_ACCOUNT: "acme" } }, "client-b": { env: { SF_ACCOUNT: "globex" } } },
      }),
    );

    await compile(resolveEnv(loadEnvInputs(workspace, "client-b")).env);

    expect(readSeen(targetPathDir)).toBe("account=globex");
  });
});

function readSeen(dir: string): string {
  return execFileSync("cat", [join(dir, "seen-env.txt")], { encoding: "utf8" }).trim();
}
