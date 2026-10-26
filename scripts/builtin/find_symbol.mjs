#!/usr/bin/env node
// purpose: find where a function, class, type, component or variable is defined and every place it is used, as file:line, in one call
// usage: node {script} <name> [--defs] [--max <lines>]
import { fail, lines, parseArgs, projectRoot, sh } from "./lib/common.mjs";

const { flags, rest } = parseArgs();
const name = rest[0];
if (!name || !/^[\w$.-]+$/.test(name)) fail("usage: find_symbol.mjs <name> [--defs] [--max <lines>]");
const root = projectRoot();
const max = Number(flags.max ?? 60);
const escaped = name.replace(/[.$]/g, "\\$&");
const hits = lines(sh("git", ["grep", "-n", "-I", "-w", "-E", escaped, "--", ".", ":!*.min.*", ":!*lock*", ":!dist/*", ":!build/*"], { cwd: root }).out);
if (hits.length === 0) {
  console.log(`"${name}" not found in tracked files.`);
  process.exit(1);
}
const DEFINES = new RegExp([
  `(function\\*?|class|interface|type|enum|struct|trait|impl|def|fn|func|module|namespace)\\s+${escaped}\\b`,
  `(const|let|var|val)\\s+${escaped}\\s*[:=]`,
  `export\\s+(default\\s+)?(async\\s+)?(function|class|const)\\s+${escaped}\\b`,
  `^\\s*(public|private|protected|static|async|\\s)*${escaped}\\s*\\([^)]*\\)\\s*[:{]`,
  `^\\s*${escaped}\\s*[:=]\\s*(async\\s*)?(\\(|function)`,
  `func\\s+\\([^)]*\\)\\s+${escaped}\\b`,
].join("|"));
const defs = [];
const uses = [];
for (const hit of hits) {
  const [file, line, ...text] = hit.split(":");
  const body = text.join(":").trim();
  (DEFINES.test(body) ? defs : uses).push({ file, line, body: body.length > 140 ? `${body.slice(0, 140)}…` : body });
}
console.log(`## Defined (${defs.length})`);
for (const hit of defs) console.log(`${hit.file}:${hit.line}  ${hit.body}`);
if (flags.defs) process.exit(0);
const byFile = new Map();
for (const hit of uses) byFile.set(hit.file, [...(byFile.get(hit.file) ?? []), hit]);
console.log(`## Used (${uses.length} in ${byFile.size} files)`);
let shown = 0;
for (const [file, list] of byFile) {
  if (shown >= max) {
    console.log(`… ${uses.length - shown} more uses; narrow with git grep`);
    break;
  }
  for (const hit of list.slice(0, 5)) {
    console.log(`${file}:${hit.line}  ${hit.body}`);
    shown += 1;
  }
  if (list.length > 5) console.log(`${file}  … ${list.length - 5} more in this file`);
}
