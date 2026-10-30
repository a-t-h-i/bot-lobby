/**
 * A page of this design: a scrolling column on the flat page with the title
 * row (a large title, a quiet count line, controls on the right) over the
 * page's own content. Up and Down (or j and k) walk its rows, Home and End
 * jump to the first and last.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react"
import { hasOverlay } from "@/lib/overlay"
import { cn } from "@/lib/utils"
import { isTyping, stepRows, verticalStep } from "@/prompts/nav"
import { ScrollHints } from "./ScrollHints"

interface PageProps {
  title: string
  /** The quiet line under the title: `2 open · 3 finished`. */
  sub?: ReactNode
  /** Controls at the right of the title row. */
  aside?: ReactNode
  className?: string
  children: ReactNode
}

export function Page({ title, sub, aside, className, children }: PageProps) {
  const scroller = useRef<HTMLDivElement>(null)
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const root = scroller.current
    if (!root || event.defaultPrevented || event.nativeEvent.isComposing || hasOverlay() || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target) || event.target instanceof HTMLInputElement) return
    const step = verticalStep(event.key)
    if (step) {
      event.preventDefault()
      stepRows(root, event.target as Element, step)
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      stepRows(root, event.target as Element, event.key === "Home" ? "first" : "last")
    }
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} data-pane="list" className="cs-scroll pb-dock" onKeyDown={onKeyDown}>
        <div className={cn("cs-pg", className)}>
          <div className="cs-pgh">
            <div className="min-w-0">
              <h1 className="cs-hd1">{title}</h1>
              {sub ? <p className="cs-hd2">{sub}</p> : null}
            </div>
            {aside ? <div className="flex flex-none items-center gap-2">{aside}</div> : null}
          </div>
          {children}
        </div>
      </div>
      <ScrollHints target={scroller} />
    </div>
  )
}

/** A check chip: a checkbox, its word and a count, as one keycap (`Archived 3`). */
export function CheckChip({ on, label, count, onToggle, describe }: { on: boolean; label: string; count?: number; onToggle: () => void; describe?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={describe} className="cs-chk" onClick={onToggle}>
      <span className="cs-cb" data-on={on ? "true" : undefined}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
      {label}
      {count !== undefined ? <span className="cs-cn">{count}</span> : null}
    </button>
  )
}
