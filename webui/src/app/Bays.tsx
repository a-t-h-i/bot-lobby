/**
 * The shell's bays, after the user's design (docs/web-ui/composer-surface): the page lies flat over the whole
 * window and three bays grow out of its edges, drawn like the composer (an edge layer and a lit fill layer through
 * goo filters, under the real content). The sidebar's mini rail sits on the left edge and grows into the session
 * list on hover or pin; the tab navigator hangs from the top showing only the active tab, opens into all four on
 * hover or a tab key, waits 600ms after the last one, then snaps back with a springy morph; the code viewer and
 * terminal buttons sit in a small bay at the top right.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import type { TabInfo } from "@protocol"
import { focusPage, tabWalk } from "@/prompts/nav"
import { cn } from "@/lib/utils"

/** The bays' goo filters, once per page: the edge with its light and shade, the lit fill, the tab dent and its tint. */
export function ShellFilters() {
  const lit = (id: string, blur: number) => (
    <filter id={id} x="-20%" y="-35%" width="140%" height="170%" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="b" />
      <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="shape" />
      <feOffset in="shape" dx="0" dy="1.5" result="dn" />
      <feComposite in="shape" in2="dn" operator="out" result="rimA" />
      <feGaussianBlur in="rimA" stdDeviation="0.6" result="rimB" />
      <feComposite in="rimB" in2="shape" operator="in" result="rimC" />
      <feFlood style={{ floodColor: "var(--hl)" }} result="hlc" />
      <feComposite in="hlc" in2="rimC" operator="in" result="hl" />
      <feOffset in="shape" dx="0" dy="-1" result="up" />
      <feComposite in="shape" in2="up" operator="out" result="shA" />
      <feGaussianBlur in="shA" stdDeviation="0.6" result="shB" />
      <feComposite in="shB" in2="shape" operator="in" result="shC" />
      <feFlood style={{ floodColor: "var(--sh)" }} result="shc" />
      <feComposite in="shc" in2="shC" operator="in" result="sh" />
      <feMerge>
        <feMergeNode in="shape" />
        <feMergeNode in="sh" />
        <feMergeNode in="hl" />
      </feMerge>
    </filter>
  )
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        {lit("cs-baylit", 5)}
        {lit("cs-worklit", 3.2)}
        <filter id="cs-bayedge" x="-20%" y="-35%" width="140%" height="170%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b" />
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="shape" />
          <feOffset in="shape" dx="0" dy="1.5" result="dn" />
          <feComposite in="shape" in2="dn" operator="out" result="tS0" />
          <feGaussianBlur in="tS0" stdDeviation="0.3" result="tS1" />
          <feComposite in="tS1" in2="shape" operator="in" result="tS" />
          <feFlood style={{ floodColor: "var(--ehl)" }} result="tc" />
          <feComposite in="tc" in2="tS" operator="in" result="eh" />
          <feOffset in="shape" dx="0" dy="-1" result="up" />
          <feComposite in="shape" in2="up" operator="out" result="bS0" />
          <feGaussianBlur in="bS0" stdDeviation="0.3" result="bS1" />
          <feComposite in="bS1" in2="shape" operator="in" result="bS" />
          <feFlood style={{ floodColor: "var(--esh)" }} result="bc" />
          <feComposite in="bc" in2="bS" operator="in" result="es" />
          <feMerge>
            <feMergeNode in="shape" />
            <feMergeNode in="eh" />
            <feMergeNode in="es" />
          </feMerge>
        </filter>
        <filter id="cs-tabdent" x="-10%" y="-45%" width="120%" height="190%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="b" />
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="shape" />
          <feOffset in="shape" dx="0" dy="1.5" result="dn" />
          <feComposite in="shape" in2="dn" operator="out" result="sA" />
          <feGaussianBlur in="sA" stdDeviation="1.5" result="sB" />
          <feComposite in="sB" in2="shape" operator="in" result="sC" />
          <feFlood style={{ floodColor: "var(--tdsh)" }} result="shc" />
          <feComposite in="shc" in2="sC" operator="in" result="sh" />
          <feOffset in="shape" dx="0" dy="-1" result="up" />
          <feComposite in="shape" in2="up" operator="out" result="hA" />
          <feGaussianBlur in="hA" stdDeviation="1" result="hB" />
          <feComposite in="hB" in2="shape" operator="in" result="hC" />
          <feFlood style={{ floodColor: "var(--tdhl)" }} result="hlc" />
          <feComposite in="hlc" in2="hC" operator="in" result="hl" />
          <feMerge>
            <feMergeNode in="shape" />
            <feMergeNode in="sh" />
            <feMergeNode in="hl" />
          </feMerge>
        </filter>
        <filter id="cs-indgoo" x="-20%" y="-80%" width="140%" height="260%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="2.6" />
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
        </filter>
      </defs>
    </svg>
  )
}

