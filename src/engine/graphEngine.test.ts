import { describe, expect, it } from "vitest";
import { buildRenderableGraph } from "./graphEngine.js";
import type { FullLineageJson, GraphEngineConfig, RunMetadataJson } from "./types.js";

function node(id: string, kind: "model" | "source" = "model") {
  return { id, kind, name: id.split(".").pop() ?? id };
}

function baseConfig(overrides: Partial<GraphEngineConfig> = {}): GraphEngineConfig {
  return {
    focus: null,
    depth: 3,
    direction: "both",
    columnLevel: false,
    diffHighlight: false,
    ...overrides,
  };
}

// Diamond: raw_orders -> stg_orders -> dim_customers
//                                   -> fct_orders
// stg_customers -> dim_customers
const diamond: FullLineageJson = {
  nodes: [
    node("source.raw_orders", "source"),
    node("model.stg_orders"),
    node("model.stg_customers"),
    node("model.dim_customers"),
    node("model.fct_orders"),
  ],
  edges: [
    { from: "source.raw_orders", to: "model.stg_orders" },
    { from: "model.stg_orders", to: "model.dim_customers" },
    { from: "model.stg_customers", to: "model.dim_customers" },
    { from: "model.stg_orders", to: "model.fct_orders" },
  ],
};

describe("buildRenderableGraph -- whole-project render (no focus)", () => {
  it("includes every node and edge, laid out by topological layer", () => {
    const graph = buildRenderableGraph(diamond, null, baseConfig({ focus: null }));
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(
      diamond.nodes.map((n) => n.id).sort(),
    );
    expect(graph.edges).toEqual(diamond.edges);
    expect(graph.focus).toBeNull();

    const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n.depth]));
    // Roots (no upstream edges at all) both land at layer 0.
    expect(byId["source.raw_orders"]).toBe(0);
    expect(byId["model.stg_customers"]).toBe(0);
    // stg_orders depends only on the root source -> layer 1.
    expect(byId["model.stg_orders"]).toBe(1);
    // dim_customers depends on stg_orders (layer 1) -- its layer is the
    // *max* over both its upstream edges, not whichever was visited
    // first, so it lands at layer 2 even though stg_customers alone
    // would only imply layer 1.
    expect(byId["model.dim_customers"]).toBe(2);
    expect(byId["model.fct_orders"]).toBe(2);
  });

  it("places a node stuck in a cycle at layer 0 rather than dropping it", () => {
    const cyclic: FullLineageJson = {
      nodes: [node("model.a"), node("model.b")],
      edges: [
        { from: "model.a", to: "model.b" },
        { from: "model.b", to: "model.a" },
      ],
    };
    const graph = buildRenderableGraph(cyclic, null, baseConfig({ focus: null }));
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["model.a", "model.b"]);
    expect(graph.nodes.every((n) => n.depth === 0)).toBe(true);
  });
});

describe("buildRenderableGraph -- direction filtering", () => {
  it("upstream-only from dim_customers includes both its upstream branches, not fct_orders", () => {
    const graph = buildRenderableGraph(
      diamond,
      null,
      baseConfig({ focus: "model.dim_customers", direction: "upstream" }),
    );
    const ids = graph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(
      [
        "model.dim_customers",
        "model.stg_customers",
        "model.stg_orders",
        "source.raw_orders",
      ].sort(),
    );
    expect(ids).not.toContain("model.fct_orders");
  });

  it("downstream-only from stg_orders includes dim_customers and fct_orders, not stg_customers", () => {
    const graph = buildRenderableGraph(
      diamond,
      null,
      baseConfig({ focus: "model.stg_orders", direction: "downstream" }),
    );
    const ids = graph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(
      ["model.stg_orders", "model.dim_customers", "model.fct_orders"].sort(),
    );
    expect(ids).not.toContain("model.stg_customers");
  });

  it("both directions from stg_orders includes its one upstream hop and both downstream hops", () => {
    const graph = buildRenderableGraph(
      diamond,
      null,
      baseConfig({ focus: "model.stg_orders", direction: "both" }),
    );
    const ids = graph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(
      [
        "model.stg_orders",
        "source.raw_orders",
        "model.dim_customers",
        "model.fct_orders",
      ].sort(),
    );
    expect(ids).not.toContain("model.stg_customers");
  });
});

describe("buildRenderableGraph -- depth limiting", () => {
  it("depth 0 includes only the focus node and no edges", () => {
    const graph = buildRenderableGraph(
      diamond,
      null,
      baseConfig({ focus: "model.stg_orders", depth: 0 }),
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["model.stg_orders"]);
    expect(graph.edges).toEqual([]);
  });

  it("depth 1 upstream from dim_customers stops before raw_orders", () => {
    const graph = buildRenderableGraph(
      diamond,
      null,
      baseConfig({ focus: "model.dim_customers", direction: "upstream", depth: 1 }),
    );
    const ids = graph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(
      ["model.dim_customers", "model.stg_orders", "model.stg_customers"].sort(),
    );
    expect(ids).not.toContain("source.raw_orders");
  });

  it("stamps each visible node with its BFS hop distance from focus", () => {
    const graph = buildRenderableGraph(
      diamond,
      null,
      baseConfig({ focus: "model.dim_customers", direction: "upstream", depth: 2 }),
    );
    const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n.depth]));
    expect(byId["model.dim_customers"]).toBe(0);
    expect(byId["model.stg_orders"]).toBe(1);
    expect(byId["source.raw_orders"]).toBe(2);
  });

  it("edges are scoped to only those between two visible nodes", () => {
    const graph = buildRenderableGraph(
      diamond,
      null,
      baseConfig({ focus: "model.dim_customers", direction: "upstream", depth: 1 }),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: "model.stg_orders", to: "model.dim_customers" },
        { from: "model.stg_customers", to: "model.dim_customers" },
      ]),
    );
    expect(graph.edges).toHaveLength(2);
  });
});

