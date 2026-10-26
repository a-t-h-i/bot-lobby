#!/usr/bin/env node
// purpose: typecheck and lint only what changed on this branch (or given files) with the project's own tools; prints each check's findings and a pass/fail line
// usage: node {script} [files…] [--base <ref>] [--timeout <seconds>]
import { existsSync } from "node:fs";
import { join } from "node:path";
import { baseRef, changedFiles, detect, parseArgs, projectRoot, sh, tail } from "./lib/common.mjs";

const { flags, rest } = parseArgs();
const root = projectRoot();
const tool = detect(root);
const files = rest.length > 0 ? rest : changedFiles(root, baseRef(root, flags.base));
const timeout = Number(flags.timeout ?? 240) * 1000;
const has = (name) => existsSync(join(root, name));
const pick = (pattern) => files.filter((file) => pattern.test(file));
const checks = [];

const ts = pick(/\.[cm]?tsx?$/);
if (ts.length > 0 && has("tsconfig.json")) checks.push({ name: "typecheck (whole project: tsc cannot check one file with the project's settings)", cmd: "npx", args: ["tsc", "--noEmit", "-p", "."] });
const js = pick(/\.[cm]?[jt]sx?$/);
const eslint = ["eslint.config.js", "eslint.config.mjs", "eslint.config.ts", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json"].some(has) || tool.pkg?.eslintConfig;
if (js.length > 0 && eslint) checks.push({ name: "eslint", cmd: "npx", args: ["eslint", ...js] });
if (js.length > 0 && (has("biome.json") || has("biome.jsonc"))) checks.push({ name: "biome", cmd: "npx", args: ["biome", "check", ...js] });
const py = pick(/\.py$/);
if (py.length > 0) {
  if (sh("ruff", ["--version"]).code === 0) checks.push({ name: "ruff", cmd: "ruff", args: ["check", ...py] });
  else checks.push({ name: "python syntax", cmd: "python3", args: ["-m", "py_compile", ...py] });
  if (has("mypy.ini") || /\[tool\.mypy\]/.test(sh("cat", ["pyproject.toml"], { cwd: root }).out)) checks.push({ name: "mypy", cmd: "python3", args: ["-m", "mypy", ...py] });
}
const go = pick(/\.go$/);
if (go.length > 0 && tool.go) checks.push({ name: "go vet", cmd: "go", args: ["vet", ...new Set(go.map((file) => `./${file.split("/").slice(0, -1).join("/") || "."}`))] });
if (pick(/\.rs$/).length > 0 && tool.rust) checks.push({ name: "cargo check", cmd: "cargo", args: ["check", "--quiet"] });

if (files.length === 0) {
  console.log("No changed files: nothing to check.");
  process.exit(0);
}
if (checks.length === 0) {
  console.log(`Changed: ${files.length} file(s). No typechecker or linter is set up for them.`);
  process.exit(0);
}
let failed = 0;
for (const check of checks) {
  const result = sh(check.cmd, check.args, { cwd: root, timeout, env: { ...process.env, FORCE_COLOR: "0" } });
  const ok = result.code === 0;
  if (!ok) failed += 1;
  console.log(`## ${check.name}: ${ok ? "clean" : `findings (exit ${result.code})`}`);
  const output = `${result.out}${result.err}`.trim();
  if (!ok && output) console.log(tail(output, 80));
}
console.log(failed === 0 ? "PASS" : `FAIL (${failed} of ${checks.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
