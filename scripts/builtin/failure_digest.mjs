#!/usr/bin/env node
// purpose: boil a long build, test, typecheck or lint log down to its errors (file:line, message, failing tests) and show our own code at each stack frame; reads a file, stdin, or runs a command
// usage: node {script} [log file] | <command> | node {script} | node {script} --run "<command>" [--timeout <seconds>]
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { parseArgs, projectRoot, sh } from "./lib/common.mjs";

const { flags, rest } = parseArgs();
const root = projectRoot();
let log = "";
let exit;
if (typeof flags.run === "string") {
  const result = sh("bash", ["-lc", flags.run], { cwd: root, timeout: Number(flags.timeout ?? 300) * 1000, env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" } });
  log = `${result.out}\n${result.err}`;
  exit = result.code;
  console.log(`$ ${flags.run}  (exit ${exit})`);
} else if (rest[0]) log = readFileSync(rest[0], "utf8");
else if (!process.stdin.isTTY) log = readFileSync(0, "utf8");
else {
  console.error("Give a log file, pipe a log in, or --run a command.");
  process.exit(2);
}
log = log.replace(/\x1b\[[0-9;]*m/g, "");
const rows = log.split("\n");

/** A path in the log, as a project file, or undefined when it is not ours. */
function ours(path) {
  if (!path || /node_modules|site-packages|dist-packages|\/usr\/lib|internal\/|^node:|<anonymous>/.test(path)) return undefined;
  const clean = path.replace(/^file:\/\//, "");
  const rel = isAbsolute(clean) ? relative(root, clean) : clean;
  return !rel.startsWith("..") && existsSync(join(root, rel)) ? rel : undefined;
}

const errors = [];
const seen = new Set();
const add = (file, line, message, kind = "error") => {
  const key = `${file}:${line}:${message}`;
  if (seen.has(key)) return;
  seen.add(key);
  errors.push({ file, line: Number(line) || 0, message: message.trim().slice(0, 220), kind });
};
const failing = new Set();
const frames = [];
let eslintFile;
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  let m;
  if ((m = /^(.+?)\((\d+),\d+\):\s*(error|warning)\s+(TS\d+:.*)$/.exec(row))) add(m[1], m[2], m[4], m[3]);
  else if ((m = /^(\S+\.\w+):(\d+):(\d+)\s*-\s*(error|warning)\s+(TS\d+:.*)$/.exec(row))) add(m[1], m[2], m[5], m[4]);
  else if ((m = /^\s*-->\s*(\S+):(\d+):\d+/.exec(row))) add(m[1], m[2], (rows[i - 1] ?? "").replace(/^(error|warning)(\[\w+\])?:\s*/, ""), /warning/.test(rows[i - 1] ?? "") ? "warning" : "error");
  else if ((m = /^(\/\S+|[\w./-]+\.\w+)$/.exec(row.trim())) && ours(m[1]) && /^\s+\d+:\d+\s+(error|warning)/.test(rows[i + 1] ?? "")) eslintFile = ours(m[1]);
  else if (eslintFile && (m = /^\s+(\d+):\d+\s+(error|warning)\s+(.+?)\s{2,}([\w@/-]+)?\s*$/.exec(row))) add(eslintFile, m[1], `${m[3]}${m[4] ? ` (${m[4]})` : ""}`, m[2]);
  else if ((m = /^FAILED\s+(\S+?)::(\S+)(?:\s+-\s+(.*))?/.exec(row))) { failing.add(`${m[1]} › ${m[2]}`); if (m[3]) add(m[1], 0, m[3]); }
  else if ((m = /^(?:✖|×|✕|not ok \d+ -)\s+(.+?)(?:\s+\(\d+(?:\.\d+)?m?s\))?$/.exec(row.trim())) && !/^\d+ (passing|failing)/.test(m[1])) failing.add(m[1]);
  else if ((m = /^\s*●\s+(.+)$/.exec(row)) && !/Console/.test(m[1])) failing.add(m[1]);
  else if ((m = /^\s*(?:FAIL)\s+(\S+)/.exec(row))) failing.add(m[1]);
  else if ((m = /^--- FAIL: (\S+)/.exec(row))) failing.add(m[1]);
  else if ((m = /^(?:\s*)([\w./-]+\.(?:go|py|rs|c|cpp|h|java|kt|swift|rb)):(\d+)(?::\d+)?:\s*(.+)$/.exec(row)) && ours(m[1])) add(ours(m[1]), m[2], m[3]);
  else if ((m = /^\s*([\w./-]+\.[cm]?[jt]sx?):(\d+):\d+:?\s+(.+)$/.exec(row)) && ours(m[1])) add(ours(m[1]), m[2], m[3]);
  // Assertion and error messages, kept with the test they belong to.
  if ((m = /^\s*(AssertionError[^:]*|Error|TypeError|ReferenceError|SyntaxError|RangeError|E\s{2,})\s*:?\s*(.+)$/.exec(row)) && !/^\s+at /.test(row) && errors.length < 200) {
    const text = `${m[1].trim()}: ${m[2]}`.replace(/^E:\s*/, "");
    if (!seen.has(text)) { seen.add(text); errors.push({ file: "", line: 0, message: text.slice(0, 220), kind: "assert" }); }
  }
  // Stack frames: JS `at fn (path:line:col)`, Python `File "path", line N`, Go `path.go:N +0x`.
  if ((m = /^\s+at (?:(.+?) \()?((?:file:\/\/)?[^():\s]+):(\d+):\d+\)?$/.exec(row)) && ours(m[2])) frames.push({ file: ours(m[2]), line: Number(m[3]), fn: m[1] ?? "" });
  else if ((m = /^\s*File "(.+?)", line (\d+), in (\S+)/.exec(row)) && ours(m[1])) frames.push({ file: ours(m[1]), line: Number(m[2]), fn: m[3] });
  else if ((m = /^\s+(\/\S+\.go):(\d+)/.exec(row)) && ours(m[1])) frames.push({ file: ours(m[1]), line: Number(m[2]), fn: (rows[i - 1] ?? "").trim().replace(/\(.*$/, "") });
}

const real = errors.filter((entry) => entry.kind !== "warning");
const warnings = errors.length - real.length;
console.log(`## Digest: ${real.length} error${real.length === 1 ? "" : "s"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}, ${failing.size} failing test${failing.size === 1 ? "" : "s"}${exit !== undefined ? `, exit ${exit}` : ""} (from ${rows.length} log lines)`);
if (failing.size > 0) {
  console.log("## Failing tests");
  for (const name of [...failing].slice(0, 25)) console.log(`- ${name}`);
  if (failing.size > 25) console.log(`… ${failing.size - 25} more`);
}
const located = real.filter((entry) => entry.file);
if (located.length > 0) {
  console.log("## Errors by file");
  const byFile = new Map();
  for (const entry of located) byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry]);
  let shown = 0;
  for (const [file, list] of byFile) {
    console.log(`${file}`);
    for (const entry of list.slice(0, 8)) { console.log(`  ${entry.line ? `${entry.line}: ` : ""}${entry.message}`); shown += 1; }
    if (list.length > 8) console.log(`  … ${list.length - 8} more in this file`);
    if (shown >= 40) { console.log(`… more errors cut; ${located.length - shown} not shown`); break; }
  }
}
const asserts = real.filter((entry) => !entry.file);
if (asserts.length > 0) {
  console.log("## Messages");
  for (const entry of asserts.slice(0, 12)) console.log(`- ${entry.message}`);
}
const unique = [...new Map(frames.map((frame) => [`${frame.file}:${frame.line}`, frame])).values()].slice(0, 4);
if (unique.length > 0) {
  console.log("## Where it broke (our frames, innermost first)");
  for (const frame of unique) {
    const code = readFileSync(join(root, frame.file), "utf8").split("\n");
    console.log(`${frame.file}:${frame.line}${frame.fn ? `  in ${frame.fn}` : ""}`);
    for (let n = Math.max(1, frame.line - 2); n <= Math.min(code.length, frame.line + 2); n++) console.log(`  ${n === frame.line ? ">" : " "}${String(n).padStart(5)} ${code[n - 1]}`);
  }
}
if (real.length === 0 && failing.size === 0) console.log(exit ? "No recognisable errors; the tail of the log:\n" + rows.filter(Boolean).slice(-25).join("\n") : "No errors found.");
process.exit(exit === undefined ? 0 : exit === 0 ? 0 : 1);
