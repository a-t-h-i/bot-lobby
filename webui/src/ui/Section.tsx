/** A detail section: a heading with a hairline after it and an optional note at the far end. */
import type { ReactNode } from "react"
import { Rule } from "./Frame"

export function Section({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="border-b border-border pb-2 text-sm text-foreground">
        <Rule title={title} right={right} />
      </h3>
      {children}
    </section>
  )
}
