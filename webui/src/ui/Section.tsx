/**
 * A detail section as the design draws it: a small label running into a hairline, with an optional note at
 * the far end, then its content on the flat page (no card). `prominent` is for the groups of a page (Settings).
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Section({ title, right, prominent, children }: { title: string; right?: string; prominent?: boolean; children: ReactNode }) {
  return (
    <section className={cn("cs-sec flex min-w-0 flex-col", prominent && "cs-prom")}>
      <h3 className="cs-rl">
        <span className="min-w-0 truncate">{title}</span>
        {right ? <span className="cs-rr">{right}</span> : null}
      </h3>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  )
}
