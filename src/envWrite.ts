// Comment- and formatting-preserving edits to `zhao.json` /
// `zhao-secret.json`, as pure text-in / text-out functions. The sidebar
// writes through these so a hand-edited file (comments, ordering,
// `envFile`, indentation) survives being edited from the UI.

import { applyEdits, modify, parse, type JSONPath } from "jsonc-parser";

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" };

function edit(text: string | null, path: JSONPath, value: unknown): string {
  const source = text === null || text.trim() === "" ? "{}\n" : text;
  return applyEdits(source, modify(source, path, value, { formattingOptions: FORMATTING }));
}

function envPath(set: string | null): JSONPath {
  return set === null ? ["env"] : ["sets", set, "env"];
}

function has(text: string, path: JSONPath): boolean {
  let node: unknown = parse(text, [], { allowTrailingComma: true });
  for (const key of path) {
    if (typeof node !== "object" || node === null || !(key in node)) {
      return false;
    }
    node = (node as Record<string | number, unknown>)[key];
  }
  return true;
}

function valueAt(text: string, path: JSONPath): unknown {
  let node: unknown = parse(text, [], { allowTrailingComma: true });
  for (const key of path) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

export function setVariable(text: string | null, set: string | null, name: string, value: string): string {
  return edit(text, [...envPath(set), name], value);
}

export function deleteVariable(text: string, set: string | null, name: string): string {
  const path = [...envPath(set), name];
  return has(text, path) ? edit(text, path, undefined) : text;
}

export function renameVariable(text: string, set: string | null, from: string, to: string): string {
  const value = valueAt(text, [...envPath(set), from]);
  if (typeof value !== "string") {
    return text;
  }
  return setVariable(deleteVariable(text, set, from), set, to, value);
}

export function addSet(text: string | null, name: string): string {
  return edit(text, ["sets", name], { env: {} });
}

export function renameSet(text: string, from: string, to: string): string {
  const value = valueAt(text, ["sets", from]);
  if (value === undefined) {
    return text;
  }
  return edit(edit(text, ["sets", from], undefined), ["sets", to], value);
}

export function deleteSet(text: string, name: string): string {
  return has(text, ["sets", name]) ? edit(text, ["sets", name], undefined) : text;
}
