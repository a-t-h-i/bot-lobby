import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, resolveConfig, type LintConfig } from "../src/schemas/configuration.ts";
import { commandWords, findLinters, planLint, runPlan, type LintExec, type LintExecResult } from "../src/execution/lint.ts";
import { lintContext, lintFeed, lintHolds, lintNote, lintRefusal, lintSuppressions, runLintGate } from "../src/workflow/lint.ts";
import { createTask, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { runWorkflowAction, waiveLint, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import type { PiStreamEvent, ProcessRunner } from "../src/execution/pi-runner.ts";

const LINT: LintConfig = { ...DEFAULT_CONFIG.lint };

function tempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "bl-lint-")));
}

function write(dir: string, path: string, text: string): void {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
}

/** A repository with an ESLint config, ESLint "installed" (a bin the fake exec stands in for), and committed files. */
function eslintRepo(files: Record<string, string> = {}): string {
  const dir = tempDir();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  write(dir, ".gitignore", "node_modules\n");
  write(dir, "eslint.config.js", "export default [];\n");
  write(dir, "node_modules/eslint/package.json", JSON.stringify({ name: "eslint", bin: { eslint: "bin/eslint.js" } }));
  write(dir, "node_modules/eslint/bin/eslint.js", "");
  for (const [path, text] of Object.entries(files)) write(dir, path, text);
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return dir;
}

/** ESLint as a fake: `no-debugger` on every `debugger` line and `no-console` on every `console.log` line, as its JSON format reports them. */
function fakeEslint(calls: string[][] = []): LintExec {
  return async (_command, args, options) => {
    calls.push([...args]);
    const files = args.slice(args.indexOf("json") + 1);
    const reports = files.map((file) => {
      const path = join(options.cwd, file);
      const messages = readFileSync(path, "utf8").split("\n").flatMap((line, index) => [
        ...(line.includes("debugger") ? [{ ruleId: "no-debugger", severity: 2, message: "Unexpected 'debugger' statement.", line: index + 1, column: 1 }] : []),
        ...(line.includes("console.log") ? [{ ruleId: "no-console", severity: 2, message: "Unexpected console statement.", line: index + 1, column: 1 }] : []),
      ]);
      return { filePath: path, messages };
    });
    const failing = reports.some((report) => report.messages.length > 0);
    return { code: failing ? 1 : 0, stdout: JSON.stringify(reports), stderr: "" } satisfies LintExecResult;
  };
}

test("lint settings normalise: a known mode, extensions with dots, a bounded time limit", () => {
  assert.deepEqual(DEFAULT_CONFIG.lint, { mode: "advise", command: "", extensions: [], timeoutMs: 120_000 }, "on by default, advising only");
  const lint = resolveConfig({ lint: { mode: "block", command: "  ruff check {files}  ", extensions: ["ts", "*.PY", ".tsx", "ts", ""], timeoutMs: 90_000 } }).lint;
  assert.deepEqual(lint, { mode: "block", command: "ruff check {files}", extensions: [".ts", ".py", ".tsx"], timeoutMs: 90_000 });
  assert.deepEqual(resolveConfig({ lint: { mode: "loud", timeoutMs: -5, extensions: "ts" } }).lint, DEFAULT_CONFIG.lint, "anything else keeps the defaults");
  assert.equal(resolveConfig({ lint: { timeoutMs: 10 * 60 * 60 * 1000 } }).lint.timeoutMs, 30 * 60 * 1000);
});

test("a lint command splits into words with quotes, and no shell ever reads it", () => {
  assert.deepEqual(commandWords(`npx eslint --rule 'no-console: off' {files}`), ["npx", "eslint", "--rule", "no-console: off", "{files}"]);
  assert.deepEqual(commandWords(`lint "" -x`), ["lint", "", "-x"]);
  assert.deepEqual(commandWords("a; rm -rf /"), ["a;", "rm", "-rf", "/"], "a semicolon is only a character");
});

