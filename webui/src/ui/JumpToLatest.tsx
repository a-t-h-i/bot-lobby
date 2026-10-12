/**
 * The "back to the newest" hint over a scrolled-up log: a round button with
 * a down arrow, nothing else. Hovering bounces the arrow once.
 */
import { ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"

export function JumpToLatest({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Jump to latest"
      title="Jump to latest"
      onClick={onClick}
      className={cn("jump-latest btn-raised grid size-9 place-items-center rounded-full border bg-card text-foreground shadow-card outline-none focus-visible:ring-3 focus-visible:ring-ring/40 max-md:size-11", className)}
    >
      <ArrowDown aria-hidden="true" className="size-4" />
    </button>
  )
}
