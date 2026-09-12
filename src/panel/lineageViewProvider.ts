import * as vscode from "vscode";
import type { LineageController } from "../lineageController.js";
import { renderLineageHtml } from "./lineageHtml.js";

/**
 * Handles one postMessage event from either lineage webview surface --
 * the docked `zhao.lineageView` (below, via `LineageViewProvider`) and
 * the pop-out `WebviewPanel` (`extension.ts`'s `zhao.popOutLineage`
 * command) both render the exact same `renderLineageHtml` output and so
 * must respond to the exact same message contract identically. Shared
 * here as one function specifically so the two surfaces can't drift
 * out of sync one message type at a time the way they previously did
 * (the pop-out panel's own copy of the `setDepth` case once accepted
 * `NaN`/`Infinity` that this docked view's copy already rejected) --
 * `vscode.WebviewView` and `vscode.WebviewPanel` are different types,
 * but both expose the identical `.webview: vscode.Webview` surface
 * (`onDidReceiveMessage`/`postMessage`), so one handler genuinely works
 * for both, taking `controller` as a plain parameter rather than being
 * a method on either webview-specific class.
 */
export function handleLineageWebviewMessage(message: unknown, controller: LineageController): void {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return;
  }
  const msg = message as Record<string, unknown>;
  switch (msg.type) {
    case "refresh":
      void vscode.commands.executeCommand("zhao.refreshLineage");
      return;
    case "popOut":
      void vscode.commands.executeCommand("zhao.popOutLineage");
      return;
    case "downloadCli":
      void vscode.commands.executeCommand("zhao.downloadCli");
      return;
    case "setFocus":
      controller.setFocus(typeof msg.focus === "string" ? msg.focus : null);
      return;
    case "setDepth":
      if (typeof msg.depth === "number" && Number.isFinite(msg.depth)) {
        controller.setDepth(msg.depth);
      }
      return;
    case "setDirection":
      if (msg.direction === "upstream" || msg.direction === "downstream" || msg.direction === "both") {
        controller.setDirection(msg.direction);
      }
      return;
    case "setColumnLevel":
      controller.setColumnLevel(Boolean(msg.value));
      return;
    case "setDiffHighlight":
      void controller.setDiffHighlight(Boolean(msg.value));
      return;
    case "copyCommand":
      void controller.copyRecommendedCommand();
      return;
    case "runCommand":
      controller.runRecommendedCommandInTerminal();
      return;
    case "setActiveTab":
      if (msg.tab === "lineage" || msg.tab === "preview") {
        controller.setActiveTab(msg.tab);
      }
      return;
    case "previewNode":
      if (typeof msg.nodeId === "string") {
        void controller.previewNode(msg.nodeId);
      }
      return;
    case "openModelFile":
      if (typeof msg.nodeId === "string") {
        void controller.openModelFile(msg.nodeId);
      }
      return;
    default:
      return;
  }
}

/** The `zhao.lineageView` webview, docked in the panel area alongside
 * Terminal/Output/Debug Console. Thin: renders `controller`'s current
 * state and forwards its own postMessage events to
 * `handleLineageWebviewMessage`. */
export class LineageViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly controller: LineageController) {
    controller.onDidChange(() => this.render());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: unknown) =>
      handleLineageWebviewMessage(message, this.controller),
    );
    this.render();
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = renderLineageHtml(this.controller.getLineageWebviewState());
  }
}
