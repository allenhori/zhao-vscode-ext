import { describe, expect, it } from "vitest";
import { findMissingEnvVars, scanEnvVarUsages } from "./envVarScan.js";

describe("scanEnvVarUsages", () => {
  it("finds a required env_var with either quote style and odd spacing", () => {
    const usages = scanEnvVarUsages([
      "host: {{ env_var('SF_ACCOUNT') }}",
      'user: "{{ env_var( "SF_USER" ) }}"',
    ]);

    expect(usages).toEqual({ required: ["SF_ACCOUNT", "SF_USER"], optional: [] });
  });

  it("treats env_var with a default as optional", () => {
    const usages = scanEnvVarUsages(["threads: {{ env_var('DBT_THREADS', '4') | as_number }}"]);

    expect(usages).toEqual({ required: [], optional: ["DBT_THREADS"] });
  });

  it("counts a name as required when any usage has no default", () => {
    const usages = scanEnvVarUsages(["{{ env_var('X', 'a') }}", "{{ env_var('X') }}"]);

    expect(usages).toEqual({ required: ["X"], optional: [] });
  });

  it("deduplicates and sorts names across sources", () => {
    const usages = scanEnvVarUsages(["{{ env_var('B') }}", "{{ env_var('A') }} {{ env_var('B') }}"]);

    expect(usages.required).toEqual(["A", "B"]);
  });

  it("ignores text that merely mentions env_var", () => {
    expect(scanEnvVarUsages(["# use env_var to read things", "env_var_count: 3"])).toEqual({
      required: [],
      optional: [],
    });
  });
});

describe("findMissingEnvVars", () => {
  it("returns required names that are in neither the resolved env nor the process env", () => {
    const missing = findMissingEnvVars(
      { required: ["A", "B", "C"], optional: ["D"] },
      { A: "1" },
      { B: "2" },
    );

    expect(missing).toEqual(["C"]);
  });
});
