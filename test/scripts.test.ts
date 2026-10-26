/**
 * The shared scripts library: scripts named for what they do, kept with a
 * header the index is read from, saved only by the oracle (workers propose),
 * matched to each step by Jev (shared words without it) and shown in the
 * agent's prompt with how to run them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Classifier } from "../src/classifier/classifier.ts";
import type { Answer, FetchLike, Question } from "../src/classifier/client.ts";
import { scriptPicker } from "../src/classifier/scripts.ts";
import { allScripts, BUILTIN_SCRIPTS_DIR, builtinScripts, listScripts, saveScript, scriptName, scriptsDir } from "../src/scripts/library.ts";
import { keywordScripts, libraryBlock, scriptsBlock, scriptsFor } from "../src/scripts/pick.ts";
import { parseScriptProposals, parseWorkerResult } from "../src/roles/worker.ts";
import { runWorker } from "../src/master/master.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask, taskDirFor } from "../src/state/persistence.ts";
import { dataRoot } from "../src/state/project.ts";
import { transition } from "../src/state/task-state.ts";
import { DEFAULT_CONFIG, type ClassifierConfig } from "../src/schemas/configuration.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

const SEED = "#!/usr/bin/env python3\nimport sys\nprint('seeded', sys.argv[1:])\n";

function library(): string {
  return mkdtempSync(join(tmpdir(), "bl-scripts-"));
}

test("a script is named for what it does in snake_case, with its language's extension", () => {
  assert.equal(scriptName("seed_public_holidays.py"), "seed_public_holidays.py");
  assert.equal(scriptName("  Seed public-holidays.PY "), "seed_public_holidays.py", "spaces, hyphens and case are put right");
  assert.equal(scriptName("run_changed_tests.sh"), "run_changed_tests.sh");
  assert.throws(() => scriptName("seed.py"), /snake_case words/, "one word does not say what it does");
  assert.throws(() => scriptName("seed_holidays"), /extension/);
  assert.throws(() => scriptName("seed_holidays.exe"), /extension/);
  assert.throws(() => scriptName("../seed_holidays.py"), /snake_case/);
  assert.throws(() => scriptName(`${"word_".repeat(20)}x.py`), /at most 64/);
});

test("saving writes the header after the shebang; the index reads purpose and usage back, and leaves other files out", () => {
  const data = library();
  const { entry, archived } = saveScript({ dataRoot: data, name: "seed_public_holidays.py", purpose: "Seed the public holidays table for a year", usage: "python3 seed_public_holidays.py --year 2026", body: SEED });
  assert.equal(archived, undefined);
  assert.equal(entry.path, join(scriptsDir(data), "seed_public_holidays.py"));
  const text = readFileSync(entry.path, "utf8");
  assert.match(text, /^#!\/usr\/bin\/env python3\n# purpose: Seed the public holidays table for a year\n# usage: python3 seed_public_holidays.py --year 2026\n\nimport sys/);
  writeFileSync(join(scriptsDir(data), "notes.txt"), "not a script");
  writeFileSync(join(scriptsDir(data), "check_links.mjs"), "// purpose: Check every link in the docs\nconsole.log('ok')\n");
  const entries = listScripts(data);
  assert.deepEqual(entries.map((script) => script.name), ["check_links.mjs", "seed_public_holidays.py"]);
  assert.equal(entries[0]!.purpose, "Check every link in the docs", "a script written by hand is read the same way");
  assert.equal(entries[0]!.usage, `node ${join(scriptsDir(data), "check_links.mjs")}`, "no usage line: its runner and path");
});

test("saving a script again replaces it and keeps the old one under archive/; the same script again changes nothing", () => {
  const data = library();
  saveScript({ dataRoot: data, name: "seed_public_holidays.py", purpose: "Seed holidays", body: SEED });
  const again = saveScript({ dataRoot: data, name: "seed_public_holidays.py", purpose: "Seed holidays", body: SEED });
  assert.equal(again.archived, undefined, "nothing changed");
  // A body that carries its own old header does not end up with two.
  const replaced = saveScript({ dataRoot: data, name: "seed_public_holidays.py", purpose: "Seed holidays for a country and year", body: `${readFileSync(again.entry.path, "utf8")}print('done')\n` });
  assert.ok(replaced.archived && existsSync(replaced.archived));
  const text = readFileSync(replaced.entry.path, "utf8");
  assert.equal(text.match(/# purpose:/g)?.length, 1);
  assert.match(text, /# purpose: Seed holidays for a country and year/);
  assert.deepEqual(readdirSync(join(scriptsDir(data), "archive")).length, 1);
  assert.throws(() => saveScript({ dataRoot: data, name: "empty_script.sh", purpose: "nothing", body: "#!/bin/bash\n" }), /empty/);
  assert.throws(() => saveScript({ dataRoot: data, name: "no_purpose.sh", purpose: " ", body: "echo hi" }), /purpose/);
});

test("without Jev a script fits a step when its name or purpose shares words with it; the prompt says how to run it and where the rest are", async () => {
  const data = library();
  saveScript({ dataRoot: data, name: "seed_public_holidays.py", purpose: "Seed the public holidays table for a year", usage: "python3 x.py --year 2026", body: SEED });
  saveScript({ dataRoot: data, name: "check_links.mjs", purpose: "Check every link in the docs", body: "console.log(1)" });
  const entries = listScripts(data);
  assert.deepEqual(keywordScripts("I can't seed public holidays for 2027", entries).map((entry) => entry.name), ["seed_public_holidays.py"]);
  assert.deepEqual(keywordScripts("Rename the export button", entries), []);
  const block = await scriptsFor(data, "Seed the holidays again");
  assert.match(block, /These shared scripts do part of this step/);
  assert.match(block, /- `seed_public_holidays\.py` — Seed the public holidays table for a year\n {2}run: `python3 x\.py --year 2026`/);
  assert.ok(block.includes(`The shared scripts library (2 scripts) is \`${scriptsDir(data)}\``));
  assert.match(await scriptsFor(data, "Recolour the banner"), /^None of the shared scripts fits this step/);
  assert.match(await scriptsFor(library(), "anything"), /^None of the shared scripts fits this step exactly\. Built-in scripts/, "no library of its own: the built-ins still show");
  assert.equal(scriptsBlock(data, [], []), "");
  assert.match(libraryBlock(data), /Shared scripts \(.*\):\n- `check_links\.mjs` — Check every link in the docs\n- `seed_public_holidays\.py`/);
  assert.match(libraryBlock(library()), /is empty/);
});

/** A fake Jev: each script's answer from `yes(script)`, where the script reads `name: purpose`. */
function scriptJev(yes: (script: string) => number, calls: string[][] = [], fail = false): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { state: { task: string; scripts: Record<string, string> }; questions: Record<string, Question> };
    calls.push(Object.values(body.state.scripts));
    if (fail) return new Response("{}", { status: 400 });
    const answers: Record<string, Answer> = {};
    for (const key of Object.keys(body.questions)) answers[key] = { type: "noul", noul: yes(body.state.scripts[key]!) };
    return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
  };
}

