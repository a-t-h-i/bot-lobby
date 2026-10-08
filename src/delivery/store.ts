import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Task } from "../schemas/task.ts";
import { loadTask, saveTask } from "../state/persistence.ts";
import { lobbyTopics } from "../lobby/topics.ts";
import type { DeliveryStore } from "./operations.ts";

export function deliveryTask(root: string, configDir: string, taskId: string): Task {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(taskId) || taskId === "." || taskId === "..") throw new Error("Invalid task ID.");
  const task = loadTask(root, configDir, taskId);
  if (!task || task.state !== "completed" || !task.delivery) throw new Error("Completed task delivery review is unavailable in this project.");
  return task;
}

export function deliveryStore(root: string, configDir: string, taskId: string): DeliveryStore {
  let baseline: string | undefined;
  return {
    identity: { projectRoot: realpathSync(root), configDir: resolve(configDir) },
    recoveryStore: (identity) => {
      if (identity.configDir !== resolve(configDir) || realpathSync(identity.projectRoot) !== identity.projectRoot) throw new Error("Interrupted owner has an untrusted project/config identity.");
      return deliveryStore(identity.projectRoot, configDir, identity.taskId);
    },
    load: () => { const task = deliveryTask(root, configDir, taskId); baseline = JSON.stringify(task.delivery); return task; },
    save: (task) => {
      const latest = deliveryTask(root, configDir, taskId);
      if (JSON.stringify(latest.delivery) !== baseline) throw new Error("Delivery changed during operation; reconcile before retrying.");
      latest.delivery = structuredClone(task.delivery);
      saveTask(root, configDir, latest);
      baseline = JSON.stringify(latest.delivery);
      lobbyTopics.bump("tasks");
    },
  };
}
