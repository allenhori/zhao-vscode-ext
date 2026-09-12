// The shapes zhao-cli's file contracts produce (`target/zhao/full_lineage.json`,
// `target/zhao/run-metadata.json`) and the shapes the lineage-graph engine
// renders. Deliberately loose on fields this extension doesn't use --
// zhao-cli owns the real contract; this is just the subset read here.

/** A model or source, as `full_lineage.json` names it (its Node/Origin id). */
export type NodeId = string;

/** One node in `full_lineage.json`'s `nodes` array. */
export interface FullLineageNode {
  id: NodeId;
  /** dbt's own vocabulary: "model", "source", or "seed" -- never zhao's
   * internal "Node"/"Origin" terms, per the Adapter Vocabulary
   * convention. "seed" is its own `kind`, not folded into a
   * materialization value -- a seed's "kind of thing" (a checked-in
   * file loaded verbatim) is orthogonal to materialization, which only
   * meaningfully varies for a real model. */
  kind: "model" | "source" | "seed";
  name: string;
  /** dbt package this model/source/seed belongs to. */
  package?: string;
  /** This node's materialization ("table"/"view"/"incremental"/
   * "ephemeral"/some other recognized-verbatim string) -- present only
   * for `kind: "model"`; a "source" or "seed" has none. */
  materialization?: string;
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

/** The color-coding token a lineage node renders with -- `"source"`/
 * `"seed"` for those kinds, otherwise a model's materialization
 * ("table"/"view"/"incremental"/"ephemeral"), or `"other"` for an
 * unrecognized materialization. Defined here (not in `graphEngine.ts`,
 * where the one function that derives it, `colorTokenFor`, lives) so
 * `RenderableNode` can carry the already-computed result without a
 * circular import -- the webview then reads `colorToken` straight off
 * each node as data, rather than re-deriving the same decision with a
 * second, hand-copied implementation of its own. */
export type ColorToken = "table" | "view" | "incremental" | "ephemeral" | "seed" | "source" | "other";

export interface RenderableNode {
  id: NodeId;
  kind: "model" | "source" | "seed";
  name: string;
  package?: string;
  /** Echoed straight from `FullLineageNode.materialization` -- present
   * only for `kind: "model"`. */
  materialization?: string;
  /** This node's color-coding token, already resolved by
   * `graphEngine.ts`'s `colorTokenFor` -- see [`ColorToken`]. */
  colorToken: ColorToken;
  /** True when `diffHighlight` is on and this node is in
   * `runMetadata.changedNodeIds`. */
  changed: boolean;
  /** True when `diffHighlight` is on and this node is in
   * `runMetadata.reachedNodeIds` (and not itself `changed`). */
  reached: boolean;
  /** Horizontal layout position: BFS distance from `focus` in hops
   * (`0` for `focus` itself) when one is given; otherwise (a
   * whole-project render, no `focus`) this node's topological layer --
   * longest-path distance from a root node/source with no upstream
   * edges. Never `null` in practice today (both branches always assign
   * a number), but kept optional-typed since a future scoping mode
   * might genuinely have no layout position to offer. */
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