function jev(fetch: FetchLike, overrides: Partial<ClassifierConfig> = {}): Classifier {
  return new Classifier({ config: () => ({ ...DEFAULT_CONFIG.classifier, enabled: true, ...overrides }), keys: async () => "ts_key", fetch, sleep: async () => {} });
}

test("Jev maps a step to the scripts that do part of it, even with no words in common; off or failing, shared words decide", async () => {
  const data = library();
  saveScript({ dataRoot: data, name: "reset_dev_database.sh", purpose: "Drop and recreate the local database with fixtures", body: "echo reset" });
  saveScript({ dataRoot: data, name: "check_links.mjs", purpose: "Check every link in the docs", body: "console.log(1)" });
  const entries = listScripts(data);
  const calls: string[][] = [];
  const picker = scriptPicker(jev(scriptJev((script) => (script.startsWith("reset_dev_database") ? 0.92 : 0.03), calls)));
  const step = "Step 2: start from a clean DB before the migration test";
  assert.deepEqual(keywordScripts(step, entries), [], "no shared words");
  assert.deepEqual((await picker.pick(step, entries)).map((entry) => entry.name), ["reset_dev_database.sh"]);
  assert.deepEqual(calls[0], ["check_links.mjs: Check every link in the docs", "reset_dev_database.sh: Drop and recreate the local database with fixtures"]);

  const failing = scriptPicker(jev(scriptJev(() => 1, [], true)));
  assert.deepEqual((await failing.pick("check the links in the docs", entries)).map((entry) => entry.name), ["check_links.mjs"]);
  const off = scriptPicker(jev(scriptJev(() => 1), { features: { ...DEFAULT_CONFIG.classifier.features, scripts: false } }));
  assert.deepEqual((await off.pick("check the links in the docs", entries)).map((entry) => entry.name), ["check_links.mjs"]);
  assert.deepEqual(await picker.pick(step, []), [], "an empty library asks nothing");
});

