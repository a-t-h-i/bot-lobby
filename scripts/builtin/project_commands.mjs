#!/usr/bin/env node
// purpose: list how this project builds, tests, lints, formats and runs: package.json scripts, Makefile and justfile targets, Python, Go and Rust commands; never guess a command
// usage: node {script}
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detect, projectRoot, runScript } from "./lib/common.mjs";

const root = projectRoot();
const tool = detect(root);
const read = (file) => {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return "";
  }
};
let any = false;
const section = (title, rows) => {
  if (rows.length === 0) return;
  any = true;
  console.log(`## ${title}`);
  for (const row of rows) console.log(row);
};

if (tool.pkg?.scripts) {
  const scripts = Object.entries(tool.pkg.scripts);
  const order = (name) => ["test", "build", "lint", "typecheck", "check", "format", "dev", "start"].findIndex((key) => name === key || name.startsWith(`${key}:`));
  scripts.sort((a, b) => (order(a[0]) < 0 ? 99 : order(a[0])) - (order(b[0]) < 0 ? 99 : order(b[0])));
  section(`package.json scripts (${tool.pm})`, scripts.map(([name, body]) => `- ${runScript(tool.pm, name)}  →  ${String(body).slice(0, 140)}`));
}
const make = read("Makefile");
if (make) section("Makefile", [...make.matchAll(/^([A-Za-z0-9_.-]+):(?!=)/gm)].map((m) => m[1]).filter((t) => !t.startsWith(".")).slice(0, 30).map((t) => `- make ${t}`));
const just = read("justfile") || read("Justfile");
if (just) section("justfile", [...just.matchAll(/^([A-Za-z0-9_-]+)[^:\n]*:/gm)].map((m) => `- just ${m[1]}`).slice(0, 30));
if (tool.python) {
  const py = read("pyproject.toml");
  const rows = [];
  if (/\[tool\.pytest|pytest/.test(py) || existsSync(join(root, "pytest.ini")) || existsSync(join(root, "tests"))) rows.push("- python3 -m pytest -q");
  if (/\[tool\.ruff/.test(py)) rows.push("- ruff check . && ruff format --check .");
  if (/\[tool\.mypy/.test(py)) rows.push("- python3 -m mypy .");
  for (const m of py.matchAll(/^\[(?:project|tool\.poetry)\.scripts\]\n((?:[^\[\n].*\n?)*)/gm)) for (const row of m[1].split("\n").filter((r) => r.includes("="))) rows.push(`- ${row.split("=")[0].trim()}  (console script)`);
  if (existsSync(join(root, "manage.py"))) rows.push("- python3 manage.py runserver / test");
  section("Python", rows);
}
if (tool.go) section("Go", ["- go build ./...", "- go test ./...", "- go vet ./..."]);
if (tool.rust) section("Rust", ["- cargo build", "- cargo test", "- cargo clippy"]);
const ci = [".github/workflows"].filter((dir) => existsSync(join(root, dir)));
if (ci.length > 0) section("CI", ["- .github/workflows/ holds what CI runs; match it locally"]);
if (!any) console.log("No build, test or lint commands found. Look in README.md before running anything.");
