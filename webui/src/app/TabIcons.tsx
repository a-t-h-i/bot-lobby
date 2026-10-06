/**
 * The tab pills' icons, drawn part by part from Lucide's own shapes so each
 * can play a little animation of its own: the Lobby's bubble talks, Tasks
 * ticks its boxes, Plan draws its route, Quick fix jolts, Issues pulses, the
 * Metrics bars grow, Git draws its branch, Knowledge claps its book and
 * Excalidraw's pen scribbles. A play is numbered: each new number plays once
 * (the parts remount and run from the start), and before the first the icon
 * simply rests. Every animation ends on the icon exactly as Lucide draws it.
 */
import type { CSSProperties, ReactNode } from "react"
import { motion, type Transition } from "motion/react"
import { cn } from "@/lib/utils"

/** How long a play lasts, in seconds; every part is timed within it. */
export const PLAY_SECONDS = 0.6

type Keyframes = Record<string, number[]>

/** A part that runs `keyframes` on a play and, before the first, rests on their last values. */
function part(play: number, keyframes: Keyframes, transition: Transition = {}) {
  return { initial: play ? undefined : (false as const), animate: keyframes, transition: { duration: PLAY_SECONDS, ...transition } }
}

/** Times within a play: `from` to `to` (fractions of it), held still before and after. */
const span = (from: number, to: number) => [0, Math.max(from, 0.001), Math.min(Math.max(to, from + 0.01), 0.999), 1]

/** A stroke drawn from its start, between `from` and `to` of the play. */
function draw(play: number, from = 0, to = 1) {
  return part(play, { pathLength: [0, 0, 1, 1], strokeOpacity: [0, 0, 1, 1] }, {
    pathLength: { duration: PLAY_SECONDS, times: span(from, to), ease: "easeInOut" },
    // A stroke of no length still shows its round cap, so it is hidden until it starts.
    strokeOpacity: { duration: PLAY_SECONDS, times: span(from, from + 0.02) },
  })
}

/** A part that springs up from nothing at `from` of the play. */
function pop(play: number, from: number) {
  return part(play, { scale: [0, 0, 1.3, 1] }, { times: span(from, from + 0.18), ease: "easeOut" })
}

/** A part that swells briefly at `from` of the play. */
function pulse(play: number, from: number, to = 1.3) {
  return part(play, { scale: [1, 1, to, 1, 1] }, { times: [0, Math.max(from, 0.001), Math.min(from + 0.15, 0.9), Math.min(from + 0.35, 0.99), 1], ease: "easeInOut" })
}

/** Transforms on an SVG part turn about its own box (`x`, `y`: where in it, 0 to 1). */
const about = (x = 0.5, y = 0.5): CSSProperties => ({ transformBox: "fill-box", originX: x, originY: y }) as CSSProperties

function Lobby({ play }: { play: number }) {
  return (
    <motion.g style={about(0.1, 0.9)} {...part(play, { rotate: [0, -12, 8, -4, 0], scale: [1, 1.12, 0.96, 1.02, 1] }, { ease: "easeInOut" })}>
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
      {/* Someone typing: three dots blink in turn inside the bubble, then it is quiet again. */}
      {[8, 12, 16].map((cx, n) => (
        <motion.circle
          key={cx}
          cx={cx}
          cy={11}
          r={1.15}
          fill="currentColor"
          stroke="none"
          {...part(play, { fillOpacity: [0, 0, 1, 1, 0], y: [0, 0, -1.5, 0, 0] }, { times: [0, 0.12 + n * 0.12, 0.24 + n * 0.12, 0.72, 1] })}
        />
      ))}
    </motion.g>
  )
}

function Tasks({ play }: { play: number }) {
  return (
    <>
      <motion.path d="M13 5h8" {...draw(play, 0.15, 0.45)} />
      <motion.path d="M13 12h8" {...draw(play, 0.3, 0.6)} />
      <motion.path d="M13 19h8" {...draw(play, 0.45, 0.75)} />
      <motion.path d="m3 17 2 2 4-4" {...draw(play, 0.35, 0.7)} />
      <motion.path d="m3 7 2 2 4-4" {...draw(play, 0, 0.35)} />
    </>
  )
}

function Plan({ play }: { play: number }) {
  return (
    <>
      <motion.circle cx={6} cy={19} r={3} style={about()} {...pulse(play, 0)} />
      <motion.path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" {...draw(play, 0.1, 0.7)} />
      <motion.circle cx={18} cy={5} r={3} style={about()} {...pop(play, 0.62)} />
    </>
  )
}

