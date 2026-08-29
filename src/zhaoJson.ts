// Translates zhao-cli's actual file-contract JSON shapes
// (`target/zhao/full_lineage.json`, `target/zhao/run-metadata.json`) into
// the normalized shapes `./engine/graphEngine.ts` consumes. Pure, no I/O
// -- the raw-JSON-shape knowledge lives here and nowhere else, so the
// engine itself never has to know zhao-cli's actual field names
// (`upstream`/`downstream`, the `node`/`origin` kind discriminant, a
// single `edges` array mixing model- and column-level entries).

import type { FullLineageJson, RunMetadataJson } from "./engine/types.js";

/** `target/zhao/full_lineage.json`'s actual shape (see zhao-cli's
 * `lineage_html::GraphData`/`GraphNode`/`GraphEdge`). */
export interface RawFullLineageJson {
  nodes: RawGraphNode[];
  edges: RawGraphEdge[];
  node_term: string;
  origin_term: string;
}

interface RawGraphNode {
  id: string;
  name: string;
  /** zhao's generic Node/Origin discriminant -- `node_term`/`origin_term`
   * carry the Adapter Vocabulary's actual display words (e.g. "model"/
   * "source" for dbt); this extension never shows "node"/"origin" to
   * the user. */
  kind: "node" | "origin";
}

interface RawGraphEdge {
  upstream: string;
  downstream: string;
  /** Present together on a column-level edge, absent together on a
   * model-level one -- both kinds share this one array. */
  upstream_column?: string;
  downstream_column?: string;
}

/** `target/zhao/run-metadata.json`'s actual shape -- only the fields
 * the diff-highlight overlay and the recommended-command display need;
 * every other field (`findings`, `staleness_warning`, `defer_plan`,
 * ...) is ignored here. */
export interface RawRunMetadataJson {
  changes: RawChange[];
  impacted_models: string[];
  /** Present only when `zhao.yml`'s `recommended-command.subcommand` is
   * configured and something was impacted -- see
   * `Report::with_recommended_command`. zhao-cli deliberately never
   * assembles this on its own otherwise, so its absence here isn't a
   * missing feature, it's the documented "not configured" state. */
  recommended_command?: string;
}

interface RawChange {
  /** Every `ChangeJson` variant carries a `node` field, regardless of
   * its `type` discriminant -- that's the only field this needs. */
  node: string;
}

export interface ParsedFullLineage {
  graph: FullLineageJson;
  /** The Adapter Vocabulary's display term for a "node" (e.g. "model"). */
  nodeTerm: string;
  /** The Adapter Vocabulary's display term for an "origin" (e.g. "source"). */
  originTerm: string;
}

export function parseFullLineageJson(raw: RawFullLineageJson): ParsedFullLineage {
  const edges = raw.edges.filter((e) => e.upstream_column === undefined);
  const columnEdges = raw.edges.filter(
    (e): e is Required<RawGraphEdge> => e.upstream_column !== undefined && e.downstream_column !== undefined,
  );

  return {
    graph: {
      nodes: raw.nodes.map((n) => ({
        id: n.id,
        kind: n.kind === "origin" ? "source" : "model",
        name: n.name,
      })),
      edges: edges.map((e) => ({ from: e.upstream, to: e.downstream })),
      columnEdges: columnEdges.map((e) => ({
        fromNode: e.upstream,
        fromColumn: e.upstream_column,
        toNode: e.downstream,
        toColumn: e.downstream_column,
      })),
    },
    nodeTerm: raw.node_term,
    originTerm: raw.origin_term,
  };
}

export interface ParsedRunMetadata {
  runMetadata: RunMetadataJson;
  /** `null` when zhao-cli didn't generate one (no `recommended-command`
   * config, or nothing was impacted) -- see `RawRunMetadataJson.recommended_command`. */
  recommendedCommand: string | null;
}

/** The changed-node set is every distinct `node` a Change touched;
 * `impacted_models` is already exactly the reached-node set
 * `zhao check`/`zhao diff` compute -- see `Report::with_impacted_models`. */
export function parseRunMetadataJson(raw: RawRunMetadataJson): ParsedRunMetadata {
  return {
    runMetadata: {
      changedNodeIds: [...new Set(raw.changes.map((c) => c.node))],
      reachedNodeIds: raw.impacted_models,
    },
    recommendedCommand: raw.recommended_command ?? null,
  };
}
