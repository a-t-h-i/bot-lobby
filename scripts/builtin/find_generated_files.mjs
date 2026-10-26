#!/usr/bin/env node
// purpose: list generated files (header markers, .gitattributes linguist-generated, codegen output folders) and where each comes from: the generator line in its header and the package scripts that make it, so the source is edited instead of the output
// usage: node {script} [file or folder…]
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { detect, isNoise, parseArgs, projectRoot, runScript, sh, tracked } from "./lib/common.mjs";

const { rest } = parseArgs();
const root = projectRoot();
const files = tracked(root, ...rest);
const MARK = /@generated|DO NOT EDIT|auto-?generated|generated (by|from|with)|This file (was|is) (automatically )?generated|Code generated .* DO NOT EDIT/i;

// Only a comment says it: code that merely mentions the words does not count.
const COMMENT = /^\s*(\/\/|#|\/?\*|<!--|--|;|%)/;

// .gitattributes `path linguist-generated` (or `-diff`/`binary` next to a generated hint).
const attributes = (() => {
  try {
    return readFileSync(join(root, ".gitattributes"), "utf8").split("\n").filter((row) => /linguist-generated(=true)?\b/.test(row) && !/linguist-generated=false/.test(row)).map((row) => row.trim().split(/\s+/)[0]);
  } catch {
    return [];
  }
})();
const globRe = (pattern) => new RegExp(`(^|/)${pattern.replace(/^\//, "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*")}($|/)`);
const marked = attributes.map(globRe);

const { pkg, pm } = detect(root);
const scripts = Object.entries(pkg?.scripts ?? {});
const GENERATOR = /codegen|generate|\bgen\b|prisma|protoc|buf\s|openapi|swagger|graphql-codegen|orval|sqlc|typechain|relay-compiler|tsc\s.*--declaration|wasm-bindgen|bindgen|i18n/i;

const found = [];
for (const file of files) {
  if (isNoise(file) && !/\.(snap)$/.test(file)) continue;
  let why;
  let header = "";
  if (marked.some((re) => re.test(file))) why = ".gitattributes";
  try {
    const head = readFileSync(join(root, file), "utf8").slice(0, 800);
    const line = head.split("\n").find((row) => COMMENT.test(row) && MARK.test(row));
    if (line) {
      why ??= "header";
      header = line.replace(/^[\s/#*<!-]+|[\s*/>-]+$/g, "").slice(0, 160);
    }
  } catch {}
  if (why) found.push({ file, why, header });
}
// Build output checked into git is generated too, but one line each is enough.
const output = new Map();
for (const file of files) {
  const m = /^(.*?(?:^|\/)(?:dist|build|out|\.next|coverage))\//.exec(file);
  if (m) output.set(m[1], (output.get(m[1]) ?? 0) + 1);
}
if (output.size) console.log(`## Build output tracked in git: ${[...output].map(([dir, count]) => `${dir}/ (${count})`).join(", ")}; rebuild it, never edit it`);
if (found.length === 0) {
  console.log(`No generated files found${rest.length ? ` in ${rest.join(", ")}` : ""} (looked for header markers and .gitattributes linguist-generated).`);
  process.exit(0);
}
// Group by folder: a codegen output folder is one line, not hundreds.
const byDir = new Map();
for (const hit of found) byDir.set(dirname(hit.file), [...(byDir.get(dirname(hit.file)) ?? []), hit]);
console.log(`# ${found.length} generated file(s) in ${byDir.size} folder(s): edit the source, then rerun the generator`);
for (const [dir, hits] of [...byDir].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${dir}/ (${hits.length})`);
  for (const hit of hits.slice(0, 6)) console.log(`  ${basename(hit.file)}  [${hit.why}]${hit.header ? `  "${hit.header}"` : ""}`);
  if (hits.length > 6) console.log(`  … ${hits.length - 6} more`);
  // Package scripts that name this folder or a file in it, or look like a generator.
  const makers = scripts.filter(([, command]) => command.includes(dir) || hits.some((hit) => command.includes(basename(hit.file))));
  for (const [name, command] of makers.length ? makers : []) console.log(`  made by: ${runScript(pm, name)}  (${command.slice(0, 120)})`);
  // A file naming its own source: "generated from x.proto".
  const sources = new Set(hits.map((hit) => /from\s+["'`]?([\w./-]+\.\w+)/i.exec(hit.header)?.[1]).filter(Boolean));
  if (sources.size) console.log(`  source: ${[...sources].slice(0, 4).join(", ")}`);
}
const generators = scripts.filter(([name, command]) => GENERATOR.test(name) || GENERATOR.test(command));
if (generators.length) {
  console.log("## Generator scripts in package.json");
  for (const [name, command] of generators) console.log(`  ${runScript(pm, name)}: ${command.slice(0, 140)}`);
}
const config = sh("git", ["ls-files", "--", "*codegen*", "*.proto", "*.graphql", "schema.prisma", "*openapi*.y*ml", "*openapi*.json", "buf.gen.yaml", "sqlc.y*ml"], { cwd: root }).out.split("\n").filter(Boolean);
if (config.length) console.log(`## Likely sources and generator configs: ${config.slice(0, 12).join(", ")}${config.length > 12 ? ", …" : ""}`);
