// The one pure module in this extension -- see the spec's "one testing
// seam" decision. No VS Code API, no subprocess, no filesystem access:
// every input arrives already parsed, every output is plain data. All
// depth/direction/column-level/diff-highlight decision-making lives
// here so it's directly unit-testable against static fixtures.

import type {
  FullLineageJson,
  GraphEngineConfig,
  NodeId,
  RenderableColumnEdge,
  RenderableEdge,
  RenderableGraph,
  RenderableNode,
  RunMetadataJson,
} from "./types.js";

/**
 * Builds the graph a lineage panel renders: `fullLineage` scoped to
 * `config.depth` hops from `config.focus` in `config.direction`
 * (unscoped -- the whole project -- when `focus` is `null`), with
 * `config.columnLevel`'s column-edge overlay and `config.diffHighlight`'s
 * changed/reached marking applied on top.
 */
export function buildRenderableGraph(
  fullLineage: FullLineageJson,
  runMetadata: RunMetadataJson | null,
  config: GraphEngineConfig,
): RenderableGraph {
  const depthById = resolveVisibleDepths(fullLineage, config);

  const nodes: RenderableNode[] = fullLineage.nodes
    .filter((n) => depthById.has(n.id))
    .map((n) => {
      const changed = config.diffHighlight && (runMetadata?.changedNodeIds.includes(n.id) ?? false);
      const reached =
        !changed &&
        config.diffHighlight &&
        (runMetadata?.reachedNodeIds.includes(n.id) ?? false);
      return {
        id: n.id,
        kind: n.kind,
        name: n.name,
        package: n.package,
        materialization: n.materialization,
        changed,
        reached,
        depth: depthById.get(n.id) ?? null,
      };
    });

  const edges: RenderableEdge[] = fullLineage.edges.filter(
    (e) => depthById.has(e.from) && depthById.has(e.to),
  );

  const columnEdges: RenderableColumnEdge[] = config.columnLevel
    ? (fullLineage.columnEdges ?? []).filter(
        (e) => depthById.has(e.fromNode) && depthById.has(e.toNode),
      )
    : [];

  return { nodes, edges, columnEdges, focus: config.focus };
}

/**
 * Resolves which Node/Origin ids are visible and their horizontal
 * layout position: hops from `config.focus` when one is given, or (when
 * `focus` is `null`, meaning "everything") each node's topological
 * *layer* -- longest-path distance from a root (a node/source with no
 * upstream edges at all), the same DAG-layering convention zhao-cli's
 * own HTML lineage export uses. A non-null focus not present in
 * `fullLineage.nodes` at all resolves to an empty map -- an empty graph,
 * not a thrown error (the caller decides how to report an unknown
 * target; this module never does).
 */
function resolveVisibleDepths(
  fullLineage: FullLineageJson,
  config: GraphEngineConfig,
): Map<NodeId, number | null> {
  if (config.focus === null) {
    return computeTopologicalLayers(fullLineage);
  }

  const focus = config.focus;
  if (!fullLineage.nodes.some((n) => n.id === focus)) {
    return new Map();
  }

  const upstreamAdjacency = new Map<NodeId, NodeId[]>();
  const downstreamAdjacency = new Map<NodeId, NodeId[]>();
  for (const edge of fullLineage.edges) {
    pushInto(downstreamAdjacency, edge.from, edge.to);
    pushInto(upstreamAdjacency, edge.to, edge.from);
  }

  const depths = new Map<NodeId, number>();
  depths.set(focus, 0);

  // Upstream hops are recorded *negative*, downstream *positive* -- both
  // are "distance from focus" in BFS terms, but the panel lays nodes out
  // left-to-right by depth (see lineageHtml.ts's `render`, sorting
  // `byDepth`'s keys ascending), and upstream/downstream need to land on
  // opposite sides of focus for that ordering to read as an actual
  // dataflow direction rather than an arbitrary column assignment. Before
  // this, both directions wrote the same unsigned hop count into one
  // shared map -- a node one hop upstream and one hop downstream both
  // got `depth: 1` and were rendered in the *same* column, with nothing
  // distinguishing which side of focus either belonged on.
  if (config.direction === "upstream" || config.direction === "both") {
    bfs(focus, upstreamAdjacency, config.depth, depths, -1);
  }
  if (config.direction === "downstream" || config.direction === "both") {
    bfs(focus, downstreamAdjacency, config.depth, depths, 1);
  }

  return new Map([...depths.entries()].map(([id, depth]) => [id, depth]));
}

/**
 * Layers every node by longest-path distance from a root (in-degree
 * zero) node, via Kahn's algorithm: a node is only finalized (and its
 * layer used to compute its own downstream neighbors') once every edge
 * into it has been processed, so each node's layer is always the
 * *maximum* of `predecessor layer + 1` across all its upstream edges --
 * not just the first one visited. A node stuck in a cycle (never
 * reaches in-degree zero, since real dbt DAGs are acyclic and this is
 * purely a defensive fallback) is placed at layer `0` rather than
 * dropped from the map entirely.
 */
