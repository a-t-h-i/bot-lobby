/**
 * A pane as the terminal draws it (D-21): a rounded frame with its title set
 * into the top border and an optional note at the other end of it. The pane
 * you are in (clicked, or reached with Tab) is drawn in the focus colour, as
 * the terminal draws its focused pane. Content sits below the title row, so
 * nothing scrolls under it.
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Frame({
  title,
  note,
  className,
  children,
  ...props
}: { title?: ReactNode; note?: ReactNode } & Omit<React.ComponentProps<"section">, "title">) {
  return (
    <section
      className={cn(
        "group/frame relative mt-2.5 flex min-h-0 min-w-0 flex-col rounded-md border border-border pt-2.5 focus-within:border-ring",
        className
      )}
      {...props}
    >
      {title ? (
        <h2 className="absolute -top-2.5 left-[1ch] max-w-[60%] truncate bg-background px-[1ch] text-sm leading-5 font-bold group-focus-within/frame:text-primary">
          {title}
        </h2>
      ) : null}
      {note ? (
        <span className="absolute -top-2.5 right-[1ch] flex max-w-[40%] items-center gap-[1ch] truncate bg-background px-[1ch] text-xs leading-5 text-muted-foreground">
          {note}
        </span>
      ) : null}
      {children}
    </section>
  )
}

/** A rule with a title set into it, as the terminal heads a section: `── Progress ──────── 2/5 steps ──`. */
export function Rule({ title, right, className }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-[1ch]", className)}>
      <span aria-hidden="true" className="w-[2ch] shrink-0 border-t border-border" />
      <span className="truncate font-bold text-primary">{title}</span>
      <span aria-hidden="true" className="min-w-[2ch] flex-1 border-t border-border" />
      {right ? (
        <>
          <span className="shrink-0 text-xs font-normal text-muted-foreground">{right}</span>
          <span aria-hidden="true" className="w-[2ch] shrink-0 border-t border-border" />
        </>
      ) : null}
    </span>
  )
}
