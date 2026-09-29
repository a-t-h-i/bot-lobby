/**
 * Pending tasks: plans the user worked out with the planner (optionally from a
 * GitHub issue) and saved for later. They are not bot-lobby tasks yet, so no
 * session owns them and the workflow never sees them; starting one creates a
 * real task in the session that starts it. One file per entry, so two sessions
 * saving at once cannot overwrite each other.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { writeFileEnsured } from "../knowledge/store.ts";
import { forgetCachedUnder, readJsonCached } from "./file-cache.ts";
import { dataRoot } from "./project.ts";
import { taskSlug } from "./persistence.ts";

export interface IssueRef {
  number: number;
  title: string;
  url?: string;
}

/** What a task saved from a split plan knows of the others: it is one part of a plan that became several tasks. */
export interface SplitInfo {
  /** Shared by every part of one plan. */
  group: string;
  /** This part's number (from 1) and how many parts there are. */
  part: number;
  of: number;
  /** The title of every part, in order. */
  titles: string[];
  /** Parts (by number) that come before this one and should be finished first. */
  after: number[];
}

export interface PlannedTask {
  id: string;
  title: string;
  /** The agreed plan in Markdown; it becomes the task request when started. */
  brief: string;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "started";
  issue?: IssueRef;
  /** The bot-lobby task started from this entry. */
  startedTaskId?: string;
  /** Set when the plan was split into several tasks and this is one of them. */
  split?: SplitInfo;
}

export function backlogDir(root: string, configDir: string): string {
  return join(dataRoot(root, configDir), "backlog");
}

function entryPath(root: string, configDir: string, id: string): string {
  return join(backlogDir(root, configDir), `${id}.json`);
}

function isPlannedTask(value: unknown): value is PlannedTask {
  const entry = value as Partial<PlannedTask> | undefined;
  return Boolean(entry && typeof entry.id === "string" && typeof entry.title === "string" && typeof entry.brief === "string");
}

/** Save a new pending task; the id is `PLAN-<slug>` with a numeric suffix when taken. */
export function savePlannedTask(
  root: string,
  configDir: string,
  input: { title: string; brief: string; issue?: IssueRef; split?: SplitInfo },
  now = new Date(),
): PlannedTask {
  const title = input.title.trim() || "planned task";
  const brief = input.brief.trim();
  if (!brief) throw new Error("a planned task needs a plan");
  const base = `PLAN-${taskSlug(title, 32) || now.getTime().toString(36)}`;
  let id = base;
  for (let n = 2; existsSync(entryPath(root, configDir, id)); n++) id = `${base}-${n}`;
  const at = now.toISOString();
  const entry: PlannedTask = { id, title, brief, createdAt: at, updatedAt: at, status: "pending", ...(input.issue ? { issue: input.issue } : {}), ...(input.split ? { split: input.split } : {}) };
  writeFileEnsured(entryPath(root, configDir, id), JSON.stringify(entry, null, 2));
  return entry;
}

export function loadPlannedTask(root: string, configDir: string, id: string): PlannedTask | undefined {
  try {
    const value = JSON.parse(readFileSync(entryPath(root, configDir, id), "utf8")) as unknown;
    return isPlannedTask(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every saved entry, pending first, newest first within each group;
 * unreadable files are skipped. Files are parsed again only when they change,
 * and the entries are shared: for reading (the lobby lists them every few
 * seconds); `loadPlannedTask` gives a copy of one's own.
 */
export function listPlannedTasks(root: string, configDir: string): PlannedTask[] {
  const dir = backlogDir(root, configDir);
  if (!existsSync(dir)) return [];
  const entries: PlannedTask[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const path = join(dir, file);
    seen.add(path);
    const entry = readJsonCached(path, isPlannedTask);
    if (entry) entries.push(entry);
  }
  forgetCachedUnder(`${dir}${sep}`, seen);
  return entries.sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function markPlannedTaskStarted(root: string, configDir: string, id: string, taskId: string, now = new Date()): PlannedTask | undefined {
  const entry = loadPlannedTask(root, configDir, id);
  if (!entry) return undefined;
  const next: PlannedTask = { ...entry, status: "started", startedTaskId: taskId, updatedAt: now.toISOString() };
  writeFileEnsured(entryPath(root, configDir, id), JSON.stringify(next, null, 2));
  return next;
}

export function discardPlannedTask(root: string, configDir: string, id: string): void {
  rmSync(entryPath(root, configDir, id), { force: true });
}

/** `Part 2 of 3 of one plan…` and the other parts' titles, for a task that is one part of a split plan. */
export function splitLine(split: SplitInfo): string {
  const others = split.titles.map((title, index) => `${index + 1}. ${title}${index + 1 === split.part ? " (this task)" : ""}`).join("; ");
  const before = split.after.length > 0 ? ` It builds on ${split.after.map((part) => `part ${part}`).join(" and ")}, which should be done first.` : "";
  return `This is part ${split.part} of ${split.of} of one plan that was split into separate tasks: ${others}.${before} Do only this part; the others are their own tasks.`;
}

/** The request a started task carries: the agreed plan, plus the issue it came from, plus where it sits in a split plan. */
export function plannedTaskRequest(entry: PlannedTask): string {
  const source = entry.issue ? `\n\nFrom GitHub issue #${entry.issue.number}: ${entry.issue.title}${entry.issue.url ? ` (${entry.issue.url})` : ""}` : "";
  const part = entry.split ? `\n\n${splitLine(entry.split)}` : "";
  return `${entry.title}${part}\n\nAgreed plan (from the planning session):\n${entry.brief}${source}`;
}
