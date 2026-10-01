/**
 * The Metrics tab: how each model performs at each thinking level, as a
 * dashboard — a row of stat tiles, average run time as bars (one hue),
 * success rate as meters with a status icon, where the time goes by agent as
 * a stacked bar with a legend, and the full table underneath (columns drop
 * from the right as the terminal narrows). It covers the Master, every
 * subagent role, quick fixes and planning rounds.
 */
import { shortDuration } from "../../text.ts";
import { tokens } from "../../pi/run-summary.ts";
import type { ClassifierSummary, GroupBy, MetricGroup, MetricRecord, SortKey, TaskStats, TaskTimeGroup } from "../../state/metrics.ts";
import { bar, beside, bold, box, fill, fit, meter, notePane, paint, selectRow, sparkline, stackedBar, windowStart, wrap, type LobbyTheme, type PaneLayout } from "../layout.ts";
import { sourceColor } from "./home.ts";
import { filterRecords } from "../models/metrics.ts";

export { filterRecords };

export interface MetricsTabInput {
  groups: readonly MetricGroup[];
  /** Completed tasks' request-to-done time by the oracle's model and thinking. */
  taskTimes?: readonly TaskTimeGroup[];
  records: readonly MetricRecord[];
  stats: TaskStats;
  by: GroupBy;
  sort: SortKey;
  selected: number;
  /** The search in force; records and groups are already narrowed by it. */
  query?: string;
  /** Filled with where the table landed, for the wheel. */
  panes?: PaneLayout;
  /** What the classifier did and spared, when it has run. */
  classifier?: ClassifierSummary;
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
  planner: "oracle (plan)",
  panel: "panel",
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

/** A stat tile: the label in its border, the value large, one line of context. */
function tile(width: number, label: string, value: string, sub: string, theme?: LobbyTheme): string[] {
  return box(width, 4, [bold(theme, paint(theme, "accent", value)), paint(theme, "dim", sub)], { title: label, theme });
}

function timed(records: readonly MetricRecord[]): MetricRecord[] {
  return records.filter((record) => record.status !== "cancelled" && record.durationMs > 0);
}

/** The KPI row: runs (with recent run times), success, average run, cost, tasks. */
export function tileRow(input: MetricsTabInput, width: number, theme?: LobbyTheme): string[] {
  const { records, stats } = input;
  const done = timed(records);
  const ok = records.filter((record) => record.status === "success").length;
  const stalls = records.filter((record) => record.stalled || record.status === "timeout").length;
  const cost = records.reduce((sum, record) => sum + (record.cost ?? 0), 0);
  const avg = done.length > 0 ? done.reduce((sum, record) => sum + record.durationMs, 0) / done.length : 0;
  const sorted = done.map((record) => record.durationMs).sort((a, b) => a - b);
  const p90 = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)]! : 0;
  const count = width >= 100 ? 5 : width >= 60 ? 3 : 2;
  const tileWidth = Math.floor((width - (count - 1)) / count);
  const rate = records.length > 0 ? ok / records.length : 0;
  const tiles = [
    tile(tileWidth, "Runs", String(records.length), sparkline(done.map((record) => record.durationMs), tileWidth - 4) || "no runs yet", theme),
    tile(tileWidth, "Success", records.length > 0 ? `${status(rate).icon} ${Math.round(rate * 100)}%` : "—", `${records.length - ok} failed${stalls > 0 ? ` · ${stalls} stalled` : ""}`, theme),
    tile(tileWidth, "Avg run", duration(avg), `p90 ${duration(p90)}`, theme),
    tile(tileWidth, "Cost", money(cost), records.length > 0 ? `${money(cost / records.length)} per run` : "—", theme),
    tile(tileWidth, "Tasks", `${stats.completed} done`, stats.avgCompleteMs > 0 ? `avg ${shortDuration(stats.avgCompleteMs)} · ${stats.active} active` : `${stats.active} active`, theme),
  ].slice(0, count);
  return beside(tiles);
}

/** Success thresholds, each with an icon so the state never rests on colour alone. */
function status(rate: number): { icon: string; color: "success" | "warning" | "error"; word: string } {
  if (rate >= 0.9) return { icon: "✓", color: "success", word: "healthy" };
  if (rate >= 0.7) return { icon: "!", color: "warning", word: "shaky" };
  return { icon: "✗", color: "error", word: "failing" };
}

/** Room for `model · thinking` beside a chart's marks: about a third of it, 10 to 26 columns. */
function chartLabelWidth(inner: number): number {
  return Math.min(26, Math.max(10, Math.floor(inner * 0.34)));
}

