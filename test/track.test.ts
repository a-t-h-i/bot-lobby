import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskTrack, type TaskTriage, type TrackPath } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask, taskDirFor } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { completionBlockers } from "../src/master/decisions.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import { chooseTrack, parseRoster, qaStillDue, qaWorkerCameLast, readRequest, trackLine, trackSummary } from "../src/workflow/track.ts";
import { kickoff } from "../src/pi/start-task.ts";
import { parseCommand } from "../src/pi/commands.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

const LENIENT = { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, briefCheck: false } };

const ON = { fastTrack: true };

function read(request: string, options: { fastTrack: boolean; forced?: TrackPath; approvedPlan?: boolean } = ON, triage?: TaskTriage): TaskTrack {
  return chooseTrack(request, triage, options, "2026-01-01T00:00:00.000Z");
}

test("small, clear requests take the fast track with only the agents they need", () => {
  const colour = read("change the submit button colour to blue");
  assert.equal(colour.path, "fast");
  assert.equal(colour.size, "trivial");
  assert.deepEqual(colour.roster, ["designer"], "a frontend tweak: DESIGN alone, no tests, no research");

  const typo = read("fix the typo in the README");
  assert.equal(typo.path, "fast");
  assert.deepEqual(typo.roster, [], "docs: the oracle picks the domain that owns the file");

  const redirect = read("fix the login redirect after sign in");
  assert.equal(redirect.path, "fast");
  assert.deepEqual(redirect.roster, ["backend", "qa"], "a backend bug fix brings QA for its regression test");

  const testOnly = read("add a unit test for parseMinutes in src/state/budget.ts");
  assert.equal(testOnly.path, "fast");
  assert.deepEqual(testOnly.roster, ["qa"], "the change is its tests");

  const research = read("check the latest Tailwind docs and fix the deprecated class on the header");
  assert.equal(research.path, "fast");
  assert.deepEqual(research.roster, ["designer", "qa", "researcher"], "outside facts bring the researcher");
  assert.equal(research.source, "rules");
});

test("bigger, serious or unclear requests take the full workflow, which always ends with QA", () => {
  const feature = read("add a login page");
  assert.equal(feature.path, "full");
  assert.equal(feature.size, "medium");
  assert.ok(feature.roster.includes("qa"));
  assert.match(feature.reasons.join("; "), /medium: new capability \(add a login page\)/);

  const password = read("let users change their password from the profile menu");
  assert.equal(password.path, "full", "small, but it touches passwords");
  assert.match(password.reasons.join("; "), /serious: touches password/);

  assert.equal(read("store sessions in redis").path, "full", "new infrastructure");
  assert.deepEqual(read("return 404 instead of 500 when the user is missing").roster, ["backend", "qa"], "it replaces existing behavior");
  const additive = read("print the server version at startup");
  assert.equal(additive.path, "fast");
  assert.deepEqual(additive.roster, ["backend"], "a small, additive backend change is left to the worker's checks and the lint gate");
  assert.equal(read("upgrade react to the latest version").path, "full", "an upgrade is more than a small change");
  assert.ok(read("upgrade react to the latest version").roster.includes("researcher"));
  assert.equal(read("rewrite the settings screen from scratch").size, "large");
  assert.match(read("why is the lobby slow?").reasons.join("; "), /unclear: asks to investigate/);
  assert.match(read("dark mode").reasons.join("; "), /unclear: too short/);
  assert.equal(read("improve the error messages").path, "full", "vague and names nothing concrete");
  assert.equal(read("clean up unused imports in src/text.ts").path, "fast", "a named file is concrete");
  const long = Array.from({ length: 70 }, (_value, index) => `word${index}`).join(" ");
  assert.equal(readRequest(long).size, "medium");
  assert.equal(readRequest("- a\n- b\n- c\n- d").size, "medium", "several requirements");
});

