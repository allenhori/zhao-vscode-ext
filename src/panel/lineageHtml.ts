// The lineage panel's webview content: controls (depth/direction/
// column-level/diff-highlight) plus a simple layered SVG render of a
// `RenderableGraph` -- nodes grouped into columns by BFS depth, edges as
// lines between them, click-to-inspect via a side info panel. Deliberately
// modest (no force-directed layout, no external graphing library --
// `webview-src`'s strict CSP allows no remote scripts anyway): correctness
// and legibility over visual sophistication for v1.
//
// Not unit-tested -- VS Code-webview-bound, per the spec's testing
// decisions; the actual filtering/highlighting logic it renders already
// lives in, and is tested via, `../engine/graphEngine.ts`.

import { randomUUID } from "node:crypto";
import type { RenderableGraph } from "../engine/types.js";

export interface LineageWebviewState {
  graph: RenderableGraph | null;
  /** Every model/source in the whole project, for the focus dropdown --
   * independent of `graph`, which is already depth/direction-scoped. */
  allNodes: { id: string; name: string }[];
  focus: string | null;
  nodeTerm: string;
  originTerm: string;
  depth: number;
  direction: "upstream" | "downstream" | "both";
  columnLevel: boolean;
  diffHighlight: boolean;
  /** Set when `zhao` isn't on PATH -- renders the warning banner instead
   * of (or above) the graph. */
  missingExecutable: boolean;
  /** A human-readable error from the last refresh attempt (an unknown
   * target, a compile failure, ...), if any. */
  error: string | null;
}