function groupLabel(group: MetricGroup, by: GroupBy): string {
  const agent = by === "model-kind" ? ` · ${agentsCell(group, by)}` : "";
  return `${group.model} · ${group.thinking}${agent}`;
}

/** Average run time per model and thinking level: one hue, longest first, value and p90 beside each bar. */
export function timeBars(groups: readonly MetricGroup[], by: GroupBy, width: number, height: number, theme?: LobbyTheme): string[] {
  const inner = width - 4;
  const rows = [...groups].filter((group) => group.avgMs > 0).sort((a, b) => b.avgMs - a.avgMs).slice(0, Math.max(0, height - 2));
  const labelWidth = chartLabelWidth(inner);
  // The p90 goes first when room runs out.
  const withP90 = inner - labelWidth >= 34;
  const valueWidth = withP90 ? 19 : 7;
  const barWidth = Math.max(4, inner - labelWidth - valueWidth - 2);
  const max = Math.max(...rows.map((group) => group.avgMs), 1);
  const lines = rows.map((group) => {
    const value = `${duration(group.avgMs).padStart(7)}${withP90 ? ` ${paint(theme, "dim", `p90 ${duration(group.p90Ms)}`)}` : ""}`;
    return `${paint(theme, "muted", fit(groupLabel(group, by), labelWidth))} ${fit(paint(theme, "accent", bar(group.avgMs, max, barWidth)), barWidth)} ${value}`;
  });
  return box(width, height, lines.length > 0 ? lines : [paint(theme, "dim", "No timed runs yet.")], { title: "Average run time", right: "per model · thinking", theme });
}

/** Success rate per model and thinking level: a meter, an icon and the number. */
export function successMeters(groups: readonly MetricGroup[], by: GroupBy, width: number, height: number, theme?: LobbyTheme): string[] {
  const inner = width - 4;
  const rows = [...groups].sort((a, b) => a.successes / a.runs - b.successes / b.runs).slice(0, Math.max(0, height - 2));
  const labelWidth = chartLabelWidth(inner);
  const meterWidth = Math.max(4, inner - labelWidth - 12);
  const lines = rows.map((group) => {
    const rate = group.runs > 0 ? group.successes / group.runs : 0;
    const state = status(rate);
    const paintFill = (text: string) => paint(theme, state.color, text);
    const paintTrack = (text: string) => paint(theme, "borderMuted", text);
    return `${paint(theme, "muted", fit(groupLabel(group, by), labelWidth))} ${meter(rate, meterWidth, paintFill, paintTrack)} ${paint(theme, state.color, state.icon)} ${`${Math.round(rate * 100)}%`.padStart(4)} ${paint(theme, "dim", `${group.runs}`)}`;
  });
  return box(width, height, lines.length > 0 ? lines : [paint(theme, "dim", "No runs yet.")], { title: "Success rate", right: "✓ ≥90% · ! ≥70% · ✗ below", theme });
}

/** Where the time goes: each agent's share of all run time, then how long a task takes per oracle model. */
export function timeShare(records: readonly MetricRecord[], taskTimes: readonly TaskTimeGroup[] | undefined, width: number, theme?: LobbyTheme): string[] {
  const inner = width - 4;
  const byAgent = new Map<string, { n: number; ms: number }>();
  for (const record of timed(records)) {
    const entry = byAgent.get(record.agent) ?? { n: 0, ms: 0 };
    entry.n += 1;
    entry.ms += record.durationMs;
    byAgent.set(record.agent, entry);
  }
  const agents = [...byAgent.entries()].sort((a, b) => b[1].ms - a[1].ms);
  const total = agents.reduce((sum, [, entry]) => sum + entry.ms, 0);
  const lines: string[] = [];
  if (total > 0) {
    lines.push(stackedBar(agents.map(([agent, entry]) => ({ value: entry.ms, paint: (text: string) => paint(theme, sourceColor(agent), text) })), inner));
    const legend = agents.map(([agent, entry]) => `${paint(theme, sourceColor(agent), "■")} ${agent} ${Math.round((entry.ms / total) * 100)}% ${paint(theme, "dim", `avg ${shortDuration(entry.ms / entry.n)} ×${entry.n}`)}`);
    lines.push(...wrap(legend.join("   "), inner));
  } else lines.push(paint(theme, "dim", "No timed runs yet."));
  if (taskTimes && taskTimes.length > 0) {
    const max = Math.max(...taskTimes.map((group) => group.avgMs), 1);
    const labelWidth = chartLabelWidth(inner);
    const barWidth = Math.max(4, inner - labelWidth - 18);
    lines.push("", bold(theme, "Request to done, by the oracle's model"));
    for (const group of taskTimes) {
      lines.push(`${paint(theme, "muted", fit(`${group.model} · ${group.thinking}`, labelWidth))} ${fit(paint(theme, "accent", bar(group.avgMs, max, barWidth)), barWidth)} ${shortDuration(group.avgMs).padStart(7)} ${paint(theme, "dim", `×${group.tasks}`)}`);
    }
  }
  return box(width, lines.length + 2, lines, { title: "Where the time goes", right: "share of run time by agent", theme });
}

