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
import { Spinner } from "@/components/ui/spinner"
import { AvgTime, SuccessRate, TimeShare } from "./Charts"
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
      className="flex gap-0.5 rounded-lg bg-muted p-0.5"
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
          className={groupBy === value ? "bg-tab text-foreground hover:bg-tab" : "text-muted-foreground"}
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
    <label className="relative flex items-center">
      <span className="sr-only">Search runs</span>
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
      <input
        id="metrics-search"
        type="search"
        value={query}
        maxLength={500}
        placeholder="Search runs: model, agent, tool…"
        onChange={(event) => onQuery(event.target.value)}
        className="h-7 w-64 max-w-full rounded-lg border border-input bg-card/40 pr-3 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
      />
    </label>
  )
}

function Body({ data, groupBy, query }: { data: MetricsData; groupBy: GroupBy; query: string }) {
  const label = (group: MetricsData["groups"][number]) => groupLabel(group, groupBy)
  if (data.tiles.runs === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Tiles tiles={data.tiles} />
        <p className="flat-pane p-4 text-sm text-muted-foreground">{query ? `No run matches "${query}".` : EMPTY}</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <Tiles tiles={data.tiles} />
      {data.classifier ? <Classifier summary={data.classifier} /> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <AvgTime groups={data.groups} label={label} />
        <SuccessRate groups={data.groups} label={label} />
      </div>
      <TimeShare timeShare={data.timeShare} />
      <MetricsTable groups={data.groups} groupBy={groupBy} />
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
  const read = useApiRead("metrics.get", { groupBy, query }, ["metrics"])
  if (!read.data && read.error) return <ErrorState message={`Could not load metrics. ${read.error}`} onRetry={read.reload} />
  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-2">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-base font-medium">Metrics</h1>
        {read.loading && read.data ? <span className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" aria-hidden="true" role="presentation" /> refreshing</span> : null}
        <span aria-hidden="true" className="min-w-4 flex-1" />
        <GroupToggle groupBy={groupBy} onGroup={setGroupBy} />
        <SearchBox query={query} onQuery={setQuery} />
      </header>
      {read.data ? <Body data={read.data} groupBy={groupBy} query={query} /> : <Skeleton />}
    </div>
  )
}
