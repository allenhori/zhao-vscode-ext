import { describe, expect, it } from "vitest";
import { generateZhaoYml, shouldSetAgainst, ZHAO_BUILTIN_DEFAULT_AGAINST } from "./zhaoYmlTemplate.js";

describe("shouldSetAgainst", () => {
  it("is false when nothing was detected", () => {
    expect(shouldSetAgainst(null)).toBe(false);
  });

  it("is false when the detected branch matches zhao's own built-in default", () => {
    expect(shouldSetAgainst(ZHAO_BUILTIN_DEFAULT_AGAINST)).toBe(false);
  });

  it("is true when the detected branch differs from the built-in default", () => {
    expect(shouldSetAgainst("main")).toBe(true);
  });
});

describe("generateZhaoYml", () => {
  it("always sets dbt-command to the given answer", () => {
    const yml = generateZhaoYml({ dbtCommand: "uv run dbt", detectedDefaultBranch: null });
    expect(yml).toContain("dbt-command: uv run dbt");
  });

  it("uses the agreed dbt-command/dbt-args comment language verbatim", () => {
    const yml = generateZhaoYml({ dbtCommand: "dbt", detectedDefaultBranch: null });
    expect(yml).toContain("runs dbt through something else (a venv/uv shim, an in-house wrapper script, a Docker");
    expect(yml).toContain('# dbt-args: "--target ci"');
  });

  it("omits against entirely when nothing was detected", () => {
    const yml = generateZhaoYml({ dbtCommand: "dbt", detectedDefaultBranch: null });
    expect(yml).not.toContain("against:");
  });

  it("omits against when the detected branch matches the built-in default", () => {
    const yml = generateZhaoYml({ dbtCommand: "dbt", detectedDefaultBranch: "master" });
    expect(yml).not.toMatch(/^against:/m);
  });

  it("sets against as an active (uncommented) value when it differs from the default", () => {
    const yml = generateZhaoYml({ dbtCommand: "dbt", detectedDefaultBranch: "main" });
    expect(yml).toMatch(/^against: main$/m);
  });

  it("writes every other documented key as a commented-out example, never active", () => {
    const yml = generateZhaoYml({ dbtCommand: "dbt", detectedDefaultBranch: "main" });
    for (const commentedKey of ["# preset:", "# rules:", "# defer:", "# recommended-command:", "# tool:", "# log:"]) {
      expect(yml).toContain(commentedKey);
    }
    // None of these appear as an active (non-commented) key.
    for (const activeKey of [/^preset:/m, /^rules:/m, /^defer:/m, /^recommended-command:/m, /^tool:/m, /^log:/m]) {
      expect(yml).not.toMatch(activeKey);
    }
  });
});