function QuickFix({ play }: { play: number }) {
  return (
    <motion.g style={about()} {...part(play, { rotate: [0, -14, 10, -6, 0], scale: [1, 1.18, 0.94, 1.04, 1] }, { duration: 0.5, ease: "easeInOut" })}>
      <motion.path
        d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"
        fill="currentColor"
        {...part(play, { fillOpacity: [0, 0.85, 0] }, { duration: 0.5, times: [0, 0.2, 1] })}
      />
    </motion.g>
  )
}

function Issues({ play }: { play: number }) {
  return (
    <>
      {/* A ripple spreads out from the ring and fades. */}
      <motion.circle cx={12} cy={12} r={10} style={about()} {...part(play, { scale: [1, 1, 1.4], strokeOpacity: [0, 0.5, 0] }, { times: [0, 0.25, 1], ease: "easeOut" })} />
      <motion.circle cx={12} cy={12} r={10} style={about()} {...part(play, { scale: [1, 0.86, 1.06, 1] }, { times: [0, 0.25, 0.55, 1], ease: "easeInOut" })} />
      <motion.circle cx={12} cy={12} r={1} fill="currentColor" style={about()} {...part(play, { scale: [1, 2.4, 0.8, 1] }, { times: [0, 0.3, 0.6, 1], ease: "easeInOut" })} />
    </>
  )
}

function Metrics({ play }: { play: number }) {
  return (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      {/* The bars grow up from the axis one after another. */}
      {["M8 17v-3", "M13 17V5", "M18 17V9"].map((d, n) => (
        <motion.path key={d} d={d} style={about(0.5, 1)} {...part(play, { scaleY: [0, 0, 1.18, 1] }, { times: span(0.08 + n * 0.14, 0.4 + n * 0.14), ease: "easeOut" })} />
      ))}
    </>
  )
}

function Git({ play }: { play: number }) {
  return (
    <>
      <motion.circle cx={6} cy={6} r={3} style={about()} {...pulse(play, 0)} />
      <motion.line x1={6} x2={6} y1={9} y2={21} {...draw(play, 0.05, 0.45)} />
      <motion.path d="M13 6h3a2 2 0 0 1 2 2v7" {...draw(play, 0.2, 0.62)} />
      <motion.circle cx={18} cy={18} r={3} style={about()} {...pop(play, 0.58)} />
    </>
  )
}

function Knowledge({ play }: { play: number }) {
  return (
    <motion.g style={about()} {...part(play, { scaleX: [1, 0.55, 1.08, 1], y: [0, -1, 0, 0] }, { times: [0, 0.35, 0.65, 1], ease: "easeInOut" })}>
      <motion.path d="M12 5v16" style={about()} {...part(play, { scaleY: [1, 1.12, 1, 1] }, { times: [0, 0.35, 0.65, 1] })} />
      <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />
    </motion.g>
  )
}

function Excalidraw({ play }: { play: number }) {
  return (
    <motion.g style={about(0.6, 0.6)} {...part(play, { x: [0, 1.5, -1.5, 1, 0], y: [0, -1, 0.5, -0.5, 0], rotate: [0, -8, 6, -3, 0] }, { ease: "easeInOut" })}>
      <path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" />
      <path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" />
      <motion.path d="m2.3 2.3 7.286 7.286" {...draw(play, 0.1, 0.6)} />
      <motion.circle cx={11} cy={11} r={2} style={about()} {...pulse(play, 0.5, 1.5)} />
    </motion.g>
  )
}

const ICONS: Record<string, (props: { play: number }) => ReactNode> = {
  lobby: Lobby,
  tasks: Tasks,
  plan: Plan,
  quickfix: QuickFix,
  issues: Issues,
  metrics: Metrics,
  git: Git,
  knowledge: Knowledge,
  excalidraw: Excalidraw,
}

/** A tab's icon, playing once each time `play` goes up. */
export function TabIcon({ id, play, className }: { id: string; play: number; className?: string }) {
  const Parts = ICONS[id]
  if (!Parts) return null
  return (
    <svg
      // A new play remounts the parts, so they run from the start.
      key={play}
      aria-hidden="true"
      data-tab-icon={id}
      data-play={play}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("overflow-visible", className)}
    >
      <Parts play={play} />
    </svg>
  )
}
