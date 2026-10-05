/**
 * The classifier's box: `Classifier (Jev)`, its calls and speed in four small
 * stats, the calls by purpose, then what its decisions spared.
 */
import type { MetricsData } from "@protocol"
import { millis, percent, tokens } from "./words"

type Summary = NonNullable<MetricsData["classifier"]>

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
      {sub ? <span className="truncate text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  )
}

const plural = (count: number, word: string, many = `${word}s`): string => `${count} ${count === 1 ? word : many}`

export function Classifier({ summary }: { summary: Summary }) {
  const purposes = Object.entries(summary.byPurpose).sort((a, b) => b[1] - a[1])
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border p-4" aria-label="Classifier (Jev)">
      <h2 className="text-sm font-medium">Classifier (Jev)</h2>
      {summary.calls === 0 ? (
        <p className="text-sm text-muted-foreground">no calls recorded</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Stat label="Calls" value={plural(summary.calls, "call")} sub={`${percent(summary.ok, summary.calls)} ok`} />
          <Stat label="Speed" value={`p50 ${millis(summary.p50Ms)}`} sub={`p90 ${millis(summary.p90Ms)}`} />
          <Stat label="Read" value={summary.input > 0 ? `${tokens(summary.input)} tokens` : "—"} />
          <Stat label="Routed down" value={summary.routed > 0 ? plural(summary.routed, "run") : "none"} sub={summary.routed > 0 ? `${percent(summary.routedOk, summary.routed)} ok` : "no runs routed"} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        <span className="text-primary">spared</span> {plural(summary.seatRunsSkipped, "seat run")} skipped · {plural(summary.questionsAnswered, "question")} answered · {plural(summary.quickFixesHeld, "quick fix", "quick fixes")} held
        {purposes.length > 0 ? <span className="ml-3 border-l border-border pl-3">{purposes.map(([purpose, count]) => `${purpose} ${count}`).join(" · ")}</span> : null}
      </p>
    </section>
  )
}