function computeTopologicalLayers(fullLineage: FullLineageJson): Map<NodeId, number> {
  const downstreamAdjacency = new Map<NodeId, NodeId[]>();
  const remainingInDegree = new Map<NodeId, number>();
  for (const node of fullLineage.nodes) {
    remainingInDegree.set(node.id, 0);
  }
  for (const edge of fullLineage.edges) {
    pushInto(downstreamAdjacency, edge.from, edge.to);
    remainingInDegree.set(edge.to, (remainingInDegree.get(edge.to) ?? 0) + 1);
  }

  const layer = new Map<NodeId, number>();
  let frontier: NodeId[] = [];
  for (const [id, degree] of remainingInDegree) {
    if (degree === 0) {
      layer.set(id, 0);
      frontier.push(id);
    }
  }

  let currentLayer = 0;
  while (frontier.length > 0) {
    const next: NodeId[] = [];
    for (const id of frontier) {
      for (const neighbor of downstreamAdjacency.get(id) ?? []) {
        const candidate = currentLayer + 1;
        if ((layer.get(neighbor) ?? -1) < candidate) {
          layer.set(neighbor, candidate);
        }
        const remaining = (remainingInDegree.get(neighbor) ?? 0) - 1;
        remainingInDegree.set(neighbor, remaining);
        if (remaining === 0) {
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    currentLayer += 1;
  }

  for (const node of fullLineage.nodes) {
    if (!layer.has(node.id)) {
      layer.set(node.id, 0);
    }
  }

  return layer;
}

/** The icon a lineage node renders -- one per `kind`. Kept as its own
 * (currently identity) function rather than inlined at each render
 * call site, so icon selection is one tested decision, not a choice
 * duplicated between the panel webview and the pop-out editor-tab
 * webview. */
export function iconFor(kind: RenderableNode["kind"]): RenderableNode["kind"] {
  return kind;
}

/** The color-coding token a lineage node renders -- `"source"`/`"seed"`
 * for those kinds (each has its own fixed color, no materialization of
 * their own), otherwise the model's materialization
 * ("table"/"view"/"incremental"/"ephemeral"), or `"other"` for any
 * materialization this extension doesn't specifically recognize (an
 * unrecognized string is never dropped upstream -- see
 * `Materialization::Other` in zhao-cli -- but it also never grows the
 * color palette on its own; it always renders as the same neutral
 * fallback). A model with no `materialization` at all (shouldn't happen
 * given zhao-cli's own contract, but defensively handled rather than
 * assumed) also falls back to `"other"`. */
export type ColorToken = "table" | "view" | "incremental" | "ephemeral" | "seed" | "source" | "other";

const RECOGNIZED_MATERIALIZATIONS = new Set(["table", "view", "incremental", "ephemeral"]);

export function colorTokenFor(node: Pick<RenderableNode, "kind" | "materialization">): ColorToken {
  if (node.kind === "source") {
    return "source";
  }
  if (node.kind === "seed") {
    return "seed";
  }
  return node.materialization && RECOGNIZED_MATERIALIZATIONS.has(node.materialization)
    ? (node.materialization as ColorToken)
    : "other";
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

/**
 * Breadth-first search from `start` over `adjacency`, up to `maxDepth`
 * hops, writing each visited node's hop count into the shared `depths`
 * map as `sign * hopCount` (`-1` for the upstream pass, `1` for
 * downstream -- see `resolveVisibleDepths`, which is what actually
 * separates upstream/downstream onto opposite sides of focus in the
 * panel's layout).
 *
 * The BFS traversal itself works in plain, unsigned hop-space via a
 * `localHops` map private to *this* call -- a node's hop count in one
 * direction has no bearing on its (differently-signed) count in the
 * other, so the "is this a shorter path" comparison a plain BFS needs
 * must never be done against the shared, cross-direction `depths` map
 * directly. Only once this pass's own traversal is complete does its
 * (unsigned, already-shortest) result get signed and merged in.
 */
function bfs(
  start: NodeId,
  adjacency: Map<NodeId, NodeId[]>,
  maxDepth: number,
  depths: Map<NodeId, number>,
  sign: 1 | -1,
): void {
  const localHops = new Map<NodeId, number>();
  let frontier = [start];
  let hop = 0;
  while (frontier.length > 0 && hop < maxDepth) {
    const next: NodeId[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (localHops.has(neighbor)) {
          continue;
        }
        localHops.set(neighbor, hop + 1);
        next.push(neighbor);
      }
    }
    frontier = next;
    hop += 1;
  }
  for (const [id, hopCount] of localHops) {
    depths.set(id, sign * hopCount);
  }
}
