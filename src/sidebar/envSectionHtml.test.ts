import { describe, expect, it } from "vitest";
import type { EnvSidebarState, EnvVariableView } from "../envController.js";
import { renderEnvSection } from "./envSectionHtml.js";

function variable(overrides: Partial<EnvVariableView> = {}): EnvVariableView {
  return {
    name: "SF_ACCOUNT",
    value: "acme",
    secret: false,
    unresolved: false,
    sourceLabel: "zhao.json",
    editable: true,
    file: "zhao.json",
    set: null,
    envFile: null,
    shadowedBy: [],
    ...overrides,
  };
}

function state(overrides: Partial<EnvSidebarState> = {}): EnvSidebarState {
  return {
    available: true,
    sets: [],
    activeSet: null,
    variables: [],
    diagnostics: [],
    requiredCount: 0,
    missing: [],
    gitWarnings: [],
    ...overrides,
  };
}

describe("renderEnvSection", () => {
  it("explains that a folder must be open when no workspace is available", () => {
    expect(renderEnvSection(state({ available: false }))).toContain("Open a folder");
  });

  it("shows a plain variable's value", () => {
    expect(renderEnvSection(state({ variables: [variable()] }))).toContain(">acme<");
  });

  it("masks a secret variable's visible text by default, with an eye toggle", () => {
    const html = renderEnvSection(state({ variables: [variable({ name: "TOKEN", value: "s3cret", secret: true })] }));

    expect(html).toContain("••••••");
    expect(html).not.toContain(">s3cret<");
    expect(html).toContain('data-reveal="TOKEN"');
  });

  it("offers Edit and Delete for JSON rows but only Open for a .env row", () => {
    const html = renderEnvSection(
      state({
        variables: [
          variable({ name: "A" }),
          variable({ name: "B", editable: false, file: null, envFile: ".env", sourceLabel: ".env" }),
        ],
      }),
    );

    expect(html).toContain('data-edit="A"');
    expect(html).toContain('data-delete="A"');
    expect(html).not.toContain('data-edit="B"');
    expect(html).not.toContain('data-delete="B"');
    expect(html).toContain('data-open=".env"');
  });

  it("marks shadowed and unresolved variables", () => {
    const html = renderEnvSection(
      state({ variables: [variable({ shadowedBy: ["zhao.json"], unresolved: true })] }),
    );

    expect(html).toContain("shadows zhao.json");
    expect(html).toContain("unresolved");
  });

  it("lists the named sets and selects the active one", () => {
    const html = renderEnvSection(state({ sets: ["client-a", "client-b"], activeSet: "client-b" }));

    expect(html).toContain('<option value="client-a" >client-a</option>');
    expect(html).toContain('<option value="client-b" selected>client-b</option>');
  });

  it("renders a git warning with a one-click .gitignore button", () => {
    const html = renderEnvSection(state({ gitWarnings: [{ file: ".vscode/zhao-secret.json", kind: "notIgnored" }] }));

    expect(html).toContain("not in .gitignore");
    expect(html).toContain('data-gitignore=".vscode/zhao-secret.json"');
  });

  it("warns loudly about an already-tracked secret file", () => {
    const html = renderEnvSection(state({ gitWarnings: [{ file: ".env", kind: "tracked" }] }));

    expect(html).toContain("already tracked");
  });

  it("summarizes required and missing env_var names", () => {
    const html = renderEnvSection(state({ requiredCount: 3, missing: ["X"] }));

    expect(html).toContain("3 required, 1 missing: X");
  });

  it("escapes variable names and values", () => {
    const html = renderEnvSection(state({ variables: [variable({ name: "A", value: "<script>x</script>" })] }));

    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders problem messages", () => {
    const html = renderEnvSection(state({ diagnostics: [{ severity: "warning", message: "envFile .env.nope was not found." }] }));

    expect(html).toContain("envFile .env.nope was not found.");
  });
});
