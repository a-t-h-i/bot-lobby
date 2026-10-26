#!/usr/bin/env node
// purpose: list breaking changes to the public surface since the base: exported functions, classes, types and constants removed, renamed or with a changed signature, and the files that still use each
// usage: node {script} [--base <ref>]
import { readFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { baseRef, changedFiles, isCode, isNoise, isTest, lines, parseArgs, projectRoot, sh } from "./lib/common.mjs";

const { flags } = parseArgs();
const root = projectRoot();
const base = baseRef(root, flags.base);
const old = base === "HEAD" ? "HEAD" : base;

/** Exported names and their one-line signature (whitespace squeezed). */
function surface(text, file) {
  const out = new Map();
  const rows = text.split("\n");
  const sig = (index) => {
    // A signature runs while its brackets are open, at most a few lines.
    let joined = "";
    let depth = 0;
    for (let i = index; i < Math.min(rows.length, index + 6); i++) {
      joined += ` ${rows[i].trim()}`;
      depth += (rows[i].match(/[(<[]/g) ?? []).length - (rows[i].match(/[)>\]]/g) ?? []).length;
      if (depth <= 0) break;
    }
    return joined.replace(/\s*[{=]\s*$/, "").replace(/\s+/g, " ").trim().slice(0, 200);
  };
  if (file.endsWith(".py")) {
    rows.forEach((row, i) => {
      const m = /^(?:async\s+)?def\s+([A-Za-z]\w*)|^class\s+([A-Za-z]\w*)|^([A-Z][A-Z0-9_]+)\s*[:=]/.exec(row);
      if (m) out.set(m[1] ?? m[2] ?? m[3], sig(i));
    });
  } else if (file.endsWith(".go")) {
    rows.forEach((row, i) => {
      const m = /^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)|^type\s+([A-Z]\w*)|^(?:const|var)\s+([A-Z]\w*)/.exec(row);
      if (m) out.set(m[1] ?? m[2] ?? m[3], sig(i));
    });
  } else {
    rows.forEach((row, i) => {
      const m = /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|interface|type|enum|const|let|var|namespace)\s+([\w$]+)/.exec(row);
      if (m) out.set(m[1], sig(i));
      const list = /^export\s+(?:type\s+)?\{([^}]*)\}/.exec(row);
      if (list) for (const part of list[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, "");
        if (name) out.set(name, `export { ${part.trim()} }`);
      }
      if (/^export\s+default\s/.test(row) && !m) out.set("default", sig(i));
    });
  }
  return out;
}

const read = (file) => { try { return readFileSync(join(root, file), "utf8"); } catch { return undefined; } };
const before = (file) => {
  const shown = sh("git", ["show", `${old}:${file}`], { cwd: root });
  return shown.code === 0 ? shown.out : undefined;
};
const deleted = lines(sh("git", ["diff", "--name-only", "--diff-filter=D", ...(base === "HEAD" ? ["HEAD"] : [base])], { cwd: root }).out);
// Renamed files count as a removal at the old path.
const renamed = lines(sh("git", ["diff", "--name-status", "-M", "--diff-filter=R", ...(base === "HEAD" ? ["HEAD"] : [base])], { cwd: root }).out).map((row) => row.split("\t")[1]);
const files = [...new Set([...changedFiles(root, base), ...deleted, ...renamed])].filter((file) => isCode(file) && !isTest(file) && !isNoise(file));

/** Files that import this module (by its file name), else, outside JS/TS, every file naming the symbol. */
const importers = new Map();
const users = (name, file) => {
  if (!/\.(m|c)?[jt]sx?$/.test(file)) {
    return lines(sh("git", ["grep", "-l", "-I", "-w", name, "--", "."], { cwd: root }).out).filter((hit) => hit !== file && isCode(hit) && !isNoise(hit));
  }
  if (!importers.has(file)) {
    const stem = basename(file).replace(/\.[^.]+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hits = lines(sh("git", ["grep", "-l", "-I", "-E", `(from|import|require\\().*['"/]${stem === "index" ? basename(dirname(file)) : stem}(\\.[a-z]+)?['"]`, "--", "."], { cwd: root }).out);
    const target = file.replace(/\.[^./]+$/, "").replace(/\/index$/, "");
    // A relative import must resolve to this file; a package or alias import is kept, it cannot be checked here.
    const points = (hit) => {
      const text = readFileSync(join(root, hit), "utf8");
      return [...text.matchAll(/(?:from|import|require\()\s*['"]([^'"]+)['"]/g)].some(([, spec]) => !spec.startsWith(".")
        ? spec.endsWith(target.split("/").pop())
        : normalize(join(dirname(hit), spec)).replace(/\.[^./]+$/, "").replace(/\/index$/, "") === target);
    };
    importers.set(file, hits.filter((hit) => hit !== file && !isNoise(hit) && points(hit)));
  }
  return importers.get(file).filter((hit) => name === "default" || new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(readFileSync(join(root, hit), "utf8")));
};

let breaks = 0;
const report = [];
for (const file of files.sort()) {
  const was = before(file);
  if (was === undefined) continue; // new file: nothing to break
  const now = read(file);
  const a = surface(was, file);
  const b = now === undefined ? new Map() : surface(now, file);
  const rows = [];
  for (const [name, signature] of a) {
    if (!b.has(name)) rows.push({ kind: "removed", name, was: signature });
    else if (b.get(name) !== signature) rows.push({ kind: "changed", name, was: signature, now: b.get(name) });
  }
  const added = [...b.keys()].filter((name) => !a.has(name));
  // A removal next to an addition is likely a rename.
  for (const row of rows) if (row.kind === "removed" && added.length === 1 && rows.filter((r) => r.kind === "removed").length === 1) row.kind = `renamed to ${added[0]}?`;
  if (rows.length === 0) continue;
  report.push(`## ${file}${now === undefined ? " (deleted)" : ""}`);
  for (const row of rows) {
    breaks += 1;
    const using = users(row.name, file);
    report.push(`  ${row.kind}: ${row.name}${using.length ? `  — used in ${using.length} file(s): ${using.slice(0, 5).join(", ")}${using.length > 5 ? ", …" : ""}` : "  — no other file names it"}`);
    report.push(`    was: ${row.was}`);
    if (row.now) report.push(`    now: ${row.now}`);
  }
}
if (breaks === 0) {
  console.log(`No exported name removed or changed since ${base === "HEAD" ? "the last commit" : base.slice(0, 12)}.`);
  process.exit(0);
}
console.log(`# ${breaks} exported name(s) removed or changed since ${base === "HEAD" ? "the last commit" : base.slice(0, 12)}`);
console.log(report.join("\n"));
console.log("Changed signatures may be harmless (an added optional parameter); a removal or rename with users left is a break.");
process.exit(1);
