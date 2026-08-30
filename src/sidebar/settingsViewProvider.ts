import * as vscode from "vscode";
import type { LineageController } from "../lineageController.js";
import { renderSettingsHtml } from "./settingsHtml.js";

/** The `zhao.settingsView` sidebar webview: active project/target,
 * "remembered, not locked" (persisted in workspace state, always
 * changeable). Thin, same shape as `../panel/lineageViewProvider.ts`. */
export class SettingsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly controller: LineageController) {
    controller.onDidChange(() => void this.render());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message));
    void this.render();
  }

  private async render(): Promise<void> {
    if (!this.view) {
      return;
    }
    this.view.webview.html = renderSettingsHtml(await this.controller.getSettingsWebviewState());
  }

  private handleMessage(message: unknown): void {
    if (typeof message !== "object" || message === null || !("type" in message)) {
      return;
    }
    const msg = message as Record<string, unknown>;
    switch (msg.type) {
      case "downloadCli":
        void vscode.commands.executeCommand("zhao.downloadCli");
        return;
      case "pickProject":
        void this.controller.pickActiveProjectDir();
        return;
      case "setTarget":
        if (typeof msg.target === "string") {
          void this.controller.setActiveTarget(msg.target.length > 0 ? msg.target : null);
        }
        return;
      default:
        return;
    }
  }
}
