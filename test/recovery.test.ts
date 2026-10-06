import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessOutcome, ProcessRunner } from "../src/execution/pi-runner.ts";
import { PlanningSession, STOPPED_WITH_PI, type PlanningSnapshot } from "../src/lobby/planner.ts";
import { QuickFixQueue, INTERRUPTED_NOTE, type QuickFixJob } from "../src/lobby/quickfix.ts";
import { recover, stoppedJob, stoppedSnapshot, WindowKeeper, type Relaunch } from "../src/lobby/recovery.ts";
import type { BackgroundSession } from "../src/lobby/sessions.ts";
import { readSessionState, recoveryDir, stoppedWindows, writeSessionState } from "../src/state/recovery.ts";
import { createTask, type Task } from "../src/schemas/task.ts";
import { loadTask, saveTask } from "../src/state/persistence.ts";
import { blockPhaseTiming } from "../src/state/phase-timing.ts";

const temp = () => mkdtempSync(join(tmpdir(), "bl-recovery-"));
const DEAD_PID = 2147483646;

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/served", stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } });
}

/** A fake pi: answers `text`, or waits for the abort when `hang`. */
function runner(text: string, prompts: string[] = [], hang = false): ProcessRunner {
  return (_args, options) => {
    prompts.push(options.prompt ?? "");
    if (!hang) return Promise.resolve({ exitCode: 0, stdout: reply(text), stderr: "", killed: false, timedOut: false } satisfies ProcessOutcome);
    return new Promise((resolve) => options.signal?.addEventListener("abort", () => resolve({ exitCode: 1, stdout: "", stderr: "", killed: true, timedOut: false }), { once: true }));
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

const PLAN = "## Status\nREADY\n## Title\nDark mode\n## Plan\n### Steps\n1. Add the tokens";

function planner(root: string, run: ProcessRunner): PlanningSession {
  return new PlanningSession({ cwd: root, root, configDir: ".pi", panel: [], profile: () => ({ thinking: "high", timeoutMs: 60_000 }), runProcess: run });
}

test("a planning round pi stopped in the middle of comes back with the conversation and runs again", async () => {
  const root = temp();
  const first = planner(root, runner("", [], true));
  void first.send("add dark mode");
  await settle();
  assert.equal(first.busy, true);
  const kept: PlanningSnapshot = JSON.parse(JSON.stringify(first.snapshot()));
  assert.equal(kept.running, true, "the snapshot knows a round was running");

  const prompts: string[] = [];
  const restored = PlanningSession.restore({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "high", timeoutMs: 60_000 }), runProcess: runner(PLAN, prompts) }, kept);
  assert.equal(restored.interrupted, true);
  assert.deepEqual(restored.messages.map((message) => message.text), ["add dark mode"], "the user's message is still there");
  await restored.resume();
  assert.equal(prompts.length, 1, "the round ran again");
  assert.match(prompts[0]!, /add dark mode/);
  assert.equal(restored.reply?.plan?.includes("Add the tokens"), true);
  assert.equal(restored.turns, 1, "running it again does not use up a round");
  assert.equal(restored.interrupted, false);
  first.cancel();

  // A quit on purpose leaves the round stopped instead: retry runs it when the user wants.
  const stopped = stoppedSnapshot(kept);
  assert.equal(stopped.running, false);
  assert.match(stopped.error!, /retry runs the round again/);
  const quiet = PlanningSession.restore({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "high", timeoutMs: 60_000 }), runProcess: runner(PLAN) }, stopped);
  assert.equal(quiet.retryable, true);
  await quiet.resume();
  assert.equal(quiet.reply, undefined, "nothing ran on its own");
});

