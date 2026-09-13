import { describe, expect, it } from "vitest";
import { isCompiledCodeStale } from "./compiledCodeStaleness.js";

describe("isCompiledCodeStale", () => {
  it("is stale when the source was modified after the compiled file", () => {
    expect(isCompiledCodeStale(1000, 2000)).toBe(true);
  });

  it("is not stale when the compiled file is newer than the source", () => {
    expect(isCompiledCodeStale(2000, 1000)).toBe(false);
  });

  it("is not stale when the timestamps are exactly equal", () => {
    expect(isCompiledCodeStale(1000, 1000)).toBe(false);
  });
});
