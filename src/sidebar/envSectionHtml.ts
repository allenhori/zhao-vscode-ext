// The settings sidebar's "Environment" section: which named set is active,
// the variables (secrets masked behind an eye toggle), problems, git
// warnings and the add/edit form. A pure state-in, HTML-out function so the
// behaviors that matter (masking, read-only `.env` rows, the one-click
// `.gitignore` fix) are unit-testable without VS Code.

import type { EnvSidebarState, EnvVariableView } from "../envController.js";

const MASK = "••••••";

const EYE_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 3C4.5 3 1.7 5.2.5 8c1.2 2.8 4 5 7.5 5s6.3-2.2 7.5-5C14.3 5.2 11.5 3 8 3zm0 8.2A3.2 3.2 0 1 1 8 4.8a3.2 3.2 0 0 1 0 6.4zm0-5.2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';

export function renderEnvSection(state: EnvSidebarState): string {
  if (!state.available) {
    return `<section class="env"><h3>Environment</h3><div class="env-note">Open a folder to manage environment variables.</div></section>`;
  }

  const setOptions = state.sets
    .map((name) => `<option value="${escapeHtml(name)}" ${name === state.activeSet ? "selected" : ""}>${escapeHtml(name)}</option>`)
    .join("");
  const scopeOptions = [
    `<option value="">Base (all sets)</option>`,
    ...state.sets.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`),
  ].join("");

  const gitWarnings = state.gitWarnings
    .map((warning) => {
      const file = escapeHtml(warning.file);
      return warning.kind === "tracked"
        ? `<div class="banner env-error">${file} may hold secrets and is already tracked by git -- adding it to .gitignore won't untrack it.</div>`
        : `<div class="banner">${file} may hold secrets and is not in .gitignore. <button data-gitignore="${file}">Add to .gitignore</button></div>`;
    })
    .join("");

  const problems = state.diagnostics
    .map(
      (d) =>
        `<div class="env-problem ${d.severity === "error" ? "env-error" : "env-warn"}">${escapeHtml(d.message)}</div>`,
    )
    .join("");

  const summary =
    state.requiredCount > 0
      ? `<div class="env-note ${state.missing.length > 0 ? "env-warn" : ""}">${state.requiredCount} required, ${state.missing.length} missing${
          state.missing.length > 0 ? `: ${escapeHtml(state.missing.join(", "))}` : ""
        }</div>`
      : "";

  const rows = state.variables.length
    ? state.variables.map(renderRow).join("")
    : `<div class="env-note">No variables yet.</div>`;

  return /* html */ `<section class="env">
  <h3>Environment</h3>
  ${gitWarnings}
  <div class="field">
    <label for="envSet">Active set</label>
    <select id="envSet"><option value="">(none: base only)</option>${setOptions}</select>
    <div class="env-actions">
      <button id="envNewSet">New set</button>
      ${state.activeSet ? `<button id="envRenameSet" data-set="${escapeHtml(state.activeSet)}">Rename</button><button id="envDeleteSet" data-set="${escapeHtml(state.activeSet)}">Delete</button>` : ""}
    </div>
  </div>
  ${summary}
  ${problems}
  <div id="envRows">${rows}</div>
  <form id="envForm" autocomplete="off">
    <div class="env-form-title" id="envFormTitle">Add variable</div>
    <input id="envName" placeholder="NAME" spellcheck="false" />
    <input id="envValue" placeholder="value" spellcheck="false" />
    <label class="env-check"><input type="checkbox" id="envSecret" /> Secret (saved to zhao-secret.json)</label>
    <select id="envScope">${scopeOptions}</select>
    <div class="env-actions"><button type="submit">Save</button><button type="button" id="envCancel">Cancel</button></div>
  </form>
  <div class="env-actions">
    <button data-open="zhao.json">Open zhao.json</button>
    <button data-open="zhao-secret.json">Open zhao-secret.json</button>
  </div>
</section>`;
}

function renderRow(variable: EnvVariableView): string {
  const name = escapeHtml(variable.name);
  const shown = variable.secret ? MASK : escapeHtml(variable.value);
  const badges = [
    `<span class="env-badge">${escapeHtml(variable.sourceLabel)}${variable.set ? ` · ${escapeHtml(variable.set)}` : ""}</span>`,
    variable.secret ? `<span class="env-badge">secret</span>` : "",
    variable.unresolved ? `<span class="env-badge env-warn">unresolved</span>` : "",
    variable.shadowedBy.length > 0 ? `<span class="env-badge">shadows ${escapeHtml(variable.shadowedBy.join(", "))}</span>` : "",
  ].join("");
  const eye = variable.secret
    ? `<button class="env-icon" data-reveal="${name}" title="Show / hide value" aria-label="Show or hide value">${EYE_ICON}</button>`
    : "";
  const actions = variable.editable
    ? `${eye}<button data-edit="${name}" data-set="${escapeHtml(variable.set ?? "")}" data-file="${escapeHtml(variable.file ?? "")}">Edit</button><button data-delete="${name}" data-set="${escapeHtml(variable.set ?? "")}" data-file="${escapeHtml(variable.file ?? "")}">Delete</button>`
    : `${eye}<button data-open="${escapeHtml(variable.envFile ?? "")}">Open</button>`;
  return `<div class="env-row"><div class="env-name">${name}</div><div class="env-value-line"><span class="env-value" data-value-of="${name}" data-masked="${variable.secret ? "1" : "0"}" data-value="${escapeHtml(variable.value)}">${shown}</span></div><div class="env-badges">${badges}</div><div class="env-actions">${actions}</div></div>`;
}

