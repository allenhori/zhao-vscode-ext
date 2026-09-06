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
  /** A ready-to-run command rebuilding the diff-highlight overlay's
   * impacted models, straight from zhao-cli's own `recommended_command`
   * -- `null` whenever there's no diff data, or zhao-cli didn't
   * generate one (no `recommended-command.subcommand` configured, or
   * nothing impacted). Drives the Copy/Run buttons' visibility. */
  recommendedCommand: string | null;
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
  .recommended-command { display: flex; gap: 8px; align-items: center; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); padding: 6px 8px; margin-bottom: 8px; font-size: 12px; }
  .recommended-command code { flex: 1; overflow-x: auto; white-space: pre; font-family: var(--vscode-editor-font-family); }
  #graph { overflow: auto; border: 1px solid var(--vscode-panel-border); }
  .node-box { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-panel-border); }
  .node-box.origin { stroke-dasharray: 3,2; }
  .node-box.changed { stroke: var(--vscode-gitDecoration-modifiedResourceForeground, orange); stroke-width: 2; }
  .node-box.reached { stroke: var(--vscode-gitDecoration-addedResourceForeground, #4a4); stroke-width: 2; }
  .node-box.selected { stroke: var(--vscode-focusBorder); stroke-width: 2; }
  .node-label { fill: var(--vscode-foreground); font-size: 11px; pointer-events: none; font-weight: 600; }
  .column-row { fill: var(--vscode-editorWidget-background); }
  .column-row:hover { fill: var(--vscode-list-hoverBackground); }
  .column-label { fill: var(--vscode-descriptionForeground); font-size: 10px; pointer-events: none; }
  .column-divider { stroke: var(--vscode-panel-border); stroke-width: 1; opacity: 0.5; }
  .edge { stroke: var(--vscode-panel-border); stroke-width: 1; fill: none; }
  .column-edge { stroke: var(--vscode-charts-blue, #3794ff); stroke-width: 1; fill: none; opacity: 0.7; }
  .column-edge.highlighted { stroke-width: 2; opacity: 1; }
  #info { margin-top: 8px; font-size: 12px; white-space: pre-wrap; }
  button { cursor: pointer; }
</style>
</head>
<body>
  ${state.missingExecutable ? `<div class="banner">zhao-cli was not found on PATH. <button id="download">Download zhao-cli</button></div>` : ""}
  ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
  ${
    state.recommendedCommand
      ? `<div class="recommended-command"><code>${escapeHtml(state.recommendedCommand)}</code><button id="copyCommand">Copy</button><button id="runCommand">Run in Terminal</button></div>`
      : ""
  }
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
  // Mirrors graphEngine.ts's own columnLevel gate (RenderableGraph.columnEdges
  // is already empty when it's off, but this also controls whether the
  // column-edge *paths* get drawn at all, not just whether there'd be
  // any to draw).
  const columnLevel = ${JSON.stringify(state.columnLevel)};

  document.getElementById("refresh")?.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  document.getElementById("popOut")?.addEventListener("click", () => vscode.postMessage({ type: "popOut" }));
  document.getElementById("download")?.addEventListener("click", () => vscode.postMessage({ type: "downloadCli" }));
  document.getElementById("copyCommand")?.addEventListener("click", () => vscode.postMessage({ type: "copyCommand" }));
  document.getElementById("runCommand")?.addEventListener("click", () => vscode.postMessage({ type: "runCommand" }));
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

    const boxWidth = 180;
    const headerHeight = 28;
    const columnRowHeight = 16;
    const boxGap = 20;

    // Column-level: every distinct column name touching each node,
    // gathered from columnEdges (fromNode/fromColumn and toNode/
    // toColumn) in first-seen order. Empty for a node with no
    // column-level edges at all -- that node just keeps its plain,
    // header-only box, same as when column-level is off entirely.
    const nodeColumns = new Map();
    function recordColumn(nodeId, column) {
      let cols = nodeColumns.get(nodeId);
      if (!cols) {
        cols = [];
        nodeColumns.set(nodeId, cols);
      }
      if (!cols.includes(column)) cols.push(column);
    }
    for (const ce of graph.columnEdges) {
      recordColumn(ce.fromNode, ce.fromColumn);
      recordColumn(ce.toNode, ce.toColumn);
    }

    function boxHeightOf(n) {
      const cols = nodeColumns.get(n.id);
      return cols && cols.length > 0 ? headerHeight + cols.length * columnRowHeight : headerHeight;
    }

    const byDepth = new Map();
    for (const n of graph.nodes) {
      const key = n.depth ?? 0;
      if (!byDepth.has(key)) byDepth.set(key, []);
      byDepth.get(key).push(n);
    }
    const columns = [...byDepth.keys()].sort((a, b) => a - b);

    // Each node's own y within its column is the running total of every
    // earlier node's box height (plus a gap) in that same column --
    // boxes are no longer a uniform height once column rows are in
    // play, so a fixed rowHeight per slot would either clip a
    // many-column node or waste space under a plain one.
    const positions = new Map();
    columns.forEach((depth, colIndex) => {
      const nodesAtDepth = byDepth.get(depth);
      let y = 16;
      for (const n of nodesAtDepth) {
        const height = boxHeightOf(n);
        positions.set(n.id, { x: colIndex * boxWidth + colIndex * 60 + 16, y, height });
        y += height + boxGap;
      }
    });

    // A column's own row position, absolute (position.y already
    // included) -- used by both the column-edge paths below and (via
    // columnRowY - box.y) the label/divider draw loop further down.
    function columnRowY(nodeId, column) {
      const pos = positions.get(nodeId);
      const cols = nodeColumns.get(nodeId);
      if (!pos || !cols) return null;
      const index = cols.indexOf(column);
      if (index === -1) return null;
      return pos.y + headerHeight + index * columnRowHeight + columnRowHeight / 2;
    }

    const ns = "http://www.w3.org/2000/svg";

    const edgeGroup = document.createElementNS(ns, "g");
    for (const e of graph.edges) {
      const from = positions.get(e.from);
      const to = positions.get(e.to);
      if (!from || !to) continue;
      const path = document.createElementNS(ns, "path");
      const x1 = from.x + boxWidth, y1 = from.y + headerHeight / 2, x2 = to.x, y2 = to.y + headerHeight / 2;
      const midX = (x1 + x2) / 2;
      path.setAttribute("d", \`M \${x1} \${y1} C \${midX} \${y1}, \${midX} \${y2}, \${x2} \${y2}\`);
      path.setAttribute("class", "edge");
      edgeGroup.appendChild(path);
    }
    svg.appendChild(edgeGroup);

    // Column-level edges, drawn from the exact row a column occupies in
    // its source node to the exact row it occupies in its destination
    // node -- a real column-to-column line, not just an overlay on the
    // node-level edge above. Skipped (both here and in the row-drawing
    // loop below) when columnLevel is off, or for any column whose node
    // isn't in the currently-scoped graph at all.
    if (columnLevel) {
      const columnEdgeGroup = document.createElementNS(ns, "g");
      for (const ce of graph.columnEdges) {
        const y1 = columnRowY(ce.fromNode, ce.fromColumn);
        const y2 = columnRowY(ce.toNode, ce.toColumn);
        const fromPos = positions.get(ce.fromNode);
        const toPos = positions.get(ce.toNode);
        if (y1 === null || y2 === null || !fromPos || !toPos) continue;
        const x1 = fromPos.x + boxWidth, x2 = toPos.x;
        const midX = (x1 + x2) / 2;
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", \`M \${x1} \${y1} C \${midX} \${y1}, \${midX} \${y2}, \${x2} \${y2}\`);
        path.setAttribute("class", "column-edge");
        path.dataset.fromNode = ce.fromNode;
        path.dataset.fromColumn = ce.fromColumn;
        path.dataset.toNode = ce.toNode;
        path.dataset.toColumn = ce.toColumn;
        columnEdgeGroup.appendChild(path);
      }
      svg.appendChild(columnEdgeGroup);
    }

    let selected = null;
    for (const n of graph.nodes) {
      const pos = positions.get(n.id);
      const cols = nodeColumns.get(n.id) ?? [];
      const g = document.createElementNS(ns, "g");
      g.setAttribute("transform", \`translate(\${pos.x}, \${pos.y})\`);

      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("width", String(boxWidth));
      rect.setAttribute("height", String(pos.height));
      rect.setAttribute("rx", "4");
      let cls = "node-box" + (n.kind === "source" ? " origin" : "");
      if (n.changed) cls += " changed";
      else if (n.reached) cls += " reached";
      rect.setAttribute("class", cls);
      rect.style.cursor = "pointer";
      g.appendChild(rect);

      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", "6");
      text.setAttribute("y", "18");
      text.setAttribute("class", "node-label");
      text.textContent = n.name;
      g.appendChild(text);

      rect.addEventListener("click", () => {
        if (selected) selected.classList.remove("selected");
        rect.classList.add("selected");
        selected = rect;
        const term = n.kind === "source" ? originTerm : nodeTerm;
        document.getElementById("info").textContent =
          term + " " + n.id + (n.package ? " (package: " + n.package + ")" : "") +
          (n.changed ? "\\nchanged in this branch" : "") +
          (n.reached ? "\\nreached by this branch's changes" : "");
      });

      // One row per real column, each independently clickable/
      // hoverable -- clicking a column highlights every column-edge
      // path touching it (both ends: it may be a source in one edge
      // and a destination in another) rather than replacing #info's
      // whole-node summary, so a user can trace one column's lineage
      // without losing which node they were looking at.
      cols.forEach((column, index) => {
        const rowY = headerHeight + index * columnRowHeight;

        if (index > 0) {
          const divider = document.createElementNS(ns, "line");
          divider.setAttribute("x1", "0");
          divider.setAttribute("x2", String(boxWidth));
          divider.setAttribute("y1", String(rowY));
          divider.setAttribute("y2", String(rowY));
          divider.setAttribute("class", "column-divider");
          g.appendChild(divider);
        }

        const rowRect = document.createElementNS(ns, "rect");
        rowRect.setAttribute("x", "0");
        rowRect.setAttribute("y", String(rowY));
        rowRect.setAttribute("width", String(boxWidth));
        rowRect.setAttribute("height", String(columnRowHeight));
        rowRect.setAttribute("class", "column-row");
        rowRect.style.cursor = "pointer";
        g.appendChild(rowRect);

        const label = document.createElementNS(ns, "text");
        label.setAttribute("x", "10");
        label.setAttribute("y", String(rowY + columnRowHeight - 4));
        label.setAttribute("class", "column-label");
        label.textContent = column;
        g.appendChild(label);

        rowRect.addEventListener("click", (event) => {
          event.stopPropagation();
          for (const path of svg.querySelectorAll(".column-edge")) {
            const touches =
              (path.dataset.fromNode === n.id && path.dataset.fromColumn === column) ||
              (path.dataset.toNode === n.id && path.dataset.toColumn === column);
            path.classList.toggle("highlighted", touches);
          }
          document.getElementById("info").textContent = n.name + "." + column;
        });
      });

      svg.appendChild(g);
    }

    const maxColumnBottom = Math.max(
      ...[...positions.values()].map((pos) => pos.y + pos.height),
    );
    svg.setAttribute("height", String(Math.max(200, maxColumnBottom + 16)));
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
