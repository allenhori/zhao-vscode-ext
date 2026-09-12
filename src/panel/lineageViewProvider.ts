import * as vscode from "vscode";
import type { LineageController } from "../lineageController.js";
import { renderLineageHtml } from "./lineageHtml.js";

/** The `zhao.lineageView` webview, docked in the panel area alongside
 * Terminal/Output/Debug Console. Thin: renders `controller`'s current
 * state and forwards its own postMessage events back onto `controller`. */
export class LineageViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly controller: LineageController) {
    controller.onDidChange(() => this.render());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message));
    this.render();
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = renderLineageHtml(this.controller.getLineageWebviewState());
  }

  private handleMessage(message: unknown): void {
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
        this.controller.setFocus(typeof msg.focus === "string" ? msg.focus : null);
        return;
      case "setDepth":
        if (typeof msg.depth === "number" && Number.isFinite(msg.depth)) {
          this.controller.setDepth(msg.depth);
        }
        return;
      case "setDirection":
        if (msg.direction === "upstream" || msg.direction === "downstream" || msg.direction === "both") {
          this.controller.setDirection(msg.direction);
        }
        return;
      case "setColumnLevel":
        this.controller.setColumnLevel(Boolean(msg.value));
        return;
      case "setDiffHighlight":
        void this.controller.setDiffHighlight(Boolean(msg.value));
        return;
      case "copyCommand":
        void this.controller.copyRecommendedCommand();
        return;
      case "runCommand":
        this.controller.runRecommendedCommandInTerminal();
        return;
      case "setActiveTab":
        if (msg.tab === "lineage" || msg.tab === "preview") {
          this.controller.setActiveTab(msg.tab);
        }
        return;
      case "previewNode":
        if (typeof msg.nodeId === "string") {
          void this.controller.previewNode(msg.nodeId);
        }
        return;
      case "openModelFile":
        if (typeof msg.nodeId === "string") {
          void this.controller.openModelFile(msg.nodeId);
        }
        return;
      default:
        return;
    }
  }
}
