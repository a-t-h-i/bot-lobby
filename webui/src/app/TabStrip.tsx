/**
 * The tabs as numbered pills with a thin border, joined by dotted connectors,
 * `1 Lobby ··· 2 Tasks ··· 3 Plan`, each with its icon. The chosen tab is
 * filled with a tint of the accent and ringed with it. Switching works like a
 * straw: the colour drains out of the current tab into the connector beside
 * it, flows along the dotted line (under any tabs in between), then runs
 * round the chosen tab from the side it arrives on, along its top and bottom
 * edges at once, until it meets on the far side as the tab's border; the tint
 * fills in behind it, and as it splashes against the far wall the whole pill
 * budges that way and bounces back into place. The fill and the ring are measured from the tab itself,
 * so they always sit on it exactly, label centred, at any size. It all runs on
 * motion's springs, so it is quick and lands with a little bounce. Under
 * `prefers-reduced-motion` the fill and the ring simply move.
 * Each tab's icon plays a little animation of its own (`TabIcons`) when the
 * pointer comes onto the tab and when the tab is chosen, as the colour reaches
 * it; under reduced motion the icons stay still.
 * Arrow keys follow the WAI-ARIA tabs pattern with a roving tabindex; `Alt+N`
 * is printed in the tooltip and `aria-keyshortcuts`, and the number on the tab
 * is the N.
 */