/** The metrics dashboard: KPI tiles, the charts, and the full table filling what is left. */
/** Milliseconds as `180 ms` or `1.2s`: classifier calls are short. */
function millis(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** The classifier's box: its calls and speed, then what its decisions spared. */
export function classifierLines(summary: ClassifierSummary, width: number, theme?: LobbyTheme): string[] {
  const inner = width - 4;
  const purposes = Object.entries(summary.byPurpose).sort((a, b) => b[1] - a[1]).map(([purpose, count]) => `${purpose} ${count}`).join(" · ");
  const calls = summary.calls > 0
    ? [`${summary.calls} call${summary.calls === 1 ? "" : "s"}`, `${percent(summary.ok, summary.calls)} ok`, `p50 ${millis(summary.p50Ms)}`, `p90 ${millis(summary.p90Ms)}`, summary.input > 0 ? `${tokens(summary.input)} tokens read` : "", purposes].filter(Boolean).join(paint(theme, "dim", " · "))
    : paint(theme, "dim", "no calls recorded");
  const spared = [
    `${summary.seatRunsSkipped} seat run${summary.seatRunsSkipped === 1 ? "" : "s"} skipped`,
    `${summary.questionsAnswered} question${summary.questionsAnswered === 1 ? "" : "s"} answered`,
    `${summary.quickFixesHeld} quick fix${summary.quickFixesHeld === 1 ? "" : "es"} held`,
    summary.routed > 0 ? `${summary.routed} run${summary.routed === 1 ? "" : "s"} routed down, ${percent(summary.routedOk, summary.routed)} ok` : "no runs routed",
  ].join(paint(theme, "dim", " · "));
  return box(width, 4, [fit(calls, inner), fit(`${paint(theme, "success", "spared")} ${spared}`, inner)], { title: "Classifier (Jev)", theme });
}

export function renderMetrics(input: MetricsTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  if (input.records.length === 0) {
    const empty = input.query ? `No run matches "${input.query}".` : "No runs recorded yet. Every Master turn, subagent run, quick fix and planning round lands here with its model, thinking level, time, tokens and cost.";
    return fill([...(height >= 8 ? tileRow(input, width, theme) : []), ...box(width, Math.max(3, height - (height >= 8 ? 4 : 0)), [paint(theme, "dim", empty)], { title: "Model performance", theme })], height, width);
  }
  const sections: string[] = [];
  let room = height;
  if (room >= 16) {
    sections.push(...tileRow(input, width, theme));
    room -= 4;
  }
  if (input.classifier && room >= 14) {
    sections.push(...classifierLines(input.classifier, width, theme));
    room -= 4;
  }
  const chartHeight = Math.min(input.groups.length + 2, 8);
  if (room - chartHeight >= 9) {
    if (width >= 100) {
      const left = Math.floor((width - 1) / 2);
      sections.push(...beside([timeBars(input.groups, input.by, left, chartHeight, theme), successMeters(input.groups, input.by, width - 1 - left, chartHeight, theme)]));
      room -= chartHeight;
    } else {
      sections.push(...timeBars(input.groups, input.by, width, chartHeight, theme));
      room -= chartHeight;
    }
  }
  const share = timeShare(input.records, input.taskTimes, width, theme);
  if (room - share.length >= 6) {
    sections.push(...share);
    room -= share.length;
  }
  const table = tableLines(input, width - 4, theme);
  const tableRows = Math.max(0, room - 3);
  const start = windowStart(input.selected, table.rows.length, tableRows);
  const grouping = input.by === "model" ? "by model · thinking" : "by model · thinking · agent";
  notePane(input.panes, "table", sections.length, 0, width, room, table.rows.length);
  sections.push(...box(width, room, [table.header, ...table.rows.slice(start, start + tableRows)], { title: "All models", right: `${grouping} · sorted by ${input.sort} · g s`, scroll: { total: table.rows.length + 1, start }, theme }));
  return fill(sections, height, width);
}


