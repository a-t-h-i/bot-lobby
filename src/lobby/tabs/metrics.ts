/**
 * The Metrics tab: how each model performs at each thinking level — how long
 * its runs take (mean, median, p90), how often they succeed, how many turns,
 * tools and tokens they use, their throughput and cost — across the Master,
 * every subagent role, quick fixes and planner turns. Columns drop from the
 * right as the terminal narrows.
 */
import { shortDuration } from "../../text.ts";
import { tokens } from "../../pi/run-summary.ts";
import type { GroupBy, MetricGroup, MetricRecord, SortKey, TaskStats, TaskTimeGroup } from "../../state/metrics.ts";
import { bold, fill, fit, paint, rule, selectRow, windowStart, type LobbyTheme } from "../layout.ts";

export interface MetricsTabInput {
  groups: readonly MetricGroup[];
  /** Completed tasks' request-to-done time by the oracle's model and thinking. */
  taskTimes?: readonly TaskTimeGroup[];
  records: readonly MetricRecord[];
  stats: TaskStats;
  by: GroupBy;
  sort: SortKey;
  selected: number;
}

interface Column {
  title: string;
  width: number;
  align: "left" | "right";
  cell: (group: MetricGroup) => string;
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

function duration(ms: number): string {
  return ms > 0 ? shortDuration(ms) : "—";
}

function money(value: number): string {
  if (value <= 0) return "—";
  return value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
}

const KIND_LABELS: Record<string, string> = {
  master: "master",
  scout: "scout",
  worker: "worker",
  reviewer: "QA gate",
  researcher: "research",
  quickfix: "quick fix",
  planner: "planner",
};

/** Columns in priority order; the table keeps as many as the width allows. */
const COLUMNS: readonly Column[] = [
  { title: "Runs", width: 5, align: "right", cell: (g) => String(g.runs) },
  { title: "OK", width: 5, align: "right", cell: (g) => percent(g.successes, g.runs) },
  { title: "Avg", width: 8, align: "right", cell: (g) => duration(g.avgMs) },
  { title: "p50", width: 8, align: "right", cell: (g) => duration(g.p50Ms) },
  { title: "p90", width: 8, align: "right", cell: (g) => duration(g.p90Ms) },
  { title: "Turns", width: 6, align: "right", cell: (g) => (g.avgTurns > 0 ? g.avgTurns.toFixed(1) : "—") },
  { title: "Tools", width: 6, align: "right", cell: (g) => (g.avgTools > 0 ? g.avgTools.toFixed(1) : "—") },
  { title: "Tokens", width: 7, align: "right", cell: (g) => (g.avgTokens > 0 ? tokens(g.avgTokens) : "—") },
  { title: "tok/s", width: 6, align: "right", cell: (g) => (g.tokensPerSecond > 0 ? g.tokensPerSecond.toFixed(0) : "—") },
  { title: "$/run", width: 7, align: "right", cell: (g) => money(g.avgCost) },
  { title: "$ total", width: 8, align: "right", cell: (g) => money(g.totalCost) },
  { title: "Stalls", width: 6, align: "right", cell: (g) => (g.timeouts > 0 ? String(g.timeouts) : "—") },
];

const MODEL_MIN = 30;
const THINK_WIDTH = 7;
const AGENTS_WIDTH = 14;

function align(text: string, width: number, side: "left" | "right"): string {
  const cut = fit(text, width).trimEnd();
  return side === "right" ? cut.padStart(width) : fit(cut, width);
}

/** The columns that fit: model, thinking and agents first, then metrics in priority order. */
export function fittedColumns(width: number): Column[] {
  let used = MODEL_MIN + 1 + THINK_WIDTH + 1 + AGENTS_WIDTH;
  const kept: Column[] = [];
  for (const column of COLUMNS) {
    if (used + 1 + column.width > width) break;
    kept.push(column);
    used += 1 + column.width;
  }
  return kept;
}

function agentsCell(group: MetricGroup, by: GroupBy): string {
  const kinds = group.kinds.map((kind) => KIND_LABELS[kind] ?? kind);
  return by === "model-kind" ? kinds[0] ?? "" : kinds.join(", ");
}

export function tableLines(input: MetricsTabInput, width: number, theme?: LobbyTheme): { header: string; rows: string[] } {
  const kept = fittedColumns(width);
  const fixed = kept.reduce((sum, column) => sum + 1 + column.width, 0);
  const modelWidth = Math.max(MODEL_MIN, width - fixed - 1 - THINK_WIDTH - 1 - AGENTS_WIDTH);
  const head = [fit("Model", modelWidth), fit("Think", THINK_WIDTH), fit(input.by === "model-kind" ? "Agent" : "Agents", AGENTS_WIDTH), ...kept.map((column) => align(column.title, column.width, column.align))].join(" ");
  const rows = input.groups.map((group, index) => {
    const cells = [
      fit(group.model, modelWidth),
      fit(group.thinking, THINK_WIDTH),
      fit(agentsCell(group, input.by), AGENTS_WIDTH),
      ...kept.map((column) => align(column.cell(group), column.width, column.align)),
    ].join(" ");
    return selectRow(theme, index === input.selected ? bold(theme, cells) : cells, width, index === input.selected);
  });
  return { header: bold(theme, paint(theme, "muted", fit(head, width))), rows };
}

function summary(input: MetricsTabInput, theme?: LobbyTheme): string[] {
  const { stats, records } = input;
  const cost = records.reduce((sum, record) => sum + (record.cost ?? 0), 0);
  const tasks = [
    `${stats.completed} completed${stats.completed > 0 && stats.avgCompleteMs > 0 ? ` (avg ${shortDuration(stats.avgCompleteMs)} from request to done)` : ""}`,
    `${stats.active} active`,
    `${stats.abandoned} abandoned`,
  ].join(" · ");
  return [
    `${bold(theme, "Tasks")} ${tasks}`,
    `${bold(theme, "Runs")} ${records.length} recorded · ${money(cost)} total · grouped by ${input.by === "model" ? "model + thinking" : "model + thinking + agent"} · sorted by ${input.sort}`,
  ];
}

/** Per-agent averages across every model, a quick read of where the time goes. */
function agentLine(records: readonly MetricRecord[], theme?: LobbyTheme): string {
  const byAgent = new Map<string, { n: number; ms: number }>();
  for (const record of records) {
    if (record.status === "cancelled" || record.durationMs <= 0) continue;
    const entry = byAgent.get(record.agent) ?? { n: 0, ms: 0 };
    entry.n += 1;
    entry.ms += record.durationMs;
    byAgent.set(record.agent, entry);
  }
  const parts = [...byAgent.entries()].sort((a, b) => b[1].n - a[1].n).map(([agent, entry]) => `${agent} ${shortDuration(entry.ms / entry.n)} ${paint(theme, "dim", `×${entry.n}`)}`);
  return parts.length > 0 ? `${bold(theme, "Avg by agent")} ${parts.join(paint(theme, "dim", " · "))}` : "";
}

/** One line: how long a task takes on each oracle model, request to done. */
function taskTimeLine(groups: readonly TaskTimeGroup[] | undefined, theme?: LobbyTheme): string {
  if (!groups || groups.length === 0) return "";
  const parts = groups.map((group) => `${group.model} ${paint(theme, "dim", group.thinking)} ${shortDuration(group.avgMs)} ${paint(theme, "dim", `×${group.tasks}`)}`);
  return `${bold(theme, "Task time by oracle")} ${parts.join(paint(theme, "dim", " · "))}`;
}

export function renderMetrics(input: MetricsTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const head = [...summary(input, theme), taskTimeLine(input.taskTimes, theme), agentLine(input.records, theme)].filter(Boolean);
  if (input.groups.length === 0) {
    return fill([
      ...head, "", rule(width, "Model performance", theme),
      paint(theme, "dim", "No runs recorded yet. Every Master turn, subagent run, quick fix and planner turn lands here with its model, thinking level, time, tokens and cost."),
    ], height, width);
  }
  const table = tableLines(input, width, theme);
  const bodyHeight = Math.max(0, height - head.length - 3);
  const start = windowStart(input.selected, table.rows.length, bodyHeight);
  return fill([...head, "", rule(width, "Model performance", theme, "g group · s sort"), table.header, ...table.rows.slice(start, start + bodyHeight)], height, width);
}
