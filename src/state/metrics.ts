/**
 * Model performance records: one line per finished run of any agent — the
 * Master's own turns, scouts, workers, the QA gate, researchers, quick fixes,
 * planner turns and planning panel seats — so the lobby can show how long each model takes at each
 * thinking level, how often it succeeds and what it costs. Append-only JSON
 * lines per project; reads keep the newest `MAX_READ` records.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentRun } from "../schemas/findings.ts";
import type { RunLogEntry, Task } from "../schemas/task.ts";
import { dataRoot } from "./project.ts";

export const METRIC_KINDS = ["master", "scout", "worker", "reviewer", "researcher", "quickfix", "planner", "panel", "classifier"] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export type MetricStatus = "success" | "failed" | "cancelled" | "timeout";

export interface MetricRecord {
  id: string;
  kind: MetricKind;
  /** Display name of the agent: MASTER, DEV, DESIGN, QA, RESEARCH, QUICK FIX, ORACLE (planning). */
  agent: string;
  model?: string;
  thinking?: string;
  status: MetricStatus;
  startedAt: string;
  durationMs: number;
  turns?: number;
  tools?: number;
  input?: number;
  output?: number;
  cost?: number;
  taskId?: string;
  stalled?: boolean;
  /** Classifier calls: what the call decided (seats, answers, files, triage, effort, test). */
  purpose?: string;
}

/** Newest records kept in memory for aggregation. */
export const MAX_READ = 5000;

export function metricsPath(root: string, configDir: string): string {
  return join(dataRoot(root, configDir), "metrics.jsonl");
}

export function appendMetrics(root: string, configDir: string, records: readonly MetricRecord[]): void {
  if (records.length === 0) return;
  const path = metricsPath(root, configDir);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, records.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf8");
  } catch {
    // Metrics are best-effort; a read-only tree must never fail a workflow step.
  }
}

function isRecord(value: unknown): value is MetricRecord {
  const record = value as Partial<MetricRecord> | undefined;
  return Boolean(record && typeof record.id === "string" && typeof record.kind === "string" && typeof record.durationMs === "number");
}

/** Agent runs for the Metrics tab; classifier calls, a few hundred milliseconds each, are read apart. */
export function readMetrics(root: string, configDir: string, limit = MAX_READ): MetricRecord[] {
  return readRecords(root, configDir, limit).filter((record) => record.kind !== "classifier");
}

/** Classifier calls only. */
export function readClassifierMetrics(root: string, configDir: string, limit = MAX_READ): MetricRecord[] {
  return readRecords(root, configDir, limit).filter((record) => record.kind === "classifier");
}

function readRecords(root: string, configDir: string, limit: number): MetricRecord[] {
  const path = metricsPath(root, configDir);
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const records: MetricRecord[] = [];
  for (const line of text.split("\n").slice(-limit - 1)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (isRecord(value)) records.push(value);
    } catch {
      // Torn lines are skipped.
    }
  }
  return records.slice(-limit);
}

const AGENT_NAMES: Record<string, string> = { backend: "DEV", designer: "DESIGN", qa: "QA" };

