/**
 * Activity in the conversation: each run of agents' steps between two
 * messages folds into one quiet line ("6 steps · Master, Dev, QA"), or, while
 * a step is running, the step itself with a spinner. Opening it lists the
 * steps, one row each with a time, a colour per source and a mark per kind (a
 * running step spins, a tick for done, an alert for a warning, a cross for an
 * error). Colour is never the only signal. Alt+A opens or folds every run.
 */
import { useEffect, useId, useState } from "react"
import { AlertTriangle, Check, ChevronRight, X } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { useCollapsed } from "@/lib/collapsed"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"
import { sourceColor, sourceLabel, type ActivityEntry } from "./types"

/** Whether every run of steps is open; remembered in this browser (`useCollapsed` stores it, folded is the default). */
export const ACTIVITY_OPEN = "lobby.activity.open"

function KindMark({ entry }: { entry: ActivityEntry }) {
  if (entry.pending) return <Spinner aria-hidden="true" role="presentation" className="size-3" />
  if (entry.kind === "error") return <X aria-hidden="true" className="size-3.5 text-destructive" />
  if (entry.kind === "warning") return <AlertTriangle aria-hidden="true" className="size-3.5 text-warning" />
  if (entry.kind === "success") return <Check aria-hidden="true" className="size-3.5 text-success" />
  return <span className="size-1.5 rounded-full bg-muted-foreground/40" />
}

function StepRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="activity-step">
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

/** The words on the folded line: the running step, or how many steps and whose. */
function summary(entries: ActivityEntry[]): { live?: ActivityEntry; count: string; sources: string; errors: number; warnings: number } {
  const live = [...entries].reverse().find((entry) => entry.pending)
  const sources = [...new Set(entries.map((entry) => sourceLabel(entry.source)))]
  return {
    ...(live ? { live } : {}),
    count: `${entries.length} ${entries.length === 1 ? "step" : "steps"}`,
    sources: sources.length > 3 ? `${sources.slice(0, 3).join(", ")} +${sources.length - 3}` : sources.join(", "),
    errors: entries.filter((entry) => entry.kind === "error").length,
    warnings: entries.filter((entry) => entry.kind === "warning").length,
  }
}

export function InlineActivity({ entries }: { entries: ActivityEntry[] }) {
  const [all] = useCollapsed(ACTIVITY_OPEN)
  const [own, setOwn] = useState<boolean>()
  // Alt+A speaks for every run at once: a run opened or folded by hand follows it again.
  useEffect(() => setOwn(undefined), [all])
  const open = own ?? all
  const list = useId()
  const { live, count, sources, errors, warnings } = summary(entries)
  return (
    <div className="activity-run" data-live={live ? true : undefined} data-open={open || undefined}>
      <button type="button" aria-expanded={open} aria-controls={list} onClick={() => setOwn(!open)} className="activity-toggle">
        <span aria-hidden="true" className="activity-mark">
          {live ? <Spinner role="presentation" className="size-3.5" /> : errors ? <X className="size-3.5 text-destructive" /> : <Check className="size-3.5" />}
        </span>
        {live ? (
          <span className="min-w-0 truncate">
            <span className={cn("font-medium", sourceColor(live.source))}>{sourceLabel(live.source)}</span> <span className="text-foreground">{live.text}…</span>
          </span>
        ) : (
          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground/80">{count}</span>
            {sources ? <span> · {sources}</span> : null}
          </span>
        )}
        {live ? <span className="shrink-0 tabular-nums">{count}</span> : null}
        {errors ? <span className="shrink-0 text-destructive">{errors} {errors === 1 ? "error" : "errors"}</span> : null}
        {warnings ? <span className="shrink-0 text-warning">{warnings} {warnings === 1 ? "warning" : "warnings"}</span> : null}
        <ChevronRight aria-hidden="true" className="activity-chevron size-3.5 shrink-0" />
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
