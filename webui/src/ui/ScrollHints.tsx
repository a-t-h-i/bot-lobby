/**
 * Scroll hints in place of a scrollbar. Put `<ScrollHints target={ref} />`
 * beside a scrolling pane (inside a positioned parent): the pane's own
 * scrollbar is hidden and a small up/down pair floats at its right edge,
 * halfway down. Each arrow shows only while there is more to see that way,
 * so the pair doubles as the "there is more" cue the scrollbar gave. A click
 * pages by most of a screen; holding an arrow keeps scrolling until it is let
 * go. Wheel, keys and touch scroll the pane as before. Under a finger the
 * pair stays away: the pane scrolls with a swipe and the arrows would only
 * cover what is being read.
 */
import { useEffect, useRef, useState, type RefObject } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

const EDGE = 4
const HOLD_MS = 320
const HOLD_SPEED = 0.9 // px per ms

interface Room {
  up: boolean
  down: boolean
  top: number
  right: number
}

function measure(pane: HTMLElement, host: HTMLElement | null): Room {
  const up = pane.scrollTop > EDGE
  const down = pane.scrollTop + pane.clientHeight < pane.scrollHeight - EDGE
  if (!host) return { up, down, top: 0, right: 0 }
  const box = pane.getBoundingClientRect()
  const frame = host.getBoundingClientRect()
  return { up, down, top: box.top - frame.top + box.height / 2, right: frame.right - box.right + 8 }
}

function same(a: Room, b: Room) {
  return a.up === b.up && a.down === b.down && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.right - b.right) < 0.5
}

export function ScrollHints({ target, up: showUp = true, down: showDown = true, className }: {
  target: RefObject<HTMLElement | null>
  /** Leave out an arrow when the pane already has its own way there (a log's "Jump to latest"). */
  up?: boolean
  down?: boolean
  className?: string
}) {
  const self = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<Room>({ up: false, down: false, top: 0, right: 0 })
  const hold = useRef<{ timer: number; frame: number; held: boolean } | null>(null)

  useEffect(() => {
    const pane = target.current
    if (!pane) return
    pane.setAttribute("data-scroll-hints", "")
    let queued = 0
    const update = () => {
      queued = 0
      const next = measure(pane, self.current?.offsetParent as HTMLElement | null)
      setRoom((now) => (same(now, next) ? now : next))
    }
    const soon = () => { if (!queued) queued = requestAnimationFrame(update) }
    update()
    pane.addEventListener("scroll", soon, { passive: true })
    window.addEventListener("resize", soon)
    const sizes = new ResizeObserver(soon)
    sizes.observe(pane)
    for (const child of pane.children) sizes.observe(child)
    // Content that arrives later (a loaded list, a new message) changes how far there is to go.
    const content = new MutationObserver(() => {
      for (const child of pane.children) sizes.observe(child)
      soon()
    })
    content.observe(pane, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(queued)
      pane.removeEventListener("scroll", soon)
      window.removeEventListener("resize", soon)
      sizes.disconnect()
      content.disconnect()
      pane.removeAttribute("data-scroll-hints")
    }
  }, [target])

  useEffect(() => () => stop(), [])

  function stop() {
    if (!hold.current) return
    clearTimeout(hold.current.timer)
    cancelAnimationFrame(hold.current.frame)
    hold.current = null
  }

  function smooth() {
    return window.matchMedia("(prefers-reduced-motion: no-preference)").matches ? "smooth" : "auto"
  }

  function page(direction: 1 | -1) {
    const pane = target.current
    if (pane) pane.scrollBy({ top: direction * Math.max(80, pane.clientHeight * 0.8), behavior: smooth() })
  }

  function press(direction: 1 | -1) {
    stop()
    const state = { timer: 0, frame: 0, held: false }
    state.timer = window.setTimeout(() => {
      state.held = true
      let last = performance.now()
      const step = (now: number) => {
        target.current?.scrollBy({ top: direction * (now - last) * HOLD_SPEED })
        last = now
        state.frame = requestAnimationFrame(step)
      }
      state.frame = requestAnimationFrame(step)
    }, HOLD_MS)
    hold.current = state
  }

  function arrow(direction: 1 | -1, shown: boolean) {
    const Icon = direction === 1 ? ChevronDown : ChevronUp
    return (
      <button
        type="button"
        tabIndex={-1}
        data-shown={shown || undefined}
        data-direction={direction === 1 ? "down" : "up"}
        title={direction === 1 ? "Scroll down · hold to keep going" : "Scroll up · hold to keep going"}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          press(direction)
        }}
        onPointerUp={() => {
          const held = hold.current?.held
          stop()
          if (held === false) page(direction)
        }}
        onPointerLeave={stop}
        onPointerCancel={stop}
        className="scroll-hint grid size-7 place-items-center rounded-md border bg-card/85 text-muted-foreground shadow-card backdrop-blur-sm hover:text-foreground"
      >
        <Icon aria-hidden="true" className="size-4" />
      </button>
    )
  }

  const up = showUp && room.up
  const down = showDown && room.down
  return (
    <div
      ref={self}
      aria-hidden="true"
      data-slot="scroll-hints"
      data-active={up || down || undefined}
      style={{ top: room.top, right: room.right }}
      className={cn("scroll-hints pointer-events-none absolute z-20 flex -translate-y-1/2 flex-col gap-1.5", className)}
    >
      {showUp ? arrow(-1, up) : null}
      {showDown ? arrow(1, down) : null}
    </div>
  )
}