test("each touched file goes to the linters configured nearest above it, each run from its own folder", () => {
  const dir = tempDir();
  write(dir, "eslint.config.js", "export default [];\n");
  write(dir, "services/api/pyproject.toml", "[project]\nname='api'\n\n[tool.ruff]\nline-length = 100\n");
  write(dir, "web/biome.json", "{}");
  const files = ["src/a.ts", "web/b.tsx", "services/api/x.py", "README.md"];
  const plans = planLint(dir, files, LINT).map((plan) => [plan.tool, plan.folder, plan.files]);
  assert.deepEqual(plans, [
    ["ESLint", dir, ["src/a.ts", "web/b.tsx"]],
    ["Biome", join(dir, "web"), ["web/b.tsx"]],
    ["Ruff", join(dir, "services/api"), ["services/api/x.py"]],
  ]);
  const custom = planLint(dir, files, { command: "make lint FILES={files}", extensions: [".py", ".md"] });
  assert.deepEqual(custom.map((plan) => [plan.tool, plan.files]), [["make", ["services/api/x.py", "README.md"]]], "a command from Settings replaces them, given the files of its types");
  assert.deepEqual(planLint(dir, ["notes.txt"], LINT), [], "nothing configured for it, nothing runs");
  const found = findLinters(dir).map((entry) => [entry.tool, entry.folder, entry.installed]);
  assert.deepEqual(found.filter(([tool]) => tool !== "Ruff"), [["ESLint", "", false], ["Biome", "web", false]], "Settings lists what the project configures, and what is not installed");
  assert.ok(found.some(([tool, folder]) => tool === "Ruff" && folder === "services/api"));
});

test("a linter's own output becomes findings; one that is missing, crashes or times out could not run", async () => {
  const dir = eslintRepo({ "src/a.ts": "debugger;\n" });
  const plan = planLint(dir, ["src/a.ts"], LINT)[0]!;
  const ran = await runPlan(plan, dir, LINT, fakeEslint());
  assert.equal(ran.state, "failing");
  assert.deepEqual(ran.findings.map((finding) => [finding.file, finding.line, finding.rule, finding.severity]), [["src/a.ts", 1, "no-debugger", "error"]]);
  const ignored: LintExec = async () => ({ code: 0, stdout: JSON.stringify([{ filePath: join(dir, "src/a.ts"), messages: [{ ruleId: null, severity: 1, message: "File ignored because no matching configuration was supplied." }] }]), stderr: "" });
  assert.deepEqual((await runPlan(plan, dir, LINT, ignored)).findings, [], "a file the config skips is not a finding");
  const crashed: LintExec = async () => ({ code: 2, stdout: "", stderr: "Oops! Something went wrong!\nCannot find package 'typescript-eslint'" });
  const crash = await runPlan(plan, dir, LINT, crashed);
  assert.equal(crash.state, "unavailable");
  assert.match(crash.output ?? "", /ESLint failed to run \(exit 2\)[\s\S]*typescript-eslint/);
  const slow: LintExec = async () => ({ code: null, stdout: "", stderr: "", failure: "timeout" });
  assert.match((await runPlan(plan, dir, LINT, slow)).output ?? "", /longer than its 120s limit/);
  const bare = tempDir();
  write(bare, "eslint.config.js", "export default [];\n");
  const missing = await runPlan(planLint(bare, ["a.ts"], LINT)[0]!, bare, LINT, fakeEslint());
  assert.equal(missing.state, "unavailable");
  assert.match(missing.output ?? "", /ESLint is configured but not installed/);
});

test("a command from Settings gets the files where {files} stands, and its file:line lines read as findings", async () => {
  const dir = tempDir();
  const seen: Array<[string, readonly string[], string]> = [];
  const exec: LintExec = async (command, args, options) => {
    seen.push([command, args, options.cwd]);
    return { code: 1, stdout: "src/a.py:3:1: E501 line too long\nFound 1 error.\n", stderr: "" };
  };
  const config = { ...LINT, command: "ruff check --select E {files} --quiet" };
  const run = await runPlan(planLint(dir, ["src/a.py", "-odd.py"], config)[0]!, dir, config, exec);
  assert.deepEqual(seen, [["ruff", ["check", "--select", "E", "src/a.py", "./-odd.py", "--quiet"], dir]], "a file name that looks like an option is never read as one");
  assert.deepEqual(run.findings.map((finding) => [finding.file, finding.line, finding.message]), [["src/a.py", 3, "E501 line too long"]]);
  const gone: LintExec = async () => ({ code: null, stdout: "", stderr: "", failure: "missing" });
  assert.match((await runPlan(planLint(dir, ["src/a.py"], config)[0]!, dir, config, gone)).output ?? "", /ruff is not installed here/);
});

