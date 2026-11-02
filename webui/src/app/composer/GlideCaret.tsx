/**
 * The composer's caret, drawn over the message box so it glides to each new spot instead of jumping. The box's own
 * caret is hidden while this one shows; with reduced motion asked for, this draws nothing and the box keeps its own.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

/** Where character `index` of the mirror's text sits: its left edge, or the right edge of the one before at a line's end. */
function caretBox(mirror: HTMLElement, index: number): DOMRect | undefined {
  const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  const at = (offset: number): { node: Text; local: number } | undefined => {
    let seen = 0
    for (const node of nodes) {
      const size = node.data.length
      if (offset < seen + size) return { node, local: offset - seen }
      seen += size
    }
    return undefined
  }
  const rectOf = (offset: number): DOMRect | undefined => {
    const spot = at(offset)
    if (!spot) return undefined
    const range = document.createRange()
    range.setStart(spot.node, spot.local)
    range.setEnd(spot.node, spot.local + 1)
    const rects = range.getClientRects()
    return rects.length ? rects[0] : undefined
  }
  const text = mirror.textContent ?? ""
  // The character under the caret, unless it ends a line: then the caret sits after the one before it.
  if (text[index] !== "\n") {
    const box = rectOf(index)
    if (box) return new DOMRect(box.left, box.top, 0, box.height)
  }
  if (index > 0 && text[index - 1] !== "\n") {
    const box = rectOf(index - 1)
    if (box) return new DOMRect(box.right, box.top, 0, box.height)
  }
  // An empty line: the line break itself marks it.
  const spot = at(index)
  if (!spot) return undefined
  const range = document.createRange()
  range.setStart(spot.node, spot.local)
  range.collapse(true)
  const box = range.getBoundingClientRect()
  return box.height ? box : undefined
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
}

export function GlideCaret({ field, mirror, text }: { field: RefObject<HTMLTextAreaElement | null>; mirror: RefObject<HTMLDivElement | null>; text: string }) {
  const caret = useRef<HTMLSpanElement>(null)
  const [still, setStill] = useState(reducedMotion)
  const frame = useRef(0)
  const placed = useRef(false)

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    if (!query) return
    const change = () => setStill(query.matches)
    query.addEventListener("change", change)
    return () => query.removeEventListener("change", change)
  }, [])

  const place = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const box = field.current
      const layer = mirror.current
      const mark = caret.current
      const host = box?.parentElement
      if (!box || !layer || !mark || !host) return
      const shown = document.activeElement === box && box.selectionStart === box.selectionEnd
      const spot = shown ? caretBox(layer, box.selectionDirection === "backward" ? box.selectionStart : box.selectionEnd) : undefined
      if (!spot) {
        mark.dataset.on = "false"
        placed.current = false
        return
      }
      const origin = host.getBoundingClientRect()
      const x = spot.left - origin.left
      const y = spot.top - origin.top
      // The first spot after showing is taken at once; from then on the caret glides.
      mark.dataset.glide = placed.current ? "true" : "false"
      mark.style.transform = `translate3d(${x}px, ${y}px, 0)`
      mark.style.height = `${spot.height}px`
      mark.dataset.on = "true"
      placed.current = true
      // Solid while it moves; the blink starts again once it rests.
      mark.style.animation = "none"
      void mark.offsetWidth
      mark.style.animation = ""
    })
  }, [field, mirror])

  useLayoutEffect(() => {
    if (!still) place()
  }, [text, still, place])

  useEffect(() => {
    const box = field.current
    if (still || !box) return
    const hide = () => {
      if (caret.current) caret.current.dataset.on = "false"
      placed.current = false
    }
    const resize = new ResizeObserver(place)
    resize.observe(box)
    box.addEventListener("focus", place)
    box.addEventListener("blur", hide)
    box.addEventListener("scroll", place)
    box.addEventListener("input", place)
    document.addEventListener("selectionchange", place)
    place()
    return () => {
      cancelAnimationFrame(frame.current)
      resize.disconnect()
      box.removeEventListener("focus", place)
      box.removeEventListener("blur", hide)
      box.removeEventListener("scroll", place)
      box.removeEventListener("input", place)
      document.removeEventListener("selectionchange", place)
    }
  }, [field, still, place])

  if (still) return null
  return <span ref={caret} className="bubble-caret" data-on="false" aria-hidden="true" />
}
