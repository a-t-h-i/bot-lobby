/**
 * Build both halves of the bundle.
 * - Host: src/host/index.ts -> lib/index.js (ESM, Node). DSH packages and Node
 *   built-ins stay external: DSH resolves them from its own installation.
 * - Client: src/client/index.tsx -> lib/client.js, a CommonJS body wrapped in
 *   DSH's browser module loader. React and every DSH client package come from
 *   the page's module table through `require`, so they stay external too.
 */
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const external = ["@deepseek-ai/*", "react", "react/*", "react-dom", "react-dom/*"];

await build({
  entryPoints: ["src/host/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: [...external, "node:*"],
  sourcemap: true,
  logLevel: "warning",
});

const client = await build({
  entryPoints: ["src/client/index.tsx"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  jsx: "automatic",
  external,
  logLevel: "warning",
});
const body = client.outputFiles[0].text;
// The loader hands the factory `require`; the module's exports are the client plugin ({ inject, apply }).
const wrapped = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(pkg.name)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${body}\n    return module.exports;\n  },\n});\n`;
await writeFile("lib/client.js", wrapped);
console.log("built lib/index.js and lib/client.js");
