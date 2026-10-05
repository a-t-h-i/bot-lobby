/**
 * The Thinking orb: a glowing sphere in the colour of the agent thinking,
 * with that agent's name on a tag beside it. Pointed at (or focused), it
 * swells with a ripple and shows the agent's icon. It can be dragged anywhere
 * on the Lobby's card, or nudged with the arrow keys while focused (Shift for
 * bigger steps), and stays where it was put. A press that does not move opens
 * Thinking.
 */
import { forwardRef, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Keys } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { AgentIcon } from "@/ui/AgentIcon"
import { sourceLabel } from "./types"
import { clampPoint, loadPlace, savePlace, toPlace, toPoint, type Area, type Place } from "./orbPlace"

/** A press that travels less than this is a click, not a drag. */
const SLOP = 5
const NUDGE = 16

function cardArea(): Area | undefined {
  const rect = document.getElementById("main")?.getBoundingClientRect()
  return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined
}

/** The card's box, read again whenever the window or the card changes size. */
function useCardArea(): Area | undefined {
  const [area, setArea] = useState<Area | undefined>(cardArea)
  useEffect(() => {
    const read = () => setArea(cardArea())
    const main = document.getElementById("main")
    const observer = typeof ResizeObserver === "undefined" || !main ? undefined : new ResizeObserver(read)
    if (main) observer?.observe(main)
    window.addEventListener("resize", read)
    read()
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", read)
    }
  }, [])
  return area
}

interface OrbProps {
  /** The agent thinking now, if any. */
  spotlight?: string | undefined
  /** Everyone thinking, for screen readers. */
  thinking: string[]
  tone: string
  expanded: boolean
  hidden: boolean
  shortcut?: string | undefined
  onOpen: () => void
}

export const ThinkingOrb = forwardRef<HTMLButtonElement, OrbProps>(function ThinkingOrb({ spotlight, thinking, tone, expanded, hidden, shortcut, onOpen }, ref) {
  const area = useCardArea()
  const [place, setPlace] = useState<Place | undefined>(loadPlace)
  const [live, setLive] = useState<{ x: number; y: number }>()
  const [tip, setTip] = useState(false)
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | undefined>(undefined)
  const swallowClick = useRef(false)
  const size = useRef(44)

  const point = live ?? (place && area ? toPoint(place, area, size.current) : undefined)
  const keep = useCallback((x: number, y: number) => {
    const now = cardArea()
    if (!now) return
    const next = toPlace(x, y, now, size.current)
    setPlace(next)
    savePlace(next)
  }, [])

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    const box = event.currentTarget.getBoundingClientRect()
    size.current = box.width
    drag.current = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: box.left, oy: box.top, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const now = drag.current
    if (!now || now.id !== event.pointerId) return
    const dx = event.clientX - now.sx
    const dy = event.clientY - now.sy
    if (!now.moved && Math.hypot(dx, dy) < SLOP) return
    now.moved = true
    const bounds = cardArea()
    if (bounds) setLive(clampPoint(now.ox + dx, now.oy + dy, bounds, size.current))
  }
  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const now = drag.current
    drag.current = undefined
    if (!now?.moved) return
    swallowClick.current = true
    keep(now.ox + event.clientX - now.sx, now.oy + event.clientY - now.sy)
    setLive(undefined)
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? NUDGE * 4 : NUDGE
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!delta || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    size.current = box.width
    keep(box.left + delta[0]!, box.top + delta[1]!)
  }

  // Near the card's left edge the name goes on the orb's right.
  const flip = point && area ? point.x - area.left < 140 : false
  const style = { "--orb": tone, ...(point ? { left: point.x, top: point.y, right: "auto", bottom: "auto" } : {}) } as CSSProperties
  return (
    <Tooltip open={tip && !live} onOpenChange={setTip}>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label="Open Thinking"
          aria-description={`${spotlight ? `${thinking.map(sourceLabel).join(", ")} thinking. ` : ""}Drag, or use the arrow keys, to move it.`}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          aria-keyshortcuts={shortcut ? `${shortcut} Enter Space` : "Enter Space"}
          onClick={(event) => {
            if (swallowClick.current) {
              swallowClick.current = false
              event.preventDefault()
              return
            }
            onOpen()
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = undefined
            setLive(undefined)
          }}
          onKeyDown={onKeyDown}
          style={style}
          data-thinking={spotlight ? "" : undefined}
          data-dragging={live ? "" : undefined}
          data-placed={point ? "" : undefined}
          data-flip={flip || undefined}
          className={cn("thinking-bubble fixed z-20 touch-none rounded-full outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40", hidden && "invisible")}
        >
          <AnimatePresence initial={false}>
            {spotlight ? (
              <motion.span
                key="label"
                className="orb-label"
                initial={{ opacity: 0, x: flip ? -8 : 8, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: flip ? -8 : 8, scale: 0.9 }}
                transition={{ type: "spring", visualDuration: 0.3, bounce: 0.35 }}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={spotlight}
                    className="inline-flex items-center gap-1"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ type: "spring", visualDuration: 0.28, bounce: 0.3 }}
                  >
                    {sourceLabel(spotlight)}
                  </motion.span>
                </AnimatePresence>
              </motion.span>
            ) : null}
          </AnimatePresence>
          <span aria-hidden="true" className="orb orb-float">
            <span className="orb-icon">
              <AgentIcon source={spotlight} strokeWidth={2.25} className="size-3.5" />
            </span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        Thinking {shortcut ? <Keys chord={shortcut} /> : null}
        <span className="text-background/70"> · drag to move</span>
      </TooltipContent>
    </Tooltip>
  )
})
