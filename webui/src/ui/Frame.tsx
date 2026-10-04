/**
 * A titled card with its title in a row at the top and an
 * optional note at the other end. Content sits below the title row, so
 * nothing scrolls under it. The card's edge lights up while you are inside it.
 */
import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface FrameProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: ReactNode
  note?: ReactNode
  /** With `onToggle`, the card can be folded down to its title row. */
  collapsed?: boolean
  onToggle?: () => void
}

export function Frame({ title, note, className, children, collapsed, onToggle, ...props }: FrameProps) {
  const name = typeof title === "string" ? title : "pane"
  return (
    <section
      className={cn("glass group/frame relative flex min-h-0 min-w-0 flex-col rounded-lg transition-[border-color] duration-200 focus-within:border-ring/50", collapsed && "flex-none", className)}
      {...props}
    >
      {title || note || onToggle ? (
        <div className={cn("flex h-10 shrink-0 items-center justify-between gap-3 px-4", !collapsed && "border-b border-border/70")}>
          {title ? <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2> : <span />}
          <span className="flex shrink-0 items-center gap-1">
            {note ? <span className="flex items-center gap-2 truncate text-xs text-muted-foreground">{note}</span> : null}
            {onToggle ? (
              <button
                type="button"
                aria-expanded={!collapsed}
                aria-label={collapsed ? `Expand ${name}` : `Minimize ${name}`}
                title={collapsed ? "Expand" : "Minimize"}
                onClick={onToggle}
                className="-mr-2 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 ease-snap outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95"
              >
                <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform duration-200 ease-snap", collapsed && "-rotate-90")} />
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {collapsed ? null : children}
    </section>
  )
}

/** A heading with, at the far end, an optional note: `Progress            2/5 steps`. */
export function Rule({ title, right, className }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <span className="truncate font-medium">{title}</span>
      <span aria-hidden="true" className="min-w-4 flex-1" />
      {right ? <span className="shrink-0 text-xs font-normal text-muted-foreground">{right}</span> : null}
    </span>
  )
}
