import { TERMINAL_STATES, type Task, type TaskState } from "../schemas/task.ts";

export interface TimingProjection {
  phase: string;
  elapsedMs: number;
  runningSince?: string;
  waiting: boolean;
  serverNow: string;
}

function elapsed(task: Task, now: string): number {
  const timing = task.phaseTiming;
  if (!timing) return 0;
  const delta = timing.runningSince ? Date.parse(now) - Date.parse(timing.runningSince) : 0;
  return timing.elapsedMs + (Number.isFinite(delta) ? Math.max(0, delta) : 0);
}

export function resetPhaseTiming(task: Task, phase: TaskState, now: string): void {
  const blockingRequestIds = [...(task.blockingRequestIds ?? task.phaseTiming?.blockingRequestIds ?? [])];
  task.blockingRequestIds = [...blockingRequestIds];
  task.phaseTiming = { phase, elapsedMs: 0, blockingRequestIds };
  if (!blockingRequestIds.length && !TERMINAL_STATES.includes(phase)) task.phaseTiming.runningSince = now;
}

/** Legacy tasks remain unavailable until a real phase transition. */
export function blockPhaseTiming(task: Task, id: string, now = new Date().toISOString()): void {
  const ids = task.blockingRequestIds ?? task.phaseTiming?.blockingRequestIds ?? [];
  if (ids.includes(id)) return;
  task.blockingRequestIds = [...ids, id];
  const timing = task.phaseTiming;
  if (!timing) return;
  timing.elapsedMs = elapsed(task, now);
  delete timing.runningSince;
  timing.blockingRequestIds = [...task.blockingRequestIds];
}

export function resolvePhaseTiming(task: Task, id: string, now = new Date().toISOString()): void {
  const ids = task.blockingRequestIds ?? task.phaseTiming?.blockingRequestIds ?? [];
  if (!ids.includes(id)) return;
  task.blockingRequestIds = ids.filter((entry) => entry !== id);
  const timing = task.phaseTiming;
  if (!timing) return;
  timing.blockingRequestIds = [...task.blockingRequestIds];
  if (!timing.blockingRequestIds.length && !TERMINAL_STATES.includes(task.state)) timing.runningSince = now;
}

/** Baseline plus anchor: clients advance only the anchor, not server wall time. */
export function projectPhaseTiming(task: Task, serverNow = new Date().toISOString()): TimingProjection | undefined {
  const timing = task.phaseTiming;
  if (!timing) return undefined;
  return { phase: timing.phase, elapsedMs: timing.elapsedMs, runningSince: timing.runningSince,
    waiting: timing.blockingRequestIds.length > 0, serverNow };
}
