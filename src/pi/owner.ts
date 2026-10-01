/**
 * What a session does on its own clock. Every few seconds a session (in the
 * terminal or headless, started from another window's lobby) refreshes its
 * heartbeat so other windows see it running, passes on what other sessions
 * left for its oracle — plan comments, messages for its task or for the
 * session itself — and in auto mode keeps the oracle going whenever its turn
 * ends before the task is done. Subagents never own tasks or show up as
 * sessions, so none of this runs in them.
 */
import type { KeyId } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { peekOwnedTask } from "../state/persistence.ts";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
import { commentMessage, markCommentsDelivered, readPlanComments, undeliveredComments } from "../state/comments.ts";
import { inboxMessage, markInboxDelivered, markSessionInboxDelivered, readInbox, readSessionInbox } from "../state/inbox.ts";
import { removePresence, writePresence } from "../state/presence.ts";
import { currentWebServer } from "../webui/server.ts";
import { isAutoMode, setAutoMode } from "../state/auto.ts";
import { isSubagentProcess } from "./quiet.ts";
import { isMinimized } from "./ui.ts";

/** How often the owning session looks for comments, messages and auto-mode work. */
export const OWNER_POLL_MS = 3000;
/** Auto mode stops nudging after this many nudged turns in a row that left the task unchanged. */
export const MAX_IDLE_NUDGES = 3;
/** The default key that switches auto mode; `lobby.keys.toggleAuto` rebinds it. */
export const AUTO_KEY = "alt+g";

export type OwnerEvent =
  | { kind: "comments" | "inbox"; taskId: string; count: number }
  | { kind: "messages"; count: number }
  | { kind: "auto"; taskId: string; on: boolean }
  | { kind: "nudge"; taskId: string }
  | { kind: "stalled"; taskId: string };

interface Owner {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  /** The session this clock runs for, kept so its heartbeat can be removed after its context goes stale. */
  sessionId: string;
  root: string;
  configDir: string;
  timer?: ReturnType<typeof setInterval>;
  auto?: AutoTrack;
  /** The session's task as this tick read it: one read serves the whole tick. */
  tick?: { task: Task | undefined };
}

let owner: Owner | undefined;
let listener: ((event: OwnerEvent) => void) | undefined;

/** Hear what the owner did (the lobby logs it in its activity feed). */
export function onOwnerEvent(fn: ((event: OwnerEvent) => void) | undefined): void {
  listener = fn;
}

function ownTask(state: Owner): Task | undefined {
  if (state.tick) return state.tick.task;
  return peekOwnedTask(state.root, state.configDir, state.ctx.sessionManager.getSessionId());
}

function live(task: Task | undefined): task is Task {
  return Boolean(task && !TERMINAL_STATES.includes(task.state));
}

/** Pass new plan comments on this session's task to its Master (held while minimized or paused). */
export function deliverComments(): number {
  const state = owner;
  if (!state || isMinimized()) return 0;
  const task = ownTask(state);
  if (!live(task) || task.paused) return 0;
  const fresh = undeliveredComments(readPlanComments(state.root, state.configDir, task.id));
  if (fresh.length === 0) return 0;
  state.pi.sendUserMessage(commentMessage(task.id, fresh, Boolean(task.plan)), state.ctx.isIdle() ? undefined : { deliverAs: "steer" });
  markCommentsDelivered(state.root, state.configDir, task.id, fresh.map((comment) => comment.id));
  listener?.({ kind: "comments", taskId: task.id, count: fresh.length });
  return fresh.length;
}

/** Pass messages other sessions left for this session's task to its Master, as if typed here. */
export function deliverInbox(): number {
  const state = owner;
  if (!state) return 0;
  const task = ownTask(state);
  if (!live(task)) return 0;
  const fresh = readInbox(state.root, state.configDir, task.id).filter((message) => !message.delivered);
  if (fresh.length === 0) return 0;
  state.pi.sendUserMessage(inboxMessage(fresh), state.ctx.isIdle() ? undefined : { deliverAs: "steer" });
  markInboxDelivered(state.root, state.configDir, task.id, fresh.map((message) => message.id));
  listener?.({ kind: "inbox", taskId: task.id, count: fresh.length });
  return fresh.length;
}

