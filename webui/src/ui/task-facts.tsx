/**
 * Small task facts the Tasks tab and the sessions page draw: the track in
 * words and the progress segments.
 */
import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"

/** A segment per step, at most eight. */
const PIPS_MAX = 8

/** `fast track (2)` or `full workflow (3)`; empty without a track. */
export function trackText(track: { path: "fast" | "full"; size: string } | undefined): string {
  if (!track) return ""
  return track.path === "fast" ? `fast track (${track.size})` : `full workflow (${track.size})`
}

/** Filled and hollow segments (`cs-pips` draws them, the fill growing as steps finish); decorative, the numbers beside it carry the meaning. */
export function Pips({ done, total }: { done: number; total: number }) {
  const cells = Math.min(total, PIPS_MAX)
  if (cells <= 0) return null
  const filled = Math.min(cells, Math.round((Math.max(0, done) / total) * cells))
  return <span className="cs-pips" aria-hidden="true" style={{ "--n": cells, "--d": filled } as CSSProperties} />
}

/** A step's or a task's mark, as the design draws it: a sunk dot, a pulse while it runs, an amber dot while it waits, a green tick, a cross, a slash. */
export type Mark = "open" | "now" | "warn" | "done" | "drop" | "skip"

export function MarkDot({ mark, className }: { mark: Mark; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("cs-mk", className)} data-s={mark === "open" ? undefined : mark}>
      <svg className="cs-ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      <svg className="cs-xx" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7l10 10M17 7L7 17" /></svg>
      <svg className="cs-sl" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 18L18 6" /></svg>
    </span>
  )
}

/** The mark a task wears: open while there is work to do (pulsing while it runs, amber while it waits on someone), ticked when completed, crossed when abandoned. */
export function CheckMark({ check, live, waiting, className }: { check: "open" | "done" | "dropped"; live?: boolean; waiting?: boolean; className?: string }) {
  const mark: Mark = check === "done" ? "done" : check === "dropped" ? "drop" : waiting ? "warn" : live ? "now" : "open"
  return <MarkDot mark={mark} {...(className ? { className } : {})} />
}

/** What a task in auto mode shows, and the line the lobby leaves where auto mode kept the oracle going (src/lobby/feed.ts AUTO_NOTE). */
export const AUTO_NOTE = "auto mode"

/** `auto mode`, in muted green. */
export function AutoModeText() {
  return <span className="auto-mode-text">{AUTO_NOTE}</span>
}