test("only problems on lines the task changed are its own; suppressions and lint config it added are listed", async () => {
  const dir = eslintRepo({ "src/a.ts": "export const old = 1;\nconsole.log(old);\n" });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  write(dir, "src/a.ts", "export const old = 1;\nconsole.log(old);\n// eslint-disable-next-line no-console\nconsole.info(1);\ndebugger;\n");
  write(dir, "src/new.ts", "console.log('new');\n");
  write(dir, "eslint.config.js", "export default [{ rules: { 'no-console': 'off' } }];\n");
  const calls: string[][] = [];
  const report = await runLintGate({ top: dir, files: ["src/a.ts", "src/new.ts", "eslint.config.js"], base, config: LINT, exec: fakeEslint(calls) });
  assert.equal(report.state, "failing");
  assert.equal(report.errors, 3);
  assert.equal(report.freshErrors, 2, "debugger on a changed line, and console.log in a new file; the old console.log is not the task's");
  assert.deepEqual(report.runs[0]!.findings.map((finding) => [finding.file, finding.line, finding.fresh]), [["src/a.ts", 5, true], ["src/new.ts", 1, true], ["src/a.ts", 2, false]], "new ones first");
  assert.deepEqual(report.suppressions, ["eslint.config.js — lint or type-check config changed", "src/a.ts:3 — // eslint-disable-next-line no-console"]);
  // Nothing changed since: the last report stands, and the linter does not run again.
  assert.equal(await runLintGate({ top: dir, files: ["src/a.ts", "src/new.ts", "eslint.config.js"], base, config: LINT, previous: report, exec: fakeEslint(calls) }), report);
  assert.equal(calls.length, 1);
  assert.equal(lintHolds(report, "block", false), true);
  assert.equal(lintHolds(report, "block", true), false, "the user accepted the work as it is");
  assert.equal(lintHolds(report, "advise", false), false);
  const note = lintNote(report, "block", new Map([["src/a.ts", "DEV"]]));
  assert.match(note, /^Lint — ESLint on 3 touched files: 2 new errors \(1 problem already there before this task\)\./);
  assert.match(note, /- src\/a\.ts:5:1 \[no-debugger\] Unexpected 'debugger' statement\. — error \(DEV\)/);
  assert.match(note, /Completion is held until the new errors are fixed/);
  assert.match(note, /- src\/a\.ts:3 — \/\/ eslint-disable-next-line no-console/);
  assert.match(lintNote(report, "advise"), /Advisory: have the domain that touched each file fix the new ones/);
  const qa = lintContext(report, "block");
  assert.match(qa, /Lint, run by the engine on the files this task touched \(block mode\)/);
  assert.match(qa, /Judge each: one without a reason that holds[\s\S]*- eslint\.config\.js — lint or type-check config changed/);
  assert.match(lintRefusal(report), /^lint found 2 errors on lines this task changed \(src\/a\.ts:5:1 no-debugger, src\/new\.ts:1:1 no-console\)/);
  assert.deepEqual(lintFeed("TASK-1", report), { text: "TASK-1 · ESLint on 3 touched files: 2 new errors (1 problem already there before this task) — src/a.ts:5:1 no-debugger", kind: "error" });
  // Fixed at the cause: the old problem stays reported and never fails the task.
  write(dir, "src/a.ts", "export const old = 1;\nconsole.log(old);\nconsole.info(1);\n");
  write(dir, "src/new.ts", "export const fresh = 1;\n");
  const fixed = await runLintGate({ top: dir, files: ["src/a.ts", "src/new.ts"], base, config: LINT, previous: report, exec: fakeEslint(calls) });
  assert.equal(fixed.state, "passing");
  assert.equal(fixed.errors, 1);
  assert.equal(fixed.freshErrors, 0);
  assert.equal(lintNote(fixed, "block"), "Lint — ESLint on 2 touched files: no new problems (1 problem already there before this task).");
});

