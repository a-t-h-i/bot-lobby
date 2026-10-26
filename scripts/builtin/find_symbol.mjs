#!/usr/bin/env node
// purpose: find where a function, class, type, component or variable is defined and every place it is used, as file:line, in one call; with --config, where a setting or environment variable is set, overridden and read
// usage: node {script} <name> [--defs] [--max <lines>]  |  node {script} --config <KEY or dotted.key>
import { fail, lines, parseArgs, projectRoot, sh } from "./lib/common.mjs";

const { flags, rest } = parseArgs();
const name = typeof flags.config === "string" ? flags.config : rest[0];
if (!name || !/^[\w$.-]+$/.test(name)) fail("usage: find_symbol.mjs <name> [--defs] [--max <lines>]");
const root = projectRoot();
const max = Number(flags.max ?? 60);
if (flags.config) config();
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

/** Where a setting lives: config and env files that set it, code that reads it from the environment or a settings object. */
function config() {
  const leaf = name.split(".").pop();
  const hits = lines(sh("git", ["grep", "-n", "-I", "-w", "-E", leaf.replace(/[$]/g, "\\$&"), "--", ".", ":!*lock*", ":!*.min.*", ":!dist/*", ":!build/*", ":!**/dist/*"], { cwd: root }).out);
  if (hits.length === 0) {
    console.log(`"${name}" is not set or read in any tracked file.`);
    process.exit(1);
  }
  const CONFIG_FILE = /(^|\/)(\.env[\w.-]*|[\w.-]+\.(ya?ml|toml|ini|cfg|conf|properties)|[\w.-]*config[\w.-]*\.json|settings[\w.-]*\.json|package\.json|Dockerfile[\w.-]*|docker-compose[\w.-]*|Makefile|\.github\/.*)$/i;
  const e = leaf.replace(/[$]/g, "\\$&");
  const SETS = new RegExp(`^\\s*(-\\s*)?(export\\s+|ENV\\s+|ARG\\s+|set\\s+)?["']?${e}["']?\\s*[:=]|^\\s*(ENV|ARG)\\s+${e}\\b`);
  const ENV_READ = new RegExp(`process\\.env(\\.${e}\\b|\\[\\s*["'\`]${e}["'\`])|import\\.meta\\.env\\.${e}\\b|os\\.(environ(\\.get)?\\s*[\\[(]\\s*["']${e}["']|getenv\\(\\s*["']${e}["'])|os\\.(Getenv|LookupEnv)\\(\\s*"${e}"|env::var\\(\\s*"${e}"|ENV\\[["']${e}["']\\]|\\$\\{?${e}\\b`);
  const groups = { set: [], env: [], code: [] };
  for (const hit of hits) {
    const [file, line, ...text] = hit.split(":");
    const body = text.join(":").trim();
    const row = `${file}:${line}  ${body.length > 140 ? `${body.slice(0, 140)}…` : body}`;
    if (CONFIG_FILE.test(file) && SETS.test(body)) groups.set.push(row);
    else if (ENV_READ.test(body)) groups.env.push(row);
    else if (name.includes(".") ? body.includes(name) || new RegExp(`[.\\["']${e}\\b`).test(body) : true) groups.code.push(row);
  }
  console.log(`## Set in config or env files (${groups.set.length})`);
  for (const row of groups.set) console.log(row);
  console.log(`## Read from the environment (${groups.env.length})`);
  for (const row of groups.env.slice(0, max)) console.log(row);
  console.log(`## Other mentions: defaults, schemas, settings reads (${groups.code.length})`);
  for (const row of groups.code.slice(0, max)) console.log(row);
  if (groups.code.length > max) console.log(`… ${groups.code.length - max} more`);
  process.exit(0);
}
