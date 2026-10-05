import type { TaskDetail, WorkClock } from "../../../src/webui/protocol.ts"
export type PhaseClock = NonNullable<TaskDetail["timing"]>
export type { WorkClock }

/** Server wall anchors establish the baseline; only monotonic client time advances it. */
export function executionMs(timing: PhaseClock, sinceSample = 0, stopped = false): number {
  const active = !stopped && !timing.waiting && Boolean(timing.runningSince)
  const anchor = active ? Date.parse(timing.serverNow) - Date.parse(timing.runningSince!) : 0
  return Math.max(0, timing.elapsedMs) + (Number.isFinite(anchor) ? Math.max(0, anchor) : 0) + (active ? Math.max(0, sinceSample) : 0)
}

export function executionWords(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`
}
