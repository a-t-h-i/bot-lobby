/** A detail section: a small muted heading with an optional note at the far end, then its content. `prominent` is for the groups of a page (Settings). */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Rule } from "./Frame"

export function Section({ title, right, prominent, children }: { title: string; right?: string; prominent?: boolean; children: ReactNode }) {
  return (
    <section className={cn("flex flex-col", prominent ? "gap-3" : "gap-2.5")}>
      <h3 className={prominent ? "text-sm text-foreground" : "text-xs text-muted-foreground"}>
        <Rule title={title} right={right} className={prominent ? "[&>span:first-child]:font-semibold" : undefined} />
      </h3>
      {children}
    </section>
  )
}
