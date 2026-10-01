/**
 * The Metrics tab's full table (batch-2 §j): Model, Think, Agent(s) and the
 * terminal's metric columns, in the same priority order. It is a real
 * `<table>` that scrolls horizontally inside its own box, so a narrow pane
 * never scrolls the page sideways.
 */
import type { MetricGroupInfo } from "@protocol"
import { duration, groupLabel, kindWord, money, percent, tokens, type GroupBy } from "./words"

const HEADERS = ["Runs", "OK", "Avg", "p50", "p90", "Turns", "Tools", "Tokens", "tok/s", "$/run", "$ total", "Stalls"] as const

function number(value: number, digits = 0): string {
  return value > 0 ? value.toFixed(digits) : "—"
}

function cells(group: MetricGroupInfo): string[] {
  return [
    String(group.runs),
    percent(group.successes, group.runs),
    duration(group.avgMs),
    duration(group.p50Ms),
    duration(group.p90Ms),
    number(group.avgTurns, 1),
    number(group.avgTools, 1),
    group.avgTokens > 0 ? tokens(group.avgTokens) : "—",
    group.tokensPerSecond > 0 ? group.tokensPerSecond.toFixed(0) : "—",
    money(group.avgCost),
    money(group.totalCost),
    group.timeouts > 0 ? String(group.timeouts) : "—",
  ]
}

function agents(group: MetricGroupInfo, groupBy: GroupBy): string {
  return groupBy === "model-kind" ? kindWord(group.kinds[0] ?? "") : group.kinds.map(kindWord).join(", ")
}

export function MetricsTable({ groups, groupBy }: { groups: MetricGroupInfo[]; groupBy: GroupBy }) {
  return (
    <section className="flex min-h-0 flex-col gap-2" aria-label="All models">
      <h2 className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1 text-sm font-medium">
        <span>All models</span>
        <span className="text-xs font-normal text-muted-foreground">{groupBy === "model" ? "by model · thinking" : "by model · thinking · agent"} · sorted by runs</span>
      </h2>
      <div className="max-h-96 overflow-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Model</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Think</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">{groupBy === "model-kind" ? "Agent" : "Agents"}</th>
              {HEADERS.map((header) => (
                <th key={header} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={groupLabel(group, groupBy)} className="border-t">
                <th scope="row" className="px-3 py-2 text-left font-normal text-foreground">
                  {group.model}
                </th>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{group.thinking || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{agents(group, groupBy) || "—"}</td>
                {cells(group).map((value, index) => (
                  <td key={HEADERS[index]} className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-foreground">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