test("nothing touched, or nothing configured: lint says so and holds nothing", async () => {
  const dir = tempDir();
  const none = await runLintGate({ top: dir, files: [], config: LINT });
  assert.equal(none.state, "skipped");
  assert.equal(lintNote(none, "block"), "", "the oracle is not told about a lint that never ran");
  const unconfigured = await runLintGate({ top: dir, files: ["a.ts"], config: LINT });
  assert.equal(unconfigured.note, "no linter is configured for the touched files");
  assert.equal(lintHolds(unconfigured, "block", false), false);
  assert.match(lintContext(unconfigured, "advise"), /Lint: no linter is configured for the touched files\./);
});

test("suppressions are read from added lines in any language", () => {
  const added = { whole: new Set<string>(), lines: new Map(), text: [
    { file: "a.py", line: 4, text: "x = 1  # noqa: E501" },
    { file: "b.ts", line: 9, text: "  // @ts-expect-error legacy type" },
    { file: "c.go", line: 2, text: "//nolint" },
    { file: "d.ts", line: 1, text: "const ok = 1;" },
    { file: "package.json", line: 3, text: "\"lint\": \"eslint . --quiet\"" },
    { file: "package.json", line: 4, text: "\"version\": \"2.0.0\"" },
  ] };
  assert.deepEqual(lintSuppressions(added, ["a.py", "b.ts", "c.go", "d.ts", "package.json", "tsconfig.json"]), [
    "package.json — lint or type-check config changed",
    "tsconfig.json — lint or type-check config changed",
    "a.py:4 — x = 1  # noqa: E501",
    "b.ts:9 — // @ts-expect-error legacy type",
    "c.go:2 — //nolint",
  ]);
});

const FLOW: TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning"];
const PLAN = "## Objective\nAdd a.\n## Domains\nbackend\n## Files\nsrc/a.ts\n## Sequence\n1\n## Dependencies\nnone\n## Testing\nunit\n## Acceptance Criteria\nworks\n## Rollback\nrevert\n## Review\npeer";

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

