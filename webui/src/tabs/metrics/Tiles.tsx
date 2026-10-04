/**
 * The Metrics tab's stat strip: `Runs`, `Success`, `Avg run`, `Cost`, `Tasks`
 * in one flat row split by dividers, a big number under each name with its
 * context line below. The success state is a dot (and a hidden word), never colour alone.
 */
import type { MetricsData } from "@protocol"
import { duration, money, percent, shortDuration, status } from "./words"

type Tiles = MetricsData["tiles"]

const DOT = { healthy: "bg-success", shaky: "bg-warning", failing: "bg-destructive" } as const

function Stat({ label, value, sub, dot }: { label: string; value: string; sub: string; dot?: { tone: keyof typeof DOT; word: string } }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-xl leading-tight font-medium tabular-nums">
        {dot ? (
          <>
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[dot.tone]}`} />
            <span className="sr-only">{dot.word}</span>
          </>
        ) : null}
        {value}
      </span>
      <span className="truncate text-xs text-muted-foreground">{sub || " "}</span>
    </div>
  )
}

export function Tiles({ tiles }: { tiles: Tiles }) {
  const rate = tiles.runs > 0 ? tiles.successes / tiles.runs : 0
  const state = status(rate)
  const failures = tiles.runs - tiles.successes
  return (
    <div className="flat-pane grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-border">
      <Stat label="Runs" value={String(tiles.runs)} sub={tiles.runs === 0 ? "no runs yet" : ""} />
      <Stat
        label="Success"
        value={percent(tiles.successes, tiles.runs)}
        sub={`${failures} failed${tiles.stalls > 0 ? ` · ${tiles.stalls} stalled` : ""}`}
        dot={{ tone: state.tone, word: state.word }}
      />
      <Stat label="Avg run" value={duration(tiles.avgMs)} sub={`p90 ${duration(tiles.p90Ms)}`} />
      <Stat label="Cost" value={money(tiles.cost)} sub={tiles.runs > 0 ? `${money(tiles.cost / tiles.runs)} per run` : "—"} />
      <Stat
        label="Tasks"
        value={`${tiles.completed} done`}
        sub={tiles.avgCompleteMs > 0 ? `avg ${shortDuration(tiles.avgCompleteMs)} · ${tiles.active} active` : `${tiles.active} active`}
      />
    </div>
  )
}
