import { Layers, Monitor, SquareTerminal } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Where } from "./words"

const ICONS = { "this window": Monitor, background: Layers, "other terminal": SquareTerminal } as const

/** Where a session runs, as a small icon (the words say it too). */
export function WhereIcon({ where, className }: { where: Where; className?: string }) {
  const Icon = ICONS[where]
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground", className)} />
}
