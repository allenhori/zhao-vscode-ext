// The settings sidebar's webview content: which dbt project is active
// (auto-detected, overridable) and which profile target zhao compiles
// against (remembered per workspace, always changeable). Not
// unit-tested -- VS Code-webview-bound, per the spec's testing decisions.

import { randomUUID } from "node:crypto";

export interface SettingsWebviewState {
  missingExecutable: boolean;
  /** The active project's full path, `null` if none is detected/set yet.
   * Only its basename is actually shown -- see `projectName` below --
   * the full path is a title-attribute/subtext detail, not the primary
   * label; picking a *different* project is handled by a searchable
   * `QuickPick` (see `LineageController.pickActiveProjectDir`), not
   * rendered here at all. */
  activeProject: string | null;
  availableTargets: string[];
  activeTarget: string | null;
}

export function renderSettingsHtml(state: SettingsWebviewState): string {
  const nonce = randomUUID();
  const projectName = state.activeProject ? basename(state.activeProject) : "(none detected)";
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
  .project-link { display: flex; align-items: center; gap: 6px; width: 100%; background: none; border: none; padding: 4px 0; color: var(--vscode-textLink-foreground); font-size: 13px; text-align: left; }
  .project-link:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
  .project-path { opacity: 0.6; font-size: 11px; margin-top: 2px; word-break: break-all; }
</style>
</head>
<body>
  ${state.missingExecutable ? `<div class="banner">zhao-cli was not found on PATH. <button id="download">Download zhao-cli</button></div>` : ""}
  <div class="field">
    <label for="project">Active dbt project</label>
    <button id="project" class="project-link" title="Click to change the active project">${escapeHtml(projectName)}</button>
    ${state.activeProject ? `<div class="project-path">${escapeHtml(state.activeProject)}</div>` : ""}
  </div>
  <div class="field">
    <label for="target">Active target</label>
    <select id="target">${targetOptions || "<option>(no profiles.yml found)</option>"}</select>
  </div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  document.getElementById("download")?.addEventListener("click", () => vscode.postMessage({ type: "downloadCli" }));
  document.getElementById("project")?.addEventListener("click", () => vscode.postMessage({ type: "pickProject" }));
  document.getElementById("target")?.addEventListener("change", (e) =>
    vscode.postMessage({ type: "setTarget", target: e.target.value }));
})();
</script>
</body>
</html>`;
}

/** The last path segment -- `"/tmp/analytics"` -> `"analytics"` --
 * without pulling in `node:path` just for this one call, and working
 * the same regardless of separator style. */
function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return lastSeparator === -1 ? trimmed : trimmed.slice(lastSeparator + 1);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
