import type { Task, TaskState } from "../schemas/task.ts";
import { assertTransition } from "../workflow/transitions.ts";

/**
 * Single mutation point for task state. Every state change flows through here
 * so the engine — not any agent — is the only thing that can move a task.
 */
export function transition(task: Task, to: TaskState, now = new Date().toISOString()): void {
  assertTransition(task.state, to);
  task.state = to;
  task.updatedAt = now;
}
