#!/usr/bin/env node
// purpose: run only the tests that cover the files changed on this branch (or given files), with a timeout; prints the command, the tail of its output and the exit code
// usage: node {script} [files…] [--base <ref>] [--timeout <seconds>] [--dry-run]
import { baseRef, changedFiles, detect, isTest, parseArgs, projectRoot, sh, tail, testsFor } from "./lib/common.mjs";

const { flags, rest } = parseArgs();
const root = projectRoot();
const tool = detect(root);
const files = rest.length > 0 ? rest : changedFiles(root, baseRef(root, flags.base));
if (files.length === 0) {
  console.log("No changed files: nothing to test.");
  process.exit(0);
}
const covered = testsFor(root, files);
const tests = [...new Set([...covered.values()].flat())];
const untested = [...covered].filter(([file, hits]) => hits.length === 0 && !isTest(file)).map(([file]) => file);

function plan() {
  const goTests = files.filter((file) => file.endsWith(".go"));
  if (tool.go && goTests.length > 0) return { cmd: "go", args: ["test", ...new Set(goTests.map((file) => `./${file.split("/").slice(0, -1).join("/") || "."}`))] };
  const py = tests.filter((file) => file.endsWith(".py"));
  if (tool.python && py.length > 0) return { cmd: "python3", args: ["-m", "pytest", "-q", ...py] };
  if (tool.rust && files.some((file) => file.endsWith(".rs"))) return { cmd: "cargo", args: ["test", "--quiet"] };
  const js = tests.filter((file) => /\.[cm]?[jt]sx?$/.test(file));
  if (!tool.pkg || js.length === 0) return undefined;
  const testScript = tool.pkg.scripts?.test ?? "";
  if (tool.deps.vitest || /vitest/.test(testScript)) return { cmd: "npx", args: ["vitest", "run", ...js] };
  if (tool.deps.jest || /jest/.test(testScript)) return { cmd: "npx", args: ["jest", ...js] };
  if (tool.deps.mocha || /mocha/.test(testScript)) return { cmd: "npx", args: ["mocha", ...js] };
  if (/@playwright\/test/.test(JSON.stringify(tool.deps)) && js.every((file) => /e2e|playwright|\/web\//.test(file))) return { cmd: "npx", args: ["playwright", "test", ...js] };
  if (/node\s+--test/.test(testScript) || js.length > 0) return { cmd: "node", args: ["--test", ...js.filter((file) => !/\/(e2e|web)\//.test(file))] };
  return undefined;
}

const run = plan();
console.log(`Changed: ${files.length} file(s). Tests covering them: ${tests.length}.`);
if (untested.length > 0) console.log(`No test found for: ${untested.slice(0, 15).join(", ")}${untested.length > 15 ? ", …" : ""}`);
if (!run || run.args.length === 0) {
  console.log("No targeted test command for these files. Run the project's test command (see project_commands.mjs) if the change needs it.");
  process.exit(0);
}
console.log(`$ ${run.cmd} ${run.args.join(" ")}`);
if (flags["dry-run"]) process.exit(0);
const seconds = Number(flags.timeout ?? 300);
const result = sh(run.cmd, run.args, { cwd: root, timeout: seconds * 1000, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
console.log(tail(`${result.out}${result.err ? `\n${result.err}` : ""}`));
console.log(result.code === 0 ? "PASS" : `FAIL (exit ${result.code}${result.code === 1 && seconds ? "" : ""})`);
process.exit(result.code === 0 ? 0 : 1);
