import { describe, expect, it } from "vitest";
import { isPreviewError, parsePreviewResult } from "./previewEngine.js";

describe("parsePreviewResult", () => {
  it("parses a successful zhao show --output json result", () => {
    const stdout = JSON.stringify({
      columns: ["customer_id", "customer_name"],
      rows: [{ customer_id: "abc", customer_name: "Joy Lam" }],
    });
    const result = parsePreviewResult(0, stdout, "");
    expect(isPreviewError(result)).toBe(false);
    expect(result).toEqual({
      columns: ["customer_id", "customer_name"],
      rows: [{ customer_id: "abc", customer_name: "Joy Lam" }],
    });
  });

  it("preserves column order rather than resorting it", () => {
    const stdout = JSON.stringify({ columns: ["zeta", "alpha", "middle"], rows: [] });
    const result = parsePreviewResult(0, stdout, "");
    expect(isPreviewError(result)).toBe(false);
    if (!isPreviewError(result)) {
      expect(result.columns).toEqual(["zeta", "alpha", "middle"]);
    }
  });

  it("handles a genuinely empty result set", () => {
    const stdout = JSON.stringify({ columns: [], rows: [] });
    const result = parsePreviewResult(0, stdout, "");
    expect(isPreviewError(result)).toBe(false);
    expect(result).toEqual({ columns: [], rows: [] });
  });

  it("surfaces zhao-cli's own stderr as the error when the exit code is non-zero", () => {
    const result = parsePreviewResult(2, "", "error: dbt show failed for customers in /proj:\n...\n");
    expect(isPreviewError(result)).toBe(true);
    if (isPreviewError(result)) {
      expect(result.error).toContain("dbt show failed for customers");
    }
  });

  it("falls back to stdout when stderr is empty but the exit code is still non-zero", () => {
    const result = parsePreviewResult(1, "something went wrong on stdout", "");
    expect(result).toEqual({ error: "something went wrong on stdout" });
  });

  it("reports a clear error rather than throwing when stdout isn't valid JSON at all", () => {
    const result = parsePreviewResult(0, "not json", "");
    expect(isPreviewError(result)).toBe(true);
    if (isPreviewError(result)) {
      expect(result.error).toContain("could not be parsed as JSON");
    }
  });

  it("reports a clear error for valid JSON that isn't the expected {columns, rows} shape", () => {
    const result = parsePreviewResult(0, JSON.stringify({ unexpected: true }), "");
    expect(isPreviewError(result)).toBe(true);
    if (isPreviewError(result)) {
      expect(result.error).toContain("unexpected JSON shape");
    }
  });

  it("never throws regardless of input", () => {
    expect(() => parsePreviewResult(null, "", "")).not.toThrow();
    expect(() => parsePreviewResult(0, "", "")).not.toThrow();
  });
});
