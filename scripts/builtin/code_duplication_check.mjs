#!/usr/bin/env node
// purpose: find code in the changed files that already exists elsewhere in the project (same lines up to whitespace, comments and names of strings), so an existing function is reused instead of copied; --all checks the whole project
// usage: node {script} [--base <ref>] [--min <lines>] [--all] [--tests]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { baseRef, changedFiles, isCode, isGenerated, isTest, parseArgs, projectRoot, tracked } from "./lib/common.mjs";

const { flags } = parseArgs();
const root = projectRoot();
const min = Math.max(3, Number(flags.min ?? 6));
const withTests = Boolean(flags.tests);
const corpus = tracked(root).filter((file) => isCode(file) && (withTests || !isTest(file)) && !isGenerated(root, file));
const targets = flags.all ? corpus : changedFiles(root, baseRef(root, flags.base)).filter((file) => corpus.includes(file));
if (targets.length === 0) {
  console.log(flags.all ? "No source files to check." : "No changed source files to check (tests are skipped unless --tests).");
  process.exit(0);
}

/** Lines that carry meaning, normalised; with their real line numbers. */
function normalise(file) {
  let text;
  try { text = readFileSync(join(root, file), "utf8"); } catch { return []; }
  const out = [];
  let block = false;
  text.split("\n").forEach((raw, index) => {
    let row = raw.trim();
    if (block) { if (row.includes("*/")) { block = false; row = row.slice(row.indexOf("*/") + 2).trim(); } else return; }
    if (row.startsWith("/*")) { if (!row.includes("*/")) { block = true; return; } row = row.slice(row.indexOf("*/") + 2).trim(); }
    row = row.replace(/(^|\s)(\/\/|#(?!\[)).*$/, "").trim();
    // Imports, bare brackets and tiny lines match everywhere and prove nothing.
    if (row.length < 4 || /^(import|from\s+\S+\s+import|export\s*\{|export\s+\*|use\s|require\(|package\s|[)}\]\s;,]+$)/.test(row)) return;
    const key = row.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "S").replace(/\b\d+(\.\d+)?\b/g, "N").replace(/\s+/g, " ");
    // Lists of strings and numbers (data tables, prompts) are not logic to reuse.
    if (!/[A-Za-z_$]/.test(key.replace(/\b[SN]\b/g, ""))) return;
    out.push({ line: index + 1, key });
  });
  return out;
}

// Every window of `min` meaningful lines, by its content.
const rows = new Map();
const index = new Map();
for (const file of corpus) {
  const list = normalise(file);
  rows.set(file, list);
  for (let i = 0; i + min <= list.length; i++) {
    const key = list.slice(i, i + min).map((row) => row.key).join("\n");
    const at = index.get(key);
    if (at) { if (at.length < 20) at.push([file, i]); } else index.set(key, [[file, i]]);
  }
}

const found = [];
const seen = new Set();
for (const file of targets) {
  const list = rows.get(file) ?? [];
  let i = 0;
  while (i + min <= list.length) {
    const key = list.slice(i, i + min).map((row) => row.key).join("\n");
    const others = (index.get(key) ?? []).filter(([other, j]) => other !== file || Math.abs(j - i) >= min);
    if (others.length === 0) { i += 1; continue; }
    // Grow the match while the next line still matches the first copy.
    const [other, j] = others[0];
    const theirs = rows.get(other);
    let length = min;
    while (i + length < list.length && j + length < theirs.length && list[i + length].key === theirs[j + length].key && !(other === file && j + length === i)) length += 1;
    const id = [file, list[i].line, other, theirs[j].line].join(":");
    const back = [other, theirs[j].line, file, list[i].line].join(":");
    if (!seen.has(back)) {
      seen.add(id);
      found.push({ file, from: list[i].line, to: list[i + length - 1].line, other, at: theirs[j].line, end: theirs[j + length - 1].line, length, copies: others.length });
    }
    i += length;
  }
}
if (found.length === 0) {
  console.log(`No repeated block of ${min}+ lines in ${flags.all ? "the project" : `the ${targets.length} changed file(s)`}.`);
  process.exit(0);
}
found.sort((a, b) => b.length - a.length);
console.log(`# ${found.length} repeated block(s) of ${min}+ meaningful lines${flags.all ? "" : " in changed files"}; reuse or extract the existing code where the copies mean the same thing`);
for (const hit of found.slice(0, 25)) {
  console.log(`${hit.file}:${hit.from}-${hit.to}  ≈  ${hit.other}:${hit.at}-${hit.end}  (${hit.length} lines${hit.copies > 1 ? `, ${hit.copies} copies` : ""})`);
}
if (found.length > 25) console.log(`… ${found.length - 25} more; raise --min to see only the larger ones`);
process.exit(1);