test("a worker's prompt carries the scripts that fit its step, and where to draft new ones", async () => {
  const data = library();
  saveScript({ dataRoot: data, name: "seed_public_holidays.py", purpose: "Seed the public holidays table for a year", body: SEED });
  const seen: string[] = [];
  const runner: ProcessRunner = async (args) => {
    seen.push(readFileSync(args[args.indexOf("--append-system-prompt") + 1]!, "utf8"));
    return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "## Completed\nx" }], model: "p/m", stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } }), stderr: "", killed: false };
  };
  await runWorker({ taskId: "T-1", domain: "backend", instruction: "Step 1: repair public holiday seeding", taskText: "I can't seed public holidays", scoutOutcomes: [], cwd: data, dataRoots: [data], config: DEFAULT_CONFIG }, runner);
  assert.match(seen[0]!, /## Scripts\n\nThese shared scripts do part of this step[^\n]*\n- `seed_public_holidays\.py`/);
  assert.ok(seen[0]!.includes(`Scripts you draft for the shared library go in \`${join(data, "tasks", "T-1", "scripts")}\``));
});

test("workers propose scripts in their report; the oracle sees the proposals", () => {
  assert.deepEqual(parseScriptProposals("backend", "- `seed_public_holidays.py` — Seed holidays for a year — draft: `.pi/bot-lobby/tasks/T/scripts/seed_public_holidays.py`\n- reset_db.sh: Reset the DB\n- nothing named here"), [
    { domain: "backend", name: "seed_public_holidays.py", purpose: "Seed holidays for a year", draft: ".pi/bot-lobby/tasks/T/scripts/seed_public_holidays.py" },
    { domain: "backend", name: "reset_db.sh", purpose: "Reset the DB" },
  ]);
  const result = parseWorkerResult("backend", "## Completed\nFixed it.\n\n## Script Proposals\n- `seed_public_holidays.py` — Seed holidays — draft: `d.py`");
  assert.equal(result.scriptProposals?.[0]?.name, "seed_public_holidays.py");
});

function deps(root: string, overrides: Partial<WorkflowDeps> = {}): WorkflowDeps {
  ensureProjectStructure(root, ".pi");
  return { root, configDir: ".pi", cwd: root, config: DEFAULT_CONFIG, ask: async () => undefined, choose: async () => undefined, notify: () => {}, ...overrides };
}

function act(workflow: WorkflowDeps, params: Partial<OrchestrateParams>) {
  return runWorkflowAction({ action: "status", ...params } as OrchestrateParams, workflow);
}

