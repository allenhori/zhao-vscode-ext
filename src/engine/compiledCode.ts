// Resolves a lineage node's compiled SQL location for the "View
// Compiled Code" right-click action. Pure: reads `compiled_path`
// straight off the node's own entry in dbt's manifest.json -- the field
// both dbt-core and dbt Fusion write once a node is compiled -- rather
// than reconstructing a `target/compiled/<project>/models/...`-shaped
// path by convention. That's what makes this work identically
// regardless of which tool produced the compile, with no
// adapter-specific branching: whichever tool wrote the manifest already
// recorded where it put the file.

/** The subset of dbt's manifest.json this extension reads. Both
 * dbt-core and dbt Fusion write a `nodes` map keyed by unique_id, each
 * entry carrying `compiled_path` once that node has actually been
 * compiled -- absent (or `null`) otherwise (e.g. it errored, or the
 * manifest predates this node). Deliberately loose: dbt owns the real
 * manifest contract, this only reads the one field needed here. */
export interface RawDbtManifest {
  nodes?: Record<string, { compiled_path?: string | null } | undefined>;
}

/**
 * Resolves `nodeId`'s compiled SQL file path from `manifest`. Returns
 * `null` when the node isn't in the manifest at all, or has no
 * `compiled_path` yet -- never throws, and never guesses a path the
 * manifest itself didn't provide.
 */
export function resolveCompiledPath(manifest: RawDbtManifest, nodeId: string): string | null {
  const path = manifest.nodes?.[nodeId]?.compiled_path;
  return typeof path === "string" && path.length > 0 ? path : null;
}
