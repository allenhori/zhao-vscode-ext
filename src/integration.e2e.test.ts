// A real end-to-end integration test: invokes the *actual* `zhao`
// binary (not a mock) via `zhaoCli.ts`'s argv builders, through a fake
// `dbt` stub that mimics `dbt compile`'s effect closely enough to
// exercise the real `--target-path` isolation path, then feeds its
// real `target/zhao/full_lineage.json` output through
// `zhaoJson.ts`/`graphEngine.ts`. This is what actually validates the
// assumptions `zhaoJson.ts` makes about zhao-cli's JSON shape (read
// from zhao-cli's Rust source, not from running it) against what
// zhao-cli genuinely produces.
//
// Uses zhao-cli's own `rules_project` test fixture manifest (a real,
// already-validated dbt manifest -- rather than a hand-rolled one that
// risks silently omitting a field the real dbt adapter needs) as the
// fake `dbt compile`'s output.
//
// Skipped entirely when no `zhao` binary is available -- set ZHAO_BIN
// to an explicit path (defaults to the sibling zhao-cli repo's release
// build) to run it locally: `ZHAO_BIN=/path/to/zhao npm test`.

import { chmodSync, cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRenderableGraph } from "./engine/graphEngine.js";
import { buildLineageArgs, readZhaoJson, runZhao } from "./zhaoCli.js";
import { parseFullLineageJson, type RawFullLineageJson } from "./zhaoJson.js";

const ZHAO_BIN =
  process.env.ZHAO_BIN ??
  join(import.meta.dirname, "..", "..", "zhao-cli", "target", "release", "zhao");

const RULES_PROJECT_MANIFEST = join(
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

const zhaoAvailable = existsSync(ZHAO_BIN) && existsSync(RULES_PROJECT_MANIFEST);

describe.skipIf(!zhaoAvailable)("end-to-end against a real zhao binary", () => {
  let projectDir: string;
  let targetPathDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "zhao-vscode-ext-e2e-project-"));
    targetPathDir = mkdtempSync(join(tmpdir(), "zhao-vscode-ext-e2e-target-"));

    writeFileSync(join(projectDir, "dbt_project.yml"), "name: fixture\nversion: '1.0.0'\n");
    cpSync(RULES_PROJECT_MANIFEST, join(projectDir, "dbt_manifest_source.json"));

    // A fake `dbt` that honors --target-path the same way real dbt
    // does, so `zhao lineage --compile` genuinely isolates its output.
    const stubDbtPath = join(projectDir, "dbt");
    writeFileSync(
      stubDbtPath,
      [
        "#!/bin/sh",
        'target_dir="target"',
        'prev=""',
        'for arg in "$@"; do',
        '  if [ "$prev" = "--target-path" ]; then target_dir="$arg"; fi',
        '  prev="$arg"',
        "done",
        'if [ "$1" = "compile" ]; then',
        '  mkdir -p "$target_dir"',
        '  cp dbt_manifest_source.json "$target_dir/manifest.json"',
        "fi",
        "",
      ].join("\n"),
    );
    chmodSync(stubDbtPath, 0o755);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(targetPathDir, { recursive: true, force: true });
  });

  it("compiles in isolation and produces a graph engine can render", async () => {
    const args = buildLineageArgs({
      projectDir,
      targetPathDir,
      compile: true,
      dbtCommand: join(projectDir, "dbt"),
    });

    const result = await runZhao(ZHAO_BIN, args);
    expect(result.code, `zhao exited non-zero: ${result.stderr}`).toBe(0);

    // Isolation actually held: the real target/ was never written.
    expect(existsSync(join(projectDir, "target", "manifest.json"))).toBe(false);
    expect(existsSync(join(targetPathDir, "manifest.json"))).toBe(true);

    // full_lineage.json is still where the file contract says it is.
    const fullLineagePath = join(projectDir, "target", "zhao", "full_lineage.json");
    expect(existsSync(fullLineagePath)).toBe(true);

    const raw = readZhaoJson<RawFullLineageJson>(fullLineagePath);
    const { graph, nodeTerm, originTerm } = parseFullLineageJson(raw);

    expect(nodeTerm).toBe("model");
    expect(originTerm).toBe("source");
    expect(graph.nodes.map((n) => n.name).sort()).toEqual(
      [
        "raw_customers",
        "raw_orders",
        "raw_payments",
        "stg_customers",
        "stg_orders",
        "stg_payments",
        "dim_customers",
        "fct_orders",
        "fct_orders_incremental",
      ].sort(),
    );

    const stgOrders = graph.nodes.find((n) => n.name === "stg_orders");
    expect(stgOrders).toBeDefined();
    const scoped = buildRenderableGraph(graph, null, {
      focus: stgOrders!.id,
      depth: 1,
      direction: "downstream",
      columnLevel: false,
      diffHighlight: false,
    });
    expect(scoped.nodes.map((n) => n.name).sort()).toEqual(
      ["dim_customers", "fct_orders", "fct_orders_incremental", "stg_orders"].sort(),
    );
  });
});
