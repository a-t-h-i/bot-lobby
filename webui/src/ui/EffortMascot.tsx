/**
 * A small robot that acts out an effort level: asleep at `off` (eyes shut,
 * floating z's, slow breathing), drowsy at `minimal`, relaxed at `low`,
 * thoughtful at `medium` (thought dots), focused at `high` (brows down,
 * sparkles), straining at `xhigh` (squint, sweat, steam) and blazing at `max`
 * (wide eyes, a grin, an aura and a shake). It is decoration: the slider next
 * to it says the level in words, so the picture is hidden from screen readers,
 * and it holds still when the system asks for less motion.
 */
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

/** What each level looks like: eye opening, mouth, brows, and how the body moves (bob in px, seconds per bob). */
const POSES = {
  off: { eye: 0.08, mouth: "M27 40 Q32 40 37 40", brow: 0, bob: 0.6, period: 4.2 },
  minimal: { eye: 0.4, mouth: "M28 40 Q32 41 36 40", brow: 0, bob: 1, period: 3.4 },
  low: { eye: 0.9, mouth: "M26 39 Q32 43 38 39", brow: 0, bob: 1.5, period: 2.8 },
  medium: { eye: 1, mouth: "M27 40 Q32 40 37 40", brow: 0, bob: 1.5, period: 2.2 },
  high: { eye: 0.85, mouth: "M27 41 Q32 39 37 41", brow: 1, bob: 2, period: 1.6 },
  xhigh: { eye: 0.65, mouth: "M28 41 Q32 38 36 41", brow: 1, bob: 2, period: 1 },
  max: { eye: 1.25, mouth: "M25 38 Q32 47 39 38", brow: 1, bob: 2.5, period: 0.5 },
} as const

type Level = keyof typeof POSES

const forever = { repeat: Infinity } as const

const STAR = "M0 -4 L1 -1 L4 0 L1 1 L0 4 L-1 1 L-4 0 L-1 -1Z"

function Zzz() {
  return (
    <g className="fill-muted-foreground" fontSize="9" fontWeight="600">
      {[0, 1, 2].map((n) => (
        <motion.text
          key={n}
          x={44 + n * 6}
          y={16 - n * 6}
          fontSize={7 + n * 2}
          animate={{ opacity: [0, 1, 0], y: [16 - n * 6 + 4, 16 - n * 6 - 4] }}
          transition={{ ...forever, duration: 2.4, delay: n * 0.6, ease: "easeOut" }}
        >
          z
        </motion.text>
      ))}
    </g>
  )
}

function ThoughtDots() {
  return (
    <g className="fill-primary">
      {[
        [49, 15, 1.3],
        [54, 10, 1.9],
        [60, 4, 2.5],
      ].map(([cx, cy, r], n) => (
        <motion.circle key={n} cx={cx} cy={cy} r={r} animate={{ opacity: [0.15, 1, 0.15] }} transition={{ ...forever, duration: 1.8, delay: n * 0.3 }} />
      ))}
    </g>
  )
}

function Sparkles() {
  return (
    <g className="fill-primary">
      {[
        [7, 14, 0],
        [58, 11, 0.5],
      ].map(([x, y, delay], n) => (
        <motion.path key={n} d={STAR} style={{ x, y }} animate={{ scale: [0, 1, 0], rotate: [0, 45, 90] }} transition={{ ...forever, duration: 1.4, delay }} />
      ))}
    </g>
  )
}

function Strain() {
  return (
    <>
      <motion.path
        d="M54 20 Q57 25 54 27 Q51 25 54 20Z"
        className="fill-primary/70"
        animate={{ y: [0, 9], opacity: [1, 1, 0] }}
        transition={{ ...forever, duration: 1, ease: "easeIn" }}
      />
      {[22, 42].map((cx, n) => (
        <motion.circle key={cx} cx={cx} cy={15} r={2} className="fill-muted-foreground/50" animate={{ y: [0, -9], opacity: [0.7, 0], scale: [0.6, 1.4] }} transition={{ ...forever, duration: 0.9, delay: n * 0.45 }} />
      ))}
    </>
  )
}

