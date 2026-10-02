/**
 * The tabs as cells of the title line, as the terminal draws its tab bar
 * (D-21): `1 Lobby  2 Tasks  3 Plan …` in `status.tabs` order, the number
 * dimmed (in the accent colour on the chosen tab), the chosen cell lit with
 * the selection colour and the rest plain text on the page: no pills and no
 * tray behind them. It scrolls sideways with no visible scrollbar when the
 * cells overflow, with a chevron at each edge that hides tabs; the chosen
 * cell is always scrolled into view. Arrow keys follow the WAI-ARIA tabs
 * pattern with a roving tabindex; `Alt+N` is printed in the cell, as in the
 * terminal, and also in its tooltip and `aria-keyshortcuts`.
 */
import { forwardRef, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { TabInfo } from "@protocol"

interface TabStripProps {
  tabs: TabInfo[]
  activeId?: string
  /** How many questions wait; `N?` shows after every tab but Lobby, in the warning colour, as the terminal marks a tab that asks. */
  questionCount?: number
  onSelect: (id: string) => void
}

const cellClass = cn(
  "inline-flex h-10 shrink-0 items-center gap-[1ch] rounded-md px-[1ch] text-sm whitespace-nowrap outline-none",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
)

/** The digit of a tab's `Alt+N` key, printed before its name as the terminal does. */
function tabNumber(key: string): string | undefined {
  return /(\d)$/.exec(key)?.[1]
}

const TabCell = forwardRef<
  HTMLAnchorElement,
  { tab: TabInfo; active: boolean }
>(function TabCell({ tab, active }, ref) {
  const number = tabNumber(tab.key)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          ref={ref}
          role="tab"
          id={`tab-${tab.id}`}
          href={`#/${tab.id}`}
          aria-selected={active}
          aria-keyshortcuts={tab.key}
          tabIndex={active ? 0 : -1}
          className={cn(
            cellClass,
            active ? "bg-accent font-bold text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {number ? (
            <span aria-hidden="true" className={cn("font-normal", active ? "text-primary" : "text-muted-foreground")}>
              {number}
            </span>
          ) : null}
          {tab.label}
        </a>
      </TooltipTrigger>
      <TooltipContent>
        {tab.label} · <Kbd>{tab.key}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
})

function Chevron({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      title="More tabs"
      onClick={onClick}
      className={cn(
        "absolute top-0 z-10 flex h-10 w-10 items-center justify-center text-muted-foreground",
        side === "left"
          ? "left-0 bg-gradient-to-r from-background via-background/85 to-transparent"
          : "right-0 bg-gradient-to-l from-background via-background/85 to-transparent"
      )}
    >
      <Icon className="size-4" />
    </button>
  )
}

export function TabStrip({ tabs, activeId, questionCount = 0, onSelect }: TabStripProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const cells = useRef<Record<string, HTMLAnchorElement | null>>({})
  const [edges, setEdges] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setEdges({
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    })
  }, [])

  useEffect(() => {
    measure()
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure, tabs.length])

  useEffect(() => {
    if (activeId) cells.current[activeId]?.scrollIntoView({ block: "nearest", inline: "nearest" })
    measure()
  }, [activeId, measure])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (!delta || tabs.length === 0) return
    event.preventDefault()
    const index = Math.max(
      0,
      tabs.findIndex((tab) => tab.id === activeId)
    )
    const next = tabs[(index + delta + tabs.length) % tabs.length]!
    onSelect(next.id)
    cells.current[next.id]?.focus()
  }

  function nudge(direction: -1 | 1) {
    scroller.current?.scrollBy({ left: direction * 160, behavior: "smooth" })
  }

  return (
    <div className="relative min-w-0 shrink-0">
      {edges.left ? <Chevron side="left" onClick={() => nudge(-1)} /> : null}
      <div
        ref={scroller}
        role="tablist"
        aria-label="Lobby tabs"
        onScroll={measure}
        onKeyDown={onKeyDown}
        className="flex h-10 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const badge = tab.id === "lobby" ? 0 : questionCount
          return (
            <div key={tab.id} className="flex shrink-0 items-center">
              <TabCell
                ref={(el) => {
                  cells.current[tab.id] = el
                }}
                tab={tab}
                active={tab.id === activeId}
              />
              {badge > 0 ? (
                <button
                  type="button"
                  aria-label={`${badge} question${badge === 1 ? "" : "s"} waiting — go to Lobby`}
                  onClick={() => onSelect("lobby")}
                  className="-ml-[1ch] h-10 rounded-md px-[0.5ch] text-sm font-bold text-warning tabular-nums outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  {badge}?
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
      {edges.right ? <Chevron side="right" onClick={() => nudge(1)} /> : null}
    </div>
  )
}
