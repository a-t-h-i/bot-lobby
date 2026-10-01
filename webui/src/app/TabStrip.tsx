/**
 * The compact pill tab strip (batch-1 §b): labelled pills in `status.tabs`
 * order, the active one filled. It scrolls horizontally with no visible
 * scrollbar when the pills overflow and shows a chevron at each edge that has
 * hidden tabs; the active pill is always scrolled into view. Arrow keys follow
 * the WAI-ARIA tabs pattern with a roving tabindex; `Alt+N` lives in each
 * pill's tooltip and `aria-keyshortcuts`.
 */
import { forwardRef, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { TabInfo } from "@protocol"

interface TabStripProps {
  tabs: TabInfo[]
  activeId?: string
  question?: boolean
  onSelect: (id: string) => void
}

const pillClass = cn(
  "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors",
  "focus-visible:ring-3 focus-visible:ring-ring/50"
)

const TabPill = forwardRef<
  HTMLAnchorElement,
  { tab: TabInfo; active: boolean; badge: boolean }
>(function TabPill({ tab, active, badge }, ref) {
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
            pillClass,
            active
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {tab.label}
          {badge ? (
            <Badge variant="destructive" className="h-4 px-1 text-[10px]" aria-label="Question waiting">
              ?
            </Badge>
          ) : null}
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
        "absolute top-0 z-10 flex h-12 w-10 items-center justify-center text-muted-foreground",
        side === "left"
          ? "left-0 bg-gradient-to-r from-background via-background/85 to-transparent"
          : "right-0 bg-gradient-to-l from-background via-background/85 to-transparent"
      )}
    >
      <Icon className="size-4" />
    </button>
  )
}

export function TabStrip({ tabs, activeId, question, onSelect }: TabStripProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const pills = useRef<Record<string, HTMLAnchorElement | null>>({})
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
    if (activeId) pills.current[activeId]?.scrollIntoView({ block: "nearest", inline: "nearest" })
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
    pills.current[next.id]?.focus()
  }

  function nudge(direction: -1 | 1) {
    scroller.current?.scrollBy({ left: direction * 160, behavior: "smooth" })
  }

  return (
    <div className="relative shrink-0 border-b">
      {edges.left ? <Chevron side="left" onClick={() => nudge(-1)} /> : null}
      <div
        ref={scroller}
        role="tablist"
        aria-label="Lobby tabs"
        onScroll={measure}
        onKeyDown={onKeyDown}
        className="flex h-12 items-center gap-1.5 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <TabPill
            key={tab.id}
            ref={(el) => {
              pills.current[tab.id] = el
            }}
            tab={tab}
            active={tab.id === activeId}
            badge={Boolean(question) && tab.id !== "lobby"}
          />
        ))}
      </div>
      {edges.right ? <Chevron side="right" onClick={() => nudge(1)} /> : null}
    </div>
  )
}