function durationBetween(startedAt: string, finishedAt: string | undefined): number {
  if (!finishedAt) return 0;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function finalStatus(status: AgentRun["status"]): MetricStatus {
  return status === "running" ? "failed" : status;
}

/** A finished subagent run as a metric record. */
export function metricFromRun(run: AgentRun): MetricRecord {
  const agent = run.role === "researcher" ? "RESEARCH" : AGENT_NAMES[run.domain] ?? run.domain.toUpperCase();
  const turns = run.turns ?? run.usage?.turns;
  return {
    id: run.runId,
    kind: run.role,
    agent,
    ...(run.model ? { model: run.model } : {}),
    ...(run.thinking ? { thinking: run.thinking } : {}),
    status: finalStatus(run.status),
    startedAt: run.startedAt,
    durationMs: durationBetween(run.startedAt, run.finishedAt),
    ...(turns ? { turns } : {}),
    ...(run.tools ? { tools: run.tools } : {}),
    ...(run.usage ? { input: run.usage.input, output: run.usage.output, cost: run.usage.cost } : {}),
    taskId: run.taskId,
    ...(run.stalled ? { stalled: true } : {}),
  };
}

/** A persisted run-log entry as a metric record, so runs from before the metrics log still count. */
export function metricFromLog(entry: RunLogEntry, taskId: string): MetricRecord {
  const agent = entry.role === "researcher" ? "RESEARCH" : AGENT_NAMES[entry.domain] ?? entry.domain.toUpperCase();
  return {
    id: entry.runId,
    kind: entry.role,
    agent,
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.thinking ? { thinking: entry.thinking } : {}),
    status: finalStatus(entry.status),
    startedAt: entry.startedAt,
    durationMs: durationBetween(entry.startedAt, entry.finishedAt),
    ...(entry.turns ? { turns: entry.turns } : {}),
    ...(entry.tools ? { tools: entry.tools } : {}),
    ...(entry.input !== undefined ? { input: entry.input, output: entry.output ?? 0, cost: entry.cost ?? 0 } : {}),
    taskId,
    ...(entry.stalled ? { stalled: true } : {}),
  };
}