function Blaze() {
  return (
    <>
      {[0, 0.5].map((delay) => (
        <motion.circle
          key={delay}
          cx={32}
          cy={34}
          fill="none"
          strokeWidth={1.5}
          className="stroke-primary"
          animate={{ r: [24, 34], opacity: [0.6, 0] }}
          transition={{ ...forever, duration: 1, delay, ease: "easeOut" }}
        />
      ))}
      {[-1, 1].map((side) => (
        <motion.path
          key={side}
          d={`M${32 + side * 6} 5 L${32 + side * 11} 1`}
          strokeWidth={1.8}
          strokeLinecap="round"
          className="stroke-primary"
          animate={{ opacity: [0, 1, 0] }}
          transition={{ ...forever, duration: 0.35, delay: side === 1 ? 0.1 : 0 }}
        />
      ))}
    </>
  )
}

export function EffortMascot({ level, className }: { level: string; className?: string }) {
  const calm = useReducedMotion()
  const name: Level = level in POSES ? (level as Level) : "medium"
  const pose = POSES[name]
  const awake = name !== "off"
  const settle = calm ? { duration: 0 } : { type: "spring" as const, stiffness: 260, damping: 22 }
  const move = !calm
  // A blink every other bob; the sleeper keeps its eyes shut.
  const eyes = move && awake ? { scaleY: [pose.eye, pose.eye, 0.08, pose.eye, pose.eye] } : { scaleY: pose.eye }
  const eyeTime = move && awake ? { ...forever, duration: Math.max(pose.period * 2, 1.2), times: [0, 0.46, 0.5, 0.54, 1] } : settle
  // The body: breathing when asleep, a bob that quickens with effort, a shake at max.
  const body =
    !move ? undefined : name === "off" ? { scale: [1, 1.025, 1] } : name === "max" ? { y: [0, -pose.bob, 0], x: [0, -0.8, 0.8, 0] } : { y: [0, -pose.bob, 0] }
  const eyeBox = { transformBox: "fill-box", transformOrigin: "center" } as const

  return (
    <svg viewBox="0 0 64 64" data-slot="effort-mascot" data-level={name} aria-hidden="true" focusable="false" className={cn("size-14 shrink-0 overflow-visible", className)}>
      {move && name === "off" ? <Zzz /> : null}
      {move && name === "medium" ? <ThoughtDots /> : null}
      {move && name === "high" ? <Sparkles /> : null}
      {move && name === "xhigh" ? <Strain /> : null}
      {move && name === "max" ? <Blaze /> : null}
      <motion.g
        animate={body}
        transition={{ ...forever, duration: pose.period, ease: "easeInOut" }}
        style={{ transformOrigin: "32px 56px" }}
      >
        <path d="M32 17 V11" strokeWidth={2} strokeLinecap="round" className="stroke-primary/70" />
        <motion.circle cx={32} cy={8} r={3} className={awake ? "fill-primary" : "fill-muted-foreground/50"} animate={move && name === "max" ? { scale: [1, 1.5, 1] } : { scale: 1 }} transition={{ ...forever, duration: 0.35 }} style={eyeBox} />
        <rect x={4.5} y={29} width={5.5} height={11} rx={2.5} className="fill-primary/25" />
        <rect x={54} y={29} width={5.5} height={11} rx={2.5} className="fill-primary/25" />
        <rect x={10} y={17} width={44} height={36} rx={10} strokeWidth={2} className="fill-primary/12 stroke-primary/80" />
        <rect x={15} y={23} width={34} height={24} rx={7} className="fill-card stroke-border" strokeWidth={1} />
        <motion.ellipse cx={25} cy={32} rx={3.2} ry={3.6} className="fill-foreground" style={eyeBox} animate={eyes} transition={eyeTime} />
        <motion.ellipse cx={39} cy={32} rx={3.2} ry={3.6} className="fill-foreground" style={eyeBox} animate={eyes} transition={eyeTime} />
        <motion.path
          d="M20 27 L28 28.5 M44 27 L36 28.5"
          strokeWidth={1.8}
          strokeLinecap="round"
          className="stroke-foreground"
          animate={{ opacity: pose.brow }}
          transition={settle}
        />
        <motion.path d={pose.mouth} fill="none" strokeWidth={2} strokeLinecap="round" className="stroke-foreground" animate={{ d: pose.mouth }} initial={false} transition={calm ? { duration: 0 } : { duration: 0.3 }} />
        <rect x={20} y={53} width={24} height={4} rx={2} className="fill-primary/25" />
      </motion.g>
    </svg>
  )
}