test("the user, a planned task and the settings decide the path over the rules", () => {
  const full = read("change the submit button colour to blue", { fastTrack: true, forced: "full" });
  assert.equal(full.path, "full");
  assert.equal(full.source, "user");
  assert.equal(full.userChoice, "full");
  const fast = read("rewrite the settings screen from scratch", { fastTrack: true, forced: "fast" });
  assert.equal(fast.path, "fast");
  assert.equal(fast.userChoice, "fast");
  assert.equal(read("change the button colour", { fastTrack: true, approvedPlan: true }).source, "plan");
  const off = read("change the button colour", { fastTrack: false });
  assert.equal(off.path, "full");
  assert.match(off.reasons[0]!, /off in settings/);
  assert.equal(resolveConfig({}).workflow.fastTrack, true);
  assert.equal(resolveConfig({ workflow: { fastTrack: false } }).workflow.fastTrack, false);
});

test("the classifier's triage refines size, domains and clarity; risk still means the full workflow", () => {
  const triage = (overrides: Partial<TaskTriage> = {}): TaskTriage => ({ size: "small", sizeConfidence: 0.9, domains: { designer: 0.9, backend: 0.1, qa: 0.2 }, research: 0.1, ambiguous: 0.1, at: "2026-01-01T00:00:00Z", ...overrides });
  const fast = read("make the lobby tab show the task's track", ON, triage());
  assert.equal(fast.path, "fast");
  assert.equal(fast.source, "classifier");
  assert.deepEqual(fast.roster, ["designer"]);
  assert.match(fast.reasons[0]!, /^classifier: small \(0\.90\)/);
  assert.deepEqual(read("make the lobby tab show the task's track", ON, triage({ domains: { designer: 0.9, qa: 0.8 }, research: 0.7 })).roster, ["designer", "qa", "researcher"]);
  assert.equal(read("make the lobby tab show the task's track", ON, triage({ ambiguous: 0.7 })).path, "full");
  assert.equal(read("make the lobby tab show the task's track", ON, triage({ size: "large" })).path, "full");
  assert.equal(read("store the password hash in the lobby tab", ON, triage()).path, "full", "the rules' risk stands");
  assert.equal(read("add a login page", ON, triage({ sizeConfidence: 0.4 })).size, "medium", "an unsure size leaves the rules' size");
});

test("roster names accept the lobby's words and reject anything else", () => {
  assert.deepEqual(parseRoster(["qa", "frontend", "research", "dev"]), ["designer", "backend", "qa", "researcher"]);
  assert.throws(() => parseRoster(["ops"]), /not a roster member/);
});

/* ------------------------------------------------------------ the engine */

function message(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

/** Reads as a worker's report and as a passing QA verdict, so one fake serves every run. */
const WORKER = ["## Completed", "Changed the colour.", "", "## Files Changed", "- `src/ui/button.css` — blue", "", "## Verdict", "PASS", "", "## Verification", "- `npm test` — passing"].join("\n");
const DEPENDENT = [WORKER, "", "## Dependencies Needed", "- a colour library"].join("\n");

function makeDeps(runs: string[], overrides: Partial<WorkflowDeps> = {}): WorkflowDeps {
  const root = mkdtempSync(join(tmpdir(), "bl-track-"));
  const runner: ProcessRunner = async (args) => {
    runs.push(String(args.at(-1)));
    return { exitCode: 0, stdout: message(WORKER), stderr: "", killed: false, timedOut: false };
  };
  return { root, configDir: ".pi", cwd: root, config: LENIENT, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess: runner, ...overrides };
}

function withTask(deps: WorkflowDeps, request: string, options: { fastTrack: boolean; forced?: TrackPath } = ON): Task {
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "task", "2026-01-01T00:00:00.000Z", request);
  task.track = read(request, options);
  createTaskDir(deps.root, deps.configDir, task);
  transition(task, "clarifying");
  saveTask(deps.root, deps.configDir, task);
  return task;
}

function act(deps: WorkflowDeps, params: Partial<OrchestrateParams>) {
  return runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);
}

