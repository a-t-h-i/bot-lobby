/**
 * The Metrics tab's charts (batch-2 §j, W-152): horizontal bars for average
 * run time, meters for success, and the stacked agent share with the
 * request-to-done bars. Plain divs and SVG-free flex bars; colour is only
 * ever a fill, each bar carries an accessible label, and chart hues come
 * from the theme's `--chart-*` / `--source-*` tokens.
 */
import type { MetricGroupInfo, MetricsData } from "@protocol"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { agentFill, duration, shortDuration, status, toneClass, type RateStatus } from "./words"

function ChartCard({ title, right, children }: { title: string; right: string; children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span>{title}</span>
          <span className="text-xs font-normal text-muted-foreground">{right}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function barWidth(value: number, max: number): string {
  return `${max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0}%`
}

function BarRow({ label, value, max, valueText, sub }: { label: string; value: number; max: number; valueText: string; sub: string }) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-muted-foreground" title={label}>
          {label}
        </span>
        <span className="shrink-0 text-foreground tabular-nums">
          {valueText}
          {sub ? <span className="ml-2 text-xs text-muted-foreground">{sub}</span> : null}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${valueText}`}>
        <div className="h-full rounded-full bg-chart-1" style={{ width: barWidth(value, max) }} />
      </div>
    </li>
  )
}

/** Average run time per model and thinking level, longest first. */
export function AvgTime({ groups, label }: { groups: MetricGroupInfo[]; label: (group: MetricGroupInfo) => string }) {
  const rows = groups.filter((group) => group.avgMs > 0).sort((a, b) => b.avgMs - a.avgMs)
  const max = Math.max(...rows.map((group) => group.avgMs), 1)
  return (
    <ChartCard title="Average run time" right="per model · thinking">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No timed runs yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((group) => (
            <BarRow
              key={label(group)}
              label={label(group)}
              value={group.avgMs}
              max={max}
              valueText={duration(group.avgMs)}
              sub={`p90 ${duration(group.p90Ms)}`}
            />
          ))}
        </ul>
      )}
    </ChartCard>
  )
}

const METER_FILL: Record<RateStatus["tone"], string> = { healthy: "bg-primary", shaky: "bg-foreground", failing: "bg-destructive" }

function MeterRow({ label, rate, runs }: { label: string; rate: number; runs: number }) {
  const state = status(rate)
  const pct = `${Math.round(rate * 100)}%`
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-muted-foreground" title={label}>
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          <span className={`flex items-center gap-1 ${toneClass(state.tone)}`}>
            <span aria-hidden="true">{state.icon}</span>
            <span className="sr-only">{state.word}</span>
            <span>{pct}</span>
          </span>
          <span className="text-xs text-muted-foreground">{runs}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${state.word}, ${pct} of ${runs} runs`}>
        <div className={`h-full rounded-full ${METER_FILL[state.tone]}`} style={{ width: barWidth(rate, 1) }} />
      </div>
    </li>
  )
}

/** Success rate per model and thinking level, weakest first. */
export function SuccessRate({ groups, label }: { groups: MetricGroupInfo[]; label: (group: MetricGroupInfo) => string }) {
  const rows = [...groups].sort((a, b) => a.successes / a.runs - b.successes / b.runs)
  return (
    <ChartCard title="Success rate" right="✓ ≥90% · ! ≥70% · ✗ below">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((group) => (
            <MeterRow key={label(group)} label={label(group)} rate={group.runs > 0 ? group.successes / group.runs : 0} runs={group.runs} />
          ))}
        </ul>
      )}
    </ChartCard>
  )
}

function ShareLegend({ share }: { share: MetricsData["timeShare"]["byAgent"] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {share.map((entry) => (
        <li key={entry.agent} className="flex items-center gap-1.5 text-muted-foreground">
          <span className={`inline-block size-2.5 rounded-sm ${agentFill(entry.agent)}`} aria-hidden="true" />
          <span className="text-foreground">{entry.agent}</span>
          <span className="tabular-nums">{Math.round(entry.share * 100)}%</span>
          <span className="tabular-nums">avg {shortDuration(entry.ms / Math.max(1, entry.runs))} ×{entry.runs}</span>
        </li>
      ))}
    </ul>
  )
}

function Stacked({ share }: { share: MetricsData["timeShare"]["byAgent"] }) {
  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Share of run time by agent">
      {share.map((entry) => (
        <span key={entry.agent} className={agentFill(entry.agent)} style={{ width: `${entry.share * 100}%` }} title={`${entry.agent} ${Math.round(entry.share * 100)}%`} />
      ))}
    </div>
  )
}

function TaskTimes({ times }: { times: MetricsData["timeShare"]["taskTimes"] }) {
  if (times.length === 0) return null
  const max = Math.max(...times.map((group) => group.avgMs), 1)
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Request to done, by the oracle's model</h3>
      <ul className="flex flex-col gap-3">
        {times.map((group) => (
          <BarRow
            key={`${group.model}-${group.thinking}`}
            label={[group.model, group.thinking].filter(Boolean).join(" · ")}
            value={group.avgMs}
            max={max}
            valueText={shortDuration(group.avgMs)}
            sub={`×${group.tasks}`}
          />
        ))}
      </ul>
    </div>
  )
}

/** Where the time goes: the stacked agent share, then request-to-done per oracle model. */
export function TimeShare({ timeShare }: { timeShare: MetricsData["timeShare"] }) {
  const share = timeShare.byAgent
  return (
    <ChartCard title="Where the time goes" right="share of run time by agent">
      {share.length === 0 ? (
        <p className="text-sm text-muted-foreground">No timed runs yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Stacked share={share} />
          <ShareLegend share={share} />
          <TaskTimes times={timeShare.taskTimes} />
        </div>
      )}
    </ChartCard>
  )
}