import { Fragment, forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { animate, spring as springCurve, useReducedMotion, type AnimationPlaybackControls, type ValueAnimationTransition } from "motion/react"
import { Keys } from "@/components/ui/kbd"
import { focusPage, tabWalk } from "@/prompts/nav"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { TabInfo } from "@protocol"
import { PLAY_SECONDS, TabIcon } from "./TabIcons"

interface TabStripProps {
  tabs: TabInfo[]
  activeId?: string
  onSelect: (id: string) => void
}

/** The digit of a tab's `Alt+N` key, printed before its name. */
function tabNumber(key: string): string | undefined {
  return /(\d)$/.exec(key)?.[1]
}

/** When a chosen tab's icon plays: as the colour from the straw reaches the tab, in ms. */
const ARRIVES = 160

/**
 * The plays of a tab's icon: one when the pointer comes onto the tab, one when the tab is chosen. A play
 * already running is left to finish (hovering a tab and then clicking it plays once), and under reduced
 * motion nothing plays.
 */
function useIconPlay(active: boolean) {
  const still = useReducedMotion()
  const [play, setPlay] = useState(0)
  const busyUntil = useRef(0)
  const start = useCallback(() => {
    if (still || performance.now() < busyUntil.current) return
    busyUntil.current = performance.now() + PLAY_SECONDS * 1000
    setPlay((now) => now + 1)
  }, [still])
  const was = useRef(active)
  useEffect(() => {
    const chosen = active && !was.current
    was.current = active
    if (!chosen) return
    const timer = window.setTimeout(start, ARRIVES)
    return () => window.clearTimeout(timer)
  }, [active, start])
  const onPointerEnter = useCallback((event: PointerEvent) => {
    if (event.pointerType !== "touch") start()
  }, [start])
  return { play, onPointerEnter }
}

const TabCell = forwardRef<HTMLAnchorElement, { tab: TabInfo; active: boolean }>(function TabCell({ tab, active }, ref) {
  const number = tabNumber(tab.key)
  const { play, onPointerEnter } = useIconPlay(active)
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
          onPointerEnter={onPointerEnter}
          className={cn(
            "relative z-10 inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-lg border border-input px-2.5 text-[0.8125rem] leading-none font-medium whitespace-nowrap outline-none",
            "transition-colors duration-200 ease-snap focus-visible:ring-3 focus-visible:ring-ring/40",
            active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <TabIcon id={tab.id} play={play} className={cn("size-3.5 shrink-0 transition-colors duration-200", active && "text-primary")} />
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
  radius: number
}

/** The side of a tab the straw meets it on. */
type Port = "left" | "right"

/** How thick the chosen tab's ring is (over its 1px border). */
const RIM = 1.5

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
 * A tab's outline as two halves, each from the middle of its `port` side
 * round to the middle of the other: one along the top edge, one along the
 * bottom. Drawn from the port, the colour seems to pour in there and part.
 */
function rimPaths(box: Box, port: Port): [string, string] {
  const width = box.right - box.left
  const { height } = box
  const inset = RIM / 2
  const r = Math.max(0, Math.min(box.radius - inset, height / 2 - inset, width / 2 - inset))
  const mid = height / 2
  const x = (value: number) => +(port === "left" ? value : width - value).toFixed(2)
  // Mirrored, the corners turn the other way.
  const over = port === "left" ? 1 : 0
  const under = 1 - over
  const near = inset
  const far = width - inset
  const low = height - inset
  const top = `M${x(near)} ${mid}L${x(near)} ${inset + r}A${r} ${r} 0 0 ${over} ${x(near + r)} ${inset}L${x(far - r)} ${inset}A${r} ${r} 0 0 ${over} ${x(far)} ${inset + r}L${x(far)} ${mid}`
  const bottom = `M${x(near)} ${mid}L${x(near)} ${low - r}A${r} ${r} 0 0 ${under} ${x(near + r)} ${low}L${x(far - r)} ${low}A${r} ${r} 0 0 ${under} ${x(far)} ${low - r}L${x(far)} ${mid}`
  return [top, bottom]
}

/** A ring on `box`, drawn `amount` of the way round from its port (both halves at once). */
function paintRim(el: SVGSVGElement | null, box: Box | undefined, port: Port, amount: number) {
  if (!el) return
  if (!box || amount <= 0.002) {
    el.style.opacity = "0"
    return
  }
  const width = box.right - box.left
  const shape = `${width}x${box.height}r${box.radius}${port}`
  if (el.dataset.shape !== shape) {
    el.dataset.shape = shape
    el.dataset.port = port
    el.setAttribute("viewBox", `0 0 ${width} ${box.height}`)
    rimPaths(box, port).forEach((d, n) => el.children[n]?.setAttribute("d", d))
  }
  // The front of the colour fades in rather than popping up as a dot.
  el.style.opacity = String(Math.min(1, amount * 12))
  el.style.top = `${box.top}px`
  el.style.height = `${box.height}px`
  el.style.width = `${width}px`
  el.style.transform = `translateX(${box.left}px)`
  const dash = `${Math.min(1, amount)} 2`
  for (const path of el.children) (path as SVGPathElement).style.strokeDasharray = dash
}

/**
 * The springs of one switch (motion's physics, so a quick run of switches
 * picks up where the last left off). The old tab is sucked dry, the colour's
 * head races along the straw with its tail a beat behind, and as it reaches
 * the new tab it runs round it into a ring while the tint fills in behind,
 * wobbling like a drop held inside the ring. When the tint hits the far wall
 * the pill is knocked that way and swings back past its place before it
 * settles, like a glass nudged by the water sloshing in it.
 */
const DRAIN: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.12, bounce: 0 }
const HEAD: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.17, bounce: 0.15, delay: 0.015 }
const TAIL: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.17, bounce: 0.05, delay: 0.07 }
const FILL: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.22, bounce: 0.25 }
const RING: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.2, bounce: 0 }
// A physical spring (a time-defined one ignores its starting velocity): the kick is the velocity, in px a second,
// and the knock's size goes with it (45 knocks the pill about 1px and swings it back about 0.4px).
const BUDGE: ValueAnimationTransition<number> = { type: "spring", stiffness: 900, damping: 18, velocity: 45, restDelta: 0.02, restSpeed: 1 }

