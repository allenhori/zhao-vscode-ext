// A minimal fake `vscode` module -- just enough surface area for
// `dist/extension.cjs`'s activate() to run its full top-level wiring
// (register commands, webview view providers, event listeners) without
// throwing. Not a substitute for running inside a real VS Code
// Extension Development Host (see README's manual-testing note) -- this
// only proves the bundled activation code path itself doesn't crash and
// registers what package.json's `contributes` promises.

class EventEmitter {
  constructor() {
    this._listeners = [];
  }
  get event() {
    return (listener) => {
      this._listeners.push(listener);
      return { dispose() {} };
    };
  }
  fire(value) {
    for (const listener of this._listeners) listener(value);
  }
  dispose() {}
}

const registeredCommands = [];
const registeredViewProviders = [];
const disposeCallbacks = [];

const configValues = {
  depth: 3,
  direction: "both",
  autoRefreshOnSave: false,
  executablePath: "zhao-that-does-not-exist-on-this-fake-path",
};

const fakeVscode = {
  EventEmitter,
  ViewColumn: { Active: 1 },
  Uri: {
    file: (path) => ({ fsPath: path }),
    parse: (value) => ({ toString: () => value }),
  },
  window: {
    activeTextEditor: undefined,
    registerWebviewViewProvider(id, provider) {
      registeredViewProviders.push(id);
      return { dispose() {} };
    },
    onDidChangeActiveTextEditor(_cb) {
      return { dispose() {} };
    },
    createWebviewPanel() {
      const panel = {
        webview: { html: "", onDidReceiveMessage() {} },
        onDidDispose() {},
        dispose() {},
      };
      return panel;
    },
  },
  workspace: {
    getConfiguration(_section) {
      return {
        get(key, fallback) {
          return key in configValues ? configValues[key] : fallback;
        },
      };
    },
    onDidSaveTextDocument(_cb) {
      return { dispose() {} };
    },
    findFiles: async () => [],
    fs: {
      readFile: async () => {
        throw new Error("no such file (fake vscode.workspace.fs)");
      },
    },
  },
  commands: {
    registerCommand(id, _cb) {
      registeredCommands.push(id);
      return { dispose() {} };
    },
    executeCommand: async () => undefined,
  },
  env: {
    openExternal: async () => true,
  },
  __test: { registeredCommands, registeredViewProviders },
};

module.exports = fakeVscode;
