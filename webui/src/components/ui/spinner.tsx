import { useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"

/** The terminal's spinner (`SPINNER` in src/lobby/layout.ts). */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const FRAME_MS = 80

/** One clock for every spinner on the page, running only while one is shown. */
let tick = 0
let timer: number | undefined
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (timer === undefined && !still) {
    timer = window.setInterval(() => {
      tick += 1
      for (const notify of listeners) notify()
    }, FRAME_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  }
}

function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  const frame = useSyncExternalStore(subscribe, () => tick % FRAMES.length)
  return (
    <span data-slot="spinner" role="status" aria-label="Loading" className={cn("inline-block text-primary", className)} {...props}>
      <span aria-hidden="true">{FRAMES[frame]}</span>
    </span>
  )
}

export { Spinner }
