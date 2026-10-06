/**
 * Resuming a task from the Tasks screen, without moving this window. A paused
 * task is unpaused where it runs (this window, a background session, another
 * terminal) and its oracle told to carry on. A task no running session drives
 * carries on in a new background session: its old session started again from
 * its file when there is one (the oracle keeps its conversation), else a fresh
 * session that takes the task over (`/bot-lobby carry-on`).
 */
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";

/** The sessions that could be driving a task, as this window sees them. */
export interface Drivers {
  /** This window's session. */
  me?: string;
  /** Sessions this window runs in the background, alive. */
  background: ReadonlySet<string>;
  /** Tasks a background session of this window was started to carry on (it may not have its id yet). */
  carrying: ReadonlySet<string>;
  /** Sessions running in other terminals. */
  live: ReadonlySet<string>;
}

export type Where = "here" | "background" | "elsewhere";

export type ResumeRoute =
  | { kind: "finished" }
  /** Under way and not paused: nothing to resume. */
  | { kind: "running"; where: Where }
  | { kind: "paused"; where: Where }
  /** No running session drives it. */
  | { kind: "stopped" };

function drivenFrom(task: Task, drivers: Drivers): Where | undefined {
  const owner = task.ownerSessionId;
  if (owner && owner === drivers.me) return "here";
  if ((owner && drivers.background.has(owner)) || drivers.carrying.has(task.id)) return "background";
  if (owner && drivers.live.has(owner)) return "elsewhere";
  return undefined;
}

export function resumeRoute(task: Task, drivers: Drivers): ResumeRoute {
  if (TERMINAL_STATES.includes(task.state)) return { kind: "finished" };
  const where = drivenFrom(task, drivers);
  if (!where) return { kind: "stopped" };
  return { kind: task.paused ? "paused" : "running", where };
}

/** Whether the Tasks screen offers Resume: the task is paused, or nothing runs it. */
export function resumable(task: Task, drivers: Drivers): boolean {
  const { kind } = resumeRoute(task, drivers);
  return kind === "paused" || kind === "stopped";
}

/** The decision a task records when it carries on in a new session. */
export const RESUMED_DECISION = "resumed from the Tasks screen in a background session; the session that drove it had stopped (steps that were running stopped with it)";

/** What the oracle is told when its task is resumed. */
export function carryOnMessage(task: Pick<Task, "id" | "state">, after: "paused" | "stopped"): string {
  if (after === "paused") {
    return `bot-lobby: the user resumed ${task.id} (${task.state}) from the Tasks screen. Carry on: read where it stands with the orchestrate tool (action=status) and go on from there.`;
  }
  return [
    `bot-lobby: the user resumed ${task.id} (${task.state}) from the Tasks screen; the session that drove it had stopped.`,
    "Pick up where it left off: read where the task stands with the orchestrate tool (action=status), run again any step that was cut off (its agent stopped with that session, and its edits may be half done), ask again any question that was not answered, and carry on.",
  ].join(" ");
}
