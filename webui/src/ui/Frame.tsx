/**
 * A titled pane with its title in a row at the top and an optional note at the
 * other end. Content sits below the title row, so nothing scrolls under it.
 * With `onToggle` the pane folds down to its title row, and the key that does
 * it is printed beside the chevron.
 */
import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Keys } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"

interface FrameProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: ReactNode
  note?: ReactNode
  /** With `onToggle`, the pane can be folded down to its title row. */
  collapsed?: boolean
  onToggle?: () => void
  /** The key that folds it, printed on the button and in its tooltip (`Alt+A`). */
  shortcut?: string
}

export function Frame({ title, note, className, children, collapsed, onToggle, shortcut, ...props }: FrameProps) {
  const name = typeof title === "string" ? title : "pane"
  return (
    <section className={cn("workspace-frame group/frame relative flex min-h-0 min-w-0 flex-col rounded-xl border shadow-xs", collapsed && "flex-none", className)} {...props}>
      {title || note || onToggle ? (
        <div className={cn("flex min-h-12 shrink-0 items-center justify-between gap-3 px-4", !collapsed && "border-b border-border")}>
          {title ? <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2> : <span />}
          <span className="flex shrink-0 items-center gap-2">
            {note ? <span className="flex items-center gap-2 truncate text-xs text-muted-foreground">{note}</span> : null}
            {onToggle ? (
              <button
                type="button"
                aria-expanded={!collapsed}
                aria-label={collapsed ? `Expand ${name}` : `Minimize ${name}`}
                title={`${collapsed ? "Expand" : "Minimize"}${shortcut ? ` · ${shortcut}` : ""}`}
                aria-keyshortcuts={shortcut ? `${shortcut} Enter Space` : "Enter Space"}
                aria-describedby="focused-action-help"
                onClick={onToggle}
                className="btn-ghost -mr-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-2 text-muted-foreground transition-[box-shadow,color,translate] duration-150 ease-snap outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px motion-reduce:active:translate-none"
              >
                {shortcut ? <Keys chord={shortcut} className="kbd-hint" /> : null}
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
