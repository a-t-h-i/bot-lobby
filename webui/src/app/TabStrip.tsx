/**
 * The tabs as numbered words joined by dotted connectors, `1 Lobby ··· 2 Tasks
 * ··· 3 Plan`, each with its icon. The chosen tab is filled with a tint of the
 * accent. Switching works like a straw: the colour drains out of the current
 * tab into the connector beside it, flows along the dotted line (under any
 * tabs in between) and fills the chosen tab from the side it arrives on. The
 * fill is measured from the tab itself, so it always sits on it exactly, label
 * centred, at any size. It all runs on motion's springs, so it is quick and
 * lands with a little bounce. Under `prefers-reduced-motion` the fill simply
 * moves.
 * Arrow keys follow the WAI-ARIA tabs pattern with a roving tabindex; `Alt+N`
 * is printed in the tooltip and `aria-keyshortcuts`, and the number on the tab
 * is the N.
 */
import { Fragment, forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { BarChart3, BookOpen, CircleDot, GitPullRequest, ListChecks, MessageSquare, PenTool, Route, Zap, type LucideIcon } from "lucide-react"
import { animate, motion, type AnimationPlaybackControls, type ValueAnimationTransition } from "motion/react"
import { Keys } from "@/components/ui/kbd"
import { focusPage, tabWalk } from "@/prompts/nav"
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
            "relative z-10 inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] leading-none font-medium whitespace-nowrap outline-none",
            "transition-colors duration-200 ease-snap focus-visible:ring-3 focus-visible:ring-ring/40",
            active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {Icon ? (
            // The icon hops as the colour lands on its tab (MotionConfig keeps it still under reduced motion).
            <motion.span
              key={active ? "on" : "off"}
              aria-hidden="true"
              className="inline-flex"
              initial={active ? { scale: 0.7, y: 2 } : false}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: "spring", visualDuration: 0.32, bounce: 0.55, delay: 0.12 }}
            >
              <Icon className={cn("size-3.5 shrink-0 transition-colors duration-200", active && "text-primary")} />
            </motion.span>
          ) : null}
          {number ? (
            <span aria-hidden="true" className={cn("text-[0.72rem] font-semibold tabular-nums transition-colors duration-200", active ? "text-primary" : "text-muted-foreground/75")}>
              {number}
            </span>
          ) : null}
          <span>{tab.label}</span>
        </a>
      </TooltipTrigger>
      <TooltipContent>
        {tab.label} <Keys chord={tab.key} />
      </TooltipContent>
    </Tooltip>
  )
})

interface Box {
  left: number
  right: number
  top: number
  height: number
}

function paint(el: HTMLElement | null, box: Box | undefined, left = box?.left ?? 0, right = box?.right ?? 0, squash = 1) {
  if (!el) return
  if (!box || right - left < 0.5) {
    el.style.opacity = "0"
    return
  }
  // A sliver fades rather than standing there as a thin bar.
  el.style.opacity = String(Math.min(1, (right - left) / 14))
  el.style.top = `${box.top}px`
  el.style.height = `${box.height}px`
  el.style.width = `${right - left}px`
  el.style.transform = `translateX(${left}px)`
  el.style.scale = squash === 1 ? "" : `1 ${squash}`
}

/**
 * The springs of one switch (motion's physics, so a quick run of switches
 * picks up where the last left off). The old tab is sucked dry, the colour's
 * head races along the straw with its tail a beat behind, and the new tab
 * fills with a bounce as it lands, its height wobbling like a drop.
 */
const DRAIN: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.12, bounce: 0 }
const HEAD: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.17, bounce: 0.15, delay: 0.015 }
const TAIL: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.17, bounce: 0.05, delay: 0.07 }
const FILL: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.22, bounce: 0.4 }
const WOBBLE: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.28, bounce: 0.6 }

/**
 * The fill on the chosen tab, the one draining out of the last, and the liquid
 * in each connector.
 */
