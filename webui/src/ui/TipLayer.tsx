import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

/** Where a label sits against its button: above by default, below with `cs-b`, left with `cs-tipl`. */
type Side = "top" | "bottom" | "left" | "right"
type Shown = { text: string; el: HTMLElement; side: Side }

const GAP = 6
const EDGE = 8
const DELAY = 400

/** Whether a button's label should stay away: pressed, disabled, or with its menu open. */
function quiet(el: HTMLElement): boolean {
  return (
    el.matches(":disabled, [aria-disabled='true'], [aria-pressed='true'], [data-on='true'], [data-on=''], [aria-expanded='true']") ||
    !el.isConnected
  )
}

function wanted(el: HTMLElement): Side {
  if (el.classList.contains("cs-tipl")) return "left"
  if (el.classList.contains("cs-b")) return "bottom"
  return "top"
}

/** Places the label centred on its button, `GAP` away, flipped to the other side and nudged along it to stay on screen. */
function place(anchor: DOMRect, w: number, h: number, side: Side): { x: number; y: number; side: Side } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const fits = (s: Side) =>
    s === "top" ? anchor.top - GAP - h >= EDGE
      : s === "bottom" ? anchor.bottom + GAP + h <= vh - EDGE
        : s === "left" ? anchor.left - GAP - w >= EDGE
          : anchor.right + GAP + w <= vw - EDGE
  const flip: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" }
  const final = fits(side) || !fits(flip[side]) ? side : flip[side]
  const clamp = (v: number, size: number, max: number) => Math.min(Math.max(v, EDGE), max - size - EDGE)
  if (final === "top" || final === "bottom") {
    const x = clamp(anchor.left + anchor.width / 2 - w / 2, w, vw)
    const y = final === "top" ? anchor.top - GAP - h : anchor.bottom + GAP
    return { x, y, side: final }
  }
  const y = clamp(anchor.top + anchor.height / 2 - h / 2, h, vh)
  const x = final === "left" ? anchor.left - GAP - w : anchor.right + GAP
  return { x, y, side: final }
}

/**
 * One label for every button that carries `data-tip`: drawn over the page (never clipped by the card it sits in),
 * centred on its button a few pixels away, and kept on screen. It shows after a short hover, never on touch, and
 * leaves on press, scroll or a key.
 */
export function TipLayer() {
  const [shown, setShown] = useState<Shown | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number; side: Side } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let timer = 0
    const hide = () => {
      window.clearTimeout(timer)
      current.current = null
      setShown(null)
      setPos(null)
    }
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      const el = (event.target as Element | null)?.closest?.<HTMLElement>("[data-tip]")
      if (el === current.current) return
      hide()
      if (!el || !el.dataset.tip) return
      current.current = el
      timer = window.setTimeout(() => {
        if (current.current !== el || quiet(el) || !el.dataset.tip) return
        setShown({ text: el.dataset.tip, el, side: wanted(el) })
      }, DELAY)
    }
    const out = (event: PointerEvent) => {
      const to = event.relatedTarget as Node | null
      if (current.current && (!to || !current.current.contains(to))) hide()
    }
    document.addEventListener("pointerover", over, true)
    document.addEventListener("pointerout", out, true)
    document.addEventListener("pointerdown", hide, true)
    document.addEventListener("keydown", hide, true)
    document.addEventListener("scroll", hide, true)
    window.addEventListener("blur", hide)
    return () => {
      hide()
      document.removeEventListener("pointerover", over, true)
      document.removeEventListener("pointerout", out, true)
      document.removeEventListener("pointerdown", hide, true)
      document.removeEventListener("keydown", hide, true)
      document.removeEventListener("scroll", hide, true)
      window.removeEventListener("blur", hide)
    }
  }, [])

  // Measured once it is drawn, then placed: the first frame is invisible, so it never shows in the wrong spot.
  useLayoutEffect(() => {
    const el = box.current
    if (!shown || !el) return
    const rect = el.getBoundingClientRect()
    setPos(place(shown.el.getBoundingClientRect(), rect.width, rect.height, shown.side))
  }, [shown])

  if (!shown) return null
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className="tipbox"
      data-side={pos?.side ?? shown.side}
      data-ready={pos ? "" : undefined}
      style={{ position: "fixed", left: pos?.x ?? 0, top: pos?.y ?? 0 }}
    >
      {shown.text}
    </div>,
    document.body
  )
}
