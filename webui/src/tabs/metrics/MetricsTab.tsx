/**
 * The Metrics tab: the KPI tile row, the classifier box, the
 * average-run-time bars beside the success meters, where the time goes, and
 * the full grouped table. The group-by segmented control and the search
 * reread `metrics.get`, and the `metrics` topic rereads them too.
 */
import { useState } from "react"
import { Search } from "lucide-react"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { Button } from "@/components/ui/button"
import { Keys } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { AvgTime, DailyTrends, SuccessRate, TimeShare } from "./Charts"
import { DateFilter, type DateRange } from "./DateFilter"
import { Classifier } from "./Classifier"
import { MetricsTable } from "./MetricsTable"
import { Tiles } from "./Tiles"
import { byLabel, groupLabel, type GroupBy } from "./words"
import type { MetricsData } from "@protocol"

const EMPTY = "No runs recorded yet. Every Master turn, subagent run, quick fix and planning round lands here with its model, thinking level, time, tokens and cost."

function GroupToggle({ groupBy, onGroup }: { groupBy: GroupBy; onGroup: (value: GroupBy) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Group by"
      className="flex max-w-full flex-wrap gap-0.5 rounded-lg bg-muted p-0.5"
      onKeyDown={(event) => {
        // Arrows move between the choices and pick, as a radio group does.
        const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
        if (!step) return
        event.preventDefault()
        const order = ["model", "model-kind"] as const
        const next = order[(order.indexOf(groupBy) + step + order.length) % order.length]!
        onGroup(next)
        requestAnimationFrame(() => event.currentTarget.querySelector<HTMLElement>("[aria-checked='true']")?.focus())
      }}
    >
      {(["model", "model-kind"] as const).map((value) => (
        <Button
          key={value}
          variant="ghost"
          size="sm"
          role="radio"
          tabIndex={groupBy === value ? 0 : -1}
          className={groupBy === value ? "bg-card text-foreground shadow-card hover:bg-card" : "text-muted-foreground"}
          aria-checked={groupBy === value}
          onClick={() => onGroup(value)}
        >
          {byLabel(value)}
        </Button>
      ))}
    </div>
  )
}

function SearchBox({ query, onQuery }: { query: string; onQuery: (value: string) => void }) {
  return (
    <label className="relative flex max-w-full items-center">
      <span className="sr-only">Search runs</span>
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
      <input
        id="metrics-search"
        type="search"
        value={query}
        maxLength={500}
        placeholder="Search runs: model, agent, tool…"
        onChange={(event) => onQuery(event.target.value)}
        className="h-8 w-64 max-w-full rounded-lg border border-input bg-background pr-9 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
      />
      <Keys chord="/" className="kbd-hint pointer-events-none absolute right-2" />
    </label>
  )
}

function Body({ data, groupBy, query }: { data: MetricsData; groupBy: GroupBy; query: string }) {
  const label = (group: MetricsData["groups"][number]) => groupLabel(group, groupBy)
  return (
    <div className="flex flex-col gap-4">
      <Tiles tiles={data.tiles} />
      {data.tiles.runs === 0 ? <p className="card-raised rounded-xl border p-4 text-sm text-muted-foreground">{query ? `No run matches "${query}" in this period.` : `No runs in this period. ${EMPTY}`}</p> : null}
      {data.daily.length > 0 ? <DailyTrends daily={data.daily} /> : null}
      {data.classifier ? <Classifier summary={data.classifier} /> : null}
      {data.tiles.runs > 0 ? <><div className="grid gap-4 lg:grid-cols-2">
        <AvgTime groups={data.groups} label={label} />
        <SuccessRate groups={data.groups} label={label} />
      </div>
      <MetricsTable groups={data.groups} groupBy={groupBy} />
      </> : null}
      {data.tiles.runs > 0 || data.timeShare.taskTimes.length > 0 ? <TimeShare timeShare={data.timeShare} /> : null}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="status" aria-label="Loading metrics">
      {[0, 1, 2, 3, 4].map((tile) => (
        <div key={tile} className="h-20 rounded-lg bg-muted motion-safe:animate-pulse" />
      ))}
    </div>
  )
}

export function MetricsTab() {
  const [groupBy, setGroupBy] = useState<GroupBy>("model")
  const [query, setQuery] = useState("")
  const [range, setRange] = useState<DateRange>({})
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const read = useApiRead("metrics.get", { groupBy, query, ...range, timeZone }, ["metrics"])
  if (!read.data && read.error) return <ErrorState message={`Could not load metrics. ${read.error}`} onRetry={read.reload} />
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 pt-5 pb-dock">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div><h1 className="text-lg font-semibold tracking-tight">Metrics</h1><p className="mt-1 text-xs text-muted-foreground">Daily trends and model performance</p></div>
        {read.loading && read.data ? <span className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" aria-hidden="true" role="presentation" /> refreshing</span> : null}
        <span aria-hidden="true" className="min-w-4 flex-1" />
      </header>
      <section aria-label="Metrics filters" className="workspace-section flex flex-wrap items-end gap-4 rounded-xl border p-4">
        <DateFilter onChange={setRange} />
        <div className="flex w-full min-w-0 flex-wrap items-end gap-3 lg:w-auto lg:flex-1 lg:justify-end">
          <GroupToggle groupBy={groupBy} onGroup={setGroupBy} />
          <SearchBox query={query} onQuery={setQuery} />
        </div>
        <p className="w-full text-xs text-muted-foreground">{range.from ? `${range.from} – ${range.to}` : "All recorded dates"} · {timeZone}. Runs and active tasks use their start date; completed tasks use their completion date.</p>
      </section>
      {read.error ? <p role="alert" className="text-sm text-destructive">Could not refresh metrics. {read.error}</p> : null}
      <div aria-busy={read.loading} className={read.loading && read.data ? "opacity-60" : undefined}>
        {read.data ? <Body key={JSON.stringify([read.data, groupBy])} data={read.data} groupBy={groupBy} query={query} /> : <Skeleton />}
      </div>
    </div>
  )
}
