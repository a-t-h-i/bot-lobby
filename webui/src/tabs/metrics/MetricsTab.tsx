/**
 * The Metrics tab: the KPI tile row, the classifier box, the
 * average-run-time bars beside the success meters, where the time goes, and
 * the full grouped table. The group-by segmented control and the search
 * reread `metrics.get`, and the `metrics` topic rereads them too.
 */
import { useState } from "react"
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
    <div role="group" aria-label="Group by" className="flex gap-1 rounded-md bg-muted p-1">
      {(["model", "model-kind"] as const).map((value) => (
        <Button key={value} variant={groupBy === value ? "default" : "ghost"} className="rounded-md" aria-pressed={groupBy === value} onClick={() => onGroup(value)}>
          {byLabel(value)}
        </Button>
      ))}
    </div>
  )
}

function SearchBox({ query, onQuery }: { query: string; onQuery: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="metrics-search" className="text-xs font-medium text-muted-foreground">
        Search runs
      </label>
      <input
        id="metrics-search"
        type="search"
        value={query}
        maxLength={500}
        placeholder="model, agent, tool…"
        onChange={(event) => onQuery(event.target.value)}
        className="h-10 w-full min-w-48 rounded-md border border-input bg-card/40 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      />
    </div>
  )
}

function Controls(props: { groupBy: GroupBy; query: string; onGroup: (value: GroupBy) => void; onQuery: (value: string) => void }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <GroupToggle groupBy={props.groupBy} onGroup={props.onGroup} />
      <SearchBox query={props.query} onQuery={props.onQuery} />
    </div>
  )
}

function Body({ data, groupBy, query }: { data: MetricsData; groupBy: GroupBy; query: string }) {
  const label = (group: MetricsData["groups"][number]) => groupLabel(group, groupBy)
  if (data.tiles.runs === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Tiles tiles={data.tiles} />
        <p className="glass rounded-md p-4 text-sm text-muted-foreground">{query ? `No run matches "${query}".` : EMPTY}</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <Tiles tiles={data.tiles} />
      {data.classifier ? <Classifier summary={data.classifier} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
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
        <div key={tile} className="h-24 rounded-md bg-muted motion-safe:animate-pulse" />
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
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Metrics</h1>
        {read.loading && read.data ? <span className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" aria-hidden="true" role="presentation" /> refreshing</span> : null}
      </header>
      <Controls groupBy={groupBy} query={query} onGroup={setGroupBy} onQuery={setQuery} />
      {read.data ? <Body data={read.data} groupBy={groupBy} query={query} /> : <Skeleton />}
    </div>
  )
}
