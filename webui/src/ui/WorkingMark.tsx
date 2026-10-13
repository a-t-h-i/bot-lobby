/**
 * The mark for work under way: a comet that circles a softly beating core,
 * easing in and out of each lap, in the colour of whoever is at work (set
 * `--orb` on it or an ancestor). Still under `prefers-reduced-motion`.
 */
import { cn } from "@/lib/utils"

export function WorkingMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" data-slot="working-mark" className={cn("working-mark", className)}>
      <span className="working-mark-core" />
    </span>
  )
}