describe("buildRenderableGraph -- cycles", () => {
  const cyclic: FullLineageJson = {
    nodes: [node("model.a"), node("model.b"), node("model.c")],
    edges: [
      { from: "model.a", to: "model.b" },
      { from: "model.b", to: "model.c" },
      { from: "model.c", to: "model.a" },
    ],
  };

  it("terminates and visits each node once even though the graph cycles back to focus", () => {
    const graph = buildRenderableGraph(
      cyclic,
      null,
      baseConfig({ focus: "model.a", direction: "downstream", depth: 10 }),
    );
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["model.a", "model.b", "model.c"]);
  });
});

describe("buildRenderableGraph -- disconnected nodes", () => {
  const withOrphan: FullLineageJson = {
    nodes: [node("model.a"), node("model.b"), node("model.orphan")],
    edges: [{ from: "model.a", to: "model.b" }],
  };

  it("a disconnected node never appears in a focused (scoped) render", () => {
    const graph = buildRenderableGraph(
      withOrphan,
      null,
      baseConfig({ focus: "model.a", depth: 5 }),
    );
    expect(graph.nodes.map((n) => n.id)).not.toContain("model.orphan");
  });

  it("a disconnected node still appears in the whole-project render", () => {
    const graph = buildRenderableGraph(withOrphan, null, baseConfig({ focus: null }));
    expect(graph.nodes.map((n) => n.id)).toContain("model.orphan");
  });
});

describe("buildRenderableGraph -- an unknown focus", () => {
  it("returns an empty graph rather than throwing", () => {
    const graph = buildRenderableGraph(
      diamond,
      null,
      baseConfig({ focus: "model.does_not_exist" }),
    );
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.focus).toBe("model.does_not_exist");
  });
});

describe("buildRenderableGraph -- column-level toggle", () => {
  const withColumns: FullLineageJson = {
    nodes: [node("model.stg_orders"), node("model.dim_customers"), node("model.unrelated")],
    edges: [{ from: "model.stg_orders", to: "model.dim_customers" }],
    columnEdges: [
      {
        fromNode: "model.stg_orders",
        fromColumn: "order_id",
        toNode: "model.dim_customers",
        toColumn: "order_id",
      },
      {
        fromNode: "model.unrelated",
        fromColumn: "x",
        toNode: "model.unrelated",
        toColumn: "y",
      },
    ],
  };

  it("columnEdges is empty when columnLevel is off, even if the fixture has them", () => {
    const graph = buildRenderableGraph(
      withColumns,
      null,
      baseConfig({ focus: "model.stg_orders", columnLevel: false }),
    );
    expect(graph.columnEdges).toEqual([]);
  });

  it("columnEdges is scoped to the visible node set when columnLevel is on", () => {
    const graph = buildRenderableGraph(
      withColumns,
      null,
      baseConfig({ focus: "model.stg_orders", direction: "downstream", columnLevel: true }),
    );
    expect(graph.columnEdges).toEqual([
      {
        fromNode: "model.stg_orders",
        fromColumn: "order_id",
        toNode: "model.dim_customers",
        toColumn: "order_id",
      },
    ]);
  });
});

describe("buildRenderableGraph -- diff highlight", () => {
  const runMetadata: RunMetadataJson = {
    changedNodeIds: ["model.stg_orders"],
    reachedNodeIds: ["model.stg_orders", "model.dim_customers", "model.fct_orders"],
  };

  it("leaves every node unmarked when diffHighlight is off, even with run metadata present", () => {
    const graph = buildRenderableGraph(diamond, runMetadata, baseConfig({ diffHighlight: false }));
    expect(graph.nodes.every((n) => !n.changed && !n.reached)).toBe(true);
  });

  it("marks changed nodes as changed, not reached, when diffHighlight is on", () => {
    const graph = buildRenderableGraph(diamond, runMetadata, baseConfig({ diffHighlight: true }));
    const stgOrders = graph.nodes.find((n) => n.id === "model.stg_orders");
    expect(stgOrders).toMatchObject({ changed: true, reached: false });
  });

  it("marks genuinely-reached, non-changed downstream nodes as reached", () => {
    const graph = buildRenderableGraph(diamond, runMetadata, baseConfig({ diffHighlight: true }));
    const dimCustomers = graph.nodes.find((n) => n.id === "model.dim_customers");
    expect(dimCustomers).toMatchObject({ changed: false, reached: true });
  });

  it("leaves an unreached node unmarked even with diffHighlight on", () => {
    const graph = buildRenderableGraph(diamond, runMetadata, baseConfig({ diffHighlight: true }));
    const stgCustomers = graph.nodes.find((n) => n.id === "model.stg_customers");
    expect(stgCustomers).toMatchObject({ changed: false, reached: false });
  });

  it("does nothing when diffHighlight is on but no run metadata was given", () => {
    const graph = buildRenderableGraph(diamond, null, baseConfig({ diffHighlight: true }));
    expect(graph.nodes.every((n) => !n.changed && !n.reached)).toBe(true);
  });
});
