import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeConfig } from "../schemas/configuration.ts";
import type { Domain } from "../schemas/agent.ts";
import type { Task } from "../schemas/task.ts";
import { dataRoot } from "./project.ts";
import {
  AGENT_DIR_NAMES,
  KNOWLEDGE_FILES,
  knowledgeDir,
  scratchpadPath,
  taskDir,
  tasksRoot,
  type KnowledgeAgent,
} from "../knowledge/paths.ts";
import { DEFAULT_KNOWLEDGE_CONTENT, ensureFile, writeFileEnsured } from "../knowledge/store.ts";

/** Idempotently create the full knowledge + tasks layout with seed files. */
export function ensureProjectStructure(root: string, configDir: string): void {
  const dr = dataRoot(root, configDir);
  const agents = Object.keys(AGENT_DIR_NAMES) as KnowledgeAgent[];
  for (const agent of agents) {
    const dir = knowledgeDir(dr, agent);
    mkdirSync(dir, { recursive: true });
    for (const file of KNOWLEDGE_FILES[agent]) {
      ensureFile(join(dir, file), DEFAULT_KNOWLEDGE_CONTENT[file] ?? `# ${file}\n`);
    }
  }
  mkdirSync(tasksRoot(dr), { recursive: true });
}

/** Create the temporary task dir with state.json, proposal/plan, scratchpads. */
export function createTaskDir(root: string, configDir: string, task: Task): void {
  const dir = taskDir(dataRoot(root, configDir), task.id);
  mkdirSync(dir, { recursive: true });
  writeFileEnsured(join(dir, "state.json"), JSON.stringify(task, null, 2));
  ensureFile(join(dir, "proposal.md"), "");
  ensureFile(join(dir, "plan.md"), "");
  for (const domain of ["designer", "backend", "qa"] as const) {
    ensureFile(scratchpadPath(dir, domain), `# ${domain} scratchpad\n`);
  }
}

export function taskDirFor(root: string, configDir: string, taskId: string): string {
  return taskDir(dataRoot(root, configDir), taskId);
}

export function saveTask(root: string, configDir: string, task: Task): void {
  writeFileEnsured(join(taskDir(dataRoot(root, configDir), task.id), "state.json"), JSON.stringify(task, null, 2));
}

export function loadTask(root: string, configDir: string, taskId: string): Task | undefined {
  try {
    return JSON.parse(readFileSync(join(taskDir(dataRoot(root, configDir), taskId), "state.json"), "utf8")) as Task;
  } catch {
    return undefined;
  }
}

/** Enforce the scratchpad size cap (§20) before writing. */
export function capScratchpad(content: string, cfg: KnowledgeConfig): string {
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const limited = paragraphs.slice(0, cfg.scratchpadMaxParagraphs).join("\n\n");
  if (limited.length <= cfg.scratchpadMaxChars) return limited;
  return `${limited.slice(0, cfg.scratchpadMaxChars)}\n\n[truncated]`;
}

export function writeScratchpad(dir: string, domain: Domain, content: string, cfg: KnowledgeConfig): void {
  writeFileEnsured(scratchpadPath(dir, domain), capScratchpad(content, cfg));
}

/** Delete the temporary task dir after knowledge has been distilled. */
export function cleanupTaskDir(root: string, configDir: string, taskId: string): void {
  rmSync(taskDir(dataRoot(root, configDir), taskId), { recursive: true, force: true });
}