function useStraw(activeId: string | undefined, tabCount: number) {
  const track = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const drain = useRef<HTMLSpanElement>(null)
  const cells = useRef<Record<string, HTMLAnchorElement | null>>({})
  const liquids = useRef<Array<HTMLSpanElement | null>>([])
  const at = useRef<string | undefined>(undefined)
  const runs = useRef<AnimationPlaybackControls[]>([])
  // How full the chosen tab is (it can briefly overflow while it bounces), so a switch mid-fill drains only what is there.
  const level = useRef(1)

  const boxOf = useCallback((id: string | undefined): Box | undefined => {
    const cell = id ? cells.current[id] : undefined
    return cell ? { left: cell.offsetLeft, right: cell.offsetLeft + cell.offsetWidth, top: cell.offsetTop, height: cell.offsetHeight } : undefined
  }, [])

  const stop = useCallback(() => {
    for (const run of runs.current) run.stop()
    runs.current = []
  }, [])

  const rest = useCallback(
    (id: string | undefined) => {
      stop()
      at.current = id
      level.current = 1
      paint(fill.current, boxOf(id))
      paint(drain.current, undefined)
      for (const liquid of liquids.current) if (liquid) liquid.style.width = "0px"
    },
    [boxOf, stop]
  )

  const flow = useCallback(
    (from: string, to: string) => {
      const a = boxOf(from)
      const b = boxOf(to)
      if (!a || !b) return rest(to)
      stop()
      at.current = to
      const dir = b.left > a.left ? 1 : -1
      const start = dir > 0 ? a.right : a.left
      const end = dir > 0 ? b.left : b.right
      const length = Math.abs(end - start)
      const links = liquids.current.map((liquid) => {
        const link = liquid?.parentElement
        return link ? { liquid, from: link.offsetLeft, to: link.offsetLeft + link.offsetWidth } : undefined
      })
      // The new tab starts to fill as the head reaches the middle of the last connector, so the colour is seen to arrive.
      const last = links.filter(Boolean).sort((x, y) => Math.abs(end - (x!.from + x!.to) / 2) - Math.abs(end - (y!.from + y!.to) / 2))[0]
      const lands = last && length > 0 ? Math.min(0.97, Math.abs((last.from + last.to) / 2 - start) / length) : 0.7
      const now = { drained: 1 - Math.min(1, level.current), head: 0, tail: 0, filled: 0, squash: 1 }
      level.current = 0
      const draw = () => {
        // The old tab empties toward the connector it drains into.
        const gone = (a.right - a.left) * Math.min(1, now.drained)
        paint(drain.current, a, dir > 0 ? a.left + gone : a.left, dir > 0 ? a.right : a.right - gone)
        // The liquid: everything between its tail and its head, seen only where a connector is.
        const head = start + dir * length * now.head
        const tail = start + dir * length * now.tail
        const low = Math.min(head, tail)
        const high = Math.max(head, tail)
        for (const link of links) {
          if (!link?.liquid) continue
          const from = Math.max(low, link.from)
          const to = Math.min(high, link.to)
          link.liquid.style.width = `${Math.max(0, to - from)}px`
          link.liquid.style.transform = `translateX(${Math.max(0, from - link.from)}px)`
        }
        // The new tab fills from the side the colour arrives on, a little past full on the bounce.
        const filled = (b.right - b.left) * Math.max(0, now.filled)
        paint(fill.current, b, dir > 0 ? b.left : b.right - filled, dir > 0 ? b.left + filled : b.right, now.squash)
      }
      const spring = (key: "drained" | "head" | "tail" | "filled" | "squash", from: number, transition: ValueAnimationTransition<number>, onUpdate?: (value: number) => void) => {
        const run = animate(from, 1, {
          ...transition,
          onUpdate: (value) => {
            now[key] = value
            onUpdate?.(value)
            draw()
          },
        })
        runs.current.push(run)
        return run
      }
      let landed = false
      const land = () => {
        if (landed) return
        landed = true
        const done = spring("filled", 0, FILL, (value) => {
          level.current = value
        })
        spring("squash", 0.8, WOBBLE)
        void Promise.all([done, ...runs.current]).then(() => {
          if (at.current === to && runs.current.includes(done)) rest(to)
        })
      }
      spring("drained", now.drained, DRAIN)
      spring("head", 0, HEAD, (value) => {
        if (value >= lands) land()
      })
      spring("tail", 0, TAIL)
      draw()
    },
    [boxOf, rest, stop]
  )

  useLayoutEffect(() => {
    const from = at.current
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!from || !activeId || from === activeId || reduced) rest(activeId)
    else flow(from, activeId)
  }, [activeId, tabCount, flow, rest])

  // A resize (the window, a tab appearing, the font loading) re-seats the fill without animating. The
  // observer lives as long as the strip and reads the latest tab through a ref, so a switch never tears it down.
  const latest = useRef(activeId)
  latest.current = activeId
  useEffect(() => {
    const el = track.current
    if (!el || typeof ResizeObserver === "undefined") return
    let first = true
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false
        return
      }
      rest(latest.current)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      stop()
    }
  }, [rest, stop])

  return { track, fill, drain, cells, liquids }
}

