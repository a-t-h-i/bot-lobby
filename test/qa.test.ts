import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completionBlockers } from "../src/master/decisions.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask, taskDirFor } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { knowledgeDir } from "../src/knowledge/paths.ts";
import { dataRoot } from "../src/state/project.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

function review(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

const PASS = "## Verdict\nPASS\n\n## Verification\n- `npm test` — passing";
const FAIL = "## Verdict\nCHANGES_REQUIRED\n\n## Findings\n- [major] regression in the empty state\n\n## Required Changes\n- handle empty list";

const FLOW: TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing", "reviewing"];

function makeDeps(overrides: Partial<WorkflowDeps> = {}): WorkflowDeps {
  const root = mkdtempSync(join(tmpdir(), "dh-qa-"));
  return {
    root,
    configDir: ".pi",
    cwd: root,
    config: DEFAULT_CONFIG,
    ask: async () => undefined,
    choose: async () => undefined,
    notify: () => {},
    runProcess: async () => ({ exitCode: 0, stdout: review(PASS), stderr: "", killed: false, timedOut: false }),
    ...overrides,
  };
}

function withTask(deps: WorkflowDeps, options: { state?: "implementing" | "reviewing"; qa?: "pass" | "changes_required" } = {}): Task {
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "Add pagination");
  createTaskDir(deps.root, deps.configDir, task);
  const until = options.state ?? "reviewing";
  for (const step of FLOW) {
    transition(task, step);
    if (step === until) break;
  }
  task.domains = ["backend"];
  task.plan = "## Objective\nAdd pagination.\n## Domains\nbackend\n## Files\nsrc/api/users.ts\n## Sequence\n1\n## Dependencies\nnone\n## Testing\nunit\n## Acceptance Criteria\nworks\n## Rollback\nrevert\n## Review\npeer";
  if (options.qa) task.qaVerdict = options.qa;
  saveTask(deps.root, deps.configDir, task);
  return task;
}

function act(deps: WorkflowDeps, params: Partial<OrchestrateParams>) {
  return runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);
}

test("completionBlockers lists every unmet gate", () => {
  const task = createTask("TASK-1", "x");
  assert.deepEqual(completionBlockers(task, 0), ["no approved plan is recorded", "QA gate is not run"]);
  task.plan = "plan";
  task.domains = ["backend"];
  task.qaVerdict = "pass";
  assert.deepEqual(completionBlockers(task, 0), []);
  assert.deepEqual(completionBlockers(task, 2), ["2 unresolved approval request(s)"]);
  task.blockers.push({ domain: "backend", reason: "x", tried: [], need: "y", createdAt: "now" });
  assert.deepEqual(completionBlockers(task, 0), ["1 unresolved blocker(s)"]);
});

test("qa runs the gate, records the verdict, and reports a pass", async () => {
  const deps = makeDeps();
  withTask(deps);
  const result = await act(deps, { action: "qa" });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state, "reviewing");
  assert.match(result.message, /QA gate: PASS/);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.qaVerdict, "pass");
});

test("a failing QA gate tells the Master to send work back", async () => {
  const runner: ProcessRunner = async () => ({ exitCode: 0, stdout: review(FAIL), stderr: "", killed: false, timedOut: false });
  const deps = makeDeps({ runProcess: runner });
  withTask(deps);
  const result = await act(deps, { action: "qa" });
  assert.match(result.message, /QA gate: CHANGES_REQUIRED/);
  assert.match(result.message, /re-run action=qa/);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.qaVerdict, "changes_required");
});

test("qa is accepted from implementing and transitions to reviewing", async () => {
  const deps = makeDeps();
  withTask(deps, { state: "implementing" });
  const result = await act(deps, { action: "qa" });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state, "reviewing");
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.reviewIterations.qa, 1);
});

test("a failing QA gate iterates until the review limit, then blocks", async () => {
  const runner: ProcessRunner = async () => ({ exitCode: 0, stdout: review(FAIL), stderr: "", killed: false, timedOut: false });
  const deps = makeDeps({ runProcess: runner });
  withTask(deps, { state: "implementing" });
  const first = await act(deps, { action: "qa" });
  assert.match(first.message, /re-run action=qa/);
  const second = await act(deps, { action: "qa" });
  assert.match(second.message, /mark the task blocked/);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.reviewIterations.qa, 2);
});

