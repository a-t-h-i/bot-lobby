/**
 * The Metrics tab over HTTP: the KPI tiles, the per-model groups, where the
 * time goes, and what the classifier did — the same figures the terminal
 * tab draws, as data. Search narrows runs exactly like the tab's `/`.
 */
import { aggregateMetrics, collectMetrics, sortGroups, summarizeClassifier, taskStats, taskTimesByModel, type GroupBy, type MetricRecord } from "../../state/metrics.ts";
import { filterRecords } from "../../lobby/models/metrics.ts";
import type { MetricsData } from "../protocol.ts";
import type { ApiContext } from "./index.ts";

function timed(records: readonly MetricRecord[]): MetricRecord[] {
  return records.filter((record) => record.status !== "cancelled" && record.durationMs > 0);
}

/** The KPI row as data: runs, success, average run, cost, tasks. */
function tilesOf(records: readonly MetricRecord[], stats: ReturnType<typeof taskStats>): MetricsData["tiles"] {
  const done = timed(records);
  const ok = records.filter((record) => record.status === "success").length;
  const cost = records.reduce((sum, record) => sum + (record.cost ?? 0), 0);
  const avg = done.length > 0 ? done.reduce((sum, record) => sum + record.durationMs, 0) / done.length : 0;
  const sorted = done.map((record) => record.durationMs).sort((a, b) => a - b);
  const p90 = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)]! : 0;
  return {
    runs: records.length,
    successes: ok,
    stalls: records.filter((record) => record.stalled || record.status === "timeout").length,
    avgMs: avg,
    p90Ms: p90,
    cost,
    completed: stats.completed,
    active: stats.active,
    avgCompleteMs: stats.avgCompleteMs,
  };
}

/** Each agent's share of all run time, longest first. */
function shareOf(records: readonly MetricRecord[]): MetricsData["timeShare"]["byAgent"] {
  const byAgent = new Map<string, { runs: number; ms: number }>();
  for (const record of timed(records)) {
    const entry = byAgent.get(record.agent) ?? { runs: 0, ms: 0 };
    entry.runs += 1;
    entry.ms += record.durationMs;
    byAgent.set(record.agent, entry);
  }
  const total = [...byAgent.values()].reduce((sum, entry) => sum + entry.ms, 0);
  return [...byAgent.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([agent, entry]) => ({ agent, runs: entry.runs, ms: entry.ms, share: total > 0 ? entry.ms / total : 0 }));
}

/** The dashboard figures for one grouping and search. */
export function metricsGet(body: { groupBy: GroupBy; query?: string }, ctx: ApiContext): MetricsData {
  const tasks = ctx.service.tasks();
  const records = filterRecords(collectMetrics(ctx.service.metrics(), tasks), body.query);
  const stats = taskStats(tasks);
  const classifier = summarizeClassifier(ctx.service.classifierMetrics?.() ?? [], records);
  return {
    tiles: tilesOf(records, stats),
    groups: sortGroups(aggregateMetrics(records, body.groupBy), "runs"),
    timeShare: { byAgent: shareOf(records), taskTimes: taskTimesByModel(tasks, records) },
    ...(classifier ? { classifier } : {}),
  };
}
