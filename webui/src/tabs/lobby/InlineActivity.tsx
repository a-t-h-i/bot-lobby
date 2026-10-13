/**
 * Activity in the conversation, after the coding harnesses: each run of
 * agents' steps between two messages folds into one line over a rule ("Worked
 * for 2m 59s · 6 steps · Master, Dev, QA"), or, while a step is running, that
 * step with a spinner. Opening it lists the steps as quiet lines, each with a
 * mark per kind (a running step spins, a tick for done, an alert for a
 * warning, a cross for an error) and its agent in its colour. Colour is never
 * the only signal. Alt+A opens or folds every run.
 */
import { useEffect, useId, useState } from "react"
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react"
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
    <li className="activity-step" title={formatClock(entry.at)}>
      <span aria-hidden="true" className="flex h-5 items-center justify-center">
        <KindMark entry={entry} />
      </span>
      <span className="sr-only">{entry.pending ? "pending" : entry.kind}</span>
      <span className="min-w-0 break-words">
        <span className={cn("font-medium", sourceColor(entry.source))}>{sourceLabel(entry.source)}</span>{" "}
        <span className={entry.kind === "error" ? "text-destructive" : entry.pending ? "text-foreground" : "text-muted-foreground"}>{entry.pending ? `${entry.text}…` : entry.text}</span>
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
function summary(entries: ActivityEntry[]): { live?: ActivityEntry; took: number; count: string; sources: string; errors: number; warnings: number } {
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

export function InlineActivity({ entries }: { entries: ActivityEntry[] }) {
  const [all] = useCollapsed(ACTIVITY_OPEN)
  const [own, setOwn] = useState<boolean>()
  // Alt+A speaks for every run at once: a run opened or folded by hand follows it again.
  useEffect(() => setOwn(undefined), [all])
  const open = own ?? all
  const list = useId()
  const { live, took, count, sources, errors, warnings } = summary(entries)
  return (
    <div className="activity-run" data-live={live ? true : undefined} data-open={open || undefined}>
      <button type="button" aria-expanded={open} aria-controls={list} onClick={() => setOwn(!open)} className="activity-toggle">
        {live ? (
          <>
            <Spinner aria-hidden="true" role="presentation" className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              <span className="activity-shimmer">Working</span>
              <span className="text-muted-foreground"> · </span>
              <span className={cn("font-medium", sourceColor(live.source))}>{sourceLabel(live.source)}</span> <span className="text-foreground">{live.text}…</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>
          </>
        ) : (
          <span className="min-w-0 truncate">
            <span className="text-foreground">{took >= 1000 ? `Worked for ${workedFor(took)}` : "Worked"}</span>
            <span className="text-muted-foreground"> · {count}{sources ? ` · ${sources}` : ""}</span>
          </span>
        )}
        {errors ? <span className="shrink-0 text-destructive">{errors} {errors === 1 ? "error" : "errors"}</span> : null}
        {warnings ? <span className="shrink-0 text-warning">{warnings} {warnings === 1 ? "warning" : "warnings"}</span> : null}
        <ChevronDown aria-hidden="true" className="activity-chevron size-4 shrink-0 text-muted-foreground" />
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
