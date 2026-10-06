/**
 * Carrying on after pi stops unexpectedly. A window running the lobby keeps
 * what it is doing on disk as it changes: its planning panel and quick-fix
 * queue (by session), and a record of the sessions it drives and whether each
 * was mid-turn (src/state/recovery.ts). Quitting on purpose removes the
 * record; a crash, a kill or a closed terminal leaves it.
 *
 * The next window to start the lobby in the project takes the stopped
 * windows over: the planning panel comes back where it was (a round that was
 * cut off runs again), queued quick fixes run (the one cut off runs again),
 * and every session that drove a task still under way is started again from
 * its saved file, its oracle told to pick up where it stopped when it was
 * mid-turn. A window that is that same session again (`pi -c`) carries its
 * own task on itself. Nothing here runs in a subagent or a background session.
 */
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { loadTask, ownedTask, saveTask } from "../state/persistence.ts";
import { resolvePhaseTiming } from "../state/phase-timing.ts";
import { updateBudget } from "../state/budget.ts";
import { clearStaleRuns } from "../state/work-time.ts";
import { livePresence } from "../state/presence.ts";
import {
  claimStoppedWindows,
  moveSessionState,
  readSessionState,
  removeSessionState,
  removeWindow,
  stoppedWindows,
  writeSessionState,
  writeWindow,
  type BackgroundRecord,
  type WindowRecord,
} from "../state/recovery.ts";
import { isPlanningSnapshot, type PlanningSession, type PlanningSnapshot } from "./planner.ts";
import { keepPlan } from "../state/plan-history.ts";
import type { QuickFixJob } from "./quickfix.ts";
import type { BackgroundSession } from "./sessions.ts";

/** Writes after a change wait this long, so a burst of changes is one write. */
export const SAVE_DELAY_MS = 300;
/** How long after the lobby starts this window's own interrupted turn is picked back up. */
export const NUDGE_DELAY_MS = 1500;

/** What the oracle is told when the session it was working in stopped mid-turn. */
export function resumeMessage(task: Task): string {
  return [
    `bot-lobby: pi stopped unexpectedly while you were working on ${task.id} (${task.state}${task.paused ? ", paused" : ""}).`,
    "Pick up where you left off: read where the task stands with the orchestrate tool (action=status), run again any step that was cut off (its agent stopped with pi, and its edits may be half done), ask again any question that was not answered, and carry on.",
  ].join(" ");
}

/** A task a stopped session drove that is still under way, or undefined. */
function liveTask(root: string, configDir: string, sessionId: string): Task | undefined {
  const task = ownedTask(root, configDir, sessionId);
  return task && !TERMINAL_STATES.includes(task.state) ? task : undefined;
}

const INTERRUPTED_DECISION = "pi stopped unexpectedly; the task carried on in the next session (steps that were running stopped with it)";

/**
 * Clear what the stopped process left marked as under way on a task: the
 * questions it was waiting on (they no longer wait), the time given to the
 * steps it was running, and the runs it noted as active. A decision records
 * the stop, so the task's history says what happened.
 */
export function settleInterrupted(root: string, configDir: string, taskId: string, now = new Date(), note = INTERRUPTED_DECISION): void {
  const task = loadTask(root, configDir, taskId);
  if (!task) return;
  const at = now.toISOString();
  for (const id of [...(task.blockingRequestIds ?? task.phaseTiming?.blockingRequestIds ?? [])]) resolvePhaseTiming(task, id, at);
  task.decisions.push({ domain: "master", text: note, createdAt: at });
  task.updatedAt = at;
  saveTask(root, configDir, task);
  updateBudget(root, configDir, taskId, (budget) => {
    for (const allotment of budget.allotments) {
      if (allotment.endedAt) continue;
      allotment.endedAt = at;
      allotment.outcome = "stopped";
    }
  });
  clearStaleRuns(root, configDir, taskId);
}

/** A session to start again from its saved file. */
export interface Relaunch {
  name: string;
  sessionFile: string;
  taskId: string;
  /** The nudge it gets once up, when it was mid-turn. */
  message?: string;
}