test("complete is refused until every gate passes", async () => {
  const deps = makeDeps();
  withTask(deps, { qa: "changes_required" });
  const result = await act(deps, { action: "complete" });
  assert.equal(result.ok, false);
  assert.match(result.message, /cannot complete/);
  assert.match(result.message, /QA gate is changes_required/);
  assert.doesNotMatch(result.message, /accepted review/);
});

test("complete records history, clears scratchpads, and finishes the task", async () => {
  const deps = makeDeps();
  withTask(deps, { qa: "pass" });
  const taskDir = taskDirFor(deps.root, deps.configDir, "TASK-1");
  assert.ok(existsSync(join(taskDir, "proposal.md")));

  const result = await act(deps, { action: "complete", text: "Added pagination to the users endpoint." });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state, "completed");
  assert.ok(!existsSync(join(taskDir, "proposal.md")), "scratchpads are removed");
  assert.ok(existsSync(join(taskDir, "state.json")), "the completion record is kept");

  const log = readFileSync(join(knowledgeDir(dataRoot(deps.root, deps.configDir), "backend"), "completed-tasks.md"), "utf8");
  assert.match(log, /TASK-1: Added pagination/);
});

test("a completed task rejects further workflow actions", async () => {
  const deps = makeDeps();
  withTask(deps, { qa: "pass" });
  await act(deps, { action: "complete" });
  const result = await act(deps, { action: "implement", domain: "backend", task: "more" });
  assert.equal(result.ok, false);
  assert.match(result.message, /already completed/);
});

test("qa and complete are rejected outside implementing/reviewing", async () => {
  const deps = makeDeps();
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "x");
  createTaskDir(deps.root, deps.configDir, task);
  transition(task, "clarifying");
  saveTask(deps.root, deps.configDir, task);
  const qa = await act(deps, { action: "qa" });
  assert.equal(qa.ok, false);
  const complete = await act(deps, { action: "complete" });
  assert.equal(complete.ok, false);
  assert.match(complete.message, /not allowed in state/);
});

test("legacy per-domain review state still loads and completes after a qa pass", async () => {
  const deps = makeDeps();
  withTask(deps);
  const statePath = join(taskDirFor(deps.root, deps.configDir, "TASK-1"), "state.json");
  const legacy = {
    ...JSON.parse(readFileSync(statePath, "utf8")),
    reviewIterations: { designer: 1, backend: 1, qa: 0 },
    reviewRecords: [{ domain: "backend", verdict: "pass", findings: [], requiredChanges: [], createdAt: "2026-01-01T00:00:00.000Z" }],
  };
  writeFileSync(statePath, JSON.stringify(legacy));

  const qa = await act(deps, { action: "qa" });
  assert.equal(qa.ok, true, qa.message);
  const complete = await act(deps, { action: "complete" });
  assert.equal(complete.ok, true, complete.message);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.equal(task.state, "completed");
  assert.deepEqual(task.reviewIterations, { qa: 1 });
});

test("each action records its finished runs in the task's run log and the Master's report", async () => {
  const deps = makeDeps();
  withTask(deps);
  const result = await act(deps, { action: "qa" });
  assert.equal(result.runs?.length, 1);
  assert.match(result.message, /\n\nRuns:\n- ✓ QA reviewer · /);
  const saved = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.equal(saved.runLog?.length, 1);
  assert.equal(saved.runLog![0]!.role, "reviewer");
  assert.equal(saved.runLog![0]!.status, "success");
  const again = await act(deps, { action: "qa" });
  assert.equal(again.runs?.length, 1);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.runLog?.length, 2);
  const status = await act(deps, { action: "status" });
  assert.ok(!status.message.includes("Runs:"), "actions without subagents carry no footer");
});

function reviewer(outputs: string[], prompts: string[] = []): ProcessRunner {
  let index = 0;
  return async (args) => {
    const file = args[args.indexOf("--append-system-prompt") + 1];
    if (file) prompts.push(readFileSync(file, "utf8"));
    const text = outputs[Math.min(index++, outputs.length - 1)]!;
    return { exitCode: 0, stdout: review(text), stderr: "", killed: false, timedOut: false };
  };
}

const MINOR = "## Verdict\nCHANGES_REQUIRED\n\n## Findings\n- [minor] rename the helper\n- [info] a comment is stale\n\n## Verification\n- `npm test` — 160/160 passing\n\n## Required Changes\n- rename the helper";

