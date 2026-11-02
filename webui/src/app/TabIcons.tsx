/**
 * The tab pills' icons, drawn part by part from Lucide's own shapes so each
 * can play a little animation of its own: the Lobby's bubble talks, Tasks
 * ticks its boxes, Plan draws its route and Knowledge turns its pages.
 * A play is numbered: each new number plays once
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

/** How long Knowledge's play lasts: its three pages need a little longer than the other icons. */
const BOOK_SECONDS = 1.05

/** One page of Knowledge's book turning from right to left over the spine, starting at `from` of the play. */
function turn(play: number, from: number) {
  const at = (t: number) => Math.min(from + t, 0.999)
  const times = [0, Math.max(from, 0.001), at(0.17), at(0.34), at(0.4), 1]
  return part(play, {
    // Folding flat over the spine and opening out on the left: a page seen edge-on half way, curling as it goes.
    scaleX: [1, 1, 0.02, -1, -1, -1],
    skewY: [0, 0, -14, 0, 0, 0],
    y: [0, 0, -1.2, 0, 0, 0],
    strokeOpacity: [0, 0, 1, 0.9, 0, 0],
    fillOpacity: [0, 0, 0.22, 0.14, 0, 0],
  }, { duration: BOOK_SECONDS, times, ease: "easeInOut" })
}

function Knowledge({ play }: { play: number }) {
  return (
    <>
      {/* The book opens a touch wider as the pages go, and settles. */}
      <motion.g style={about()} {...part(play, { scaleX: [1, 1.08, 1.06, 1], y: [0, -0.6, -0.4, 0] }, { duration: BOOK_SECONDS, times: [0, 0.15, 0.8, 1], ease: "easeInOut" })}>
        <path d="M12 5v16" />
        <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />
      </motion.g>
      {/* Three pages flip from right to left, one after another, each turning about the spine. */}
      {play
        ? [0.06, 0.26, 0.46].map((from) => (
            <motion.path
              key={from}
              d="M12 6.4C13.6 5 15.6 4.4 18.6 4.5V16.6C15.6 16.5 13.6 17 12 18.4z"
              fill="currentColor"
              strokeWidth={1.4}
              style={about(0, 0.5)}
              {...turn(play, from)}
            />
          ))
        : null}
    </>
  )
}

const ICONS: Record<string, (props: { play: number }) => ReactNode> = {
  lobby: Lobby,
  tasks: Tasks,
  plan: Plan,
  knowledge: Knowledge,
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
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("overflow-visible", className)}
    >
      <Parts play={play} />
    </svg>
  )
}