/** One bay's ghost: its edge layer and its lit fill layer. */
export function BayGhost({ className, style }: { className: string; style?: CSSProperties }) {
  return (
    <div className={className} aria-hidden="true" style={style}>
      <div className="cs-layer cs-edge"><div className="cs-bb" /></div>
      <div className="cs-layer cs-fill"><div className="cs-bb" /></div>
    </div>
  )
}

/**
 * Whether a bay is open from the pointer: it opens as soon as the pointer comes onto it and closes `linger` ms after
 * it leaves. `flash` opens it for that long without the pointer (a tab key). Focus inside keeps it open.
 */
export function useHoverBay(linger: number) {
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const enter = useCallback(() => {
    window.clearTimeout(timer.current)
    setHover(true)
  }, [])
  const leave = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setHover(false), linger)
  }, [linger])
  const flash = useCallback(() => {
    window.clearTimeout(timer.current)
    setHover(true)
    timer.current = window.setTimeout(() => setHover(false), linger)
  }, [linger])
  // A touch has no hover: a tap on the closed bay opens it, a tap outside it (or on a tab in it) closes it.
  const touchAway = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => touchAway.current?.(), [])
  const onTouch = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return
    const wrap = event.currentTarget as HTMLElement
    if (!hover) {
      window.clearTimeout(timer.current)
      setHover(true)
      touchAway.current?.()
      const away = (down: PointerEvent) => {
        if (wrap.contains(down.target as Node)) return
        window.clearTimeout(timer.current)
        setHover(false)
        touchAway.current?.()
      }
      document.addEventListener("pointerdown", away, true)
      // The tap that opened the bay must not also press whatever opened under the finger.
      const swallow = (click: Event) => {
        click.preventDefault()
        click.stopPropagation()
      }
      wrap.addEventListener("click", swallow, { capture: true, once: true })
      window.setTimeout(() => wrap.removeEventListener("click", swallow, true), 500)
      touchAway.current = () => {
        document.removeEventListener("pointerdown", away, true)
        touchAway.current = undefined
      }
    } else if ((event.target as HTMLElement).closest("[role='tab']")) leave()
  }
  const handlers = {
    onPointerDown: onTouch,
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType !== "touch") enter()
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType !== "touch") leave()
    },
    onFocus: () => setFocus(true),
    onBlur: (event: React.FocusEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocus(false)
    },
  }
  return { open: hover || focus, flash, close: () => { window.clearTimeout(timer.current); setHover(false) }, handlers }
}

/** The tab icons, as the design draws them: a chat bubble, a ticked box, a folded map, a book and a gear. */
export function TabGlyph({ id }: { id: string }) {
  const common = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true }
  if (id === "lobby") return <svg {...common}><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" /></svg>
  if (id === "tasks") return <svg {...common}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
  if (id === "plan") return <svg {...common}><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></svg>
  if (id === "knowledge") return <svg {...common}><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>
  return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>
}

const LEAD = "cubic-bezier(0.3,1.2,0.5,1)"
const TRAIL = "cubic-bezier(0.22,1,0.36,1)"

/**
 * The tab navigator. Closed it shows the active tab (or Settings, which is no tab); open, all four tabs with the
 * active one pressed into the bay. Moving between tabs, the indicator's leading edge springs ahead and its trailing
 * edge follows, and it squashes as it goes. Arrow keys follow the WAI-ARIA tabs pattern with a roving tabindex.
 */
