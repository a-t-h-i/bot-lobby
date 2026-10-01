/**
 * Bundle the page into dist/: one script and one stylesheet, named by their
 * content so a browser never runs a stale copy after an update, and an
 * index.html that names them. Preact, marked and DOMPurify are bundled in;
 * nothing is loaded from a CDN (the page must work offline, under its CSP).
 */
import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const result = await build({
  entryPoints: [join(root, "client/main.tsx")],
  bundle: true,
  format: "esm",
  target: ["es2020", "chrome100", "safari15", "firefox100"],
  minify: true,
  sourcemap: false,
  jsx: "automatic",
  jsxImportSource: "preact",
  entryNames: "app-[hash]",
  outdir: out,
  metafile: true,
  legalComments: "eof",
  logLevel: "warning",
});

const outputs = Object.keys(result.metafile.outputs).map((file) => basename(file));
const script = outputs.find((file) => file.endsWith(".js"));
const style = outputs.find((file) => file.endsWith(".css"));
if (!script || !style) throw new Error(`expected one .js and one .css, got ${outputs.join(", ")}`);
const html = (await readFile(join(root, "client/index.html"), "utf8")).replace("/APP_JS", `/${script}`).replace("/APP_CSS", `/${style}`);
await writeFile(join(out, "index.html"), html);
await copyFile(join(root, "client/icon.svg"), join(out, "icon.svg"));

for (const [file, info] of Object.entries(result.metafile.outputs)) console.log(`${basename(file)}  ${(info.bytes / 1024).toFixed(1)} KB`);
