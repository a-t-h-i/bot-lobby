/**
 * The activity log: every agent's plain-words steps, oldest first, one row
 * each with a time, a colour per source and a mark per kind (a running step
 * spins, a tick for done, an alert for a warning, a cross for an error). The
 * feed caps it at 400, so the pane slices the same way. Colour is never the
 * only signal.
 */
import { useCallback, useEffect, useRef } from "react"
import { AlertTriangle, Check, X } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { formatClock } from "@/lib/format"
import { Frame } from "@/ui/Frame"
import { sourceColor, sourceLabel, type ActivityEntry } from "./types"

const CAP = 400

function KindMark({ entry }: { entry: ActivityEntry }) {
  if (entry.pending) return <Spinner aria-hidden="true" role="presentation" className="size-3" />
  if (entry.kind === "error") return <X aria-hidden="true" className="size-3.5 text-destructive" />
  if (entry.kind === "warning") return <AlertTriangle aria-hidden="true" className="size-3.5 text-warning" />
  if (entry.kind === "success") return <Check aria-hidden="true" className="size-3.5 text-success" />
  return <span className="size-1.5 rounded-full bg-muted-foreground/40" />
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="grid grid-cols-[2.75rem_5.5rem_1rem_minmax(0,1fr)] items-baseline gap-x-2 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-accent/50">
      <span className="text-xs tabular-nums text-muted-foreground">{formatClock(entry.at)}</span>
      <span className={cn("overflow-hidden text-xs font-medium whitespace-nowrap", sourceColor(entry.source))}>{sourceLabel(entry.source)}</span>
      <span aria-hidden="true" className="flex items-center justify-center self-center">
        <KindMark entry={entry} />
      </span>
      <span className="sr-only">{entry.pending ? "pending" : entry.kind}</span>
      <span className={cn("min-w-0 break-words", entry.kind === "error" ? "text-destructive" : entry.pending ? "" : "text-muted-foreground")}>
        {entry.pending ? `${entry.text}…` : entry.text}
      </span>
    </li>
  )
}

export function ActivityLog({ entries, collapsed, onToggle, shortcut }: { entries: ActivityEntry[]; collapsed: boolean; onToggle: () => void; shortcut?: string }) {
  const shown = entries.slice(-CAP)
  const running = shown.filter((entry) => entry.pending).length
  const scroller = useRef<HTMLDivElement | null>(null)
  const seenHeight = useRef(0)
  const last = shown.at(-1)?.id
  useEffect(() => {
    // The log always follows its newest entry, so a run's progress is never off screen.
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last])
  // Late layout, a streaming note or a resized window can grow the pane without
  // a new entry, so re-pin whenever its content height actually changed.
  const observe = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el
    if (!el) return
    seenHeight.current = el.scrollHeight
    const observer = new ResizeObserver(() => {
      const height = el.scrollHeight
      if (height === seenHeight.current) return
      seenHeight.current = height
      el.scrollTop = height
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      scroller.current = null
    }
  }, [])
  return (
    <Frame
      aria-label="Activity"
      title="Activity"
      collapsed={collapsed}
      onToggle={onToggle} shortcut={shortcut}
      note={running ? <><Spinner aria-hidden="true" role="presentation" className="size-3" /> {running} running</> : undefined}
    >
      <div ref={observe} className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-3" role="log" aria-label="Activity" tabIndex={0}>
        {shown.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No activity yet.</p>
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