export function useTabNavigator({ tabs, activeId, label, onSelect, flashRef }: {
  tabs: TabInfo[]
  activeId: string | undefined
  /** What the closed bay shows when no tab is active (Settings). */
  label: { id: string; text: string }
  onSelect: (id: string) => void
  /** Filled with a function that opens the bay for a moment (the tab keys). */
  flashRef: { current: (() => void) | null }
}) {
  const bay = useHoverBay(600)
  flashRef.current = bay.flash
  const strip = useRef<HTMLDivElement>(null)
  const closedLabel = useRef<HTMLSpanElement>(null)
  const cells = useRef<Record<string, HTMLAnchorElement | null>>({})
  const [width, setWidth] = useState({ closed: 99, open: 346 })
  const [flip, setFlip] = useState(0)
  const last = useRef<{ left?: number; placed: boolean }>({ placed: false })
  const shown = tabs.find((tab) => tab.id === activeId)
  const closedId = shown?.id ?? label.id
  const closedText = shown?.label ?? label.text

  // The bay's widths come from its content: the active label closed, every tab open.
  useLayoutEffect(() => {
    const measure = () => {
      const closed = closedLabel.current ? Math.ceil(closedLabel.current.getBoundingClientRect().width) + 40 : 99
      const tabsIn = strip.current ? [...strip.current.querySelectorAll<HTMLElement>("[role='tab']")] : []
      const open = tabsIn.length ? Math.ceil(tabsIn.reduce((sum, tab) => sum + tab.offsetWidth, 0) + (tabsIn.length - 1) * 2) + 20 : 346
      setWidth((now) => (now.closed === closed && now.open === open ? now : { closed, open }))
    }
    measure()
    void document.fonts?.ready.then(measure)
  }, [closedText, tabs.length])

  useEffect(() => setFlip((now) => now + 1), [closedId])

  // The indicator: placed under the active tab, its edges sprung as it moves.
  const place = useCallback(() => {
    const track = strip.current
    if (!track) return
    const active = activeId ? cells.current[activeId] : undefined
    if (!active) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const first = !last.current.placed
    const left = active.offsetLeft
    const right = track.offsetWidth - left - active.offsetWidth
    const goingRight = last.current.left === undefined ? true : left > last.current.left
    for (const layer of track.querySelectorAll<HTMLElement>(".cs-tabind")) {
      const el = layer.firstElementChild as HTMLElement | null
      if (!el) continue
      if (first || reduce || track.offsetWidth === 0) {
        el.style.transition = "none"
        el.style.left = `${left}px`
        el.style.right = `${right}px`
        continue
      }
      if (left === last.current.left) continue
      el.style.transition = goingRight ? `left 520ms ${TRAIL} 24ms, right 320ms ${LEAD}` : `left 320ms ${LEAD}, right 520ms ${TRAIL} 24ms`
      el.style.left = `${left}px`
      el.style.right = `${right}px`
      layer.animate?.([{ transform: "scaleY(1)" }, { transform: "scaleY(0.84)", offset: 0.35 }, { transform: "scaleY(1.05)", offset: 0.75 }, { transform: "scaleY(1)" }], { duration: 540, easing: "ease-in-out" })
    }
    if (track.offsetWidth > 0) last.current = { left, placed: true }
  }, [activeId])
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(place))
    return () => cancelAnimationFrame(frame)
  }, [place, width.open])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" && !event.altKey) {
      if (focusPage()) event.preventDefault()
      return
    }
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (!delta || tabs.length === 0) return
    event.preventDefault()
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

  const open = bay.open
  const vars = { "--wT": `${open ? width.open : width.closed}px`, "--hT": "40px" } as CSSProperties
  return { open, vars, ghost: <BayGhost className="cs-gt" style={vars} />, bay: (
    <div className="cs-tbwrap" style={vars} {...bay.handlers}>
      <div className="cs-tbx">
        <div className="cs-tbc" aria-hidden="true">
          <span ref={closedLabel} key={closedId} className="cs-lb" data-p={String(flip % 2)}>
            <span className="cs-ti"><TabGlyph id={closedId} /></span>
            {closedText}
          </span>
        </div>
        <div className="cs-tbo" data-none={activeId ? undefined : ""}>
        <div ref={strip} role="tablist" aria-label="Lobby tabs" onKeyDown={onKeyDown} className="cs-track">
          <span className="cs-tabind cs-dent" aria-hidden="true"><i /></span>
          <span className="cs-tabind cs-tint" aria-hidden="true"><i /></span>
          {tabs.map((tab, index) => (
            <a
              key={tab.id}
              ref={(el) => {
                cells.current[tab.id] = el
              }}
              role="tab"
              id={`tab-${tab.id}`}
              href={`#/${tab.id}`}
              aria-selected={tab.id === activeId}
              aria-keyshortcuts={tab.key}
              title={`${tab.label} · ${tab.key.replace("+", " ")}`}
              tabIndex={tab.id === activeId || (!activeId && index === 0) ? 0 : -1}
              className="cs-tab"
              style={{ "--i": index } as CSSProperties}
            >
              <span className="cs-ti"><TabGlyph id={tab.id} /></span>
              {tab.label}
            </a>
          ))}
        </div>
        </div>
      </div>
    </div>
  ) }
}

/** The bay at the top right that holds the code viewer and terminal buttons. */
export function RightBay({ children }: { children: ReactNode }) {
  return (
    <>
      <BayGhost className="cs-gr" />
      <div className={cn("cs-rbx")}>{children}</div>
    </>
  )
}
