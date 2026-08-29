// Bundles the extension entry point into a single CommonJS file VS Code
// can load directly, external-izing `vscode` (provided by the host at
// runtime, never bundled) -- the standard esbuild recipe from VS Code's
// own extension-bundling guide.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
