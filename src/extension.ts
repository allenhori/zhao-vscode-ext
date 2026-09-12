import * as vscode from "vscode";
import { LineageController } from "./lineageController.js";
import { renderLineageHtml } from "./panel/lineageHtml.js";
import { handleLineageWebviewMessage, LineageViewProvider } from "./panel/lineageViewProvider.js";
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
        "zhao",
        vscode.ViewColumn.Active,
        { enableScripts: true },
      );
      const render = () => {
        panel.webview.html = renderLineageHtml(controller.getLineageWebviewState());
      };
      render();
      const subscription = controller.onDidChange(render);
      panel.onDidDispose(() => subscription.dispose());
      // The pop-out tab shares the exact same message contract as the
      // docked panel view -- both dispatch through the one shared
      // `handleLineageWebviewMessage`, so the two surfaces can't drift
      // out of sync message-type by message-type the way hand-copied
      // duplicates of this switch once did.
      panel.webview.onDidReceiveMessage((message: unknown) =>
        handleLineageWebviewMessage(message, controller),
      );
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