/** The strip fades out at an edge it can still be scrolled past, so a clipped tab looks meant. */
function fadeFor(more: { left: boolean; right: boolean }): string | undefined {
  if (!more.left && !more.right) return undefined
  return `linear-gradient(to right, ${more.left ? "transparent 0, black 28px" : "black 0"}, ${more.right ? "black calc(100% - 28px), transparent 100%" : "black 100%"})`
}

export function TabStrip({ tabs, activeId, onSelect }: TabStripProps) {
  const { track, fill, drain, cells, liquids } = useStraw(activeId, tabs.length)
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  const measureEdges = useCallback(() => {
    const strip = scroller.current
    if (!strip) return
    const left = strip.scrollLeft > 2
    const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2
    setMore((now) => (now.left === left && now.right === right ? now : { left, right }))
  }, [])

  useEffect(() => {
    const strip = scroller.current
    if (!strip || typeof ResizeObserver === "undefined") return
    measureEdges()
    const observer = new ResizeObserver(measureEdges)
    observer.observe(strip)
    if (strip.firstElementChild) observer.observe(strip.firstElementChild)
    return () => observer.disconnect()
  }, [measureEdges, tabs.length])

  useEffect(() => {
    // Only the strip scrolls sideways; scrollIntoView would also move the page.
    const strip = scroller.current
    const cell = activeId ? cells.current[activeId] : undefined
    if (!strip || !cell) return
    if (cell.offsetLeft < strip.scrollLeft) strip.scrollLeft = cell.offsetLeft - 8
    else if (cell.offsetLeft + cell.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = cell.offsetLeft + cell.offsetWidth - strip.clientWidth + 8
  }, [activeId, cells])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Down goes from the tab bar into the page.
    if (event.key === "ArrowDown" && !event.altKey) {
      if (focusPage()) event.preventDefault()
      return
    }
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (!delta || tabs.length === 0) return
    event.preventDefault()
    const index = Math.max(0, tabs.findIndex((tab) => tab.id === activeId))
    const next = tabs[(index + delta + tabs.length) % tabs.length]!
    tabWalk.active = true
    window.setTimeout(() => {
      tabWalk.active = false
    }, 3000)
    onSelect(next.id)
    cells.current[next.id]?.focus({ preventScroll: true })
  }

  return (
    <div
      ref={scroller}
      onScroll={measureEdges}
      style={{ maskImage: fadeFor(more), WebkitMaskImage: fadeFor(more) }}
      className="min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] pointer-coarse:-my-1.5 pointer-coarse:py-1.5 [&::-webkit-scrollbar]:hidden"
    >
      <div ref={track} role="tablist" aria-label="Lobby tabs" onKeyDown={onKeyDown} className="relative mx-auto flex w-max items-center gap-0.5 py-0.5">
        <span ref={drain} aria-hidden="true" data-tab-drain className="pointer-events-none absolute left-0 z-0 rounded-lg bg-tab-fill opacity-0 will-change-transform" />
        <span ref={fill} aria-hidden="true" data-tab-fill className="pointer-events-none absolute left-0 z-0 rounded-lg bg-tab-fill opacity-0 will-change-transform" />
        {tabs.map((tab, position) => (
          <Fragment key={tab.id}>
            {position > 0 ? (
              <span aria-hidden="true" data-tab-link className="relative h-[2px] w-2.5 shrink-0 sm:w-3">
                <span className="absolute inset-0 border-t-2 border-dotted border-input" />
                <span
                  ref={(el) => {
                    liquids.current[position - 1] = el
                  }}
                  data-tab-liquid
                  className="absolute top-0 left-0 h-[2px] w-0 rounded-full bg-tab-liquid shadow-[0_0_6px_var(--tab-liquid)] will-change-transform"
                />
              </span>
            ) : null}
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
