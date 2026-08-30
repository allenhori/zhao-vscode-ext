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

  if (config.direction === "upstream" || config.direction === "both") {
    bfs(focus, upstreamAdjacency, config.depth, depths);
  }
  if (config.direction === "downstream" || config.direction === "both") {
    bfs(focus, downstreamAdjacency, config.depth, depths);
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
 * hops, recording each visited node's *smallest* hop count into
 * `depths` (shared across both the upstream and downstream passes, so a
 * node reachable both ways keeps whichever distance is smaller). Guards
 * against cycles the same way any BFS does: a node already in `depths`
 * at or before the distance this pass would assign it is never
 * re-enqueued.
 */
function bfs(
  start: NodeId,
  adjacency: Map<NodeId, NodeId[]>,
  maxDepth: number,
  depths: Map<NodeId, number>,
): void {
  let frontier = [start];
  let hop = 0;
  while (frontier.length > 0 && hop < maxDepth) {
    const next: NodeId[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        const existing = depths.get(neighbor);
        if (existing === undefined || existing > hop + 1) {
          depths.set(neighbor, hop + 1);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    hop += 1;
  }
}