test("a fast task goes straight to its worker and completes without scouts, a proposal or a QA gate", async () => {
  const runs: string[] = [];
  const deps = makeDeps(runs);
  withTask(deps, "change the submit button colour to blue");
  const built = await act(deps, { action: "implement", domain: "designer", task: "Step 1: make the submit button blue" });
  assert.equal(built.ok, true, built.message);
  assert.equal(built.state, "implementing");
  assert.match(built.message, /Next \(fast track\).*action=complete\. No QA gate/);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.match(task.plan!, /^## Steps\n1\. DESIGN: make the submit button blue\n\n## Objective\n/, "the engine keeps the plan: its steps, the delegations, come first");
  assert.equal(task.track!.autoPlan, true);
  assert.ok(existsSync(join(taskDirFor(deps.root, deps.configDir, "TASK-1"), "plan.md")));
  assert.match(task.decisions.map((decision) => decision.text).join("\n"), /Fast track: started without a proposal round/);

  const done = await act(deps, { action: "complete", text: "Blue button." });
  assert.equal(done.ok, true, done.message);
  assert.equal(done.state, "completed");
  assert.equal(runs.length, 1, "one agent run: the worker");
});

test("QA takes part in a fast task that needs tests: as the last step, or through the gate", async () => {
  const runs: string[] = [];
  const deps = makeDeps(runs);
  withTask(deps, "the save button crashes when the name is empty");
  assert.deepEqual(loadTask(deps.root, deps.configDir, "TASK-1")!.track!.roster, ["designer", "qa"]);
  await act(deps, { action: "implement", domain: "designer", task: "Step 1: guard the empty name" });
  const early = await act(deps, { action: "complete" });
  assert.equal(early.ok, false);
  assert.match(early.message, /QA has not taken part/);

  const tests = await act(deps, { action: "implement", domain: "qa", task: "add a regression test for the empty name" });
  assert.match(tests.message, /QA has taken part \(its step came last\)/);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.match(task.plan!, /^## Steps\n1\. DESIGN: guard the empty name\n2\. QA: add a regression test for the empty name\n\n## Objective\n/);
  const done = await act(deps, { action: "complete" });
  assert.equal(done.ok, true, done.message);
  assert.equal(runs.length, 2, "no QA gate on top of QA's own step");

  // The gate is the other way in.
  const gated = makeDeps([]);
  withTask(gated, "the save button crashes when the name is empty");
  await act(gated, { action: "implement", domain: "designer", task: "Step 1: guard the empty name" });
  assert.match((await act(gated, { action: "qa" })).message, /QA gate: PASS/);
  assert.equal((await act(gated, { action: "complete" })).state, "completed");
});

test("a retried step is not added twice, and a fast task cannot complete before any work", async () => {
  const deps = makeDeps([]);
  withTask(deps, "change the submit button colour to blue");
  assert.match((await act(deps, { action: "complete" })).message, /not allowed in state "clarifying"/);
  await act(deps, { action: "implement", domain: "designer", task: "Step 1: make it blue" });
  await act(deps, { action: "implement", domain: "designer", task: "Step 1: make it blue, again" });
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.plan!.match(/^\d+\./gm)!.length, 1);

  const task = createTask("TASK-2", "x");
  task.track = read("change the submit button colour to blue");
  task.plan = "## Steps\n1. x";
  assert.deepEqual(completionBlockers(task, 0), ["no worker step has finished yet"]);
});

test("on the full workflow implement waits for approval, and the oracle may take the fast track instead", async () => {
  const deps = makeDeps([]);
  withTask(deps, "add a login page");
  const refused = await act(deps, { action: "implement", domain: "designer", task: "build it" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /the user approves a proposal first \(a small, clear change can take the fast track: action=track track=fast\)/);
  assert.equal((await act(deps, { action: "track", track: "fast" })).ok, false, "a reason is required");
  const switched = await act(deps, { action: "track", track: "fast", roster: ["designer"], reason: "the page exists; this is one link" });
  assert.equal(switched.ok, true, switched.message);
  assert.match(switched.message, /^Fast track: DESIGN \(frontend\)\. Delegate straight away/);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.equal(task.track!.source, "oracle");
  assert.deepEqual(task.track!.roster, ["designer"]);
  assert.equal((await act(deps, { action: "implement", domain: "designer", task: "Step 1: add the link" })).state, "implementing");
  assert.match((await act(deps, { action: "track" })).message, /^Track: fast track \(medium; set by oracle\)/);
});

test("the fast track is never taken against the user's --full, the settings, or once work is planned", async () => {
  const forced = makeDeps([]);
  withTask(forced, "change the submit button colour to blue", { fastTrack: true, forced: "full" });
  assert.match((await act(forced, { action: "track", track: "fast", reason: "tiny" })).message, /the user asked for the full workflow/);

  const off = makeDeps([], { config: resolveConfig({ workflow: { fastTrack: false, briefCheck: false } }) });
  withTask(off, "change the submit button colour to blue", { fastTrack: false });
  assert.match((await act(off, { action: "track", track: "fast", reason: "tiny" })).message, /off in settings/);

  const planned = makeDeps([]);
  const task = withTask(planned, "add a login page");
  for (const state of ["awaiting_approval", "planning"] as const) transition(task, state);
  saveTask(planned.root, planned.configDir, task);
  assert.match((await act(planned, { action: "track", track: "fast", reason: "small" })).message, /before its work is planned; this one is planning/);
});

test("once work is under way a fast task only gets stricter: the full workflow's gate, and QA never dropped", async () => {
  const deps = makeDeps([]);
  withTask(deps, "the save button crashes when the name is empty");
  await act(deps, { action: "implement", domain: "designer", task: "Step 1: guard the empty name" });
  assert.match((await act(deps, { action: "track", roster: ["designer"], reason: "no tests" })).message, /QA stays on the roster/);
  const grown = await act(deps, { action: "track", track: "full", reason: "the form's state is shared with the API" });
  assert.equal(grown.ok, true, grown.message);
  assert.match(grown.message, /Full workflow from here.*QA gate runs before the task completes; tell the user in one line why the task grew/);
  assert.match((await act(deps, { action: "complete" })).message, /not allowed in state "implementing" \(expected: reviewing, blocked\)/, "the full workflow completes from review");
  assert.match((await act(deps, { action: "qa" })).message, /PASS/);
  assert.equal((await act(deps, { action: "complete" })).state, "completed");
});

test("a fast task whose worker asks for a dependency gets QA", async () => {
  const deps = makeDeps([], { runProcess: async () => ({ exitCode: 0, stdout: message(DEPENDENT), stderr: "", killed: false, timedOut: false }) });
  withTask(deps, "change the submit button colour to blue");
  const result = await act(deps, { action: "implement", domain: "designer", task: "Step 1: make it blue" });
  assert.match(result.message, /QA now takes part/);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.deepEqual(task.track!.roster, ["designer", "qa"]);
  assert.match(task.decisions.map((decision) => decision.text).join("\n"), /QA joined the fast track: DESIGN asked for a colour library/);
});

test("a fast task whose change turns out to touch security gets QA before it completes", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bl-track-git-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/form.ts"), "export const label = \"Save\";\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  const runs: string[] = [];
  // The request reads as a colour change; what the worker built checks a password.
  const deps = makeDeps(runs, {
    root: dir,
    cwd: dir,
    runProcess: async (args) => {
      runs.push(String(args.at(-1)));
      writeFileSync(join(dir, "src/form.ts"), "export const label = \"Save\";\nexport const valid = (password: string) => password.length >= 8;\n");
      return { exitCode: 0, stdout: message(WORKER), stderr: "", killed: false, timedOut: false };
    },
  });
  withTask(deps, "change the submit button colour to blue");
  await act(deps, { action: "implement", domain: "designer", task: "Step 1: make it blue" });
  const held = await act(deps, { action: "complete" });
  assert.equal(held.ok, false);
  assert.match(held.message, /QA joins before completion: QA risk: high \(rules\)[^\n]*Run action=qa, then complete/);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.deepEqual(task.track!.roster, ["designer", "qa"]);
  assert.match((await act(deps, { action: "qa" })).message, /QA gate: PASS/);
  assert.equal((await act(deps, { action: "complete" })).state, "completed");
});

test("QA's part comes last only when it started after the other domains finished; the budget reserve follows", () => {
  const task = createTask("TASK-1", "x");
  task.track = read("the save button crashes when the name is empty");
  const run = (domain: "designer" | "qa", startedAt: string, finishedAt: string) => ({ runId: `${domain}-${startedAt}`, domain, instruction: "", status: "success" as const, startedAt, finishedAt });
  task.workerRuns = [run("designer", "2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z"), run("qa", "2026-01-01T00:01:00Z", "2026-01-01T00:06:00Z")];
  assert.equal(qaWorkerCameLast(task), false, "a parallel QA run did not see the finished change");
  assert.equal(qaStillDue(task), true);
  task.workerRuns.push(run("qa", "2026-01-01T00:07:00Z", "2026-01-01T00:09:00Z"));
  assert.equal(qaWorkerCameLast(task), true);
  assert.equal(qaStillDue(task), false);

  task.track = read("change the submit button colour to blue");
  task.workerRuns = [];
  assert.equal(qaStillDue(task), false, "no QA on the roster: nothing is kept back for it");
  task.track = read("add a login page");
  assert.equal(qaStillDue(task), true, "the full workflow keeps the gate's reserve until it passes");
  task.qaVerdict = "pass";
  assert.equal(qaStillDue(task), false);
});

/* ------------------------------------------------------------ what the oracle and the user see */

test("the kickoff follows the track", () => {
  const fastTask = createTask("TASK-1", "blue button", "2026-01-01T00:00:00.000Z", "change the submit button colour to blue");
  fastTask.track = read(fastTask.request);
  const fast = kickoff(fastTask);
  assert.match(fast, /Track: fast track \(trivial; set by rules\) · who takes part: DESIGN \(frontend\)/);
  assert.match(fast, /1\. Delegate now with orchestrate action=implement: domain designer; open each task with "Step 1:"/);
  assert.match(fast, /No QA gate on this track/);
  assert.doesNotMatch(fast, /Do not implement anything before the user approves/);

  const researched = createTask("TASK-2", "x", "2026-01-01T00:00:00.000Z", "check the latest Tailwind docs and fix the deprecated class on the header");
  researched.track = read(researched.request);
  assert.match(kickoff(researched), /1\. First summon the researcher[\s\S]*2\. Delegate now[\s\S]*3\. QA takes part[\s\S]*4\. Check `git diff --stat`/);

  const fullTask = createTask("TASK-3", "login", "2026-01-01T00:00:00.000Z", "add a login page");
  fullTask.track = read(fullTask.request);
  const full = kickoff(fullTask);
  assert.match(full, /Do not implement anything before the user approves the proposal\.\nIf it is in fact a small, clear, low-risk change, take the fast track instead/);
  fullTask.track = read(fullTask.request, { fastTrack: true, forced: "full" });
  assert.doesNotMatch(kickoff(fullTask), /take the fast track instead/, "the user asked for the full workflow");
  assert.doesNotMatch(kickoff(createTask("TASK-4", "legacy")), /Track:/);
  assert.equal(trackLine(fastTask.track), "track: fast · trivial · DESIGN · rules");
  assert.match(trackSummary(fullTask.track), /^Track: full workflow \(medium; set by user\)/);
});

test("--fast and --full start a task on that path", () => {
  assert.deepEqual(parseCommand("--fast fix the typo"), { sub: undefined, rest: [], restText: "fix the typo", track: "fast" });
  assert.deepEqual(parseCommand("--full --auto --budget 30m change it"), { sub: undefined, rest: [], restText: "change it", track: "full", auto: true, budget: 30 });
});

test("the status and the oracle's context carry the track", async () => {
  const deps = makeDeps([]);
  withTask(deps, "change the submit button colour to blue");
  assert.match((await act(deps, { action: "status" })).message, /Track: fast track \(trivial; set by rules\) · who takes part: DESIGN \(frontend\) · why: trivial: colour/);
  assert.match(readFileSync(join(taskDirFor(deps.root, deps.configDir, "TASK-1"), "state.json"), "utf8"), /"path": "fast"/);
});
