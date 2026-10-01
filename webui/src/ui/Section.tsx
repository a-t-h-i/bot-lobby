/** A detail section: a heading over a hairline, with an optional right-hand note. */
import type { ReactNode } from "react"

export function Section({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center justify-between border-b pb-1 text-sm font-medium">
        <span>{title}</span>
        {right ? <span className="text-xs font-normal text-muted-foreground">{right}</span> : null}
      </h3>
      {children}
    </section>
  )
}