/** Records from the log plus every task's run log, deduplicated by id (the log wins). */
export function collectMetrics(logged: readonly MetricRecord[], tasks: readonly Task[]): MetricRecord[] {
  const byId = new Map<string, MetricRecord>();
  for (const task of tasks) for (const entry of task.runLog ?? []) byId.set(entry.runId, metricFromLog(entry, task.id));
  for (const record of logged) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export interface MetricGroup {
  /** The model id without its provider, or "unknown" when a run never reported one. */
  model: string;
  thinking: string;
  /** Agent kinds seen in the group, most frequent first. */
  kinds: MetricKind[];
  runs: number;
  successes: number;
  /** Runs that stalled or hit their time limit. */
  timeouts: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  avgTurns: number;
  avgTools: number;
  avgTokens: number;
  avgCost: number;
  totalCost: number;
  /** Output tokens per second of wall time, a rough throughput signal. */
  tokensPerSecond: number;
}

export type GroupBy = "model" | "model-kind";

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The model a record ran on, without its provider: the Master reports
 * `provider/id` while subagent streams report the bare id, and both are the
 * same model.
 */
export function modelName(model: string | undefined): string {
  if (!model) return "unknown";
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function groupKey(record: MetricRecord, by: GroupBy): string {
  const base = `${modelName(record.model)}\0${record.thinking ?? "—"}`;
  return by === "model-kind" ? `${base}\0${record.kind}` : base;
}

/**
 * Aggregate records per model and thinking level (optionally split by agent
 * kind). Cancelled runs say nothing about a model's speed, so they count as
 * runs but stay out of the timing and throughput figures.
 */
export function aggregateMetrics(records: readonly MetricRecord[], by: GroupBy = "model"): MetricGroup[] {
  const groups = new Map<string, MetricRecord[]>();
  for (const record of records) {
    const key = groupKey(record, by);
    const list = groups.get(key);
    if (list) list.push(record);
    else groups.set(key, [record]);
  }
  return [...groups.values()].map((list) => {
    const timed = list.filter((record) => record.status !== "cancelled" && record.durationMs > 0);
    const durations = timed.map((record) => record.durationMs).sort((a, b) => a - b);
    const kindCounts = new Map<MetricKind, number>();
    for (const record of list) kindCounts.set(record.kind, (kindCounts.get(record.kind) ?? 0) + 1);
    const totalCost = list.reduce((sum, record) => sum + (record.cost ?? 0), 0);
    const outputTokens = timed.reduce((sum, record) => sum + (record.output ?? 0), 0);
    const seconds = durations.reduce((sum, ms) => sum + ms, 0) / 1000;
    return {
      model: modelName(list[0]!.model),
      thinking: list[0]!.thinking ?? "—",
      kinds: [...kindCounts.entries()].sort((a, b) => b[1] - a[1]).map(([kind]) => kind),
      runs: list.length,
      successes: list.filter((record) => record.status === "success").length,
      timeouts: list.filter((record) => record.status === "timeout" || record.stalled).length,
      avgMs: mean(durations),
      p50Ms: percentile(durations, 0.5),
      p90Ms: percentile(durations, 0.9),
      avgTurns: mean(list.filter((record) => record.turns).map((record) => record.turns!)),
      avgTools: mean(list.filter((record) => record.tools !== undefined).map((record) => record.tools!)),
      avgTokens: mean(list.filter((record) => record.input !== undefined).map((record) => (record.input ?? 0) + (record.output ?? 0))),
      avgCost: list.length > 0 ? totalCost / list.length : 0,
      totalCost,
      tokensPerSecond: seconds > 0 ? outputTokens / seconds : 0,
    };
  });
}

export type SortKey = "runs" | "avg" | "success" | "cost";
export const SORT_KEYS: readonly SortKey[] = ["runs", "avg", "success", "cost"];

export function sortGroups(groups: readonly MetricGroup[], key: SortKey): MetricGroup[] {
  const score = (group: MetricGroup): number => {
    if (key === "avg") return group.avgMs;
    if (key === "success") return group.runs === 0 ? 0 : group.successes / group.runs;
    if (key === "cost") return group.totalCost;
    return group.runs;
  };
  // Fastest first for time; largest first otherwise.
  const direction = key === "avg" ? 1 : -1;
  return [...groups].sort((a, b) => direction * (score(a) - score(b)) || a.model.localeCompare(b.model));
}

export interface TaskStats {
  completed: number;
  abandoned: number;
  active: number;
  /** Mean wall time from creation to completion over completed tasks. */
  avgCompleteMs: number;
}

export function taskStats(tasks: readonly Task[]): TaskStats {
  const completed = tasks.filter((task) => task.state === "completed");
  const times = completed.map((task) => durationBetween(task.createdAt, task.updatedAt)).filter((ms) => ms > 0);
  return {
    completed: completed.length,
    abandoned: tasks.filter((task) => task.state === "abandoned").length,
    active: tasks.filter((task) => task.state !== "completed" && task.state !== "abandoned").length,
    avgCompleteMs: mean(times),
  };
}

export interface TaskTimeGroup {
  model: string;
  thinking: string;
  tasks: number;
  avgMs: number;
}

/**
 * How long completed tasks took from request to done, grouped by the model and
 * thinking level the oracle ran most of its turns on for that task. Tasks with
 * no recorded Master turn are left out.
 */
export function taskTimesByModel(tasks: readonly Task[], records: readonly MetricRecord[]): TaskTimeGroup[] {
  const masterTurns = new Map<string, Map<string, number>>();
  for (const record of records) {
    if (record.kind !== "master" || !record.taskId) continue;
    const key = `${modelName(record.model)}\0${record.thinking ?? "—"}`;
    const counts = masterTurns.get(record.taskId) ?? new Map<string, number>();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    masterTurns.set(record.taskId, counts);
  }
  const groups = new Map<string, number[]>();
  for (const task of tasks) {
    if (task.state !== "completed") continue;
    const counts = masterTurns.get(task.id);
    const ms = durationBetween(task.createdAt, task.updatedAt);
    if (!counts || ms <= 0) continue;
    const key = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    groups.set(key, [...(groups.get(key) ?? []), ms]);
  }
  return [...groups.entries()]
    .map(([key, times]) => {
      const [model, thinking] = key.split("\0");
      return { model: model!, thinking: thinking!, tasks: times.length, avgMs: mean(times) };
    })
    .sort((a, b) => b.tasks - a.tasks || a.avgMs - b.avgMs);
}
