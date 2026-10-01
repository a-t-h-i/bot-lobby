/**
 * The activity log: every agent's plain-words steps, oldest first, one line
 * each with a time, a colour per source and a mark per kind (a running step
 * spins, `✓` done, `!` warning, `✗` error, `·` plain). The feed caps it at
 * 400, so the pane slices the same way. Colour is never the only signal.
 */
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { formatClock } from "@/lib/format"
import { sourceColor, type ActivityEntry } from "./types"

const CAP = 400

function KindMark({ entry }: { entry: ActivityEntry }) {
  if (entry.pending) return <Spinner className="size-3" aria-hidden="true" role="presentation" />
  if (entry.kind === "error") return <span className="text-destructive">✗</span>
  if (entry.kind === "warning") return <span className="text-chart-1">!</span>
  if (entry.kind === "success") return <span className="text-chart-2">✓</span>
  return <span className="text-muted-foreground">·</span>
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="shrink-0 tabular-nums text-muted-foreground">{formatClock(entry.at)}</span>
      <span className={cn("w-20 shrink-0 truncate font-mono font-medium", sourceColor(entry.source))}>{entry.source}</span>
      <span className="mt-px shrink-0" aria-hidden="true">
        <KindMark entry={entry} />
      </span>
      <span className="sr-only">{entry.pending ? "pending" : entry.kind}</span>
      <span
        className={cn(
          "min-w-0 flex-1",
          entry.kind === "error" ? "text-destructive" : entry.pending ? "" : "text-muted-foreground"
        )}
      >
        {entry.pending ? `${entry.text}…` : entry.text}
      </span>
    </li>
  )
}

export function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  const shown = entries.slice(-CAP)
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card" aria-label="Activity">
      <header className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <h2 className="text-sm font-medium">Activity</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" role="log" aria-label="Activity">
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
