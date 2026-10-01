/**
 * The Metrics tab's KPI row (batch-2 §j): `Runs`, `Success`, `Avg run`,
 * `Cost`, `Tasks`, each a card with the terminal's value and context line
 * (`tileRow`). The Runs sparkline is not on the wire, so its context reads
 * `no runs yet` when there is nothing to draw.
 */
import type { MetricsData } from "@protocol"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { duration, money, percent, shortDuration, status, toneClass } from "./words"

type Tiles = MetricsData["tiles"]

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <Card size="sm" className="gap-1">
      <CardHeader>
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        <span className={`text-2xl leading-tight font-medium tabular-nums ${tone ?? "text-foreground"}`}>{value}</span>
        <span className="text-xs text-muted-foreground">{sub || "\u00a0"}</span>
      </CardContent>
    </Card>
  )
}

function successTile(tiles: Tiles) {
  const rate = tiles.runs > 0 ? tiles.successes / tiles.runs : 0
  const state = status(rate)
  const failures = tiles.runs - tiles.successes
  const sub = `${failures} failed${tiles.stalls > 0 ? ` · ${tiles.stalls} stalled` : ""}`
  return { value: `${state.icon} ${percent(tiles.successes, tiles.runs)}`, sub, tone: toneClass(state.tone) }
}

export function Tiles({ tiles }: { tiles: Tiles }) {
  const success = successTile(tiles)
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="Runs" value={String(tiles.runs)} sub={tiles.runs === 0 ? "no runs yet" : ""} />
      <Tile label="Success" value={success.value} sub={success.sub} tone={success.tone} />
      <Tile label="Avg run" value={duration(tiles.avgMs)} sub={`p90 ${duration(tiles.p90Ms)}`} />
      <Tile label="Cost" value={money(tiles.cost)} sub={tiles.runs > 0 ? `${money(tiles.cost / tiles.runs)} per run` : "—"} />
      <Tile
        label="Tasks"
        value={`${tiles.completed} done`}
        sub={tiles.avgCompleteMs > 0 ? `avg ${shortDuration(tiles.avgCompleteMs)} · ${tiles.active} active` : `${tiles.active} active`}
      />
    </div>
  )
}
