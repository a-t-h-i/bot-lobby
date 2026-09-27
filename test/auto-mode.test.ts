import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type Task } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import { isAutoMode, setAutoMode } from "../src/state/auto.ts";
import { inboxMessage, markInboxDelivered, readInbox, sendToInbox } from "../src/state/inbox.ts";
import { autoNudge, autoStep, deliverInbox, driveAuto, MAX_IDLE_NUDGES, registerOwner, setAuto, startOwner, taskFingerprint, toggleOwnAuto } from "../src/pi/owner.ts";
import { masterTaskContext } from "../src/pi/events.ts";

const SESSION = "session-1";

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "bl-auto-"));
  ensureProjectStructure(root, ".pi");
  return root;
}

function ownedTask(root: string, states: Task["state"][] = ["clarifying"], extra: Partial<Task> = {}): Task {
  const task = { ...createTask("TASK-1", "Add login", "2026-09-27T10:00:00.000Z", "Add a login page", SESSION), ...extra };
  createTaskDir(root, ".pi", task);
  for (const state of states) transition(task, state);
  saveTask(root, ".pi", task);
  return task;
}

function deps(root: string, overrides: Partial<WorkflowDeps> = {}): WorkflowDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    root,
    configDir: ".pi",
    cwd: root,
    config: DEFAULT_CONFIG,
    ask: async (question) => void asked.push(question) as unknown as string,
    choose: async (title) => {
      asked.push(title);
      return undefined;
    },
    notify: () => {},
    ...overrides,
    asked,
  };
}

function act(workflow: WorkflowDeps, params: Partial<OrchestrateParams>) {
  return runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, workflow);
}

test("auto mode lives beside the task, readable and switchable from any session", () => {
  const root = project();
  ownedTask(root);
  assert.equal(isAutoMode(root, ".pi", "TASK-1"), false);
  setAutoMode(root, ".pi", "TASK-1", true, "other-session");
  assert.equal(isAutoMode(root, ".pi", "TASK-1"), true);
  setAutoMode(root, ".pi", "TASK-1", false);
  assert.equal(isAutoMode(root, ".pi", "TASK-1"), false);
  assert.equal(isAutoMode(root, ".pi", "TASK-missing"), false);
});

test("in auto mode the workflow never asks: clarify is decided by the oracle and the proposal is approved", async () => {
  const root = project();
  ownedTask(root, []);
  setAutoMode(root, ".pi", "TASK-1", true);
  const workflow = deps(root);
  const clarified = await act(workflow, { action: "clarify", question: "Email or username?", options: ["Email", "Username"] });
  assert.equal(workflow.asked.length, 0, "nobody is asked");
  assert.match(clarified.message, /Auto mode is on, so nobody will answer\. Do not ask the user/);
  const proposed = await act(workflow, { action: "propose", proposal: "- Add a login form." });
  assert.equal(workflow.asked.length, 0);
  assert.equal(proposed.state, "planning");
  assert.match(proposed.message, /No approval needed: auto mode is on/);
  const task = loadTask(root, ".pi", "TASK-1")!;
  assert.ok(task.decisions.some((decision) => /Not asked \(auto mode\): Email or username\?/.test(decision.text)));
  assert.ok(task.decisions.some((decision) => decision.text === "Proposal approved without asking (auto mode)."));
});

