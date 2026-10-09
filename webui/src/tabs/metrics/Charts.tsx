/**
 * The Metrics tab's charts: run time per model with its p90 marked, success as
 * a two-tone bar (what worked, what failed), and the stacked agent share with
 * the request-to-done bars. Plain divs; each bar carries an accessible label,
 * and hues come from the theme's tokens. Long lists show the first few rows
 * and a button for the rest.
 */
import { useId, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Frame, FrameHeader, FramePanel } from "@/components/reui/frame"
import type { MetricGroupInfo, MetricsData } from "@protocol"
import { sourceLabel } from "../lobby/types"
import { agentFill, duration, shortDuration, status } from "./words"

const SHOWN = 6

function TrendChart({ daily, cost }: { daily: MetricsData["daily"]; cost?: boolean }) {
  const id = useId().replace(/:/g, "")
  const reduce = useReducedMotion()
  const [active, setActive] = useState<MetricsData["daily"][number] | null>(null)
  const title = cost ? "Daily cost" : "Daily runs"
  const values = daily.map((day) => cost ? day.cost : day.runs)
  const max = Math.max(...values, cost ? 0.01 : 1)
  const scale = cost ? [0, max / 2, max] : [...new Set([0, Math.ceil(max / 2), max])]
  const start = Date.parse(daily[0]?.date ?? "1970-01-01")
  const end = Date.parse(daily.at(-1)?.date ?? "1970-01-01")
  const days = Math.max(1, (end - start) / 86_400_000)
  const x = (date: string) => 52 + ((Date.parse(date) - start) / (days * 86_400_000)) * 424
  const width = Math.max(0.5, Math.min(28, 424 / (days + 1) * 0.65))
  const format = (value: number) => cost ? `$${value.toFixed(2)}` : String(Math.round(value))
  const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
  const ticks = [...new Set([daily[0]?.date, daily[Math.floor(daily.length / 2)]?.date, daily.at(-1)?.date])].filter((date): date is string => Boolean(date))
  return <ChartCard title={title} right={cost ? "USD · per day" : "all runs · successful runs"}>
    <div className="flex min-h-5 flex-wrap items-baseline gap-x-2 text-xs" aria-live="polite">
      {active ? <><span className="font-medium">{dateLabel(active.date)}</span><span className="text-muted-foreground">{cost ? format(active.cost) : `${active.runs} runs · ${active.successes} successful`}</span></> : <span className="text-muted-foreground">Hover or focus a day to inspect it.</span>}
    </div>
    <svg viewBox="0 0 512 220" className="w-full overflow-visible" role="group" aria-label={title}>
      <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--primary)" /><stop offset="1" stopColor="var(--primary)" stopOpacity="0.5" /></linearGradient></defs>
      {scale.map((value) => <g key={value} aria-hidden="true">
        <line x1="36" x2="494" y1={180 - value / max * 144} y2={180 - value / max * 144} stroke="var(--workspace-border)" strokeDasharray="3 5" opacity="0.6" />
        <text x="29" y={184 - value / max * 144} textAnchor="end" fill="var(--muted-foreground)" fontSize="10">{format(value)}</text>
      </g>)}
      {daily.map((day, index) => {
        const value = cost ? day.cost : day.runs
        const height = value / max * 144
        const cx = start === end ? 264 : x(day.date)
        const description = `${day.date}: ${cost ? format(day.cost) : `${day.runs} runs, ${day.successes} successful`}`
        return <g key={day.date} role="img" aria-label={description} tabIndex={0} className="outline-none" onFocus={() => setActive(day)} onBlur={() => setActive(null)} onPointerEnter={() => setActive(day)} onPointerLeave={() => setActive(null)}>
          <title>{description}</title>
          <rect x={cx - Math.max(width, 12) / 2} y="26" width={Math.max(width, 12)} height="156" rx="4" fill="var(--accent)" opacity={active?.date === day.date ? 1 : 0} />
          <motion.rect data-trend-bar x={cx - width / 2} width={width} rx="3" fill={`url(#${id}-fill)`} initial={reduce ? false : { height: 0, y: 180 }} animate={{ height, y: 180 - height }} transition={{ duration: reduce ? 0 : 0.65, delay: reduce ? 0 : Math.min(index * 0.04, 0.3), ease: [0.22, 1, 0.36, 1] }} />
          {!cost ? <motion.rect x={cx - width / 2} width={width} rx="3" fill="var(--success)" initial={reduce ? false : { height: 0, y: 180 }} animate={{ height: day.successes / max * 144, y: 180 - day.successes / max * 144 }} transition={{ duration: reduce ? 0 : 0.65, delay: reduce ? 0 : Math.min(index * 0.04, 0.3) }} /> : null}
        </g>
      })}
      {ticks.map((date) => <text key={date} aria-hidden="true" x={start === end ? 264 : x(date)} y="205" textAnchor="middle" fill="var(--muted-foreground)" fontSize="11">{dateLabel(date)}</text>)}
    </svg>
    {!cost ? <div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-primary" aria-hidden="true" />All runs</span><span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-success" aria-hidden="true" />Successful</span></div> : null}
  </ChartCard>
}

export function DailyTrends({ daily }: { daily: MetricsData["daily"] }) {
  return <div className="grid gap-4 lg:grid-cols-2"><TrendChart daily={daily} /><TrendChart daily={daily} cost /></div>
}

export function ChartCard({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <Frame role="region" className="min-w-0" aria-label={title}>
      <FrameHeader className="py-2.5">
      <h2 className="flex items-baseline justify-between gap-3 text-sm font-semibold">
        <span>{title}</span>
        {right ? <span className="truncate text-xs font-normal text-muted-foreground">{right}</span> : null}
      </h2>
      </FrameHeader>
      <FramePanel className="flex min-w-0 flex-col gap-3">{children}</FramePanel>
    </Frame>
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
        <button aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
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

function AnimatedBar({ width, className, title }: { width: number; className: string; title?: string }) {
  const reduce = useReducedMotion()
  return <motion.div data-chart-bar title={title} className={`h-full ${className}`} initial={reduce ? false : { width: 0 }} animate={{ width: `${width}%` }} transition={{ duration: reduce ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }} />
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
      <div className="relative h-5 overflow-hidden rounded-md border border-border bg-muted chart-track" role="img" aria-label={`${label}: ${valueText}`}>
        <AnimatedBar className="rounded-r-md bg-linear-to-r from-primary/65 to-primary" width={pct(value, max)} />
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
      <div className="flex h-5 overflow-hidden rounded-md border border-border bg-muted" role="img" aria-label={`${label}: ${state.word}, ${text} of ${runs} runs`}>
        <AnimatedBar className="bg-success/80" width={rate * 100} />
        <AnimatedBar className="bg-destructive/60" width={(1 - rate) * 100} />
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
    <div className="flex h-6 gap-0.5 overflow-hidden rounded-md border border-border bg-muted" role="img" aria-label="Share of run time by agent">
      {share.map((entry) => (
        <AnimatedBar key={entry.agent} className={`${agentFill(entry.agent)} opacity-85`} width={entry.share * 100} title={`${entry.agent} ${Math.round(entry.share * 100)}%`} />
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
        </div>
      )}
      <TaskTimes times={timeShare.taskTimes} />
    </ChartCard>
  )
}