/** What the window starting the lobby can carry on from the windows that stopped. */
export interface RecoveryPlan {
  windows: WindowRecord[];
  /** Kept state to hand to this session, from the newest stopped window that has it. */
  planner?: { from: string };
  quickfix: string[];
  relaunch: Relaunch[];
  /** This window is the stopped one's session again, and its task is under way. */
  own?: { taskId: string; message?: string };
}

/**
 * Decide what carries on: pure but for reads, so a test can check it. The
 * stopped windows are claimed first (`claimStoppedWindows`), so only one
 * window acts on each.
 */
export function planRecovery(input: {
  root: string;
  configDir: string;
  sessionId: string;
  windows: readonly WindowRecord[];
  /** Sessions running now in some terminal: never started a second time. */
  running: ReadonlySet<string>;
}): RecoveryPlan {
  const { root, configDir, sessionId } = input;
  const plan: RecoveryPlan = { windows: [...input.windows], quickfix: [], relaunch: [] };
  const hasOwnPlanner = isPlanningSnapshot(readSessionState(root, configDir, "planner", sessionId));
  const seen = new Set<string>();
  const consider = (session: { sessionId: string; sessionFile?: string; name?: string; working: boolean }) => {
    if (seen.has(session.sessionId) || input.running.has(session.sessionId)) return;
    seen.add(session.sessionId);
    const task = liveTask(root, configDir, session.sessionId);
    if (!task) return;
    const message = session.working && !task.paused ? resumeMessage(task) : undefined;
    if (session.sessionId === sessionId) {
      plan.own = { taskId: task.id, ...(message ? { message } : {}) };
      return;
    }
    if (!session.sessionFile) return;
    plan.relaunch.push({ name: session.name ?? task.title, sessionFile: session.sessionFile, taskId: task.id, ...(message ? { message } : {}) });
  };
  for (const window of input.windows) {
    if (!hasOwnPlanner && !plan.planner && window.sessionId !== sessionId && isPlanningSnapshot(readSessionState(root, configDir, "planner", window.sessionId))) {
      plan.planner = { from: window.sessionId };
    }
    if (window.sessionId !== sessionId && Array.isArray(readSessionState(root, configDir, "quickfix", window.sessionId))) plan.quickfix.push(window.sessionId);
    consider({ sessionId: window.sessionId, ...(window.sessionFile ? { sessionFile: window.sessionFile } : {}), working: window.working });
    for (const background of window.background) consider(background);
  }
  return plan;
}

/** What `recover` needs of the lobby: its paths and session, and how to act. */
export interface RecoveryHost {
  root: string;
  configDir: string;
  sessionId: string;
  /** Start a stopped session again in the background from its saved file. */
  relaunch(start: Relaunch): BackgroundSession | string;
  /** Restore the planning panel from a snapshot (and run again a round it cut off). */
  restorePlanner(snapshot: PlanningSnapshot): void;
  /** Take up quick-fix jobs a stopped process left; returns how many will run. */
  restoreQuickFixes(jobs: readonly QuickFixJob[]): number;
  /** Send this window's oracle the nudge, once it is idle. */
  nudge(message: string): void;
}

/** What carried on, in words, or undefined when nothing did. */
export function recoverySummary(parts: { planner: boolean; quickfixes: number; tasks: string[] }): string | undefined {
  const done = [
    parts.planner ? "the planning session" : "",
    parts.quickfixes > 0 ? `${parts.quickfixes} quick fix${parts.quickfixes === 1 ? "" : "es"}` : "",
    parts.tasks.length > 0 ? `${parts.tasks.length === 1 ? "task" : "tasks"} ${parts.tasks.join(", ")}` : "",
  ].filter(Boolean);
  if (done.length === 0) return undefined;
  const list = done.length === 1 ? done[0]! : `${done.slice(0, -1).join(", ")} and ${done.at(-1)}`;
  return `pi stopped unexpectedly — carried on with ${list}`;
}

/**
 * Carry on what the stopped windows were doing, and this session's own kept
 * planning panel and quick-fix queue. Returns the summary to show, if any.
 */
