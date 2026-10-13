import { resolve } from "node:path";

const executions = new Map<string, Set<AbortController>>();
const key = (root: string, configDir: string, taskId: string) => JSON.stringify([resolve(root), configDir, taskId]);

/** Scope an orchestration action and its workers/children to one project task. */
export function taskExecution(root: string, configDir: string, taskId: string, parent?: AbortSignal) {
  const id = key(root, configDir, taskId);
  const controller = new AbortController();
  const running = executions.get(id) ?? new Set<AbortController>();
  running.add(controller);
  executions.set(id, running);
  return {
    signal: parent ? AbortSignal.any([parent, controller.signal]) : controller.signal,
    release: () => {
      running.delete(controller);
      if (!running.size) executions.delete(id);
    },
  };
}

/** Abort only this task's orchestration and the subprocesses inheriting its signal. */
export function cancelTaskExecutions(root: string, configDir: string, taskId: string): void {
  for (const controller of executions.get(key(root, configDir, taskId)) ?? []) {
    controller.abort(new Error("Task abandoned by the user"));
  }
}
