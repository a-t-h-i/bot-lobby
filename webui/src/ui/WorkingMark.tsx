/**
 * The mark for work under way: a comet that circles a faint ring, easing in
 * and out of each lap (nothing in the middle, at the user's ask), in the colour of whoever is at work (set
 * `--orb` on it or an ancestor). Still under `prefers-reduced-motion`.
 */
import { cn } from "@/lib/utils"

export function WorkingMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" data-slot="working-mark" className={cn("working-mark", className)} />
  )
}
