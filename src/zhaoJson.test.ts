import { describe, expect, it } from "vitest";
import { parseFullLineageJson, parseRunMetadataJson, type RawFullLineageJson, type RawRunMetadataJson } from "./zhaoJson.js";

describe("parseFullLineageJson", () => {
  const raw: RawFullLineageJson = {
    nodes: [
      { id: "source.raw_orders", name: "raw_orders", kind: "origin" },
      { id: "model.stg_orders", name: "stg_orders", kind: "node" },
      { id: "model.dim_customers", name: "dim_customers", kind: "node" },
    ],
    edges: [
      { upstream: "source.raw_orders", downstream: "model.stg_orders" },
      { upstream: "model.stg_orders", downstream: "model.dim_customers" },
      {
        upstream: "model.stg_orders",
        downstream: "model.dim_customers",
        upstream_column: "order_id",
        downstream_column: "order_id",
      },
    ],
    node_term: "model",
    origin_term: "source",
  };

  it("maps the origin/node kind discriminant to source/model", () => {
    const { graph } = parseFullLineageJson(raw);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        { id: "source.raw_orders", kind: "source", name: "raw_orders" },
        { id: "model.stg_orders", kind: "model", name: "stg_orders" },
      ]),
    );
  });

  it("splits the mixed edges array into model-level edges (no column fields)", () => {
    const { graph } = parseFullLineageJson(raw);
    expect(graph.edges).toEqual([
      { from: "source.raw_orders", to: "model.stg_orders" },
      { from: "model.stg_orders", to: "model.dim_customers" },
    ]);
  });

  it("and column-level edges (both column fields present) separately", () => {
    const { graph } = parseFullLineageJson(raw);
    expect(graph.columnEdges).toEqual([
      {
        fromNode: "model.stg_orders",
        fromColumn: "order_id",
        toNode: "model.dim_customers",
        toColumn: "order_id",
      },
    ]);
  });

  it("carries node_term/origin_term through for display", () => {
    const { nodeTerm, originTerm } = parseFullLineageJson(raw);
    expect(nodeTerm).toBe("model");
    expect(originTerm).toBe("source");
  });
});

describe("parseRunMetadataJson", () => {
  it("dedupes changedNodeIds across multiple changes on the same node", () => {
    const raw: RawRunMetadataJson = {
      changes: [{ node: "model.stg_orders" }, { node: "model.stg_orders" }, { node: "model.fct_orders" }],
      impacted_models: ["model.dim_customers"],
    };
    const parsed = parseRunMetadataJson(raw);
    expect(parsed.changedNodeIds.sort()).toEqual(["model.fct_orders", "model.stg_orders"]);
  });

  it("passes impacted_models through as reachedNodeIds unchanged", () => {
    const raw: RawRunMetadataJson = {
      changes: [],
      impacted_models: ["model.dim_customers", "model.fct_orders"],
    };
    expect(parseRunMetadataJson(raw).reachedNodeIds).toEqual([
      "model.dim_customers",
      "model.fct_orders",
    ]);
  });
});
