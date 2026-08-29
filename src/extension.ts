import * as vscode from "vscode";
import { LineageController } from "./lineageController.js";
import { renderLineageHtml } from "./panel/lineageHtml.js";
import { LineageViewProvider } from "./panel/lineageViewProvider.js";
import { SettingsViewProvider } from "./sidebar/settingsViewProvider.js";

const RELEASES_URL = "https://github.com/allenhori/zhao-cli/releases";

export function activate(context: vscode.ExtensionContext): void {
  const controller = new LineageController(context);
  context.subscriptions.push(controller);

  const lineageProvider = new LineageViewProvider(controller);
  const settingsProvider = new SettingsViewProvider(controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("zhao.lineageView", lineageProvider),
    vscode.window.registerWebviewViewProvider("zhao.settingsView", settingsProvider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zhao.refreshLineage", () => controller.refresh(true)),
    vscode.commands.registerCommand("zhao.downloadCli", () => {
      void vscode.env.openExternal(vscode.Uri.parse(RELEASES_URL));
    }),
    vscode.commands.registerCommand("zhao.popOutLineage", () => {
      const panel = vscode.window.createWebviewPanel(
        "zhao.lineagePopOut",
        "zhao Lineage",
        vscode.ViewColumn.Active,
        { enableScripts: true },
      );
      const render = () => {
        panel.webview.html = renderLineageHtml(controller.getLineageWebviewState());
      };
      render();
      const subscription = controller.onDidChange(render);
      panel.onDidDispose(() => subscription.dispose());
      panel.webview.onDidReceiveMessage((message: unknown) => {
        // The pop-out tab shares the exact same message contract as the
        // panel view -- reuse its handling by round-tripping through the
        // same commands/setters `LineageViewProvider` uses. Duplicated
        // here rather than shared because a `WebviewPanel` and a
        // `WebviewView` are different VS Code types with no common
        // "message handler" interface to factor out cheaply.
        if (typeof message !== "object" || message === null || !("type" in message)) {
          return;
        }
        const msg = message as Record<string, unknown>;
        if (msg.type === "setFocus") {
          controller.setFocus(typeof msg.focus === "string" ? msg.focus : null);
        } else if (msg.type === "setDepth" && typeof msg.depth === "number") {
          controller.setDepth(msg.depth);
        } else if (
          msg.type === "setDirection" &&
          (msg.direction === "upstream" || msg.direction === "downstream" || msg.direction === "both")
        ) {
          controller.setDirection(msg.direction);
        } else if (msg.type === "setColumnLevel") {
          controller.setColumnLevel(Boolean(msg.value));
        } else if (msg.type === "setDiffHighlight") {
          void controller.setDiffHighlight(Boolean(msg.value));
        } else if (msg.type === "refresh") {
          void controller.refresh(true);
        } else if (msg.type === "downloadCli") {
          void vscode.env.openExternal(vscode.Uri.parse(RELEASES_URL));
        }
      });
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isSqlFile(editor.document)) {
        void controller.autoDetectProjectForFile(editor.document.uri.fsPath);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!isSqlFile(document)) {
        return;
      }
      const autoRefresh = vscode.workspace.getConfiguration("zhao").get<boolean>("autoRefreshOnSave", false);
      if (!autoRefresh) {
        return;
      }
      void controller.autoDetectProjectForFile(document.uri.fsPath).then(() => controller.refresh(true));
    }),
  );

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && isSqlFile(activeEditor.document)) {
    void controller.autoDetectProjectForFile(activeEditor.document.uri.fsPath);
  }
}

/** A `.sql` file, regardless of what `languageId` VS Code assigned it --
 * a dbt-aware syntax-highlighting extension commonly registers its own
 * language id (e.g. "jinja-sql") for the same `.sql` files, which
 * `languageId === "sql"` alone would miss entirely. */
function isSqlFile(document: vscode.TextDocument): boolean {
  return document.uri.fsPath.toLowerCase().endsWith(".sql");
}

export function deactivate(): void {
  // No teardown needed -- every resource this extension holds is
  // registered in `context.subscriptions` and disposed by VS Code
  // itself on deactivation.
}
