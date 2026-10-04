import type { PhaseTiming, Task } from "../schemas/task.ts";
import { blockPhaseTiming, resetPhaseTiming, resolvePhaseTiming } from "./phase-timing.ts";

export interface TimingBaseline { timing?: PhaseTiming; ids: string[] }
export function timingBaseline(task: Task): TimingBaseline {
  return { timing: task.phaseTiming ? structuredClone(task.phaseTiming) : undefined,
    ids: [...(task.blockingRequestIds ?? task.phaseTiming?.blockingRequestIds ?? [])] };
}

/** Apply only this copy's wait deltas to the authoritative registry and clock. */
export function mergePhaseTiming(task: Task, baseline: TimingBaseline | undefined, latest: Task): void {
  const incoming = timingBaseline(task);
  const oldIds = baseline?.ids ?? incoming.ids;
  task.blockingRequestIds = [...(latest.blockingRequestIds ?? latest.phaseTiming?.blockingRequestIds ?? [])];
  if (JSON.stringify(baseline?.timing) !== JSON.stringify(latest.phaseTiming)) {
    task.phaseTiming = latest.phaseTiming ? structuredClone(latest.phaseTiming) : undefined;
  }
  const now = new Date().toISOString();
  for (const id of oldIds.filter((id) => !incoming.ids.includes(id))) resolvePhaseTiming(task, id, now);
  for (const id of incoming.ids.filter((id) => !oldIds.includes(id))) blockPhaseTiming(task, id, now);
  if (task.phaseTiming) task.phaseTiming.blockingRequestIds = [...task.blockingRequestIds];
  if (task.state !== latest.state || (task.phaseTiming && task.state !== task.phaseTiming.phase)) {
    resetPhaseTiming(task, task.state, task.updatedAt);
  }
}
