import { describe, expect, it } from "vitest";
import { parse } from "jsonc-parser";
import { addSet, deleteSet, deleteVariable, hasSet, hasVariable, renameSet, renameVariable, setVariable } from "./envWrite.js";

const read = (text: string): unknown => parse(text);

describe("setVariable", () => {
  it("creates the file content from nothing", () => {
    expect(read(setVariable(null, null, "A", "1"))).toEqual({ env: { A: "1" } });
  });

  it("adds to and updates the flat env", () => {
    const added = setVariable('{ "env": { "A": "1" } }', null, "B", "2");
    const updated = setVariable(added, null, "A", "9");

    expect(read(updated)).toEqual({ env: { A: "9", B: "2" } });
  });

  it("writes into a named set, creating it when needed", () => {
    expect(read(setVariable('{ "env": { "A": "1" } }', "client-a", "X", "y"))).toEqual({
      env: { A: "1" },
      sets: { "client-a": { env: { X: "y" } } },
    });
  });

  it("keeps comments and untouched formatting", () => {
    const before = '{\n  // shared settings\n  "env": {\n    "A": "1" // the a\n  }\n}\n';

    const after = setVariable(before, null, "B", "2");

    expect(after).toContain("// shared settings");
    expect(after).toContain("// the a");
    expect(read(after)).toEqual({ env: { A: "1", B: "2" } });
  });

  it("preserves other top-level keys such as envFile", () => {
    const after = setVariable('{ "envFile": ".env" }', null, "A", "1");

    expect(read(after)).toEqual({ envFile: ".env", env: { A: "1" } });
  });
});

describe("deleteVariable", () => {
  it("removes only that variable", () => {
    const after = deleteVariable('{ "env": { "A": "1", "B": "2" } }', null, "A");

    expect(read(after)).toEqual({ env: { B: "2" } });
  });

  it("removes a variable from a named set", () => {
    const text = '{ "sets": { "a": { "env": { "X": "1", "Y": "2" } } } }';

    expect(read(deleteVariable(text, "a", "X"))).toEqual({ sets: { a: { env: { Y: "2" } } } });
  });

  it("returns the text unchanged when the variable is absent", () => {
    const text = '{ "env": { "A": "1" } }';

    expect(deleteVariable(text, null, "NOPE")).toBe(text);
  });
});

describe("renameVariable", () => {
  it("keeps the value under the new name", () => {
    expect(read(renameVariable('{ "env": { "A": "1" } }', null, "A", "Z"))).toEqual({ env: { Z: "1" } });
  });
});

describe("sets", () => {
  it("adds an empty set", () => {
    expect(read(addSet('{ "env": { "A": "1" } }', "client-a"))).toEqual({
      env: { A: "1" },
      sets: { "client-a": { env: {} } },
    });
  });

  it("renames a set and keeps its contents", () => {
    const text = '{ "sets": { "old": { "env": { "X": "1" }, "envFile": ".env.old" } } }';

    expect(read(renameSet(text, "old", "new"))).toEqual({
      sets: { new: { env: { X: "1" }, envFile: ".env.old" } },
    });
  });

  it("deletes a set", () => {
    const text = '{ "sets": { "a": { "env": {} }, "b": { "env": {} } } }';

    expect(read(deleteSet(text, "a"))).toEqual({ sets: { b: { env: {} } } });
  });
});

describe("existence checks", () => {
  const text = '{ "env": { "A": "1" }, "sets": { "client-a": { "env": { "X": "2" } } } }';

  it("finds variables in the base and in a set", () => {
    expect(hasVariable(text, null, "A")).toBe(true);
    expect(hasVariable(text, "client-a", "X")).toBe(true);
  });

  it("does not confuse scopes or names", () => {
    expect(hasVariable(text, null, "X")).toBe(false);
    expect(hasVariable(text, "client-a", "A")).toBe(false);
    expect(hasVariable(text, "nope", "A")).toBe(false);
    expect(hasVariable(null, null, "A")).toBe(false);
  });

  it("finds sets", () => {
    expect(hasSet(text, "client-a")).toBe(true);
    expect(hasSet(text, "client-b")).toBe(false);
    expect(hasSet(null, "client-a")).toBe(false);
  });
});