/** Pass messages other sessions left for this session itself (it may have no task) to its Master. */
export function deliverSessionInbox(): number {
  const state = owner;
  if (!state) return 0;
  const sessionId = state.ctx.sessionManager.getSessionId();
  const fresh = readSessionInbox(state.root, state.configDir, sessionId).filter((message) => !message.delivered);
  if (fresh.length === 0) return 0;
  state.pi.sendUserMessage(inboxMessage(fresh), state.ctx.isIdle() ? undefined : { deliverAs: "steer" });
  markSessionInboxDelivered(state.root, state.configDir, sessionId, fresh.map((message) => message.id));
  listener?.({ kind: "messages", count: fresh.length });
  return fresh.length;
}

/** Tell other windows this session is running: its name, file, task and process. */
export function heartbeat(): void {
  const state = owner;
  if (!state) return;
  const name = state.pi.getSessionName?.();
  const sessionFile = state.ctx.sessionManager.getSessionFile?.();
  const task = ownTask(state);
  try {
    writePresence(state.root, state.configDir, {
      sessionId: state.ctx.sessionManager.getSessionId(),
      pid: process.pid,
      mode: state.ctx.mode ?? "tui",
      ...(name ? { name } : {}),
      ...(sessionFile ? { sessionFile } : {}),
      ...(live(task) ? { taskId: task.id } : {}),
      ...(currentWebServer() ? { webPort: currentWebServer()!.port } : {}),
    });
  } catch {
    // A read-only project only means other windows do not see this one.
  }
}

/** What auto mode remembers between nudges: the task as it was, and how many nudges changed nothing. */
export interface AutoTrack {
  fingerprint: string;
  idle: number;
  stalled: boolean;
}

/** Everything a workflow step changes, cheaply: two equal fingerprints mean the oracle made no progress. */
export function taskFingerprint(task: Task): string {
  return [
    task.state,
    task.paused,
    task.updatedAt,
    task.proposal?.length ?? 0,
    task.plan?.length ?? 0,
    task.decisions.length,
    task.approvals.length,
    task.blockers.length,
    task.reviewRecords.length,
    task.workerRuns?.length ?? 0,
    task.runLog?.length ?? 0,
  ].join("|");
}

/**
 * Whether to nudge an idle oracle in auto mode. Each nudge that leaves the
 * task unchanged counts; after `MAX_IDLE_NUDGES` of them auto mode stalls
 * (and says so once) until the task changes again.
 */
export function autoStep(previous: AutoTrack | undefined, fingerprint: string): { nudge: boolean; track: AutoTrack; stalledNow: boolean } {
  const idle = previous && previous.fingerprint === fingerprint ? previous.idle + 1 : 0;
  if (idle >= MAX_IDLE_NUDGES) {
    return { nudge: false, track: { fingerprint, idle, stalled: true }, stalledNow: !previous?.stalled };
  }
  return { nudge: true, track: { fingerprint, idle, stalled: false }, stalledNow: false };
}

export function autoNudge(task: Task): string {
  return `Auto mode: ${task.id} is ${task.state}. Keep driving it to completion with the orchestrate tool: decide anything open yourself and record it. Do not wait for me.`;
}

/** In auto mode, start the idle oracle's next turn (unless it keeps making no progress). */
export function driveAuto(): boolean {
  const state = owner;
  if (!state || isMinimized()) return false;
  const task = ownTask(state);
  if (!live(task) || task.paused || !isAutoMode(state.root, state.configDir, task.id)) {
    state.auto = undefined;
    return false;
  }
  if (!state.ctx.isIdle()) return false;
  const step = autoStep(state.auto, taskFingerprint(task));
  state.auto = step.track;
  if (step.stalledNow) {
    listener?.({ kind: "stalled", taskId: task.id });
    state.ctx.ui.notify(`bot-lobby: auto mode — the oracle made no progress on ${task.id} after ${MAX_IDLE_NUDGES} nudges; it needs you.`, "warning");
  }
  if (!step.nudge) return false;
  state.pi.sendUserMessage(autoNudge(task));
  listener?.({ kind: "nudge", taskId: task.id });
  return true;
}

