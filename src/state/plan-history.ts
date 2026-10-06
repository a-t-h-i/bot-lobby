/**
 * Every planning session in a project, kept as it goes (one file each under
 * `planning/`): the conversation, the draft and the panel, so a plan the user
 * walked away from (a new plan, a closed window) can be read again, carried
 * on, archived or deleted. A session saved as a pending task is flagged with
 * the tasks it became and leaves the previous plans; its record stays.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "./project.ts";
import type { PlanningSnapshot } from "../lobby/planner.ts";

export interface PlanRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Put aside by the user: listed only with the archived plans. */
  archivedAt?: string;
  /** The pending tasks it was saved as: such a plan is no longer a previous plan. */
  savedAs?: string[];
  snapshot: PlanningSnapshot;
}

/** What a list of previous plans shows of each. */
export interface PlanSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  /** Messages in its conversation. */
  messages: number;
  rounds: number;
  hasDraft: boolean;
}

const PLAN_ID = /^PS-[a-z0-9]{4,32}$/;

export function isPlanId(id: string): boolean {
  return PLAN_ID.test(id);
}

export function planningDir(root: string, configDir: string): string {
  return join(dataRoot(root, configDir), "planning");
}

function recordPath(root: string, configDir: string, id: string): string {
  if (!isPlanId(id)) throw new Error(`no plan ${id}`);
  return join(planningDir(root, configDir), `${id}.json`);
}

/** A title for a session: the oracle's, else the start of the idea. */
export function planTitle(snapshot: PlanningSnapshot): string {
  const words = snapshot.reply?.title ?? snapshot.seed?.issue.title ?? snapshot.messages.find((message) => message.role === "you")?.text ?? "";
  const line = words.split("\n")[0]!.replace(/\s+/g, " ").trim();
  return (line.length > 80 ? `${line.slice(0, 79)}…` : line) || "Untitled plan";
}

export function readPlan(root: string, configDir: string, id: string): PlanRecord | undefined {
  try {
    const record = JSON.parse(readFileSync(recordPath(root, configDir, id), "utf8")) as PlanRecord;
    return record && record.id === id && record.snapshot && Array.isArray(record.snapshot.messages) ? record : undefined;
  } catch {
    return undefined;
  }
}

function write(root: string, configDir: string, record: PlanRecord): void {
  const path = recordPath(root, configDir, record.id);
  mkdirSync(planningDir(root, configDir), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record), "utf8");
  renameSync(tmp, path);
}

/**
 * Keep a session as it stands. One that has not started (no idea, no issue)
 * is not kept; saving it as a task flags it, for good.
 */
export function keepPlan(root: string, configDir: string, id: string, createdAt: number, snapshot: PlanningSnapshot, now = new Date()): void {
  if (!isPlanId(id) || (snapshot.messages.length === 0 && !snapshot.seed)) return;
  const previous = readPlan(root, configDir, id);
  const saved = [...new Set([...(previous?.savedAs ?? []), ...(snapshot.saved ? [snapshot.saved.id] : []), ...snapshot.savedParts.map((part) => part.id)])];
  write(root, configDir, {
    id,
    title: planTitle(snapshot),
    createdAt: previous?.createdAt ?? new Date(createdAt).toISOString(),
    updatedAt: now.toISOString(),
    ...(previous?.archivedAt ? { archivedAt: previous.archivedAt } : {}),
    ...(saved.length > 0 ? { savedAs: saved } : {}),
    snapshot: { ...snapshot, running: false },
  });
}

function summary(record: PlanRecord): PlanSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
    messages: record.snapshot.messages.length,
    rounds: record.snapshot.turns,
    hasDraft: Boolean(record.snapshot.reply?.plan),
  };
}

/**
 * The previous plans: never saved as a task, newest first; the archived ones
 * only when asked for, and the session on screen (`except`) never.
 */
export function previousPlans(root: string, configDir: string, options: { archived?: boolean; except?: string } = {}): PlanSummary[] {
  const dir = planningDir(root, configDir);
  if (!existsSync(dir)) return [];
  const found: PlanSummary[] = [];
  for (const file of readdirSync(dir)) {
    const id = file.replace(/\.json$/, "");
    if (!file.endsWith(".json") || !isPlanId(id) || id === options.except) continue;
    const record = readPlan(root, configDir, id);
    if (!record || record.savedAs?.length) continue;
    if (Boolean(record.archivedAt) !== Boolean(options.archived)) continue;
    found.push(summary(record));
  }
  return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Put a previous plan aside, or bring it back. */
export function archivePlan(root: string, configDir: string, id: string, archived: boolean, now = new Date()): PlanRecord {
  const record = readPlan(root, configDir, id);
  if (!record) throw new Error(`no plan ${id}`);
  if (record.savedAs?.length) throw new Error(`${id} was saved as a task`);
  const { archivedAt: _was, ...rest } = record;
  const next: PlanRecord = archived ? { ...rest, archivedAt: now.toISOString() } : rest;
  write(root, configDir, next);
  return next;
}

export function deletePlan(root: string, configDir: string, id: string): void {
  if (!readPlan(root, configDir, id)) throw new Error(`no plan ${id}`);
  rmSync(recordPath(root, configDir, id), { force: true });
}
