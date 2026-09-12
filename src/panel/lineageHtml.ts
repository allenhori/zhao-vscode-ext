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
import type { PreviewResult } from "../engine/previewEngine.js";
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
  /** Which of the panel's two tabs is showing. */
  activeTab: "lineage" | "preview";
  /** The node id the Preview tab is scoped to -- `null` before anything's
   * been previewed this session. */
  previewFocus: string | null;
  /** `true` while a `zhao show` invocation is in flight. */
  previewLoading: boolean;
  /** `null` before anything's been previewed, or while one is loading. */
  previewResult: PreviewResult | null;
}

/** Renders the Preview tab's body: a loading indicator while a `zhao
 * show` invocation is in flight, a readable error (never an empty
 * table) if the last one failed, the resulting table on success, or a
 * neutral placeholder before anything's been previewed at all. */
function renderPreviewBody(state: LineageWebviewState, previewFocusNode: { id: string; name: string } | null): string {
  if (state.previewLoading) {
    return `<div class="preview-empty">Loading preview${previewFocusNode ? ` for ${escapeHtml(previewFocusNode.name)}` : ""}…</div>`;
  }
  if (!state.previewResult) {
    return `<div class="preview-empty">Right-click a node in the Lineage tab and choose "Preview Data," or pick one above.</div>`;
  }
  if ("error" in state.previewResult) {
    return `<div class="error">${escapeHtml(state.previewResult.error)}</div>`;
  }
  const { columns, rows } = state.previewResult;
  if (rows.length === 0) {
    return `<div class="preview-empty">No rows returned.</div>`;
  }
  const header = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(formatPreviewValue(row[c]))}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="preview-table-wrap"><table class="preview-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function formatPreviewValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
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
  const previewFocusNode = state.allNodes.find((n) => n.id === state.previewFocus) ?? null;
  const previewOptions =
    `<option value="">(select a model/seed/source)</option>` +
    [...state.allNodes]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (n) =>
          `<option value="${escapeHtml(n.id)}" ${n.id === state.previewFocus ? "selected" : ""}>${escapeHtml(n.name)}</option>`,
      )
      .join("");

  return /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 8px; }
  .tab-strip { display: flex; gap: 2px; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  .tab-strip button { background: none; border: none; color: var(--vscode-descriptionForeground); padding: 6px 12px; font-size: 12px; border-bottom: 2px solid transparent; }
  .tab-strip button.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .controls label { display: flex; gap: 4px; align-items: center; font-size: 12px; }
  .banner { background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); padding: 8px; margin-bottom: 8px; }
  .error { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); padding: 8px; margin-bottom: 8px; white-space: pre-wrap; }
  .recommended-command { display: flex; gap: 8px; align-items: center; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); padding: 6px 8px; margin-bottom: 8px; font-size: 12px; }
  .recommended-command code { flex: 1; overflow-x: auto; white-space: pre; font-family: var(--vscode-editor-font-family); }
  #graph { overflow: auto; border: 1px solid var(--vscode-panel-border); }
  .node-box { stroke-width: 1.5; }
  /* Icon + color are always paired -- never color alone -- so the
   * distinction survives a greyscale screenshot or a colorblind viewer.
   * Soft, low-saturation border + a semi-transparent tint of the same
   * hue for the fill (rather than a solid block), matching the
   * restrained look of the official dbt extension this is informed by.
   * Values chosen to read reasonably against both a light and a dark
   * VS Code theme without a separate dark-mode override -- alpha
   * transparency blends with whatever the panel's own background is. */
  .node-box.token-table { stroke: #4a90d9; fill: rgba(74, 144, 217, 0.16); }
  .node-box.token-view { stroke: #2ca58d; fill: rgba(44, 165, 141, 0.16); }
  .node-box.token-incremental { stroke: #d98e3b; fill: rgba(217, 142, 59, 0.16); }
  .node-box.token-ephemeral { stroke: #8e8e9e; fill: rgba(142, 142, 158, 0.14); }
  .node-box.token-seed { stroke: #5fae55; fill: rgba(95, 174, 85, 0.16); }
  .node-box.token-source { stroke: #b08551; stroke-dasharray: 3,2; fill: rgba(176, 133, 81, 0.14); }
  .node-box.token-other { stroke: var(--vscode-panel-border); fill: var(--vscode-editorWidget-background); }
  .node-box.changed { stroke: var(--vscode-gitDecoration-modifiedResourceForeground, orange); stroke-width: 2.5; }
  .node-box.reached { stroke: var(--vscode-gitDecoration-addedResourceForeground, #4a4); stroke-width: 2.5; }
  .node-box.selected { stroke: var(--vscode-focusBorder); stroke-width: 2.5; }
  .node-icon { font-size: 11px; pointer-events: none; }
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
  #contextMenu { position: fixed; z-index: 10; display: none; flex-direction: column; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); border: 1px solid var(--vscode-panel-border); box-shadow: 0 2px 8px rgba(0,0,0,0.2); min-width: 160px; }
  #contextMenu button { text-align: left; background: none; border: none; color: var(--vscode-foreground); padding: 6px 10px; font-size: 12px; }
  #contextMenu button:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  #contextMenu button:disabled { color: var(--vscode-disabledForeground, #888); cursor: default; }
  .preview-table-wrap { overflow: auto; border: 1px solid var(--vscode-panel-border); max-height: 480px; }
  table.preview-table { border-collapse: collapse; font-size: 12px; white-space: nowrap; }
  table.preview-table th, table.preview-table td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; }
  table.preview-table th { background: var(--vscode-editorWidget-background); position: sticky; top: 0; }
  .preview-empty { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 8px 0; }
</style>
</head>
<body>
  ${state.missingExecutable ? `<div class="banner">zhao-cli was not found on PATH. <button id="download">Download zhao-cli</button></div>` : ""}
  <div class="tab-strip">
    <button id="tabLineage" class="${state.activeTab === "lineage" ? "active" : ""}">Lineage</button>
    <button id="tabPreview" class="${state.activeTab === "preview" ? "active" : ""}">Preview</button>
  </div>
  <div id="panelLineage" class="tab-panel ${state.activeTab === "lineage" ? "active" : ""}">
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
  </div>
  <div id="panelPreview" class="tab-panel ${state.activeTab === "preview" ? "active" : ""}">
    <div class="controls">
      <label>Model/seed/source <select id="previewFocus">${previewOptions}</select></label>
    </div>
    ${renderPreviewBody(state, previewFocusNode)}
  </div>
  <div id="contextMenu">
    <button id="ctxPreview">Preview Data</button>
    <button id="ctxOpenFile">Open Model File</button>
  </div>
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

  document.getElementById("tabLineage")?.addEventListener("click", () =>
    vscode.postMessage({ type: "setActiveTab", tab: "lineage" }));
  document.getElementById("tabPreview")?.addEventListener("click", () =>
    vscode.postMessage({ type: "setActiveTab", tab: "preview" }));
  document.getElementById("previewFocus")?.addEventListener("change", (e) => {
    if (e.target.value) vscode.postMessage({ type: "previewNode", nodeId: e.target.value });
  });

  // Right-click context menu -- custom-drawn (a plain HTML <div>, not a
  // native VS Code menu contribution), since the lineage graph itself is
  // plain SVG inside this one webview, not a TreeView VS Code's own
  // "view/item/context" menu contribution mechanism could attach to.
  const contextMenu = document.getElementById("contextMenu");
  const ctxPreviewBtn = document.getElementById("ctxPreview");
  const ctxOpenFileBtn = document.getElementById("ctxOpenFile");
  let contextMenuNodeId = null;

  function showContextMenu(x, y, node) {
    contextMenuNodeId = node.id;
    const isSource = node.kind === "source";
    ctxPreviewBtn.disabled = isSource;
    ctxOpenFileBtn.disabled = isSource;
    ctxOpenFileBtn.title = isSource ? "A source has no file of its own to open" : "";
    ctxPreviewBtn.title = isSource ? "A source has no query of its own to preview" : "";
    contextMenu.style.left = x + "px";
    contextMenu.style.top = y + "px";
    contextMenu.style.display = "flex";
  }
  function hideContextMenu() {
    contextMenu.style.display = "none";
    contextMenuNodeId = null;
  }
  document.addEventListener("click", (e) => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });
  ctxPreviewBtn.addEventListener("click", () => {
    if (contextMenuNodeId) vscode.postMessage({ type: "previewNode", nodeId: contextMenuNodeId });
    hideContextMenu();
  });
  ctxOpenFileBtn.addEventListener("click", () => {
    if (contextMenuNodeId) vscode.postMessage({ type: "openModelFile", nodeId: contextMenuNodeId });
    hideContextMenu();
  });

  // Icon (by kind) + color token (by kind/materialization) -- mirrors
  // ../engine/graphEngine.ts's iconFor/colorTokenFor exactly (duplicated
  // here rather than imported, since this script runs as a plain
  // webview blob with no module bundling of its own -- see the module
  // doc comment's "not unit-tested" note; the decision itself is what's
  // tested, in graphEngine.test.ts).
  const NODE_ICONS = { model: "\\u{1F5C3}\\u{FE0F}", source: "\\u{1F50C}", seed: "\\u{1F331}" };
  const RECOGNIZED_MATERIALIZATIONS = new Set(["table", "view", "incremental", "ephemeral"]);
  function colorTokenFor(n) {
    if (n.kind === "source") return "source";
    if (n.kind === "seed") return "seed";
    return n.materialization && RECOGNIZED_MATERIALIZATIONS.has(n.materialization) ? n.materialization : "other";
  }

  // Dynamic node width: grows with the label's estimated width up to a
  // cap, then wraps onto a second line instead of continuing to grow or
  // overflowing the box -- fixes the previous fixed-width behavior where
  // a long model name simply ran past the frame. Character-width is an
  // estimate (avg glyph width at the label's 11px font), not a live DOM
  // measurement -- "good enough to read," matching this render's own
  // existing layering heuristic, and deterministic/testable without a
  // real browser.
  const MIN_BOX_WIDTH = 140;
  const MAX_BOX_WIDTH = 260;
  const AVG_CHAR_WIDTH = 6.5;
  const HORIZONTAL_PADDING = 16;
  function layoutLabel(name) {
    const naturalWidth = name.length * AVG_CHAR_WIDTH + HORIZONTAL_PADDING;
    if (naturalWidth <= MAX_BOX_WIDTH) {
      return { width: Math.max(MIN_BOX_WIDTH, naturalWidth), lines: [name] };
    }
    // Wrap at the nearest underscore/word boundary to the midpoint, so a
    // snake_case model name (the overwhelming common case) breaks at a
    // real word seam rather than mid-word; falls back to a hard
    // character split only when no underscore exists to break on at all.
    const mid = Math.floor(name.length / 2);
    let splitAt = -1;
    for (let offset = 0; offset < mid; offset++) {
      if (name[mid - offset] === "_") { splitAt = mid - offset; break; }
      if (name[mid + offset] === "_") { splitAt = mid + offset; break; }
    }
    const [first, second] =
      splitAt === -1
        ? [name.slice(0, mid), name.slice(mid)]
        : [name.slice(0, splitAt), name.slice(splitAt + 1)];
    return { width: MAX_BOX_WIDTH, lines: [first, second] };
  }

  function render() {
    const svg = document.getElementById("graph");
    svg.innerHTML = "";
    if (!graph || graph.nodes.length === 0) {
      return;
    }

    const headerHeight = 28;
    const wrapLineHeight = 14;
    const columnRowHeight = 16;
    const boxGap = 20;
    const columnGap = 60;

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

    // Each node's label layout (width + one or two lines, see
    // layoutLabel) is resolved once and cached per node id, since it's
    // consulted repeatedly below (box height, box width, column-max
    // width, text rendering) and the wrap decision itself never changes
    // mid-render.
    const labelLayouts = new Map();
    function labelLayoutOf(n) {
      let layout = labelLayouts.get(n.id);
      if (!layout) {
        layout = layoutLabel(n.name);
        labelLayouts.set(n.id, layout);
      }
      return layout;
    }
    function headerHeightOf(n) {
      return labelLayoutOf(n).lines.length > 1 ? headerHeight + wrapLineHeight : headerHeight;
    }
    function boxHeightOf(n) {
      const cols = nodeColumns.get(n.id);
      const header = headerHeightOf(n);
      return cols && cols.length > 0 ? header + cols.length * columnRowHeight : header;
    }

    const byDepth = new Map();
    for (const n of graph.nodes) {
      const key = n.depth ?? 0;
      if (!byDepth.has(key)) byDepth.set(key, []);
      byDepth.get(key).push(n);
    }
    const columns = [...byDepth.keys()].sort((a, b) => a - b);

    // Each column's width is the widest label in that column (capped at
    // MAX_BOX_WIDTH by layoutLabel itself) -- a node's box grows to fit
    // its own label, up to that cap, and every node in the same column
    // shares that column's width so the graph still reads as a clean
    // grid rather than a ragged one. Column x-offsets are cumulative
    // (each column's width, not a fixed constant, plus a gap), replacing
    // the previous fixed-width-per-column spacing.
    const columnWidths = new Map();
    for (const n of graph.nodes) {
      const key = n.depth ?? 0;
      const width = labelLayoutOf(n).width;
      columnWidths.set(key, Math.max(columnWidths.get(key) ?? 0, width));
    }
    const columnX = new Map();
    let cursorX = 16;
    for (const depth of columns) {
      columnX.set(depth, cursorX);
      cursorX += (columnWidths.get(depth) ?? MIN_BOX_WIDTH) + columnGap;
    }

    // Each node's own y within its column is the running total of every
    // earlier node's box height (plus a gap) in that same column --
    // boxes are no longer a uniform height once column rows are in
    // play, so a fixed rowHeight per slot would either clip a
    // many-column node or waste space under a plain one.
    const positions = new Map();
    columns.forEach((depth) => {
      const nodesAtDepth = byDepth.get(depth);
      let y = 16;
      for (const n of nodesAtDepth) {
        const height = boxHeightOf(n);
        const width = columnWidths.get(depth) ?? MIN_BOX_WIDTH;
        positions.set(n.id, { x: columnX.get(depth), y, width, height, headerHeight: headerHeightOf(n) });
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
      return pos.y + pos.headerHeight + index * columnRowHeight + columnRowHeight / 2;
    }

    const ns = "http://www.w3.org/2000/svg";

    const edgeGroup = document.createElementNS(ns, "g");
    for (const e of graph.edges) {
      const from = positions.get(e.from);
      const to = positions.get(e.to);
      if (!from || !to) continue;
      const path = document.createElementNS(ns, "path");
      const x1 = from.x + from.width, y1 = from.y + from.headerHeight / 2, x2 = to.x, y2 = to.y + to.headerHeight / 2;
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
        const x1 = fromPos.x + fromPos.width, x2 = toPos.x;
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

      const layout = labelLayoutOf(n);

      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("width", String(pos.width));
      rect.setAttribute("height", String(pos.height));
      rect.setAttribute("rx", "4");
      let cls = "node-box token-" + colorTokenFor(n);
      if (n.changed) cls += " changed";
      else if (n.reached) cls += " reached";
      rect.setAttribute("class", cls);
      rect.style.cursor = "pointer";
      g.appendChild(rect);

      const icon = document.createElementNS(ns, "text");
      icon.setAttribute("x", "6");
      icon.setAttribute("y", "18");
      icon.setAttribute("class", "node-icon");
      icon.textContent = NODE_ICONS[n.kind] ?? "";
      g.appendChild(icon);

      // One <tspan> per wrapped line (one or two, see layoutLabel) --
      // an SVG <text> element has no native word-wrap of its own, so a
      // long label previously just overflowed the box; this is the
      // fix.
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", "22");
      text.setAttribute("y", "18");
      text.setAttribute("class", "node-label");
      layout.lines.forEach((line, index) => {
        const tspan = document.createElementNS(ns, "tspan");
        tspan.setAttribute("x", "22");
        if (index > 0) tspan.setAttribute("dy", String(wrapLineHeight));
        tspan.textContent = line;
        text.appendChild(tspan);
      });
      g.appendChild(text);

      rect.addEventListener("click", () => {
        if (selected) selected.classList.remove("selected");
        rect.classList.add("selected");
        selected = rect;
        const term = n.kind === "source" ? originTerm : n.kind === "seed" ? "seed" : nodeTerm;
        document.getElementById("info").textContent =
          term + " " + n.id + (n.package ? " (package: " + n.package + ")" : "") +
          (n.materialization ? "\\nmaterialization: " + n.materialization : "") +
          (n.changed ? "\\nchanged in this branch" : "") +
          (n.reached ? "\\nreached by this branch's changes" : "");
      });
      rect.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        showContextMenu(event.clientX, event.clientY, n);
      });

      // One row per real column, each independently clickable/
      // hoverable -- clicking a column highlights every column-edge
      // path touching it (both ends: it may be a source in one edge
      // and a destination in another) rather than replacing #info's
      // whole-node summary, so a user can trace one column's lineage
      // without losing which node they were looking at.
      cols.forEach((column, index) => {
        const rowY = pos.headerHeight + index * columnRowHeight;

        if (index > 0) {
          const divider = document.createElementNS(ns, "line");
          divider.setAttribute("x1", "0");
          divider.setAttribute("x2", String(pos.width));
          divider.setAttribute("y1", String(rowY));
          divider.setAttribute("y2", String(rowY));
          divider.setAttribute("class", "column-divider");
          g.appendChild(divider);
        }

        const rowRect = document.createElementNS(ns, "rect");
        rowRect.setAttribute("x", "0");
        rowRect.setAttribute("y", String(rowY));
        rowRect.setAttribute("width", String(pos.width));
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
