// Adapted from T3 Code (MIT), apps/web/src/components/chat/WorkLog.tsx
/**
 * Activity in the conversation, as work-log rows after the coding harnesses: each run of
 * agents' steps between two messages folds into one quiet line ("Worked
 * for 2m 59s · 6 steps · Master, Dev, QA"), or, while a step is running, that
 * step beside the working mark, in its agent's colour: the word "Working"
 * glints, each new step slides in over the last and the clock counts up.
 * Opening it lists the steps as quiet lines, each with a
 * mark per kind (the working mark for a running step, a tick for done, an alert for a
 * warning, a cross for an error) and its agent in its colour. Colour is never
 * the only signal. Alt+A opens or folds every run.
 */
import { useEffect, useId, useState, type CSSProperties } from "react"
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react"
import { useCollapsed } from "@/lib/collapsed"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"
import { WorkingMark } from "@/ui/WorkingMark"
import { linkFiles } from "@/app/code/FileLink"
import { ShimmerWord } from "./ChatParts"
import { sourceColor, sourceLabel, sourceTone, type ActivityEntry } from "./types"

/** Whether every run of steps is open; remembered in this browser (`useCollapsed` stores it, folded is the default). */
export const ACTIVITY_OPEN = "lobby.activity.open"

function KindMark({ entry }: { entry: ActivityEntry }) {
  if (entry.pending) return <WorkingMark className="size-3" />
  if (entry.kind === "error") return <X aria-hidden="true" className="size-3.5 text-destructive" />
  if (entry.kind === "warning") return <AlertTriangle aria-hidden="true" className="size-3.5 text-warning" />
  if (entry.kind === "success") return <Check aria-hidden="true" className="size-3.5 text-success" />
  return <span className="size-1.5 rounded-full bg-muted-foreground/40" />
}

function StepRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="activity-step" title={formatClock(entry.at)} style={entry.pending ? ({ "--orb": sourceTone(entry.source) } as CSSProperties) : undefined}>
      <span aria-hidden="true" className="flex h-5 w-6 items-center justify-center">
        <KindMark entry={entry} />
      </span>
      <span className="sr-only">{entry.pending ? "pending" : entry.kind}</span>
      <span className="min-w-0 break-words">
        <span className={cn("font-medium", sourceColor(entry.source))}>{sourceLabel(entry.source)}</span>{" "}
        <span className={entry.kind === "error" ? "text-destructive" : entry.pending ? "text-foreground" : undefined}>{linkFiles(entry.text)}{entry.pending ? "…" : ""}</span>
      </span>
    </li>
  )
}

/** How long a run took, as the harnesses put it: `48s`, `2m 59s`, `1h 04m`. */
export function workedFor(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

/** The words on the folded line: the running step, or how many steps and whose. */
export function summary(entries: ActivityEntry[]): { live?: ActivityEntry; took: number; count: string; sources: string; errors: number; warnings: number } {
  const live = [...entries].reverse().find((entry) => entry.pending)
  const sources = [...new Set(entries.map((entry) => sourceLabel(entry.source)))]
  return {
    ...(live ? { live } : {}),
    took: (entries.at(-1)?.at ?? 0) - (entries[0]?.at ?? 0),
    count: `${entries.length} ${entries.length === 1 ? "step" : "steps"}`,
    sources: sources.length > 3 ? `${sources.slice(0, 3).join(", ")} +${sources.length - 3}` : sources.join(", "),
    errors: entries.filter((entry) => entry.kind === "error").length,
    warnings: entries.filter((entry) => entry.kind === "warning").length,
  }
}

/** The time now, ticking each second while `running`. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return now
}

export function InlineActivity({ entries }: { entries: ActivityEntry[] }) {
  const [all] = useCollapsed(ACTIVITY_OPEN)
  const [own, setOwn] = useState<boolean>()
  // Alt+A speaks for every run at once: a run opened or folded by hand follows it again.
  useEffect(() => setOwn(undefined), [all])
  const open = own ?? all
  const list = useId()
  const { live, took, count, sources, errors, warnings } = summary(entries)
  const now = useNow(Boolean(live))
  const style = live ? ({ "--orb": sourceTone(live.source) } as CSSProperties) : undefined
  return (
    <div className="activity-run" data-live={live ? true : undefined} data-open={open || undefined} style={style}>
      <button type="button" aria-expanded={open} aria-controls={list} onClick={() => setOwn(!open)} className="activity-toggle">
        {live ? (
          <>
            <WorkingMark />
            <span className="min-w-0 truncate">
              <ShimmerWord text="Working" />
              <span className="text-muted-foreground"> · </span>
              <span key={live.id} className="activity-live-step">
                <span className={cn("font-medium", sourceColor(live.source))}>{sourceLabel(live.source)}</span> <span className="text-foreground">{live.text}…</span>
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              {count}
              {entries[0] && now - entries[0].at >= 1000 ? ` · ${workedFor(now - entries[0].at)}` : ""}
            </span>
          </>
        ) : (
          <span className="min-w-0 truncate">
            <span className="font-medium">{took >= 1000 ? `Worked for ${workedFor(took)}` : "Worked"}</span>
            <span> · {count}{sources ? ` · ${sources}` : ""}</span>
          </span>
        )}
        {errors ? <span className="shrink-0 text-destructive">{errors} {errors === 1 ? "error" : "errors"}</span> : null}
        {warnings ? <span className="shrink-0 text-warning">{warnings} {warnings === 1 ? "warning" : "warnings"}</span> : null}
        <ChevronDown aria-hidden="true" className="activity-chevron size-3.5 shrink-0" />
      </button>
      {open ? (
        <ol id={list} aria-label="Activity" className="activity-steps">
          {entries.map((entry) => (
            <StepRow key={entry.id} entry={entry} />
          ))}
        </ol>
      ) : null}
    </div>
  )
}
