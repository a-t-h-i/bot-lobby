#!/usr/bin/env node
// purpose: summarise the branch before reading its diff: per file the changed functions, classes and interfaces, lines added and removed, the tests that cover it, and changed functions no test mentions; lockfiles, build output and generated files are set aside
// usage: node {script} [--base <ref>] [--all]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { baseRef, changedFiles, changedRanges, declarations, isCode, isGenerated, isTest, lines, parseArgs, projectRoot, sh, testsFor, tracked } from "./lib/common.mjs";

const { flags } = parseArgs();
const root = projectRoot();
const base = baseRef(root, flags.base);
const all = changedFiles(root, base);
if (all.length === 0) {
  console.log("Nothing changed.");
  process.exit(0);
}
const noise = flags.all ? [] : all.filter((file) => isGenerated(root, file));
const files = all.filter((file) => !noise.includes(file));
const stats = new Map();
const numstat = (args) => {
  for (const row of lines(sh("git", ["diff", "--numstat", ...args], { cwd: root }).out)) {
    const [added, removed, file] = row.split("\t");
    const now = stats.get(file) ?? [0, 0];
    stats.set(file, [now[0] + (Number(added) || 0), now[1] + (Number(removed) || 0)]);
  }
};
if (base !== "HEAD") numstat([`${base}...HEAD`]);
numstat(["HEAD"]);
const untracked = new Set(lines(sh("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root }).out));
const ranges = changedRanges(root, base);
const everything = tracked(root);
const covered = testsFor(root, files, everything);
const testText = everything.filter(isTest).map((file) => { try { return readFileSync(join(root, file), "utf8"); } catch { return ""; } }).join("\n");

let plus = 0;
let minus = 0;
const untested = [];
console.log(`## Compared with ${base === "HEAD" ? "the last commit" : base.slice(0, 12)}: ${files.length} file(s)${noise.length ? `, ${noise.length} generated or lock file(s) set aside` : ""}`);
for (const file of files) {
  const text = (() => { try { return readFileSync(join(root, file), "utf8"); } catch { return ""; } })();
  const [added, removed] = stats.get(file) ?? [untracked.has(file) ? text.split("\n").length : 0, 0];
  plus += added;
  minus += removed;
  const tests = covered.get(file) ?? [];
  const note = isTest(file) ? "test" : tests.length > 0 ? `tests: ${tests.slice(0, 3).join(", ")}${tests.length > 3 ? ` +${tests.length - 3}` : ""}` : isCode(file) ? "no test found" : "";
  console.log(`${untracked.has(file) ? "new " : "    "}+${added} -${removed}  ${file}${note ? `  (${note})` : ""}`);
  if (!isCode(file) || !text) continue;
  const decls = declarations(text, file);
  const hunks = untracked.has(file) ? [[1, text.split("\n").length]] : ranges.get(file) ?? [];
  const touched = decls.filter((decl) => hunks.some(([from, to]) => from <= decl.end && to >= decl.start));
  // Name the innermost declarations a hunk touched, not every class around them.
  const inner = touched.filter((decl) => !touched.some((other) => other !== decl && other.start >= decl.start && other.end <= decl.end && other.start !== decl.start));
  if (inner.length === 0) continue;
  const names = inner.slice(0, 12).map((decl) => {
    const bare = !isTest(file) && !new RegExp(`\\b${decl.name.replace(/\$/g, "\\$")}\\b`).test(testText);
    if (bare) untested.push(`${file}: ${decl.name}`);
    return `${decl.name}${bare ? "*" : ""}`;
  });
  console.log(`      changed: ${names.join(", ")}${inner.length > 12 ? `, +${inner.length - 12}` : ""}`);
}
console.log(`## Total +${plus} -${minus}`);
if (untested.length > 0) console.log(`## * Changed and named in no test (${untested.length}): check whether each needs one`);
if (noise.length > 0) console.log(`## Set aside: ${noise.slice(0, 10).join(", ")}${noise.length > 10 ? ", …" : ""} (--all to include)`);