test("a round with only minor findings passes, its asks kept as follow-ups", async () => {
  const deps = makeDeps({ runProcess: reviewer([MINOR]) });
  withTask(deps);
  const result = await act(deps, { action: "qa" });
  assert.match(result.message, /QA gate: PASS \(run success\) — only minor findings/);
  assert.match(result.message, /Follow-ups \(not blocking[^\n]*\n- rename the helper/);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.qaVerdict, "pass");
  const untagged = makeDeps({ runProcess: reviewer([MINOR.replace("[minor] ", "")]) });
  withTask(untagged);
  assert.match((await act(untagged, { action: "qa" })).message, /QA gate: CHANGES_REQUIRED/, "an untagged finding may be serious: it still blocks");
  const unchecked = makeDeps({ runProcess: reviewer([MINOR.replace(/## Verification\n[^\n]*\n/, "")]) });
  withTask(unchecked);
  assert.match((await act(unchecked, { action: "qa" })).message, /QA gate: CHANGES_REQUIRED/, "without executed checks nothing passes");
});

test("a re-review is given what the last round asked for, and verifies it instead of starting over", async () => {
  const prompts: string[] = [];
  const deps = makeDeps({ runProcess: reviewer([FAIL, PASS], prompts) });
  withTask(deps);
  await act(deps, { action: "qa" });
  assert.doesNotMatch(prompts[0]!, /This is QA round/);
  await act(deps, { action: "qa" });
  assert.match(prompts[1]!, /This is QA round 2\. Round 1 \(CHANGES_REQUIRED\) asked for:\n- \[major\] regression in the empty state\n- handle empty list\nVerify each of these first/);
});

test("at the review limit the user decides: accept the work, one more round, or leave it blocked", async () => {
  const choose = (answer: string | undefined, seen: string[] = []) => async (title: string, options: string[]) => (seen.push(title), options.find((option) => option.startsWith(answer ?? "\0")));
  const titles: string[] = [];
  const accepting = makeDeps({ runProcess: reviewer([FAIL]), choose: choose("Accept", titles) });
  withTask(accepting, { state: "implementing" });
  await act(accepting, { action: "qa" });
  const second = await act(accepting, { action: "qa" });
  assert.match(titles[0]!, /QA has not passed TASK-1 after 2 rounds[\s\S]*- \[major\] regression in the empty state/);
  assert.match(second.message, /The user accepted the work as it is[^\n]*action=complete/);
  const task = loadTask(accepting.root, accepting.configDir, "TASK-1")!;
  assert.deepEqual(task.qaWaiver?.open, ["[major] regression in the empty state", "handle empty list"]);
  const done = await act(accepting, { action: "complete", text: "Shipped with QA's last asks noted." });
  assert.equal(done.ok, true, done.message);
  assert.equal(titles.length, 1, "completing asks nothing more");

  const again = makeDeps({ runProcess: reviewer([FAIL]), choose: choose("Run one more") });
  withTask(again, { state: "implementing" });
  await act(again, { action: "qa" });
  assert.match((await act(again, { action: "qa" })).message, /re-run action=qa/);
  assert.equal(loadTask(again.root, again.configDir, "TASK-1")!.extraReviewRounds, 1);
  assert.match((await act(again, { action: "qa" })).message, /The QA gate did not pass|mark the task blocked/);

  const leave = makeDeps({ runProcess: reviewer([FAIL]), choose: choose("Leave") });
  withTask(leave, { state: "implementing" });
  await act(leave, { action: "qa" });
  assert.match((await act(leave, { action: "qa" })).message, /mark the task blocked[^\n]*\/bot-lobby accept/);

  const unattended: string[] = [];
  const auto = makeDeps({ runProcess: reviewer([FAIL]), choose: choose("Accept", unattended) });
  withTask(auto, { state: "implementing" });
  const { setAutoMode } = await import("../src/state/auto.ts");
  setAutoMode(auto.root, auto.configDir, "TASK-1", true);
  await act(auto, { action: "qa" });
  assert.match((await act(auto, { action: "qa" })).message, /mark the task blocked/);
  assert.equal(unattended.length, 0, "auto mode has nobody to ask");
});

test("told to finish without a QA pass, the oracle completes only once the user confirms, even from blocked", async () => {
  const titles: string[] = [];
  let answer = "Not yet";
  const deps = makeDeps({ runProcess: reviewer([FAIL]), choose: async (title, options) => (titles.push(title), options.find((option) => option === answer)) });
  withTask(deps, { state: "implementing" });
  await act(deps, { action: "qa" });
  await act(deps, { action: "block", reason: "QA review limit reached" });
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.state, "blocked");
  const refused = await act(deps, { action: "complete" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /the user did not accept its work/);
  assert.match(titles[0]!, /Complete TASK-1 without a QA pass\? QA ran 1 round; the last said CHANGES_REQUIRED/);
  answer = "Complete it anyway";
  const done = await act(deps, { action: "complete", text: "Done as the user asked." });
  assert.equal(done.ok, true, done.message);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.equal(task.state, "completed");
  assert.ok(task.decisions.some((decision) => /The user accepted the work without a QA pass \(when the oracle completed it\)[\s\S]*Cleared blockers: QA review limit reached/.test(decision.text)));
});

test("a task resumed after the review limit asks the user again when QA still fails", async () => {
  const titles: string[] = [];
  const deps = makeDeps({ runProcess: reviewer([FAIL]), choose: async (title) => (titles.push(title), undefined) });
  withTask(deps, { state: "implementing" });
  await act(deps, { action: "qa" });
  await act(deps, { action: "qa" });
  await act(deps, { action: "block", reason: "review limit" });
  await act(deps, { action: "resume" });
  await act(deps, { action: "qa" });
  assert.equal(titles.length, 2, "each round past the limit is the user's call");
  assert.match(titles[1]!, /after 3 rounds/);
});

test("the plan keeps its acceptance criteria and testing when cut for length", async () => {
  const { planWithin } = await import("../src/workflow/workflow.ts");
  const plan = ["## Objective\nShip it.", `## Steps\n${"1. a long step\n".repeat(400)}`, "## Files\nsrc/a.ts", "## Testing\nunit tests", "## Acceptance Criteria\n- users can log in"].join("\n");
  const cut = planWithin(plan, 1000);
  assert.match(cut, /## Objective\nShip it\./);
  assert.match(cut, /## Acceptance Criteria\n- users can log in/);
  assert.match(cut, /## Testing\nunit tests/);
  assert.match(cut, /## Files\nsrc\/a\.ts/);
  assert.match(cut, /\[Left out for length: Steps\. The whole plan is plan\.md in the task folder\.\]$/);
  assert.equal(planWithin("## Objective\nshort", 1000), "## Objective\nshort");
});

/* ------------------------------------------------------------ the QA risk */

/** A repository with a README and an auth module, committed; the task's work starts from its HEAD. */
function repoTask(prompts: string[]): { deps: WorkflowDeps; dir: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bl-qa-risk-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  mkdirSync(join(dir, "src/auth"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# App\n");
  writeFileSync(join(dir, "src/auth/reset.ts"), "export function reset(password: string) {\n  return password;\n}\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  const deps = makeDeps({ root: dir, cwd: dir, runProcess: reviewer([PASS], prompts) });
  const task = withTask(deps);
  task.baseline = { at: new Date().toISOString(), files: [], head };
  saveTask(deps.root, deps.configDir, task);
  return { deps, dir };
}

test("QA scales with the change: nothing that runs passes on the engine's checks, a security change gets a deep review", async () => {
  const prompts: string[] = [];
  const { deps, dir } = repoTask(prompts);
  writeFileSync(join(dir, "README.md"), `# App\n\n${"How to reset a password.\n".repeat(200)}`);
  const docs = await act(deps, { action: "qa" });
  assert.match(docs.message, /^QA gate: PASS on the engine's checks; no QA agent ran\. QA risk: none \(rules\)/);
  assert.equal(prompts.length, 0, "no QA agent for documentation");
  const passed = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.deepEqual([passed.qaVerdict, passed.qaRisk?.risk, passed.qaRisk?.qaRequired], ["pass", "none", false]);

  writeFileSync(join(dir, "src/auth/reset.ts"), "export function reset(password: string) {\n  if (password.length < 8) throw new Error(\"too short\");\n  return password;\n}\n");
  const auth = await act(deps, { action: "qa" });
  assert.match(auth.message, /QA gate: PASS \(run success\)\nQA risk: high \(rules\) · 2-6 new tests at most · security/);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]!, /## QA risk: HIGH \(the engine's rules\)\nDepth: deep and adversarial\. Test budget: 2-6 new behavioural tests at most — a ceiling, never a quota/);
  assert.match(prompts[0]!, /security: src\/auth\/reset\.ts \("password"\)/);
  assert.match((await act(deps, { action: "status" })).message, /QA risk: high \(rules\)/, "the status carries it");
});
