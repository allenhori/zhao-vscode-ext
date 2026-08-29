// The settings sidebar's webview content: which dbt project is active
// (auto-detected, overridable) and which profile target zhao compiles
// against (remembered per workspace, always changeable). Not
// unit-tested -- VS Code-webview-bound, per the spec's testing decisions.

import { randomUUID } from "node:crypto";

export interface SettingsWebviewState {
  missingExecutable: boolean;
  /** Every dbt project directory found in the workspace (by
   * `dbt_project.yml` presence), for the override dropdown. */
  availableProjects: string[];
  activeProject: string | null;
  availableTargets: string[];
  activeTarget: string | null;
}

export function renderSettingsHtml(state: SettingsWebviewState): string {
  const nonce = randomUUID();
  const projectOptions = state.availableProjects
    .map(
      (p) =>
        `<option value="${escapeHtml(p)}" ${p === state.activeProject ? "selected" : ""}>${escapeHtml(p)}</option>`,
    )
    .join("");
  const targetOptions = state.availableTargets
    .map(
      (t) => `<option value="${escapeHtml(t)}" ${t === state.activeTarget ? "selected" : ""}>${escapeHtml(t)}</option>`,
    )
    .join("");

  return /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 8px; font-size: 12px; }
  .banner { background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); padding: 8px; margin-bottom: 8px; }
  .field { margin-bottom: 12px; }
  .field label { display: block; margin-bottom: 4px; opacity: 0.8; }
  select { width: 100%; }
  button { cursor: pointer; }
</style>
</head>
<body>
  ${state.missingExecutable ? `<div class="banner">zhao-cli was not found on PATH. <button id="download">Download zhao-cli</button></div>` : ""}
  <div class="field">
    <label for="project">Active dbt project</label>
    <select id="project">${projectOptions || "<option>(none detected)</option>"}</select>
  </div>
  <div class="field">
    <label for="target">Active target</label>
    <select id="target">${targetOptions || "<option>(no profiles.yml found)</option>"}</select>
  </div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  document.getElementById("download")?.addEventListener("click", () => vscode.postMessage({ type: "downloadCli" }));
  document.getElementById("project")?.addEventListener("change", (e) =>
    vscode.postMessage({ type: "setProject", project: e.target.value }));
  document.getElementById("target")?.addEventListener("change", (e) =>
    vscode.postMessage({ type: "setTarget", target: e.target.value }));
})();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
