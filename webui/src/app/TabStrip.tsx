/**
 * The tabs as plain numbered words joined by dotted lines, `1-Lobby ··· 2-Tasks
 * ··· 3-Plan`. One pill (10px corners, a shade off the page) sits behind the
 * chosen tab and slides to the next like a drop of water: the edge it moves toward runs ahead on a stiff
 * spring, the other trails on a soft one, so the drop stretches across the
 * gap and then draws back into the new tab (and settles with a small
 * overshoot). Under `prefers-reduced-motion` it simply jumps. Arrow keys
 * follow the WAI-ARIA tabs pattern with a roving tabindex; `Alt+N` is printed
 * in the tooltip and `aria-keyshortcuts`.
 */
import { forwardRef, Fragment, useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react"
import { animate, type AnimationPlaybackControls } from "motion"
import { BarChart3, BookOpen, CircleDot, GitPullRequest, ListChecks, MessageSquare, PenTool, Route, Zap, type LucideIcon } from "lucide-react"
import { Keys } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { TabInfo } from "@protocol"

interface TabStripProps {
  tabs: TabInfo[]
  activeId?: string
  onSelect: (id: string) => void
}

/** One icon per tab. */
const TAB_ICONS: Record<string, LucideIcon> = {
  lobby: MessageSquare,
  tasks: ListChecks,
  plan: Route,
  quickfix: Zap,
  issues: CircleDot,
  metrics: BarChart3,
  git: GitPullRequest,
  knowledge: BookOpen,
  excalidraw: PenTool,
}

/** The digit of a tab's `Alt+N` key, printed before its name. */
function tabNumber(key: string): string | undefined {
  return /(\d)$/.exec(key)?.[1]
}

const TabCell = forwardRef<HTMLAnchorElement, { tab: TabInfo; active: boolean }>(function TabCell({ tab, active }, ref) {
  const number = tabNumber(tab.key)
  const Icon = TAB_ICONS[tab.id]
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
            "relative z-10 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-3.5 text-sm font-medium whitespace-nowrap outline-none",
            "transition-colors duration-200 ease-snap focus-visible:ring-3 focus-visible:ring-ring/40",
            active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {Icon ? <Icon aria-hidden="true" className={cn("size-4 shrink-0 transition-colors duration-200", active && "text-primary")} /> : null}
          <span>
            {number ? (
              <span aria-hidden="true">
                {number}-
              </span>
            ) : null}
            {tab.label}
          </span>
        </a>
      </TooltipTrigger>
      <TooltipContent>
        {tab.label} <Keys chord={tab.key} />
      </TooltipContent>
    </Tooltip>
  )
})

interface Edges {
  left: number
  right: number
}

/** The lit pill behind the chosen tab, and the spring that moves it. */
function useDroplet(activeId: string | undefined, tabCount: number) {
  const track = useRef<HTMLDivElement>(null)
  const drop = useRef<HTMLSpanElement>(null)
  const cells = useRef<Record<string, HTMLAnchorElement | null>>({})
  const at = useRef<Edges | undefined>(undefined)
  const base = useRef(1)
  const running = useRef<AnimationPlaybackControls[]>([])

  const paint = useCallback((edges: Edges) => {
    const el = drop.current
    if (!el) return
    // Never thinner than most of its tab, so the drop squeezes but never vanishes.
    const width = Math.max(edges.right - edges.left, base.current * 0.8)
    // The drop thins a little as it stretches, then fills out again.
    const stretch = Math.max(0, width / base.current - 1)
    const squash = 1 - Math.min(stretch * 0.1, 0.16)
    el.style.width = `${width}px`
    el.style.transform = `translateX(${edges.left}px) scaleY(${squash})`
  }, [])

  const stop = useCallback(() => {
    for (const control of running.current) control.stop()
    running.current = []
  }, [])

  const place = useCallback(
    (target: Edges | undefined, animated: boolean) => {
      const el = drop.current
      if (!el) return
      stop()
      if (!target) {
        el.style.opacity = "0"
        at.current = undefined
        return
      }
      base.current = target.right - target.left
      const from = at.current
      const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      el.style.opacity = "1"
      if (!from || !animated || reduced) {
        at.current = target
        paint(target)
        return
      }
      const toRight = target.left >= from.left
      // The edge in the direction of travel runs ahead on a stiff spring; the other trails on a soft one.
      const ahead = { stiffness: 520, damping: 34, mass: 0.9 }
      const behind = { stiffness: 230, damping: 27, mass: 1 }
      const current: Edges = { ...from }
      const step = () => {
        at.current = { ...current }
        paint(current)
      }
      running.current = [
        animate(from.right, target.right, { type: "spring", ...(toRight ? ahead : behind), onUpdate: (value) => { current.right = value; step() } }),
        animate(from.left, target.left, { type: "spring", ...(toRight ? behind : ahead), onUpdate: (value) => { current.left = value; step() } }),
      ]
    },
    [paint, stop]
  )

  const measure = useCallback((): Edges | undefined => {
    const cell = activeId ? cells.current[activeId] : undefined
    return cell ? { left: cell.offsetLeft, right: cell.offsetLeft + cell.offsetWidth } : undefined
  }, [activeId])

  useLayoutEffect(() => {
    place(measure(), true)
  }, [measure, place, tabCount])

  // A resize (the window, a tab appearing) re-seats the drop where it belongs without animating.
  // The observer lives as long as the strip; it reads the latest measure through a ref, so a tab
  // change never tears it down (that would stop the glide it just started).
  const latest = useRef({ measure, place })
  latest.current = { measure, place }
  useEffect(() => {
    const el = track.current
    if (!el) return
    let first = true
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false
        return
      }
      latest.current.place(latest.current.measure(), false)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      stop()
    }
  }, [stop])

  return { track, drop, cells }
}

export function TabStrip({ tabs, activeId, onSelect }: TabStripProps) {
  const { track, drop, cells } = useDroplet(activeId, tabs.length)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeId) cells.current[activeId]?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeId, cells])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (!delta || tabs.length === 0) return
    event.preventDefault()
    const index = Math.max(0, tabs.findIndex((tab) => tab.id === activeId))
    const next = tabs[(index + delta + tabs.length) % tabs.length]!
    onSelect(next.id)
    cells.current[next.id]?.focus()
  }

  return (
    <div ref={scroller} className="min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div ref={track} role="tablist" aria-label="Lobby tabs" onKeyDown={onKeyDown} className="relative mx-auto flex w-max items-center py-1">
        <span
          ref={drop}
          aria-hidden="true"
          className="pointer-events-none absolute top-1 left-0 z-0 h-10 origin-center rounded-[10px] bg-tab opacity-0 will-change-transform"
        />
        {tabs.map((tab, position) => (
          <Fragment key={tab.id}>
            {position > 0 ? <span aria-hidden="true" className="mx-1 w-3 shrink-0 border-t-2 border-dotted border-border sm:w-5" /> : null}
            <TabCell
              ref={(el) => {
                cells.current[tab.id] = el
              }}
              tab={tab}
              active={tab.id === activeId}
            />
          </Fragment>
        ))}
      </div>
    </div>
  )
}
