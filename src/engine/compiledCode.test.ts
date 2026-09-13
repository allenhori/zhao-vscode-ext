import { describe, expect, it } from "vitest";
import { resolveCompiledPath } from "./compiledCode.js";

describe("resolveCompiledPath", () => {
  it("resolves a compiled path from a dbt-core-shaped manifest", () => {
    const manifest = {
      nodes: {
        "model.my_project.customers": {
          compiled_path: "target/compiled/my_project/models/staging/customers.sql",
        },
      },
    };
    expect(resolveCompiledPath(manifest, "model.my_project.customers")).toBe(
      "target/compiled/my_project/models/staging/customers.sql",
    );
  });

  it("resolves a compiled path from a differently-laid-out (dbt Fusion-shaped) manifest", () => {
    // Fusion's actual compiled-output directory convention differs from
    // dbt-core's -- this fixture stands in for "some other layout
    // entirely" to prove resolution doesn't care, since it only ever
    // reads the field the manifest itself provides.
    const manifest = {
      nodes: {
        "model.my_project.customers": {
          compiled_path: ".fusion-target/compiled/my_project/staging__customers.sql",
        },
      },
    };
    expect(resolveCompiledPath(manifest, "model.my_project.customers")).toBe(
      ".fusion-target/compiled/my_project/staging__customers.sql",
    );
  });

  it("returns null when the node exists but has never been compiled", () => {
    const manifest = { nodes: { "model.my_project.customers": {} } };
    expect(resolveCompiledPath(manifest, "model.my_project.customers")).toBeNull();
  });

  it("returns null when compiled_path is explicitly null", () => {
    const manifest = { nodes: { "model.my_project.customers": { compiled_path: null } } };
    expect(resolveCompiledPath(manifest, "model.my_project.customers")).toBeNull();
  });

  it("returns null when the node isn't in the manifest at all", () => {
    expect(resolveCompiledPath({ nodes: {} }, "model.my_project.missing")).toBeNull();
  });

  it("returns null for a manifest with no nodes map", () => {
    expect(resolveCompiledPath({}, "model.my_project.customers")).toBeNull();
  });
});
