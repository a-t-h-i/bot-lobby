/**
 * The activity log: every agent's plain-words steps, oldest first, one line
 * each with a time, a colour per source and a mark per kind (a running step
 * spins, `✓` done, `!` warning, `✗` error, `·` plain). The feed caps it at
 * 400, so the pane slices the same way. Colour is never the only signal.
 */
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { formatClock } from "@/lib/format"
import { Frame } from "@/ui/Frame"
import { sourceColor, type ActivityEntry } from "./types"

const CAP = 400

function KindMark({ entry }: { entry: ActivityEntry }) {
  if (entry.pending) return <Spinner aria-hidden="true" role="presentation" />
  if (entry.kind === "error") return <span className="text-destructive">✗</span>
  if (entry.kind === "warning") return <span className="text-warning">!</span>
  if (entry.kind === "success") return <span className="text-success">✓</span>
  return <span className="text-muted-foreground">·</span>
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="grid grid-cols-[5ch_9ch_1ch_minmax(0,1fr)] gap-x-[1ch] text-sm">
      <span className="tabular-nums text-muted-foreground">{formatClock(entry.at)}</span>
      <span className={cn("overflow-hidden whitespace-nowrap", sourceColor(entry.source))}>{entry.source}</span>
      <span aria-hidden="true">
        <KindMark entry={entry} />
      </span>
      <span className="sr-only">{entry.pending ? "pending" : entry.kind}</span>
      <span
        className={cn(
          "min-w-0 break-words",
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
  const running = shown.filter((entry) => entry.pending).length
  return (
    <Frame
      aria-label="Activity"
      title="Activity"
      note={running ? <><Spinner aria-hidden="true" role="presentation" /> {running} running</> : undefined}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-[1ch] pb-1" role="log" aria-label="Activity" tabIndex={0}>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul>
            {shown.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </div>
    </Frame>
  )
}
