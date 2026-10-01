/**
 * Small task facts the Lobby header and the Tasks tab both draw: the track in
 * words and the progress pips. Wording mirrors `src/lobby/tabs/tasks.ts`.
 */
import { cn } from "@/lib/utils"

/** A pip per step, at most eight, as the terminal's `pips` does. */
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

/** Filled and hollow pips; decorative, the numbers beside it carry the meaning. */
export function Pips({ done, total }: { done: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 align-middle" aria-hidden="true">
      {pipStates(done, total).map((on, index) => (
        <span key={index} className={cn("h-1.5 w-3 rounded-full", on ? "bg-primary" : "bg-border")} />
      ))}
    </span>
  )
}
