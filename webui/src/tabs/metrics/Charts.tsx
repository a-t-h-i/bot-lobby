/**
 * The Metrics tab's charts: run time per model with its p90 marked, success as
 * a two-tone bar (what worked, what failed), and the stacked agent share with
 * the request-to-done bars. Plain divs; each bar carries an accessible label,
 * and hues come from the theme's tokens. Long lists show the first few rows
 * and a button for the rest.
 */
import { useState } from "react"
import type { MetricGroupInfo, MetricsData } from "@protocol"
import { sourceLabel } from "../lobby/types"
import { agentFill, duration, shortDuration, status } from "./words"

const SHOWN = 6

function ChartCard({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <section className="glass flex min-w-0 flex-col gap-3 rounded-lg px-4 py-3" aria-label={title}>
      <h2 className="flex items-baseline justify-between gap-3 text-sm font-medium">
        <span>{title}</span>
        {right ? <span className="truncate text-xs font-normal text-muted-foreground">{right}</span> : null}
      </h2>
      {children}
    </section>
  )
}

/** The first rows of a list, and "Show all n" for the rest. */
function Rows<T>({ rows, render }: { rows: T[]; render: (row: T) => React.ReactNode }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, SHOWN)
  return (
    <>
      <ul className="flex flex-col gap-2.5">{shown.map(render)}</ul>
      {rows.length > SHOWN ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((now) => !now)}
          className="h-6 self-start rounded-lg text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </>
  )
}

function pct(value: number, max: number): number {
  return max > 0 ? Math.max(1.5, (value / max) * 100) : 0
}

function BarRow({ label, value, marker, max, valueText, sub }: { label: string; value: number; marker?: number; max: number; valueText: string; sub: string }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
        <span className="shrink-0 tabular-nums">
          {valueText}
          {sub ? <span className="ml-2 text-xs text-muted-foreground">{sub}</span> : null}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted" role="img" aria-label={`${label}: ${valueText}`}>
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct(value, max)}%` }} />
        {marker ? <span aria-hidden="true" className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-foreground/40" style={{ left: `${Math.min(99.5, pct(marker, max))}%` }} /> : null}
      </div>
    </li>
  )
}

/** Average run time per model and thinking level, longest first, with the p90 as a tick. */
export function AvgTime({ groups, label }: { groups: MetricGroupInfo[]; label: (group: MetricGroupInfo) => string }) {
  const rows = groups.filter((group) => group.avgMs > 0).sort((a, b) => b.avgMs - a.avgMs)
  const max = Math.max(...rows.map((group) => Math.max(group.avgMs, group.p90Ms)), 1)
  return (
    <ChartCard title="Average run time" right="per model · thinking · tick is p90">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No timed runs yet.</p>
      ) : (
        <Rows
          rows={rows}
          render={(group) => <BarRow key={label(group)} label={label(group)} value={group.avgMs} marker={group.p90Ms} max={max} valueText={duration(group.avgMs)} sub={`p90 ${duration(group.p90Ms)}`} />}
        />
      )}
    </ChartCard>
  )
}

const DOT = { healthy: "bg-success", shaky: "bg-warning", failing: "bg-destructive" } as const
const TEXT = { healthy: "text-success", shaky: "text-warning", failing: "text-destructive" } as const

function MeterRow({ label, rate, runs }: { label: string; rate: number; runs: number }) {
  const state = status(rate)
  const text = `${Math.round(rate * 100)}%`
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          <span className={`flex items-center gap-1.5 ${TEXT[state.tone]}`}>
            <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[state.tone]}`} />
            <span className="sr-only">{state.word}</span>
            {text}
          </span>
          <span className="text-xs text-muted-foreground">{runs} run{runs === 1 ? "" : "s"}</span>
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${state.word}, ${text} of ${runs} runs`}>
        <div className="h-full bg-success/70" style={{ width: `${rate * 100}%` }} />
        <div className="h-full bg-destructive/45" style={{ width: `${(1 - rate) * 100}%` }} />
      </div>
    </li>
  )
}

/** Success rate per model and thinking level, weakest first. */
export function SuccessRate({ groups, label }: { groups: MetricGroupInfo[]; label: (group: MetricGroupInfo) => string }) {
  const rows = groups.filter((group) => group.runs > 0).sort((a, b) => a.successes / a.runs - b.successes / b.runs)
  return (
    <ChartCard title="Success rate" right="green worked · red failed">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <Rows rows={rows} render={(group) => <MeterRow key={label(group)} label={label(group)} rate={group.successes / group.runs} runs={group.runs} />} />
      )}
    </ChartCard>
  )
}

function ShareLegend({ share }: { share: MetricsData["timeShare"]["byAgent"] }) {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
      {share.map((entry) => (
        <li key={entry.agent} className="flex items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${agentFill(entry.agent)}`} aria-hidden="true" />
          <span className="text-[0.8125rem]">{sourceLabel(entry.agent)}</span>
          <span className="tabular-nums">{Math.round(entry.share * 100)}%</span>
          <span className="text-muted-foreground tabular-nums">
            avg {shortDuration(entry.ms / Math.max(1, entry.runs))} ×{entry.runs}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Stacked({ share }: { share: MetricsData["timeShare"]["byAgent"] }) {
  return (
    <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Share of run time by agent">
      {share.map((entry) => (
        <span key={entry.agent} className={`${agentFill(entry.agent)} opacity-75 first:rounded-l-full last:rounded-r-full`} style={{ width: `${entry.share * 100}%` }} title={`${entry.agent} ${Math.round(entry.share * 100)}%`} />
      ))}
    </div>
  )
}

function TaskTimes({ times }: { times: MetricsData["timeShare"]["taskTimes"] }) {
  if (times.length === 0) return null
  const max = Math.max(...times.map((group) => group.avgMs), 1)
  return (
    <div className="flex flex-col gap-2.5 pt-1">
      <h3 className="text-xs text-muted-foreground">Request to done, by the oracle's model</h3>
      <Rows
        rows={times}
        render={(group) => (
          <BarRow
            key={`${group.model}-${group.thinking}`}
            label={[group.model, group.thinking].filter(Boolean).join(" · ")}
            value={group.avgMs}
            max={max}
            valueText={shortDuration(group.avgMs)}
            sub={`×${group.tasks}`}
          />
        )}
      />
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