test("a quick fix pi cut off runs again first, told its edits may be half done; finished ones stay as they ended", async () => {
  const root = temp();
  const prompts: string[] = [];
  const queue = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "low", timeoutMs: 60_000 }), runProcess: runner("## Done", prompts) });
  const job = (id: string, status: QuickFixJob["status"], prompt: string): QuickFixJob => ({ id, prompt, status, createdAt: 1, steps: [{ at: 1, text: "editing a.ts", pending: true }], tools: 1, turns: 1, force: true });
  const running = queue.restore([job("QF-1", "success", "rename x"), job("QF-2", "running", "fix the header"), job("QF-3", "queued", "fix the footer")]);
  assert.deepEqual(running.map((entry) => entry.id), ["QF-2", "QF-3"]);
  await settle();
  assert.match(prompts[0]!, /fix the header/);
  assert.ok(prompts[0]!.includes(INTERRUPTED_NOTE));
  assert.equal(queue.jobs.find((entry) => entry.id === "QF-1")?.status, "success");
  assert.equal(queue.submit("another").id, "QF-4", "new jobs number on from the restored ones");
  queue.restore([job("QF-1", "failed", "from another window")]);
  assert.equal(new Set(queue.jobs.map((entry) => entry.id)).size, queue.jobs.length, "a second stopped window's ids never clash");
  assert.equal(stoppedJob(job("QF-5", "queued", "x")).status, "cancelled", "a quit cancels what was waiting");
});

/** A task some session drives, mid-implementation, waiting on a question that pi took down with it. */
function drivenTask(root: string, id: string, sessionId: string): Task {
  const task = createTask(id, `Task ${id}`, new Date().toISOString(), `request ${id}`, sessionId);
  task.state = "implementing";
  blockPhaseTiming(task, "request:lost");
  saveTask(root, ".pi", task);
  return task;
}

function stoppedWindow(root: string, record: Record<string, unknown>): void {
  const dir = join(recoveryDir(root, ".pi"), "windows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${DEAD_PID}-dead.json`), JSON.stringify({ pid: DEAD_PID, token: "dead", startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z", ...record }));
}

test("a window that stopped unexpectedly is carried on: its panel, its quick fixes, and every session driving a task", () => {
  const root = temp();
  drivenTask(root, "T-window", "S-window");
  drivenTask(root, "T-background", "S-background");
  drivenTask(root, "T-idle", "S-idle");
  const finished = createTask("T-done", "done", new Date().toISOString(), "done", "S-finished");
  finished.state = "completed";
  saveTask(root, ".pi", finished);
  stoppedWindow(root, {
    sessionId: "S-window",
    sessionFile: "/sessions/window.jsonl",
    working: true,
    background: [
      { sessionId: "S-background", sessionFile: "/sessions/background.jsonl", name: "Background task", working: true },
      { sessionId: "S-idle", sessionFile: "/sessions/idle.jsonl", name: "Waiting task", working: false },
      { sessionId: "S-finished", sessionFile: "/sessions/finished.jsonl", name: "Done task", working: true },
    ],
  });
  const snapshot = planner(root, runner("")).snapshot();
  writeSessionState(root, ".pi", "planner", "S-window", { ...snapshot, messages: [{ role: "you", text: "plan this", at: 1 }], running: true });
  writeSessionState(root, ".pi", "quickfix", "S-window", [{ id: "QF-1", prompt: "fix it", status: "running", createdAt: 1, steps: [], tools: 0, turns: 0 }]);

  const relaunched: Relaunch[] = [];
  const restored: PlanningSnapshot[] = [];
  const jobs: QuickFixJob[] = [];
  const nudges: string[] = [];
  const host = {
    root, configDir: ".pi", sessionId: "S-new",
    relaunch: (start: Relaunch) => { relaunched.push(start); return {} as BackgroundSession; },
    restorePlanner: (kept: PlanningSnapshot) => { restored.push(kept); },
    restoreQuickFixes: (kept: readonly QuickFixJob[]) => { jobs.push(...kept); return kept.length; },
    nudge: (message: string) => { nudges.push(message); },
  };
  const summary = recover(host);

  assert.equal(restored.length, 1, "the panel came back in the new window");
  assert.equal(restored[0]!.messages[0]!.text, "plan this");
  assert.equal(readSessionState(root, ".pi", "planner", "S-new") !== undefined, true, "and is now kept as the new window's");
  assert.deepEqual(jobs.map((job) => job.id), ["QF-1"]);
  assert.deepEqual(relaunched.map((start) => [start.taskId, start.sessionFile, Boolean(start.message)]), [
    ["T-window", "/sessions/window.jsonl", true],
    ["T-background", "/sessions/background.jsonl", true],
    ["T-idle", "/sessions/idle.jsonl", false],
  ], "each live task's session starts again; only those cut off mid-turn are nudged, and a finished task's is left");
  assert.match(relaunched[1]!.message!, /pi stopped unexpectedly while you were working on T-background \(implementing\)/);
  assert.deepEqual(nudges, [], "the new window drives none of them itself");

  const settled = loadTask(root, ".pi", "T-background")!;
  assert.deepEqual(settled.blockingRequestIds, [], "the question pi took down no longer reads as waiting");
  assert.match(settled.decisions.at(-1)!.text, /pi stopped unexpectedly/);
  assert.match(summary!, /carried on with the planning session, 1 quick fix and tasks T-window, T-background, T-idle/);
  assert.deepEqual(stoppedWindows(root, ".pi"), [], "the stopped window is taken, so no other window carries it on twice");
  assert.equal(recover(host), undefined, "nothing is left to carry on");
});

