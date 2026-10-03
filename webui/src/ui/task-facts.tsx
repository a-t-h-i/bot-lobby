/**
 * Small task facts the Tasks tab and the sessions page draw: the track in
 * words and the progress segments.
 */
import { CheckCircle2, Circle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"

/** A segment per step, at most eight. */
const PIPS_MAX = 8

/** `fast track (2)` or `full workflow (3)`; empty without a track. */
export function trackText(track: { path: "fast" | "full"; size: string } | undefined): string {
  if (!track) return ""
  return track.path === "fast" ? `fast track (${track.size})` : `full workflow (${track.size})`
}

function pipStates(done: number, total: number): boolean[] {
  const cells = Math.min(total, PIPS_MAX)
  if (cells <= 0) return []
  const filled = Math.min(cells, Math.round((Math.max(0, done) / total) * cells))
  return Array.from({ length: cells }, (_, index) => index < filled)
}

/** Filled and hollow segments; decorative, the numbers beside it carry the meaning. */
export function Pips({ done, total }: { done: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {pipStates(done, total).map((on, index) => (
        <span key={index} className={cn("h-1.5 w-3 rounded-full", on ? "bg-primary" : "bg-muted-foreground/25")} />
      ))}
    </span>
  )
}

/** The mark a task wears: open while there is work to do, ticked when completed, crossed when abandoned. */
export function CheckMark({ check, className }: { check: "open" | "done" | "dropped"; className?: string }) {
  const Icon = check === "done" ? CheckCircle2 : check === "dropped" ? XCircle : Circle
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", check === "done" ? "text-success" : "text-muted-foreground", className)} />
}