export function renderLineageHtml(state: LineageWebviewState): string {
  const graphJson = JSON.stringify(state.graph);
  const nodeTerm = escapeHtml(state.nodeTerm);
  const originTerm = escapeHtml(state.originTerm);
  const focusOptions =
    `<option value="">(whole project)</option>` +
    [...state.allNodes]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (n) =>
          `<option value="${escapeHtml(n.id)}" ${n.id === state.focus ? "selected" : ""}>${escapeHtml(n.name)}</option>`,
      )
      .join("");

  const nonce = randomUUID();

  return /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 8px; }
  .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .controls label { display: flex; gap: 4px; align-items: center; font-size: 12px; }
  .banner { background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); padding: 8px; margin-bottom: 8px; }
  .error { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); padding: 8px; margin-bottom: 8px; }
  #graph { overflow: auto; border: 1px solid var(--vscode-panel-border); }
  .node-box { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-panel-border); }
  .node-box.origin { stroke-dasharray: 3,2; }
  .node-box.changed { stroke: var(--vscode-gitDecoration-modifiedResourceForeground, orange); stroke-width: 2; }
  .node-box.reached { stroke: var(--vscode-gitDecoration-addedResourceForeground, #4a4); stroke-width: 2; }
  .node-box.selected { stroke: var(--vscode-focusBorder); stroke-width: 2; }
  .node-label { fill: var(--vscode-foreground); font-size: 11px; pointer-events: none; }
  .edge { stroke: var(--vscode-panel-border); stroke-width: 1; fill: none; }
  #info { margin-top: 8px; font-size: 12px; white-space: pre-wrap; }
  button { cursor: pointer; }
</style>
</head>
<body>
  ${state.missingExecutable ? `<div class="banner">zhao-cli was not found on PATH. <button id="download">Download zhao-cli</button></div>` : ""}
  ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
  <div class="controls">
    <button id="refresh">Refresh Lineage</button>
    <button id="popOut">Pop Out</button>
    <label>Focus <select id="focus">${focusOptions}</select></label>
    <label>Depth <input id="depth" type="number" min="0" value="${state.depth}" style="width:3em" /></label>
    <label><input type="radio" name="direction" value="upstream" ${state.direction === "upstream" ? "checked" : ""} /> Upstream</label>
    <label><input type="radio" name="direction" value="downstream" ${state.direction === "downstream" ? "checked" : ""} /> Downstream</label>
    <label><input type="radio" name="direction" value="both" ${state.direction === "both" ? "checked" : ""} /> Both</label>
    <label><input id="columnLevel" type="checkbox" ${state.columnLevel ? "checked" : ""} /> Column-level</label>
    <label><input id="diffHighlight" type="checkbox" ${state.diffHighlight ? "checked" : ""} /> Diff highlight</label>
  </div>
  <svg id="graph" width="100%" height="480"></svg>
  <div id="info"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const graph = ${graphJson};
  const nodeTerm = ${JSON.stringify(nodeTerm)};
  const originTerm = ${JSON.stringify(originTerm)};

  document.getElementById("refresh")?.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  document.getElementById("popOut")?.addEventListener("click", () => vscode.postMessage({ type: "popOut" }));
  document.getElementById("download")?.addEventListener("click", () => vscode.postMessage({ type: "downloadCli" }));
  document.getElementById("depth")?.addEventListener("change", (e) =>
    vscode.postMessage({ type: "setDepth", depth: Number(e.target.value) }));
  document.getElementById("focus")?.addEventListener("change", (e) =>
    vscode.postMessage({ type: "setFocus", focus: e.target.value || null }));
  document.getElementById("columnLevel")?.addEventListener("change", (e) =>
    vscode.postMessage({ type: "setColumnLevel", value: e.target.checked }));
  document.getElementById("diffHighlight")?.addEventListener("change", (e) =>
    vscode.postMessage({ type: "setDiffHighlight", value: e.target.checked }));
  for (const el of document.querySelectorAll('input[name="direction"]')) {
    el.addEventListener("change", (e) => vscode.postMessage({ type: "setDirection", direction: e.target.value }));
  }

  function render() {
    const svg = document.getElementById("graph");
    svg.innerHTML = "";
    if (!graph || graph.nodes.length === 0) {
      return;
    }

    const byDepth = new Map();
    for (const n of graph.nodes) {
      const key = n.depth ?? 0;
      if (!byDepth.has(key)) byDepth.set(key, []);
      byDepth.get(key).push(n);
    }
    const columns = [...byDepth.keys()].sort((a, b) => a - b);

    const colWidth = 200;
    const rowHeight = 48;
    const positions = new Map();
    columns.forEach((depth, colIndex) => {
      const nodesAtDepth = byDepth.get(depth);
      nodesAtDepth.forEach((n, rowIndex) => {
        positions.set(n.id, { x: colIndex * colWidth + 16, y: rowIndex * rowHeight + 16 });
      });
    });

    const ns = "http://www.w3.org/2000/svg";
    const edgeGroup = document.createElementNS(ns, "g");
    for (const e of graph.edges) {
      const from = positions.get(e.from);
      const to = positions.get(e.to);
      if (!from || !to) continue;
      const path = document.createElementNS(ns, "path");
      const x1 = from.x + 150, y1 = from.y + 14, x2 = to.x, y2 = to.y + 14;
      const midX = (x1 + x2) / 2;
      path.setAttribute("d", \`M \${x1} \${y1} C \${midX} \${y1}, \${midX} \${y2}, \${x2} \${y2}\`);
      path.setAttribute("class", "edge");
      edgeGroup.appendChild(path);
    }
    svg.appendChild(edgeGroup);

    let selected = null;
    for (const n of graph.nodes) {
      const pos = positions.get(n.id);
      const g = document.createElementNS(ns, "g");
      g.setAttribute("transform", \`translate(\${pos.x}, \${pos.y})\`);
      g.style.cursor = "pointer";

      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("width", "150");
      rect.setAttribute("height", "28");
      rect.setAttribute("rx", "4");
      let cls = "node-box" + (n.kind === "source" ? " origin" : "");
      if (n.changed) cls += " changed";
      else if (n.reached) cls += " reached";
      rect.setAttribute("class", cls);
      g.appendChild(rect);

      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", "6");
      text.setAttribute("y", "18");
      text.setAttribute("class", "node-label");
      text.textContent = n.name;
      g.appendChild(text);

      g.addEventListener("click", () => {
        if (selected) selected.classList.remove("selected");
        rect.classList.add("selected");
        selected = rect;
        const term = n.kind === "source" ? originTerm : nodeTerm;
        document.getElementById("info").textContent =
          term + " " + n.id + (n.package ? " (package: " + n.package + ")" : "") +
          (n.changed ? "\\nchanged in this branch" : "") +
          (n.reached ? "\\nreached by this branch's changes" : "");
      });

      svg.appendChild(g);
    }

    const maxRows = Math.max(...columns.map((d) => byDepth.get(d).length));
    svg.setAttribute("height", String(Math.max(200, maxRows * rowHeight + 32)));
  }

  render();
})();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
