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
      case "setupZhaoYml":
        void vscode.commands.executeCommand("zhao.setupZhaoYml");
        return;
      case "pickProject":
        void this.controller.pickActiveProjectDir();
        return;
      case "setTarget":
        if (typeof msg.target === "string") {
          void this.controller.setActiveTarget(msg.target.length > 0 ? msg.target : null);
        }
        return;
      case "envSetActive":
        void this.controller.env.setActiveSet(typeof msg.set === "string" ? msg.set : null);
        return;
      case "envNewSet":
        void this.promptNewSet();
        return;
      case "envRenameSet":
        if (typeof msg.set === "string") {
          void this.promptRenameSet(msg.set);
        }
        return;
      case "envDeleteSet":
        if (typeof msg.set === "string") {
          void this.confirmDeleteSet(msg.set);
        }
        return;
      case "envSaveVariable":
        if (typeof msg.name === "string" && typeof msg.value === "string") {
          this.controller.env.saveVariable({
            name: msg.name,
            value: msg.value,
            secret: Boolean(msg.secret),
            set: typeof msg.set === "string" ? msg.set : null,
            originalName: typeof msg.originalName === "string" ? msg.originalName : undefined,
          });
        }
        return;
      case "envDeleteVariable":
        if (typeof msg.name === "string" && (msg.file === "zhao.json" || msg.file === "zhao-secret.json")) {
          this.controller.env.removeVariable(msg.file, typeof msg.set === "string" ? msg.set : null, msg.name);
        }
        return;
      case "envOpenFile":
        if (typeof msg.file === "string" && msg.file.length > 0) {
          void this.controller.env.openFile(msg.file);
        }
        return;
      case "envAddGitignore":
        if (typeof msg.file === "string") {
          this.controller.env.addToGitignore(msg.file);
        }
        return;
      default:
        return;
    }
  }

  private async promptNewSet(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: "Name for the new environment set (e.g. client-a-prod)",
      validateInput: (value) => (value.trim().length === 0 ? "A name is required." : undefined),
    });
    if (name) {
      this.controller.env.createSet(name);
      await this.controller.env.setActiveSet(name.trim());
    }
  }

  private async promptRenameSet(current: string): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: `Rename set "${current}" to`, value: current });
    if (name) {
      await this.controller.env.renameActiveOrNamedSet(current, name);
    }
  }

  private async confirmDeleteSet(name: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      `Delete the environment set "${name}" and all its variables?`,
      { modal: true },
      "Delete",
    );
    if (choice === "Delete") {
      await this.controller.env.removeSet(name);
    }
  }
}