test("the same session started again carries its own task on itself", () => {
  const root = temp();
  drivenTask(root, "T-own", "S-same");
  stoppedWindow(root, { sessionId: "S-same", sessionFile: "/sessions/same.jsonl", working: true, background: [] });
  const relaunched: Relaunch[] = [];
  const nudges: string[] = [];
  const summary = recover({
    root, configDir: ".pi", sessionId: "S-same",
    relaunch: (start) => { relaunched.push(start); return {} as BackgroundSession; },
    restorePlanner: () => {},
    restoreQuickFixes: () => 0,
    nudge: (message) => { nudges.push(message); },
  });
  assert.deepEqual(relaunched, []);
  assert.equal(nudges.length, 1);
  assert.match(nudges[0]!, /T-own/);
  assert.match(summary!, /task T-own/);
});

test("the keeper keeps a window's work as it changes; a quit removes its record, a stop on a signal keeps it", async () => {
  const root = temp();
  let jobs: QuickFixJob[] = [{ id: "QF-1", prompt: "fix it", status: "running", createdAt: 1, steps: [], tools: 0, turns: 0 }];
  const session = planner(root, runner("", [], true));
  void session.send("plan this");
  await settle();
  const keeper = () => new WindowKeeper({
    root, configDir: ".pi",
    sessionId: () => "S-keep",
    sessionFile: () => "/sessions/keep.jsonl",
    working: () => true,
    planner: () => session,
    quickfix: () => jobs,
    background: () => [],
  });
  const crashing = keeper();
  crashing.window.flush();
  crashing.planner.schedule();
  crashing.quickfix.schedule();
  crashing.stop(true);
  const records = () => readdirSync(join(recoveryDir(root, ".pi"), "windows")).filter((file) => file.startsWith(`${process.pid}-`)).length;
  assert.equal(records(), 1, "a stop on a signal leaves the record for the next window");
  assert.equal((readSessionState(root, ".pi", "planner", "S-keep") as PlanningSnapshot).running, true);
  assert.equal((readSessionState(root, ".pi", "quickfix", "S-keep") as QuickFixJob[])[0]!.status, "running");

  const quitting = keeper();
  quitting.window.flush();
  quitting.stop(false);
  assert.equal(records(), 0, "a quit removes this window's record");
  assert.equal((readSessionState(root, ".pi", "planner", "S-keep") as PlanningSnapshot).running, false, "and leaves its round stopped");
  assert.equal((readSessionState(root, ".pi", "quickfix", "S-keep") as QuickFixJob[])[0]!.status, "cancelled");
  jobs = [];
  session.cancel();
  assert.equal(existsSync(root), true);
});

test("a seat that was thinking when pi stopped shows it until its round runs again", () => {
  const root = temp();
  const kept = { ...planner(root, runner("")).snapshot(), members: [{ member: "backend" as const, status: "thinking" as const, step: "reading a.ts" }], running: true };
  const restored = PlanningSession.restore({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "high", timeoutMs: 60_000 }) }, kept);
  assert.deepEqual(restored.members, [{ member: "backend", status: "failed", error: STOPPED_WITH_PI, step: undefined }]);
});
