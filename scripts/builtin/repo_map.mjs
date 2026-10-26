#!/usr/bin/env node
// purpose: a short map of the project: folders with file counts, languages, entry points, test folders and config files, to orient before reading code
// usage: node {script} [folder] [--depth <n>]
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { detect, isTest, lines, parseArgs, projectRoot, sh } from "./lib/common.mjs";

const { flags, rest } = parseArgs();
const root = projectRoot();
const under = (rest[0] ?? "").replace(/^\.\/?/, "").replace(/\/$/, "");
const depth = Number(flags.depth ?? 2);
const files = lines(sh("git", ["ls-files", "--cached", "--others", "--exclude-standard", ...(under ? ["--", under] : [])], { cwd: root }).out);
if (files.length === 0) {
  console.log("No tracked files here.");
  process.exit(0);
}
const tool = detect(root);

// Folders to `depth`, with how many files sit under each.
const counts = new Map();
for (const file of files) {
  const parts = (under ? file.slice(under.length + 1) : file).split("/").slice(0, -1);
  for (let level = 1; level <= Math.min(depth, parts.length); level++) {
    const dir = parts.slice(0, level).join("/");
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
}
console.log(`## ${under || "Project"} (${files.length} files)`);
for (const dir of [...counts.keys()].sort()) {
  const level = dir.split("/").length - 1;
  console.log(`${"  ".repeat(level)}${dir.split("/").pop()}/  ${counts.get(dir)}`);
}

const langs = new Map();
for (const file of files) {
  const ext = extname(file) || "(none)";
  langs.set(ext, (langs.get(ext) ?? 0) + 1);
}
console.log(`## Languages: ${[...langs].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ext, n]) => `${ext} ${n}`).join(", ")}`);

const entries = [];
if (tool.pkg) {
  for (const key of ["main", "module", "types"]) if (typeof tool.pkg[key] === "string") entries.push(`${key}: ${tool.pkg[key]}`);
  if (tool.pkg.bin) entries.push(`bin: ${typeof tool.pkg.bin === "string" ? tool.pkg.bin : Object.values(tool.pkg.bin).join(", ")}`);
  if (tool.pkg.exports) entries.push(`exports: ${JSON.stringify(tool.pkg.exports).slice(0, 160)}`);
  for (const [key, value] of Object.entries(tool.pkg)) if (value && typeof value === "object" && Array.isArray(value.extensions)) entries.push(`${key}.extensions: ${value.extensions.join(", ")}`);
}
for (const file of files) if (/(^|\/)(main|index|app|server|cli)\.(ts|tsx|js|mjs|py|go|rs)$|(^|\/)manage\.py$|(^|\/)cmd\/[^/]+\/main\.go$/.test(file) && file.split("/").length <= 3) entries.push(file);
if (entries.length > 0) console.log(`## Entry points\n${[...new Set(entries)].slice(0, 15).map((entry) => `- ${entry}`).join("\n")}`);

const testDirs = new Map();
for (const file of files.filter(isTest)) {
  const dir = file.split("/").slice(0, -1).join("/") || ".";
  testDirs.set(dir, (testDirs.get(dir) ?? 0) + 1);
}
if (testDirs.size > 0) console.log(`## Tests (${[...testDirs.values()].reduce((a, b) => a + b, 0)} files)\n${[...testDirs].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([dir, n]) => `- ${dir}/  ${n}`).join("\n")}`);

const configs = files.filter((file) => !file.includes("/") && /^(package\.json|tsconfig.*\.json|vite\.config\.\w+|next\.config\.\w+|playwright\.config\.\w+|vitest\.config\.\w+|jest\.config\.\w+|eslint\.config\.\w+|\.eslintrc.*|biome\.jsonc?|tailwind\.config\.\w+|pyproject\.toml|setup\.cfg|requirements.*\.txt|go\.mod|Cargo\.toml|Makefile|justfile|Dockerfile|docker-compose\.ya?ml|\.env\.example)$/.test(file));
if (configs.length > 0) console.log(`## Config: ${configs.join(", ")}`);
const readme = ["README.md", "readme.md", "CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md"].filter((file) => existsSync(join(root, file)));
if (readme.length > 0) console.log(`## Docs to read first: ${readme.join(", ")}`);
if (existsSync(join(root, "CLAUDE.md"))) {
  const head = readFileSync(join(root, "CLAUDE.md"), "utf8").split("\n").slice(0, 3).join(" ").slice(0, 200);
  console.log(`   CLAUDE.md starts: ${head}`);
}
