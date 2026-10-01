/**
 * The Metrics page's wording and small helpers, copied from
 * `src/lobby/tabs/metrics.ts` and `src/text.ts` (which the page cannot
 * import: they draw through the terminal layout). Pure and DOM-free.
 */
import type { MetricGroupInfo } from "@protocol"

export type GroupBy = "model" | "model-kind"

export const KIND_LABELS: Record<string, string> = {
  master: "master",
  scout: "scout",
  worker: "worker",
  reviewer: "QA gate",
  researcher: "research",
  quickfix: "quick fix",
  planner: "oracle (plan)",
  panel: "panel",
}

/** `45s`, `3m` or `2m 05s` (the terminal's `shortDuration`). */
export function shortDuration(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0
  const minutes = Math.floor(seconds / 60)
  if (minutes === 0) return `${seconds}s`
  const rest = seconds % 60
  return rest === 0 ? `${minutes}m` : `${minutes}m ${String(rest).padStart(2, "0")}s`
}

/** A run time, or `—` when there is none. */
export function duration(ms: number): string {
  return ms > 0 ? shortDuration(ms) : "—"
}

/** A share as `94%`, or `—` with no denominator. */
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—"
}

/** A dollar amount as `$0.05`, `<$0.01` or `—`. */
export function money(value: number): string {
  if (value <= 0) return "—"
  return value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`
}

/** Compact token count: `950`, `41k`, `1.2M` (the terminal's `tokens`). */
export function tokens(count: number): string {
  if (!Number.isFinite(count) || count < 1000) return String(Math.max(0, Math.round(count || 0)))
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}

/** A short span in milliseconds: `240 ms` or `1.2s`. */
export function millis(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)}s`
}

export interface RateStatus {
  icon: string
  word: string
  tone: "healthy" | "shaky" | "failing"
}

/** Success thresholds, each with a glyph so the state never rests on colour alone. */
export function status(rate: number): RateStatus {
  if (rate >= 0.9) return { icon: "✓", word: "healthy", tone: "healthy" }
  if (rate >= 0.7) return { icon: "!", word: "shaky", tone: "shaky" }
  return { icon: "✗", word: "failing", tone: "failing" }
}

/** The class a tone's glyph and meter wear (never colour alone: the glyph stays). */
export function toneClass(tone: RateStatus["tone"]): string {
  if (tone === "healthy") return "text-primary"
  return tone === "failing" ? "text-destructive" : "text-foreground"
}

/** The label in force: `by model · thinking` or `by model · thinking · agent`. */
export function byLabel(groupBy: GroupBy): string {
  return groupBy === "model" ? "by model · thinking" : "by model · thinking · agent"
}

/** `openai/gpt-5 · high`, with the agent appended when grouping by model and kind. */
export function groupLabel(group: MetricGroupInfo, groupBy: GroupBy): string {
  const agent = groupBy === "model-kind" ? (KIND_LABELS[group.kinds[0] ?? ""] ?? group.kinds[0] ?? "") : ""
  return [group.model, group.thinking, agent].filter(Boolean).join(" · ")
}

const AGENT_FILLS: readonly string[] = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"]

/** A stable fill class per agent name (chart hues are fills, never text). */
export function agentFill(agent: string): string {
  let hash = 0
  for (const char of agent) hash = (hash * 31 + char.charCodeAt(0)) % AGENT_FILLS.length
  return AGENT_FILLS[hash] ?? AGENT_FILLS[0]!
}

/** A run kind's label (`worker`, `QA gate`), or the raw kind when unknown. */
export function kindWord(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}
