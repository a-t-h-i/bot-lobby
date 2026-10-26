#!/usr/bin/env node
// purpose: summarise what changed on this branch before reading the full diff: each file's lines added and removed, new files, and the tests that cover each
// usage: node {script} [--base <ref>]
import { baseRef, changedFiles, isTest, parseArgs, projectRoot, sh, lines, testsFor } from "./lib/common.mjs";

const { flags } = parseArgs();
const root = projectRoot();
const base = baseRef(root, flags.base);
const files = changedFiles(root, base);
if (files.length === 0) {
  console.log("Nothing changed.");
  process.exit(0);
}
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
const covered = testsFor(root, files);
let plus = 0;
let minus = 0;
console.log(`Compared with ${base === "HEAD" ? "the last commit" : base.slice(0, 12)}: ${files.length} file(s)`);
for (const file of files) {
  const [added, removed] = stats.get(file) ?? [untracked.has(file) ? lines(sh("cat", [file], { cwd: root }).out).length : 0, 0];
  plus += added;
  minus += removed;
  const tests = covered.get(file) ?? [];
  const note = isTest(file) ? "test" : tests.length > 0 ? `tests: ${tests.slice(0, 3).join(", ")}${tests.length > 3 ? ` +${tests.length - 3}` : ""}` : "no test found";
  console.log(`${untracked.has(file) ? "new " : "    "}+${added} -${removed}  ${file}  (${note})`);
}
console.log(`Total +${plus} -${minus}`);