test("the oracle saves a script with action=script, from its text or a worker's draft, with or without a task", async () => {
  const root = library();
  const workflow = deps(root);
  const bare = await act(workflow, { action: "script", name: "check_links.mjs", purpose: "Check every link in the docs", text: "console.log('ok')" });
  assert.equal(bare.ok, true, bare.message);
  assert.match(bare.message, /Saved check_links\.mjs in the shared scripts library/);
  assert.deepEqual(listScripts(dataRoot(root, ".pi")).map((entry) => entry.name), ["check_links.mjs"]);

  const task = createTask("TASK-1", "Fix holiday seeding");
  createTaskDir(root, ".pi", task);
  for (const state of ["clarifying", "awaiting_approval", "planning"] as const) transition(task, state);
  saveTask(root, ".pi", task);
  const drafts = join(taskDirFor(root, ".pi", task.id), "scripts");
  mkdirSync(drafts, { recursive: true });
  writeFileSync(join(drafts, "seed_public_holidays.py"), SEED);
  const saved = await act(workflow, { action: "script", taskId: task.id, name: "seed_public_holidays.py", purpose: "Seed holidays for a year", usage: "python3 seed_public_holidays.py --year 2026", file: join(drafts, "seed_public_holidays.py") });
  assert.equal(saved.ok, true, saved.message);
  assert.match(saved.message, /run: python3 seed_public_holidays\.py --year 2026/);
  assert.match(loadTask(root, ".pi", task.id)!.decisions.at(-1)!.text, /Saved the shared script seed_public_holidays\.py/);

  const outside = join(library(), "evil_script.sh");
  writeFileSync(outside, "echo hi");
  assert.match((await act(workflow, { action: "script", name: "evil_script.sh", purpose: "x", file: outside })).message, /inside the project/);
  assert.match((await act(workflow, { action: "script", name: "bad", purpose: "x", text: "echo" })).message, /extension/);
  assert.match((await act(workflow, { action: "script", name: "no_body.sh", purpose: "x" })).message, /requires text/);
});

test("built-in scripts ship for every project, read their usage with the real path, and a project script of the same name wins", () => {
  const builtins = builtinScripts();
  assert.deepEqual(builtins.map((entry) => entry.name), [
    "check_changed.mjs", "diff_summary.mjs", "find_symbol.mjs", "find_tests_for.mjs", "outline_file.mjs",
    "project_commands.mjs", "recent_changes.mjs", "repo_map.mjs", "run_changed_tests.mjs",
  ]);
  for (const entry of builtins) {
    assert.ok(entry.builtin && entry.purpose.length > 30, entry.name);
    assert.ok(entry.usage.startsWith(`node ${entry.path}`), `${entry.name}: ${entry.usage}`);
  }
  const root = mkdtempSync(join(tmpdir(), "bl-builtin-"));
  const data = dataRoot(root, ".pi");
  saveScript({ dataRoot: data, name: "find_symbol.mjs", purpose: "Our own symbol finder", body: "console.log(1)" });
  const all = allScripts(data);
  assert.equal(all.filter((entry) => entry.name === "find_symbol.mjs").length, 1);
  assert.equal(all.find((entry) => entry.name === "find_symbol.mjs")?.builtin, undefined, "the project's own wins");
  assert.match(libraryBlock(data), /Built-in scripts every agent can run/);
});

test("the built-in scripts run: outline, symbol lookup, tests for a file, the project's commands, --help", () => {
  const run = (name: string, ...args: string[]) => execFileSync("node", [join(BUILTIN_SCRIPTS_DIR, name), ...args], { encoding: "utf8" });
  assert.match(run("outline_file.mjs", "src/scripts/library.ts"), /\d+ {2}export function listScripts/);
  const symbol = run("find_symbol.mjs", "builtinScripts");
  assert.match(symbol, /## Defined \(\d+\)\nsrc\/scripts\/library\.ts:\d+ {2}export function builtinScripts/);
  assert.match(symbol, /## Used \(\d+ in \d+ files\)[\s\S]*src\/scripts\/library\.ts:\d+ .*builtinScripts\(\)/);
  assert.match(run("find_tests_for.mjs", "src/scripts/library.ts"), /test\/scripts\.test\.ts/);
  assert.match(run("project_commands.mjs"), /npm run test {2}→ {2}node --test/);
  assert.match(run("run_changed_tests.mjs", "src/scripts/pick.ts", "--dry-run"), /\$ node --test .*test\/scripts\.test\.ts/);
  assert.match(run("repo_map.mjs", "src", "--depth", "1"), /^## src \(\d+ files\)\nagents\//);
  assert.match(run("diff_summary.mjs", "--help"), /^purpose: .*\nusage: node .*diff_summary\.mjs/);
});
