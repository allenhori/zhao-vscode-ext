#!/usr/bin/env node
// Loads the real, esbuild-bundled dist/extension.cjs (exactly what VS
// Code's extension host `require()`s at activation, per package.json's
// `main`) against a fake `vscode` module, and asserts that activate():
// - runs to completion without throwing
// - registers the two webview view providers package.json's
//   `contributes.views` declares
// - registers the three commands package.json's `contributes.commands`
//   declares
//
// Run: node test/activationSmoke.cjs   (after `npm run build`)

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const fakeVscodePath = path.join(__dirname, "fakeVscode.cjs");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "vscode") {
    return fakeVscodePath;
  }
  return originalResolveFilename.call(this, request, ...rest);
};

const distPath = path.join(__dirname, "..", "dist", "extension.cjs");
const extension = require(distPath);
const fakeVscode = require("vscode");

const workspaceState = new Map();
const context = {
  subscriptions: [],
  workspaceState: {
    get(key, fallback) {
      return workspaceState.has(key) ? workspaceState.get(key) : fallback;
    },
    async update(key, value) {
      workspaceState.set(key, value);
    },
  },
};

assert.equal(typeof extension.activate, "function", "extension.activate should be exported");
extension.activate(context);

assert.deepEqual(
  [...fakeVscode.__test.registeredViewProviders].sort(),
  ["zhao.lineageView", "zhao.settingsView"].sort(),
  "both webview view providers from package.json's contributes.views should be registered",
);

assert.deepEqual(
  [...fakeVscode.__test.registeredCommands].sort(),
  ["zhao.downloadCli", "zhao.popOutLineage", "zhao.refreshLineage"].sort(),
  "all three commands from package.json's contributes.commands should be registered",
);

assert.ok(context.subscriptions.length > 0, "activate() should register disposables");

console.log("activation smoke test passed:");
console.log("  view providers:", fakeVscode.__test.registeredViewProviders);
console.log("  commands:", fakeVscode.__test.registeredCommands);
console.log("  subscriptions registered:", context.subscriptions.length);