export function recover(host: RecoveryHost): string | undefined {
  const { root, configDir, sessionId } = host;
  const windows = claimStoppedWindows(root, configDir);
  let running = new Set<string>();
  try {
    running = new Set(livePresence(root, configDir).map((presence) => presence.sessionId));
  } catch {
    // Unreadable heartbeats only mean nothing is ruled out.
  }
  running.delete(sessionId);
  const plan = planRecovery({ root, configDir, sessionId, windows, running });

  if (plan.planner) moveSessionState(root, configDir, "planner", plan.planner.from, sessionId);
  const snapshot = readSessionState(root, configDir, "planner", sessionId);
  const planner = isPlanningSnapshot(snapshot);
  if (planner) host.restorePlanner(snapshot);

  const jobs: QuickFixJob[] = [];
  for (const from of [sessionId, ...plan.quickfix]) {
    const kept = readSessionState(root, configDir, "quickfix", from);
    if (Array.isArray(kept)) jobs.push(...(kept as QuickFixJob[]));
    if (from !== sessionId) removeSessionState(root, configDir, "quickfix", from);
  }
  const quickfixes = jobs.length > 0 ? host.restoreQuickFixes(jobs) : 0;

  const tasks: string[] = [];
  for (const start of plan.relaunch) {
    settleInterrupted(root, configDir, start.taskId);
    const session = host.relaunch(start);
    if (typeof session !== "string") tasks.push(start.taskId);
  }
  if (plan.own) {
    settleInterrupted(root, configDir, plan.own.taskId);
    if (plan.own.message) host.nudge(plan.own.message);
    tasks.push(plan.own.taskId);
  }
  // A restart after a quit restores the panel quietly; only carrying on after a stop is announced.
  return windows.length > 0 ? recoverySummary({ planner, quickfixes, tasks }) : undefined;
}

/** Whether a window in this project stopped without quitting: the lobby then starts on, to carry its work on. */
export function workToCarryOn(root: string, configDir: string): boolean {
  try {
    return stoppedWindows(root, configDir).length > 0;
  } catch {
    return false;
  }
}

/** A write that waits a moment, so a burst of changes is one write; `flush` writes now. */
export class Debounced {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private readonly write: () => void;
  private readonly delayMs: number;
  constructor(write: () => void, delayMs = SAVE_DELAY_MS) {
    this.write = write;
    this.delayMs = delayMs;
  }

  schedule(): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.run();
    }, this.delayMs);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.closed) this.run();
  }

  /** Write once more, then never again (the lobby is stopping). */
  close(): void {
    this.flush();
    this.closed = true;
  }

  /** Never write again, not even what is waiting. */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.closed = true;
  }

  private run(): void {
    try {
      this.write();
    } catch {
      // A read-only project only means the work does not carry on after a crash.
    }
  }
}

/** What a window keeps on disk while the lobby runs, so the next window can carry it on. */
export interface KeeperSource {
  root: string;
  configDir: string;
  sessionId: () => string;
  sessionFile: () => string | undefined;
  /** This window's oracle is mid-turn. */
  working: () => boolean;
  planner: () => PlanningSession | undefined;
  quickfix: () => readonly QuickFixJob[];
  background: () => readonly BackgroundSession[];
}

/**
 * Keeps this window's record, planning panel and quick-fix queue on disk as
 * they change, for the next window to carry on after a stop.
 */
export class WindowKeeper {
  private readonly startedAt = new Date().toISOString();
  readonly window: Debounced;
  readonly planner: Debounced;
  readonly quickfix: Debounced;
  /** pi going down on an uncaught error skips the shutdown: what is waiting is written as the process exits. */
  private readonly onExit = () => {
    for (const writer of [this.planner, this.quickfix, this.window]) writer.close();
  };
  private readonly source: KeeperSource;
  constructor(source: KeeperSource) {
    this.source = source;
    process.once("exit", this.onExit);
    this.window = new Debounced(() => writeWindow(source.root, source.configDir, this.record()));
    this.planner = new Debounced(() => {
      const session = source.planner();
      if (session) this.keepPlanner(session, session.snapshot());
    });
    this.quickfix = new Debounced(() => {
      const jobs = source.quickfix();
      if (jobs.length > 0) writeSessionState(source.root, source.configDir, "quickfix", source.sessionId(), jobs);
      else removeSessionState(source.root, source.configDir, "quickfix", source.sessionId());
    });
  }