export const ENV_SECTION_CSS = /* css */ `
  section.env { border-top: 1px solid var(--vscode-panel-border); padding-top: 8px; margin-top: 8px; }
  section.env h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; opacity: 0.8; }
  .env-note { opacity: 0.75; margin-bottom: 6px; }
  .env-warn { color: var(--vscode-editorWarning-foreground); }
  .env-error { color: var(--vscode-errorForeground); }
  .env-problem { margin-bottom: 4px; }
  .env-row { border: 1px solid var(--vscode-panel-border); padding: 6px; margin-bottom: 6px; }
  .env-name { font-weight: bold; word-break: break-all; }
  .env-value-line { font-family: var(--vscode-editor-font-family); word-break: break-all; margin: 2px 0; }
  .env-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
  .env-badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 0 6px; border-radius: 8px; font-size: 10px; }
  .env-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .env-icon { display: inline-flex; align-items: center; background: none; border: none; color: var(--vscode-foreground); padding: 2px 4px; }
  #envForm { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
  #envForm input[type="text"], #envForm input:not([type]), #envForm input:not([type="checkbox"]) { width: 100%; box-sizing: border-box; }
  .env-check { display: flex; align-items: center; gap: 4px; }
  .env-form-title { font-weight: bold; }
`;

/** Client-side behavior: reveal toggles, the add/edit form and every
 * message to the extension. Expects `vscode` (from `acquireVsCodeApi()`)
 * in scope. The reveal set and the form draft survive re-renders through
 * `vscode.setState`, so a watched-file refresh doesn't discard typing. */
export const ENV_SECTION_SCRIPT = /* js */ `
  (function envSection() {
    const saved = vscode.getState() || {};
    const revealed = new Set(saved.revealed || []);
    let draft = saved.draft || { name: "", value: "", secret: false, scope: "", original: null };
    const persist = () => vscode.setState({ revealed: [...revealed], draft });
    const $ = (id) => document.getElementById(id);
    const MASK = "${MASK}";

    for (const el of document.querySelectorAll(".env-value")) {
      const name = el.getAttribute("data-value-of");
      if (el.getAttribute("data-masked") === "1") {
        el.textContent = revealed.has(name) ? el.getAttribute("data-value") : MASK;
      }
    }
    for (const button of document.querySelectorAll("[data-reveal]")) {
      button.addEventListener("click", () => {
        const name = button.getAttribute("data-reveal");
        revealed.has(name) ? revealed.delete(name) : revealed.add(name);
        persist();
        const el = document.querySelector('[data-value-of="' + CSS.escape(name) + '"]');
        if (el) el.textContent = revealed.has(name) ? el.getAttribute("data-value") : MASK;
      });
    }

    const form = $("envForm");
    if (!form) return;
    const fill = () => {
      $("envName").value = draft.name;
      $("envValue").value = draft.value;
      $("envSecret").checked = draft.secret;
      $("envScope").value = draft.scope;
      $("envScope").disabled = draft.original !== null;
      $("envFormTitle").textContent = draft.original === null ? "Add variable" : "Edit " + draft.original;
    };
    const read = () => {
      draft = { name: $("envName").value, value: $("envValue").value, secret: $("envSecret").checked, scope: $("envScope").value, original: draft.original };
      persist();
    };
    fill();
    for (const id of ["envName", "envValue", "envSecret", "envScope"]) $(id).addEventListener("input", read);
    $("envSecret").addEventListener("change", () => {
      $("envValue").type = $("envSecret").checked && !revealed.has("__form") ? "password" : "text";
    });
    $("envValue").type = draft.secret ? "password" : "text";

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      read();
      if (!draft.name.trim()) return;
      vscode.postMessage({ type: "envSaveVariable", name: draft.name.trim(), value: draft.value, secret: draft.secret, set: draft.scope === "" ? null : draft.scope, originalName: draft.original });
      draft = { name: "", value: "", secret: false, scope: draft.scope, original: null };
      persist();
      fill();
    });
    $("envCancel").addEventListener("click", () => {
      draft = { name: "", value: "", secret: false, scope: "", original: null };
      persist();
      fill();
    });

    for (const button of document.querySelectorAll("[data-edit]")) {
      button.addEventListener("click", () => {
        const name = button.getAttribute("data-edit");
        const el = document.querySelector('[data-value-of="' + CSS.escape(name) + '"]');
        draft = { name, value: el ? el.getAttribute("data-value") : "", secret: button.getAttribute("data-file") === "zhao-secret.json", scope: button.getAttribute("data-set") || "", original: name };
        persist();
        fill();
        $("envValue").type = draft.secret ? "password" : "text";
        $("envName").focus();
      });
    }
    for (const button of document.querySelectorAll("[data-delete]")) {
      button.addEventListener("click", () => vscode.postMessage({ type: "envDeleteVariable", name: button.getAttribute("data-delete"), set: button.getAttribute("data-set") || null, file: button.getAttribute("data-file") }));
    }
    for (const button of document.querySelectorAll("[data-open]")) {
      button.addEventListener("click", () => vscode.postMessage({ type: "envOpenFile", file: button.getAttribute("data-open") }));
    }
    for (const button of document.querySelectorAll("[data-gitignore]")) {
      button.addEventListener("click", () => vscode.postMessage({ type: "envAddGitignore", file: button.getAttribute("data-gitignore") }));
    }
    $("envSet").addEventListener("change", (e) => vscode.postMessage({ type: "envSetActive", set: e.target.value === "" ? null : e.target.value }));
    $("envNewSet").addEventListener("click", () => vscode.postMessage({ type: "envNewSet" }));
    $("envRenameSet")?.addEventListener("click", (e) => vscode.postMessage({ type: "envRenameSet", set: e.target.getAttribute("data-set") }));
    $("envDeleteSet")?.addEventListener("click", (e) => vscode.postMessage({ type: "envDeleteSet", set: e.target.getAttribute("data-set") }));
  })();
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
