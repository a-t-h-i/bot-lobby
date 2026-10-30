/**
 * A segmented switch: a few equal options on a sunk track, the chosen one on a
 * raised thumb that springs across to whichever is picked (`cs-seg`). It serves as tabs (`role="tablist"`, a
 * page section each) or as a radio group (`role="radiogroup"`, one value).
 * Arrow keys move between options with a roving tabindex; Home and End jump
 * to the ends. As `nav` the options are plain buttons marking the open one with
 * `aria-current`, for a caller that wraps them in its own `<nav>`. Under reduced motion the thumb simply moves.
 */
import { useId, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

export interface SegmentedItem<T extends string> {
  id: T
  label: ReactNode
  /** The accessible name, when `label` is not plain text. */
  name?: string
  /** For tabs: the panel the option controls. */
  controls?: string
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  as = "radio",
  size = "sm",
  className,
  idPrefix,
}: {
  items: ReadonlyArray<SegmentedItem<T>>
  value: T
  onChange: (id: T) => void
  label: string
  /** Tabs over page sections, a radio group picking one value, or buttons inside the caller's own nav. */
  as?: "tab" | "radio" | "nav"
  size?: "sm" | "md"
  className?: string
  /** Each option's id is `${idPrefix}-${id}`, so other code can focus it. */
  idPrefix?: string
}) {
  const group = useId()
  const reduce = useReducedMotion() ?? false
  const prefix = idPrefix ?? group

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = Math.max(0, items.findIndex((item) => item.id === value))
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
    const to = step ? (index + step + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1
    if (to < 0) return
    event.preventDefault()
    event.stopPropagation()
    const next = items[to]!
    onChange(next.id)
    // By id, and once it is the chosen one: a route-driven switch catches up a frame or two later, and may be rebuilt.
    let tries = 0
    const land = () => {
      const el = document.getElementById(`${prefix}-${next.id}`)
      if (el && el.tabIndex === 0) el.focus()
      else if (tries++ < 20) requestAnimationFrame(land)
    }
    requestAnimationFrame(land)
  }

  const at = Math.max(0, items.findIndex((item) => item.id === value))
  return (
    <div
      role={as === "tab" ? "tablist" : as === "radio" ? "radiogroup" : undefined}
      aria-label={as === "nav" ? undefined : label}
      onKeyDown={onKeyDown}
      data-slot="segmented"
      data-reduce={reduce || undefined}
      style={{ "--n": items.length, "--k": at } as CSSProperties}
      className={cn("cs-seg", size === "sm" && "cs-sm", className)}
    >
      <i aria-hidden="true" className="cs-thumb" />
      {items.map((item) => {
        const on = item.id === value
        return (
          <button
            key={item.id}
            id={`${prefix}-${item.id}`}
            type="button"
            data-segment={item.id}
            data-on={on ? "true" : undefined}
            role={as === "nav" ? undefined : as}
            {...(as === "tab" ? { "aria-selected": on, "aria-controls": item.controls } : as === "radio" ? { "aria-checked": on } : { "aria-current": on ? ("page" as const) : undefined, "aria-controls": item.controls })}
            aria-label={item.name}
            tabIndex={on || as === "nav" ? 0 : -1}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