  /** The panel as this window's (to carry on) and among the project's plans (to read again later). */
  private keepPlanner(session: PlanningSession, snapshot: PlanningSnapshot): void {
    writeSessionState(this.source.root, this.source.configDir, "planner", this.source.sessionId(), snapshot);
    keepPlan(this.source.root, this.source.configDir, session.id, session.createdAt, snapshot);
  }

  private record(): Omit<WindowRecord, "pid" | "token" | "updatedAt"> {
    const file = this.source.sessionFile();
    return {
      sessionId: this.source.sessionId(),
      ...(file ? { sessionFile: file } : {}),
      working: this.source.working(),
      background: backgroundRecords(this.source.background(), this.source.root),
      startedAt: this.startedAt,
    };
  }

  /**
   * The lobby is stopping. `carryOn` (pi stopped on a signal, or is going
   * down unexpectedly) keeps everything as it stands for the next window; a
   * stop on purpose (quit, switching sessions, turning bot-lobby off) records
   * what was running as stopped and removes the window's record.
   */
  stop(carryOn: boolean): void {
    process.off("exit", this.onExit);
    if (carryOn) {
      this.planner.close();
      this.quickfix.close();
      this.window.close();
      return;
    }
    const { root, configDir } = this.source;
    const sessionId = this.source.sessionId();
    try {
      const session = this.source.planner();
      if (session) this.keepPlanner(session, stoppedSnapshot(session.snapshot()));
      const jobs = this.source.quickfix().map(stoppedJob);
      if (jobs.length > 0) writeSessionState(root, configDir, "quickfix", sessionId, jobs);
      else removeSessionState(root, configDir, "quickfix", sessionId);
      removeWindow(root, configDir);
    } catch {
      // A read-only project keeps nothing.
    }
    for (const writer of [this.planner, this.quickfix, this.window]) writer.cancel();
  }
}

/** What a stop on purpose leaves of a planning round: stopped, and retryable. */
export function stoppedSnapshot(snapshot: PlanningSnapshot): PlanningSnapshot {
  if (!snapshot.running) return snapshot;
  return { ...snapshot, running: false, members: snapshot.members.map((member) => member.status === "thinking" ? { ...member, status: "failed", error: "stopped" } : member), error: STOPPED_ROUND };
}

/** What a stop on purpose leaves of a quick fix that was queued or running: cancelled. */
export function stoppedJob(job: QuickFixJob): QuickFixJob {
  if (job.status !== "queued" && job.status !== "running") return job;
  return { ...job, status: "cancelled", note: "stopped when the lobby stopped", ...(job.finishedAt ? {} : { finishedAt: Date.now() }) };
}

/** A round stopped by a quit, as the Plan tab shows it. */
export const STOPPED_ROUND = "stopped when the lobby stopped — retry runs the round again";

/** The background sessions worth carrying on: running, saved to a file, in this project. */
export function backgroundRecords(sessions: readonly BackgroundSession[], root: string): BackgroundRecord[] {
  return sessions
    .filter((session) => session.alive && session.sessionId && session.sessionFile && (!session.projectRoot || session.projectRoot === root))
    .map((session) => ({ sessionId: session.sessionId!, sessionFile: session.sessionFile!, name: session.name, working: session.busy || session.dialogs.length > 0 }));
}

/**
 * Whether pi is stopping on a signal (a closed terminal, a kill) rather than a
 * quit the user asked for: such a stop carries on in the next window. pi turns
 * both into the same `quit` shutdown, so the signal is heard here first. When
 * pi's own handlers are gone, the signal is passed on, so it still stops pi.
 */
let signalled = false;
let listening = false;

export function stoppingOnSignal(): boolean {
  return signalled;
}

export function listenForSignals(): void {
  if (listening) return;
  listening = true;
  const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGTERM"] : ["SIGTERM", "SIGHUP"];
  for (const signal of signals) {
    const handler = () => {
      signalled = true;
      if (process.listenerCount(signal) > 1) return;
      process.off(signal, handler);
      process.kill(process.pid, signal);
    };
    process.on(signal, handler);
  }
}

/** Forget a heard signal (tests). */
export function resetSignals(): void {
  signalled = false;
}