/** When, in seconds after the tint starts, it first reaches the far wall. */
const SPLASH = (() => {
  const curve = springCurve({ keyframes: [0, 1], visualDuration: FILL.visualDuration, bounce: FILL.bounce })
  let ms = 0
  while (ms < 1000 && curve.next(ms).value < 0.97) ms += 4
  return ms / 1000
})()
const WOBBLE: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.28, bounce: 0.6 }

/**
 * The fill and the ring on the chosen tab, the ones draining out of the last,
 * and the liquid in each connector.
 */
function useStraw(activeId: string | undefined, tabCount: number) {
  const track = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const drain = useRef<HTMLSpanElement>(null)
  const ring = useRef<SVGSVGElement>(null)
  const unring = useRef<SVGSVGElement>(null)
  const cells = useRef<Record<string, HTMLAnchorElement | null>>({})
  const liquids = useRef<Array<HTMLSpanElement | null>>([])
  const at = useRef<string | undefined>(undefined)
  const runs = useRef<AnimationPlaybackControls[]>([])
  // How full the chosen tab is (it can briefly overflow while it bounces), so a switch mid-fill drains only what is there.
  const level = useRef(1)
  // And how far round its ring is.
  const rimmed = useRef(1)

  const boxOf = useCallback((id: string | undefined): Box | undefined => {
    const cell = id ? cells.current[id] : undefined
    if (!cell) return undefined
    const radius = parseFloat(getComputedStyle(cell).borderTopLeftRadius) || 0
    return { left: cell.offsetLeft, right: cell.offsetLeft + cell.offsetWidth, top: cell.offsetTop, height: cell.offsetHeight, radius }
  }, [])

  const stop = useCallback(() => {
    for (const run of runs.current) run.stop()
    runs.current = []
    // A pill knocked aside by the last switch goes straight back.
    for (const cell of Object.values(cells.current)) if (cell?.style.translate) cell.style.translate = ""
  }, [])

  const rest = useCallback(
    (id: string | undefined) => {
      stop()
      at.current = id
      level.current = 1
      rimmed.current = 1
      const box = boxOf(id)
      paint(fill.current, box)
      paint(drain.current, undefined)
      paintRim(ring.current, box, "left", 1)
      paintRim(unring.current, undefined, "left", 0)
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
      // The straw leaves the old tab on the side it flows toward and meets the new one on the side it comes from.
      const exit: Port = dir > 0 ? "right" : "left"
      const entry: Port = dir > 0 ? "left" : "right"
      const links = liquids.current.map((liquid) => {
        const link = liquid?.parentElement
        return link ? { liquid, from: link.offsetLeft, to: link.offsetLeft + link.offsetWidth } : undefined
      })
      // The colour runs on round the new tab as the head reaches it, so it is seen to arrive and become the border.
      const lands = length > 4 ? 1 - 4 / length : 0
      const now = { drained: 1 - Math.min(1, level.current), unrung: 1 - Math.min(1, rimmed.current), head: 0, tail: 0, filled: 0, rung: 0, squash: 1, budge: 0 }
      const pill = cells.current[to]
      level.current = 0
      rimmed.current = 0
      const draw = () => {
        // The old tab empties toward the connector it drains into.
        const gone = (a.right - a.left) * Math.min(1, now.drained)
        paint(drain.current, a, dir > 0 ? a.left + gone : a.left, dir > 0 ? a.right : a.right - gone)
        // Its ring is sucked back round to the side the straw leaves from.
        paintRim(unring.current, a, exit, 1 - now.unrung)
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
        // The new tab, knocked along the way the colour flows when it splashes against the far wall.
        const shift = dir * now.budge
        const seat = shift ? { ...b, left: b.left + shift, right: b.right + shift } : b
        if (pill) pill.style.translate = Math.abs(shift) > 0.01 ? `${shift.toFixed(2)}px` : ""
        // It fills from the side the colour arrives on, held inside its ring as it bounces.
        const filled = (seat.right - seat.left) * Math.min(1, Math.max(0, now.filled))
        paint(fill.current, seat, dir > 0 ? seat.left : seat.right - filled, dir > 0 ? seat.left + filled : seat.right, Math.min(1, now.squash))
        // And the colour runs round it from that side, top and bottom at once, to meet as its border.
        paintRim(ring.current, seat, entry, now.rung)
      }
      const spring = (key: "drained" | "unrung" | "head" | "tail" | "filled" | "rung" | "squash" | "budge", from: number, transition: ValueAnimationTransition<number>, onUpdate?: (value: number) => void, to = 1) => {
        const run = animate(from, to, {
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
        spring("rung", 0, RING, (value) => {
          rimmed.current = value
        })
        // The kick lands as the tint reaches the far wall, and the pill springs back to 0.
        spring("budge", 0, { ...BUDGE, delay: SPLASH }, undefined, 0)
        void Promise.all([done, ...runs.current]).then(() => {
          if (at.current === to && runs.current.includes(done)) rest(to)
        })
      }
      spring("drained", now.drained, DRAIN)
      spring("unrung", now.unrung, DRAIN)
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

  return { track, fill, drain, ring, unring, cells, liquids }
}

/** A ring: the two halves of a tab's outline, drawn by `paintRim`. */
const Rim = forwardRef<SVGSVGElement, { which: "ring" | "unring" }>(function Rim({ which }, ref) {
  return (
    <svg ref={ref} aria-hidden="true" {...{ [`data-tab-${which}`]: "" }} className="pointer-events-none absolute left-0 z-20 overflow-visible opacity-0 will-change-transform" fill="none">
      <path pathLength={1} strokeWidth={RIM} strokeLinecap="round" className="stroke-tab-rim" />
      <path pathLength={1} strokeWidth={RIM} strokeLinecap="round" className="stroke-tab-rim" />
    </svg>
  )
})

/** The strip fades out at an edge it can still be scrolled past, so a clipped tab looks meant. */
function fadeFor(more: { left: boolean; right: boolean }): string | undefined {
  if (!more.left && !more.right) return undefined
  return `linear-gradient(to right, ${more.left ? "transparent 0, black 28px" : "black 0"}, ${more.right ? "black calc(100% - 28px), transparent 100%" : "black 100%"})`
}

export function TabStrip({ tabs, activeId, onSelect }: TabStripProps) {
  const { track, fill, drain, ring, unring, cells, liquids } = useStraw(activeId, tabs.length)
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
    // From the tab with focus (the chosen one, unless the page has not caught up with a jump made a moment ago).
    const from = (event.target as HTMLElement).closest<HTMLElement>("[role='tab']")?.id.replace(/^tab-/, "") ?? activeId
    const index = Math.max(0, tabs.findIndex((tab) => tab.id === from))
    const next = tabs[(index + delta + tabs.length) % tabs.length]!
    tabWalk.active = true
    tabWalk.to = next.id
    window.setTimeout(() => {
      tabWalk.active = false
      tabWalk.to = undefined
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
      <div ref={track} role="tablist" aria-label="Lobby tabs" onKeyDown={onKeyDown} className="relative mx-auto flex w-max items-center py-0.5">
        <span ref={drain} aria-hidden="true" data-tab-drain className="pointer-events-none absolute left-0 z-0 rounded-lg bg-tab-fill opacity-0 will-change-transform" />
        <span ref={fill} aria-hidden="true" data-tab-fill className="pointer-events-none absolute left-0 z-0 rounded-lg bg-tab-fill opacity-0 will-change-transform" />
        <Rim ref={unring} which="unring" />
        <Rim ref={ring} which="ring" />
        {tabs.map((tab, position) => (
          <Fragment key={tab.id}>
            {position > 0 ? (
              <span aria-hidden="true" data-tab-link className="relative h-[2px] w-3.5 shrink-0 sm:w-4">
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
