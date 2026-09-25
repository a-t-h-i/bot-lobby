import { TERMINAL_STATES, type TaskState } from "../schemas/task.ts";

/**
 * Workflow transitions per the build plan §8. These are the only legal
 * workflow moves; the engine enforces them regardless of what any agent asks.
 */
export const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  created: ["clarifying"],
  clarifying: ["scouting", "awaiting_approval"],
  scouting: ["synthesizing"],
  synthesizing: ["awaiting_approval"],
  awaiting_approval: ["planning", "abandoned"],
  planning: ["implementing"],
  implementing: ["reviewing", "blocked"],
  reviewing: ["implementing", "completed", "blocked"],
  blocked: ["implementing", "abandoned"],
  completed: [],
  abandoned: [],
};

/** User cancellation / decline abandons from any non-terminal state. */
export function canAbandon(state: TaskState): boolean {
  return !TERMINAL_STATES.includes(state);
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  if (to === "abandoned") return canAbandon(from);
  if (from === to) return !TERMINAL_STATES.includes(from);
  return (TRANSITIONS[from] as readonly TaskState[]).includes(to);
}

export function nextStates(from: TaskState): readonly TaskState[] {
  const base = TRANSITIONS[from];
  return canAbandon(from) && !base.includes("abandoned") ? [...base, "abandoned"] : base;
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} -> ${to}`);
  }
}