test("the engine lints what a task's workers touched after each step, gives QA the result, and in block mode holds completion", async () => {
  const dir = eslintRepo({ "src/a.ts": "export const old = 1;\nconsole.log(old);\n", "src/other.ts": "debugger;\n" });
  const prompts: string[] = [];
  let fixed = false;
  const runProcess: ProcessRunner = async (args, options) => {
    const system = readFileSync(args[args.indexOf("--append-system-prompt") + 1]!, "utf8");
    prompts.push(system);
    if (/Worker Role/.test(system)) {
      const edit: PiStreamEvent = { type: "tool_execution_start", toolName: "edit", args: { path: "src/a.ts" } };
      options.onEvent?.(edit);
      writeFileSync(join(dir, "src/a.ts"), fixed ? "export const old = 1;\nconsole.log(old);\nexport const a = 2;\n" : "export const old = 1;\nconsole.log(old);\n// eslint-disable-next-line no-console\ndebugger;\n");
      return { exitCode: 0, stdout: reply("## Completed\nAdded a.\n\n## Files Changed\n- src/a.ts — added a\n\n## Verification\n- `npx eslint src/a.ts` — ran"), stderr: "", killed: false, timedOut: false };
    }
    return { exitCode: 0, stdout: reply("## Verdict\nPASS\n\n## Verification\n- `npm test` — passing"), stderr: "", killed: false, timedOut: false };
  };
  const linted: string[][] = [];
  const feed: string[] = [];
  const deps: WorkflowDeps = {
    root: dir, configDir: ".pi", cwd: dir, config: { ...DEFAULT_CONFIG, lint: { ...DEFAULT_CONFIG.lint, mode: "block" } },
    ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess,
    exec: async () => ({ code: 1, stdout: "", stderr: "no remote" }),
    lintExec: fakeEslint(linted),
    onLint: (taskId, report) => feed.push(lintFeed(taskId, report).text),
  };
  ensureProjectStructure(dir, ".pi");
  const task = createTask("TASK-1", "Add a", "2026-01-01T00:00:00.000Z");
  createTaskDir(dir, ".pi", task);
  for (const state of FLOW) transition(task, state);
  task.domains = ["backend"];
  task.plan = PLAN;
  saveTask(dir, ".pi", task);
  const act = (params: Partial<OrchestrateParams>) => runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);

  const implemented = await act({ action: "implement", domain: "backend", task: "Add a to src/a.ts" });
  assert.equal(implemented.ok, true, implemented.message);
  assert.match(implemented.message, /Lint — ESLint on 1 touched file: 1 new error \(1 problem already there before this task\)\./, "only the touched file, never src/other.ts");
  assert.match(implemented.message, /- src\/a\.ts:4:1 \[no-debugger\] [^\n]* — error \(DEV\)/, "with the domain that touched it");
  assert.match(implemented.message, /Completion is held until the new errors are fixed/);
  assert.match(implemented.message, /- src\/a\.ts:3 — \/\/ eslint-disable-next-line no-console/);
  assert.deepEqual(linted.map((args) => args.slice(-3)), [["--format", "json", "src/a.ts"]]);
  assert.match(linted[0]![0]!, /node_modules\/eslint\/bin\/eslint\.js$/, "the project's own ESLint");
  assert.equal(loadTask(dir, ".pi", "TASK-1")!.lint?.state, "failing", "the report is kept on the task");

  const qa = await act({ action: "qa" });
  assert.equal(qa.ok, true, qa.message);
  assert.equal(linted.length, 1, "unchanged since the step: the same report, no second run");
  const reviewer = prompts.at(-1)!;
  assert.match(reviewer, /## Lint\n\nWhen your context has a Lint section/, "the reviewer's role says how to judge it");
  assert.match(reviewer, /Lint, run by the engine on the files this task touched \(block mode\): ESLint on 1 touched file: 1 new error/);
  assert.match(reviewer, /Judge each: [^\n]*\n- src\/a\.ts:3 — \/\/ eslint-disable-next-line no-console/, "QA, who cannot edit, judges the suppression");
  assert.match(qa.message, /Lint — ESLint on 1 touched file: 1 new error[^\n]* Completion stays held until the new errors are fixed\./);

  const refused = await act({ action: "complete" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /cannot complete: lint found 1 error on lines this task changed \(src\/a\.ts:4:1 no-debugger\)\. Delegate the fixes/);

  fixed = true;
  const again = await act({ action: "implement", domain: "backend", task: "Step 2: fix the lint error in src/a.ts at the cause" });
  assert.equal(again.ok, true, again.message);
  assert.match(again.message, /Lint — ESLint on 1 touched file: no new problems \(1 problem already there before this task\)\./);
  assert.equal(linted.length, 2);
  assert.ok(feed.length === 2 && /1 new error/.test(feed[0]!) && /no new problems/.test(feed[1]!), "each new result is a line in the lobby's activity log");
  const qa2 = await act({ action: "qa" });
  assert.equal(qa2.ok, true, qa2.message);
  const done = await act({ action: "complete", text: "Added a." });
  assert.equal(done.ok, true, done.message);
  assert.doesNotMatch(done.message, /Lint/, "nothing left to tell");
});

test("the user can accept work with its lint errors, and advise mode never holds it", async () => {
  const dir = eslintRepo({ "src/a.ts": "export {};\n" });
  const runProcess: ProcessRunner = async (args, options) => {
    const system = readFileSync(args[args.indexOf("--append-system-prompt") + 1]!, "utf8");
    if (/Worker Role/.test(system)) {
      options.onEvent?.({ type: "tool_execution_start", toolName: "write", args: { path: "src/a.ts" } });
      writeFileSync(join(dir, "src/a.ts"), "debugger;\n");
      return { exitCode: 0, stdout: reply("## Completed\nDone.\n\n## Files Changed\n- src/a.ts\n\n## Verification\n- `true` — ok"), stderr: "", killed: false, timedOut: false };
    }
    return { exitCode: 0, stdout: reply("## Verdict\nPASS\n\n## Verification\n- `npm test` — passing"), stderr: "", killed: false, timedOut: false };
  };
  const setUp = (mode: LintConfig["mode"]) => {
    const deps: WorkflowDeps = { root: dir, configDir: ".pi", cwd: dir, config: { ...DEFAULT_CONFIG, lint: { ...DEFAULT_CONFIG.lint, mode } }, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess, exec: async () => ({ code: 1, stdout: "", stderr: "" }), lintExec: fakeEslint() };
    return deps;
  };
  ensureProjectStructure(dir, ".pi");
  for (const [id, mode] of [["TASK-1", "block"], ["TASK-2", "advise"]] as const) {
    execFileSync("git", ["checkout", "-q", "--", "src/a.ts"], { cwd: dir });
    const deps = setUp(mode);
    const task = createTask(id, "Add a");
    createTaskDir(dir, ".pi", task);
    for (const state of FLOW) transition(task, state);
    task.domains = ["backend"];
    task.plan = PLAN;
    saveTask(dir, ".pi", task);
    const act = (params: Partial<OrchestrateParams>) => runWorkflowAction({ action: "status", taskId: id, ...params } as OrchestrateParams, deps);
    assert.equal((await act({ action: "implement", domain: "backend", task: "Write src/a.ts" })).ok, true);
    assert.equal((await act({ action: "qa" })).ok, true);
    if (mode === "block") {
      assert.equal((await act({ action: "complete" })).ok, false);
      const held = loadTask(dir, ".pi", id)!;
      waiveLint(held, "with /bot-lobby accept");
      saveTask(dir, ".pi", held);
    }
    const done = await act({ action: "complete" });
    assert.equal(done.ok, true, done.message);
    assert.match(done.message, mode === "block" ? /Accepted by the user with lint errors: ESLint on 1 touched file: 1 new error\. Tell the user\./ : /Lint \(advisory\): ESLint on 1 touched file: 1 new error\. Tell the user\./);
    if (mode === "block") assert.ok(loadTask(dir, ".pi", id)!.decisions.some((decision) => /accepted the work with its lint errors \(with \/bot-lobby accept\)/.test(decision.text)));
  }
});

test("lint off runs nothing", async () => {
  const dir = eslintRepo({ "src/a.ts": "export {};\n" });
  const calls: string[][] = [];
  const runProcess: ProcessRunner = async (_args, options) => {
    options.onEvent?.({ type: "tool_execution_start", toolName: "edit", args: { path: "src/a.ts" } });
    writeFileSync(join(dir, "src/a.ts"), "debugger;\n");
    return { exitCode: 0, stdout: reply("## Completed\nDone.\n\n## Files Changed\n- src/a.ts\n\n## Verification\n- `true` — ok"), stderr: "", killed: false, timedOut: false };
  };
  const deps: WorkflowDeps = { root: dir, configDir: ".pi", cwd: dir, config: { ...DEFAULT_CONFIG, lint: { ...DEFAULT_CONFIG.lint, mode: "off" } }, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess, lintExec: fakeEslint(calls) };
  ensureProjectStructure(dir, ".pi");
  const task = createTask("TASK-1", "Add a");
  createTaskDir(dir, ".pi", task);
  for (const state of FLOW) transition(task, state);
  task.domains = ["backend"];
  task.plan = PLAN;
  saveTask(dir, ".pi", task);
  const implemented = await runWorkflowAction({ action: "implement", taskId: "TASK-1", domain: "backend", task: "Write src/a.ts" } as OrchestrateParams, deps);
  assert.equal(implemented.ok, true, implemented.message);
  assert.doesNotMatch(implemented.message, /Lint/);
  assert.deepEqual(calls, []);
  assert.equal(loadTask(dir, ".pi", "TASK-1")!.lint, undefined);
});
