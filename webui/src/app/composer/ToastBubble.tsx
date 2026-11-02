/**
 * The toast as a bubble of the composer's surface. It swells out of the composer's top edge, stretches up, pinches
 * off through the goo filters and settles a little above the box with a soft spring; leaving, it sinks back in and
 * merges with the composer again. Its shape is drawn in the bubble's ghost layers next to the menu's and the
 * composer's, so it gets the same lit rim and cast shadow; the text and the action button ride on top of it.
 *
 * With no composer on screen the same bubble rises alone from the window's foot (see the Toaster).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react"
import { animate, motion, useMotionValue, useReducedMotion, type MotionValue } from "motion/react"
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react"
import { useAnyOverlay } from "@/lib/overlay"
import { dismissToast, useToast, type ToastItem, type ToastKind } from "@/lib/toast"
import { cn } from "@/lib/utils"

const ICONS: Record<ToastKind, typeof Info> = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }
const TONES: Record<ToastKind, string> = { info: "text-info", success: "text-success", warning: "text-warning", error: "text-destructive" }

/** The room between the composer's top edge and the toast: wide enough that the goo lets them part. */
const GAP = 12
/** How narrow and how flat the bubble starts, deep in the composer. */
const START_X = 0.4
const START_Y = 0.45

export interface ToastBubble {
  item: ToastItem | undefined
  y: MotionValue<number>
  sx: MotionValue<number>
  sy: MotionValue<number>
  solid: MotionValue<number>
  fade: MotionValue<number>
  body: RefObject<HTMLDivElement | null>
  /** --tw, --th and --toast-room, for the bubble that holds the toast. */
  vars: CSSProperties
}

/**
 * The toast this bubble shows, and the values that move it. `from` says where it rises from: out of the composer,
 * or from below the window's foot. A new toast waits for the old one to sink away first.
 */
export function useToastBubble(enabled: boolean, from: "composer" | "floor"): ToastBubble {
  const { item: next } = useToast()
  const blocked = useAnyOverlay()
  const want = enabled && !blocked ? next : undefined
  const reduce = useReducedMotion() ?? false

  // `n` counts the toasts brought up, so the same toast coming back still rises again.
  const [shown, setShown] = useState<{ item: ToastItem; n: number } | undefined>()
  const [size, setSize] = useState({ w: 0, h: 0 })
  const y = useMotionValue(0)
  const sx = useMotionValue(START_X)
  const sy = useMotionValue(START_Y)
  const solid = useMotionValue(0)
  const fade = useMotionValue(0)
  const body = useRef<HTMLDivElement>(null)
  const leaving = useRef(false)
  const wantRef = useRef(want)
  wantRef.current = want
  const count = useRef(0)
  const sunk = useRef(0)

  const raise = (item: ToastItem | undefined) => setShown(item ? { item, n: ++count.current } : undefined)

  useEffect(() => {
    if (leaving.current) return
    if (!shown) return void (want && raise(want))
    if (want && want.id === shown.item.id) {
      // The same toast, perhaps with an action that joined it since.
      if (want !== shown.item) setShown({ item: want, n: shown.n })
      return
    }
    leaving.current = true
    const done = () => {
      leaving.current = false
      raise(wantRef.current)
    }
    if (reduce) {
      void Promise.all([animate(fade, 0, { duration: 0.12 }), animate(solid, 0, { duration: 0.12 })]).then(done)
      return
    }
    // The text goes first, then the bubble sinks back into where it came from, gathering speed as it goes.
    const sink = { duration: 0.3, delay: 0.06, ease: [0.55, 0, 0.75, 0.2] as const }
    void Promise.all([
      animate(fade, 0, { duration: 0.09, ease: "easeIn" }),
      animate(y, sunk.current, sink),
      animate(sx, START_X, sink),
      animate(sy, START_Y, sink),
      ...(from === "floor" ? [animate(solid, 0, { duration: 0.1, delay: 0.2 })] : []),
    ]).then(done)
  }, [want, shown, reduce, from, y, sx, sy, solid, fade])

  // Measure the new toast before it paints, start it deep in the composer, then let it spring up.
  const n = shown?.n
  useLayoutEffect(() => {
    const el = body.current
    if (n === undefined || !el) return
    const h = el.offsetHeight
    setSize({ w: el.offsetWidth, h })
    // Out of the composer, it starts as a low swell on the composer's top edge; from the floor, below the window.
    sunk.current = from === "composer" ? GAP + h * 0.3 : GAP + h + 28
    if (reduce) {
      y.set(0)
      sx.set(1)
      sy.set(1)
      solid.set(0)
      fade.set(0)
      animate(solid, 1, { duration: 0.14 })
      animate(fade, 1, { duration: 0.16 })
      return
    }
    y.set(sunk.current)
    sx.set(START_X)
    sy.set(START_Y)
    solid.set(from === "composer" ? 1 : 0)
    fade.set(0)
    // It rises a beat ahead of filling out, so it stretches tall as it leaves and squashes a touch as it lands.
    animate(y, 0, { type: "spring", visualDuration: 0.42, bounce: 0.18 })
    animate(sy, 1, { type: "spring", visualDuration: 0.36, bounce: 0.34, delay: 0.03 })
    animate(sx, 1, { type: "spring", visualDuration: 0.44, bounce: 0.3, delay: 0.05 })
    if (from === "floor") animate(solid, 1, { duration: 0.12 })
    animate(fade, 1, { duration: 0.2, delay: 0.24, ease: "easeOut" })
  }, [n, reduce, from, y, sx, sy, solid, fade])

  // A longer line or an action joining it later resizes the bubble with it.
  useEffect(() => {
    const el = body.current
    if (n === undefined || !el) return
    const observer = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [n])

  const vars = {
    "--tw": `${size.w}px`,
    "--th": `${size.h}px`,
    "--toast-room": shown ? `${size.h + GAP + 24}px` : "0px",
  } as CSSProperties
  return { item: shown?.item, y, sx, sy, solid, fade, body, vars }
}

/** The toast's shape, for one of the bubble's ghost layers. */
export function ToastShape({ t }: { t: ToastBubble }) {
  if (!t.item) return null
  return (
    <div className="toast-anchor">
      <motion.div className="toast-shape" style={{ y: t.y, scaleX: t.sx, scaleY: t.sy, opacity: t.solid }} />
    </div>
  )
}

/** The toast's words and action, over its shape. */
export function ToastBody({ t }: { t: ToastBubble }) {
  const item = t.item
  if (!item) return null
  const Icon = ICONS[item.kind]
  return (
    <div className="toast-anchor">
      <motion.div
        ref={t.body}
        className="toast-body"
        style={{ y: t.y, opacity: t.fade }}
        // Focusing the action must not unfold a folded composer under it.
        onFocus={(event) => event.stopPropagation()}
      >
        <Icon aria-hidden="true" className={cn("size-4 shrink-0", TONES[item.kind])} />
        <span className="min-w-0 break-words">{item.message}</span>
        {item.action ? (
          <button
            aria-keyshortcuts="Enter Space"
            aria-describedby="focused-action-help"
            type="button"
            className="btn-outline -my-1.5 -mr-1 h-7 shrink-0 rounded-lg border px-2.5 text-xs font-medium text-foreground transition-[box-shadow,scale] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => {
              item.action?.onClick()
              dismissToast(item.id)
            }}
          >
            {item.action.label}
          </button>
        ) : null}
      </motion.div>
    </div>
  )
}