/** Switch auto mode for a task; switching it on for this session's own idle task starts the oracle at once. */
export function setAuto(root: string, configDir: string, taskId: string, on: boolean, by?: string): void {
  setAutoMode(root, configDir, taskId, on, by);
  listener?.({ kind: "auto", taskId, on });
  const state = owner;
  if (!state || state.root !== root) return;
  const task = ownTask(state);
  if (task?.id !== taskId) return;
  state.auto = undefined;
  if (on) driveAuto();
}

/** Switch auto mode for this session's task; returns the notice to show. */
export function toggleOwnAuto(): string {
  const state = owner;
  if (!state) return "bot-lobby is not running in this session";
  const task = ownTask(state);
  if (!live(task)) return "no active task in this session — auto mode applies to a task";
  const on = !isAutoMode(state.root, state.configDir, task.id);
  setAuto(state.root, state.configDir, task.id, on, state.ctx.sessionManager.getSessionId());
  return on ? `auto mode on for ${task.id}: the oracle drives it to completion without asking you` : `auto mode off for ${task.id}: the oracle asks you again`;
}

/** One tick of the owner's clock. */
export function ownerTick(): void {
  const state = owner;
  if (!state) return;
  state.tick = { task: ownTask(state) };
  try {
    heartbeat();
    deliverComments();
    deliverInbox();
    deliverSessionInbox();
    driveAuto();
  } finally {
    state.tick = undefined;
  }
}

function stop(): void {
  if (owner?.timer) clearInterval(owner.timer);
  if (owner) {
    try {
      removePresence(owner.root, owner.configDir, owner.sessionId);
    } catch {
      // The heartbeat goes stale on its own.
    }
  }
  owner = undefined;
}

/** Start the owner's clock for this session (called on session_start; exported for tests). */
export function startOwner(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string, pollMs = OWNER_POLL_MS): void {
  stop();
  if (isSubagentProcess()) return;
  owner = { pi, ctx, sessionId: ctx.sessionManager.getSessionId(), root: detectProjectRoot(ctx.cwd, configDir), configDir };
  heartbeat();
  if (pollMs > 0) {
    owner.timer = setInterval(() => ownerTick(), pollMs);
    owner.timer.unref?.();
  }
}

export function registerOwner(pi: ExtensionAPI, configDir: string): void {
  if (isSubagentProcess()) return;
  const track = (ctx: ExtensionContext) => {
    if (owner) owner.ctx = ctx;
  };
  pi.on("session_start", (_event, ctx) => startOwner(pi, ctx, configDir));
  pi.on("session_shutdown", () => stop());
  pi.on("agent_start", (_event, ctx) => track(ctx));
  pi.on("agent_end", (_event, ctx) => track(ctx));
  // Auto mode has nobody to answer a question: tell the oracle to decide instead.
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "ask_user_question" || !owner) return undefined;
    const task = peekOwnedTask(owner.root, owner.configDir, ctx.sessionManager.getSessionId());
    if (!live(task) || !isAutoMode(owner.root, owner.configDir, task.id)) return undefined;
    return { block: true, reason: `Auto mode is on for ${task.id}: nobody will answer. Decide this yourself from the request, the plan and your reconnaissance, record the decision, and continue.` };
  });
  pi.registerShortcut((loadConfig().lobby.keys.toggleAuto ?? AUTO_KEY) as KeyId, {
    description: "bot-lobby: switch auto mode for this session's task",
    handler: (ctx) => ctx.ui.notify(`bot-lobby: ${toggleOwnAuto()}`, "info"),
  });
}
