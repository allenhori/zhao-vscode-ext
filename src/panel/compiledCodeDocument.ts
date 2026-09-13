// A read-only virtual document for "View Compiled Code" -- registers a
// dedicated URI scheme so the opened tab gets a clean, synthetic title
// decoupled from the compiled file's actual (temp-directory) location,
// and is read-only by construction: VS Code never offers to save edits
// back to a `TextDocumentContentProvider`-backed document, so there's no
// separate read-only flag to maintain.

import { readFileSync } from "node:fs";
import * as vscode from "vscode";

export const COMPILED_CODE_SCHEME = "zhao-compiled";

export class CompiledCodeContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    // The real file path travels in the URI's query string -- `uri.path`
    // alone is what VS Code shows as the tab title, so that stays just
    // `<node name> (compiled).sql`, clean of the temp directory the
    // file actually lives in.
    const realPath = decodeURIComponent(uri.query);
    try {
      return readFileSync(realPath, "utf8");
    } catch (err) {
      return `-- Could not read compiled code: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

/** Builds the `zhao-compiled:` URI for `nodeName`'s compiled file at
 * `realPath` -- see `CompiledCodeContentProvider` for why the real path
 * rides in the query string rather than the URI path itself. */
export function compiledCodeUri(nodeName: string, realPath: string): vscode.Uri {
  return vscode.Uri.parse(
    `${COMPILED_CODE_SCHEME}:${encodeURIComponent(`${nodeName} (compiled).sql`)}?${encodeURIComponent(realPath)}`,
  );
}
