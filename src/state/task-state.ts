import type { Task, TaskState } from "../schemas/task.ts";
import { assertTransition } from "../workflow/transitions.ts";

/**
 * Single mutation point for task state. Every state change flows through here
 * so the engine — not any agent — is the only thing that can move a task.
 */
export type TransitionListener = (task: Task, to: TaskState) => void;

let listener: TransitionListener | undefined;

/** Install the single transition observer (the extension's attention notifier). */
export function onTransition(fn: TransitionListener): void {
  listener = fn;
}

export function transition(task: Task, to: TaskState, now = new Date().toISOString()): void {
  assertTransition(task.state, to);
  task.state = to;
  task.updatedAt = now;
  listener?.(task, to);
}
