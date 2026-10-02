/** A detail section, headed as the terminal heads one: a rule with the title set into it and an optional right-hand note. */
import type { ReactNode } from "react"
import { Rule } from "./Frame"

export function Section({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm">
        <Rule title={title} right={right} />
      </h3>
      {children}
    </section>
  )
}
