// The shapes zhao-cli's file contracts produce (`target/zhao/full_lineage.json`,
// `target/zhao/run-metadata.json`) and the shapes the lineage-graph engine
// renders. Deliberately loose on fields this extension doesn't use --
// zhao-cli owns the real contract; this is just the subset read here.

/** A model or source, as `full_lineage.json` names it (its Node/Origin id). */
export type NodeId = string;

/** One node in `full_lineage.json`'s `nodes` array. */
export interface FullLineageNode {
  id: NodeId;
  /** dbt's own vocabulary: "model" or "source" -- never zhao's internal
   * "Node"/"Origin" terms, per the Adapter Vocabulary convention. */
  kind: "model" | "source";
  name: string;
  /** dbt package this model/source belongs to. */
  package?: string;
}

/** One model-level edge in `full_lineage.json`'s `edges` array. */
export interface FullLineageEdge {
  from: NodeId;
  to: NodeId;
}

/** One column-level edge in `full_lineage.json`'s `column_edges` array
 * (present only when zhao-cli resolved column-level lineage). */
export interface FullLineageColumnEdge {
  fromNode: NodeId;
  fromColumn: string;
  toNode: NodeId;
  toColumn: string;
}

/** The whole-project graph `zhao lineage` always writes to
 * `target/zhao/full_lineage.json`, regardless of `--text`/HTML/target. */
export interface FullLineageJson {
  nodes: FullLineageNode[];
  edges: FullLineageEdge[];
  columnEdges?: FullLineageColumnEdge[];
}

/** The subset of `target/zhao/run-metadata.json` (from `zhao diff`) the
 * diff-highlight overlay needs: which Nodes changed, and which downstream
 * Nodes were genuinely reached by that change. */
export interface RunMetadataJson {
  changedNodeIds: NodeId[];
  reachedNodeIds: NodeId[];
}

export type Direction = "upstream" | "downstream" | "both";

/** The engine's one configuration input -- see the spec's "one testing
 * seam" decision: `(fullLineageJson, runMetadataJson | null, config) =>
 * RenderableGraph`. */
export interface GraphEngineConfig {
  /** The model/source to center the view on. `null` renders the whole
   * project (bounded only by the fixture itself, no BFS scoping). */
  focus: NodeId | null;
  /** Number of upstream/downstream hops from `focus` to include. Ignored
   * when `focus` is `null`. */
  depth: number;
  direction: Direction;
  /** When true, render columnEdges (scoped the same way as model-level
   * edges) instead of/in addition to model-level edges. */
  columnLevel: boolean;
  /** When true and `runMetadata` is given, mark changed/reached nodes. */
  diffHighlight: boolean;
}

export interface RenderableNode {
  id: NodeId;
  kind: "model" | "source";
  name: string;
  package?: string;
  /** True when `diffHighlight` is on and this node is in
   * `runMetadata.changedNodeIds`. */
  changed: boolean;
  /** True when `diffHighlight` is on and this node is in
   * `runMetadata.reachedNodeIds` (and not itself `changed`). */
  reached: boolean;
  /** BFS distance from `focus`, in hops; `0` for `focus` itself, `null`
   * when there is no `focus` (whole-project render). */
  depth: number | null;
}

export interface RenderableEdge {
  from: NodeId;
  to: NodeId;
}

export interface RenderableColumnEdge {
  fromNode: NodeId;
  fromColumn: string;
  toNode: NodeId;
  toColumn: string;
}

/** What the lineage-graph engine produces: the visible node/edge set
 * after depth/direction/column-level scoping, with diff-highlight flags
 * already applied -- the webview renders this directly, no further
 * filtering logic on the plumbing side. */
export interface RenderableGraph {
  nodes: RenderableNode[];
  edges: RenderableEdge[];
  columnEdges: RenderableColumnEdge[];
  /** Echoes back which Node/Origin the graph was centered on, so the
   * webview can highlight it without re-deriving it from `config`. */
  focus: NodeId | null;
}