test("a task started from an agreed plan skips the approval; without auto or a plan the user is still asked", async () => {
  const root = project();
  ownedTask(root, ["clarifying"], { approvedPlan: "PLAN-login" });
  const workflow = deps(root);
  const proposed = await act(workflow, { action: "propose", proposal: "- Add a login form." });
  assert.equal(proposed.state, "planning");
  assert.match(proposed.message, /the user agreed this plan in the planning panel \(PLAN-login\)/);
  assert.equal(workflow.asked.length, 0);
  assert.match(masterTaskContext(loadTask(root, ".pi", "TASK-1")!), /agreed this task's plan in the planning panel \(PLAN-login\)/);

  const plain = project();
  ownedTask(plain);
  const asking = deps(plain);
  const pending = await act(asking, { action: "propose", proposal: "- Add a login form." });
  assert.equal(pending.state, "awaiting_approval");
  assert.equal(asking.asked.length, 1, "the proposal still goes to the user");
  assert.match(masterTaskContext(loadTask(plain, ".pi", "TASK-1")!, [], true), /AUTO MODE is on/);
});

test("the inbox holds messages for a task's oracle until its owner delivers them", () => {
  const root = project();
  ownedTask(root);
  assert.throws(() => sendToInbox(root, ".pi", "TASK-1", "   "), /needs some text/);
  const first = sendToInbox(root, ".pi", "TASK-1", "use port 8080", "other");
  sendToInbox(root, ".pi", "TASK-1", "and dark mode");
  assert.deepEqual(readInbox(root, ".pi", "TASK-1").map((message) => [message.text, message.delivered]), [["use port 8080", false], ["and dark mode", false]]);
  markInboxDelivered(root, ".pi", "TASK-1", [first.id]);
  assert.deepEqual(readInbox(root, ".pi", "TASK-1").map((message) => message.delivered), [true, false]);
  assert.equal(inboxMessage(readInbox(root, ".pi", "TASK-1")), "use port 8080\n\nand dark mode");
});

test("auto mode nudges an idle oracle, and stops after turns that change nothing", () => {
  const first = autoStep(undefined, "a");
  assert.deepEqual([first.nudge, first.track.idle], [true, 0]);
  let track = first.track;
  for (let index = 1; index < MAX_IDLE_NUDGES; index += 1) {
    const step = autoStep(track, "a");
    assert.equal(step.nudge, true);
    track = step.track;
  }
  const stalled = autoStep(track, "a");
  assert.deepEqual([stalled.nudge, stalled.stalledNow], [false, true]);
  assert.equal(autoStep(stalled.track, "a").stalledNow, false, "it says so once");
  assert.equal(autoStep(stalled.track, "b").nudge, true, "progress resets the budget");
  const task = createTask("TASK-9", "x");
  const moved = { ...task, decisions: [{ domain: "master" as const, text: "d", createdAt: "" }] };
  assert.notEqual(taskFingerprint(task), taskFingerprint(moved));
  assert.match(autoNudge(task), /Auto mode: TASK-9 is created\. Keep driving it to completion/);
});

function fakeSession(root: string, idle = true) {
  const sent: Array<{ text: string; options?: unknown }> = [];
  const notes: string[] = [];
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => unknown>>();
  const shortcuts: string[] = [];
  const pi = {
    on: (event: string, handler: (event: any, ctx: ExtensionContext) => unknown) => void handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    sendUserMessage: (text: string, options?: unknown) => void sent.push({ text, options }),
    registerShortcut: (key: string) => void shortcuts.push(key),
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: root,
    isIdle: () => idle,
    sessionManager: { getSessionId: () => SESSION },
    ui: { notify: (message: string) => void notes.push(message) },
  } as unknown as ExtensionContext;
  return { pi, ctx, sent, notes, handlers, shortcuts };
}

test("the owner delivers inbox messages and keeps an auto-mode oracle going until it stalls", () => {
  const root = project();
  ownedTask(root);
  const session = fakeSession(root);
  startOwner(session.pi, session.ctx, ".pi", 0);
  sendToInbox(root, ".pi", "TASK-1", "use port 8080", "other");
  assert.equal(deliverInbox(), 1);
  assert.deepEqual(session.sent, [{ text: "use port 8080", options: undefined }]);
  assert.equal(deliverInbox(), 0, "delivered once");

  assert.equal(driveAuto(), false, "auto mode is off");
  assert.equal(toggleOwnAuto(), "auto mode on for TASK-1: the oracle drives it to completion without asking you");
  assert.match(session.sent.at(-1)!.text, /^Auto mode: TASK-1 is clarifying/, "switching it on starts the idle oracle at once");
  for (let index = 1; index < MAX_IDLE_NUDGES; index += 1) assert.equal(driveAuto(), true);
  assert.equal(driveAuto(), false, "no progress after the budget: it stops");
  assert.match(session.notes.at(-1)!, /no progress on TASK-1 after 3 nudges; it needs you/);
  setAuto(root, ".pi", "TASK-1", false);
  assert.equal(driveAuto(), false);
  assert.equal(toggleOwnAuto(), "auto mode on for TASK-1: the oracle drives it to completion without asking you");
});

test("in auto mode ask_user_question is blocked with a reason, and the auto key is registered", async () => {
  const root = project();
  ownedTask(root);
  const session = fakeSession(root, false);
  registerOwner(session.pi, ".pi");
  for (const handler of session.handlers.get("session_start") ?? []) await handler({}, session.ctx);
  assert.ok(session.shortcuts.includes("alt+g"));
  const call = async (toolName: string) => {
    for (const handler of session.handlers.get("tool_call") ?? []) return handler({ toolName }, session.ctx);
    return undefined;
  };
  assert.equal(await call("ask_user_question"), undefined, "off: the question goes through");
  setAutoMode(root, ".pi", "TASK-1", true);
  assert.deepEqual(await call("ask_user_question"), { block: true, reason: "Auto mode is on for TASK-1: nobody will answer. Decide this yourself from the request, the plan and your reconnaissance, record the decision, and continue." });
  assert.equal(await call("read"), undefined, "other tools are untouched");
  assert.equal(driveAuto(), false, "a busy oracle is not nudged");
  for (const handler of session.handlers.get("session_shutdown") ?? []) await handler({}, session.ctx);
});
