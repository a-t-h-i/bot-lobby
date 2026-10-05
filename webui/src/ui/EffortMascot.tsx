/**
 * A small robot that acts out an effort level, one character per level:
 *
 * - `off`: fast asleep, eyes shut, antenna drooping, z's drifting up
 * - `minimal`: drowsy, nodding off and yawning
 * - `low`: chilled out, swaying and humming a tune
 * - `medium`: curious, looking around with a question popping up
 * - `high`: locked in, brows down, a scan line sweeping its face
 * - `xhigh`: hyped, hopping with electrons whizzing round its head
 * - `max`: ultra, a rainbow shimmer over the whole bot, star eyes and sparkles
 *
 * Switching level gets a reaction: a hop and a burst going up, a squish going
 * down. It is decoration (the slider beside it says the level in words), so it
 * is hidden from screen readers and holds a still pose when the system asks
 * for less motion.
 */
import { useEffect, useId, useRef, useState } from "react"
import { motion, useReducedMotion, type TargetAndTransition, type Transition } from "motion/react"
import { cn } from "@/lib/utils"

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const
type Level = (typeof LEVELS)[number]

const forever = { repeat: Infinity } as const
const STAR = "M0 -4 L1 -1 L4 0 L1 1 L0 4 L-1 1 L-4 0 L-1 -1Z"
/** The rainbow's hues, the same ones the `max` word shimmers through. */
const RAINBOW = ["var(--rainbow-1)", "var(--rainbow-2)", "var(--rainbow-3)", "var(--rainbow-4)", "var(--rainbow-5)", "var(--rainbow-6)", "var(--rainbow-7)"]
const box = { transformBox: "fill-box", transformOrigin: "center" } as const

/** How the whole bot moves at each level (its idle loop). */
function idleOf(level: Level): { animate: TargetAndTransition; transition: Transition } {
  switch (level) {
    case "off":
      return { animate: { scale: [1, 1.03, 1], rotate: -5 }, transition: { ...forever, duration: 4, ease: "easeInOut" } }
    case "minimal":
      // Nodding off: the head sinks slowly, then jerks back awake.
      return { animate: { rotate: [0, 0, 7, 9, 0, 0], y: [0, 0, 1.5, 2, 0, 0] }, transition: { ...forever, duration: 4.2, times: [0, 0.35, 0.7, 0.82, 0.86, 1], ease: "easeInOut" } }
    case "low":
      return { animate: { rotate: [-4, 4, -4], y: [0, -1, 0] }, transition: { ...forever, duration: 3.2, ease: "easeInOut" } }
    case "medium":
      return { animate: { rotate: [0, -5, -5, 5, 5, 0], y: [0, -1, -1, -1, -1, 0] }, transition: { ...forever, duration: 4, times: [0, 0.12, 0.4, 0.52, 0.8, 1], ease: "easeInOut" } }
    case "high":
      return { animate: { y: [0, -1.5, 0] }, transition: { ...forever, duration: 0.6, ease: "easeInOut" } }
    case "xhigh":
      // A hop with a squash on landing.
      return {
        animate: { y: [0, -7, 0, 0], scaleY: [1, 1.06, 0.88, 1], scaleX: [1, 0.96, 1.1, 1] },
        transition: { ...forever, duration: 0.7, times: [0, 0.4, 0.75, 1], ease: "easeInOut" },
      }
    case "max":
      return { animate: { y: [-1, -4, -1], rotate: [-3, 3, -3] }, transition: { ...forever, duration: 1.6, ease: "easeInOut" } }
  }
}

function Zzz() {
  // Motion's x and y are offsets from the letter's own place, so each z drifts up and a little right.
  return (
    <g className="fill-muted-foreground" fontWeight="700">
      {[0, 1, 2].map((n) => (
        <motion.text
          key={n}
          x={44 + n * 4.5}
          y={17 - n * 5.5}
          fontSize={5.5 + n * 2}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0], y: [3, -4], x: [0, 2.5] }}
          transition={{ ...forever, duration: 2.6, delay: n * 0.8, ease: "easeOut" }}
        >
          z
        </motion.text>
      ))}
    </g>
  )
}

function Notes() {
  return (
    <g className="fill-primary" fontSize="9">
      {[0, 1].map((n) => (
        <motion.text
          key={n}
          x={48}
          y={20}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0], y: [2, -5, -11, -17], x: [0, 3, 1, 5], rotate: [0, 12, -8, 10] }}
          transition={{ ...forever, duration: 3, delay: n * 1.5, ease: "easeOut" }}
          style={box}
        >
          {n ? "♫" : "♪"}
        </motion.text>
      ))}
    </g>
  )
}

function Question() {
  return (
    <motion.text
      x={52}
      y={14}
      fontSize="12"
      fontWeight="700"
      className="fill-primary"
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: [0, 0, 1, 1, 0], scale: [0, 0, 1.2, 1, 0.6], rotate: [0, 0, -12, 8, 0] }}
      transition={{ ...forever, duration: 4, times: [0, 0.5, 0.58, 0.85, 1] }}
      style={box}
    >
      ?
    </motion.text>
  )
}

function Sparkles({ spots, rainbow }: { spots: Array<[number, number, number]>; rainbow?: boolean }) {
  return (
    <g>
      {spots.map(([x, y, delay], n) => (
        <motion.path
          key={n}
          d={STAR}
          className={rainbow ? undefined : "fill-primary"}
          style={{ x, y, ...(rainbow ? { fill: RAINBOW[n % RAINBOW.length] } : {}) }}
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.1, 0], rotate: [0, 90, 180] }}
          transition={{ ...forever, duration: 1.3, delay, ease: "easeInOut" }}
        />
      ))}
    </g>
  )
}

/** Two electrons whizzing round the head on tilted orbits. */
function Orbits() {
  return (
    <g>
      {[-20, 20].map((tilt, n) => (
        <g key={tilt} transform={`rotate(${tilt} 32 34)`}>
          <ellipse cx={32} cy={34} rx={30} ry={9} fill="none" strokeWidth={0.8} strokeDasharray="2 3" className="stroke-primary/35" />
          <motion.circle
            r={2}
            className="fill-primary"
            animate={{ cx: [2, 32, 62, 32, 2], cy: [34, 43, 34, 25, 34] }}
            transition={{ ...forever, duration: 1.1, delay: n * 0.55, ease: "linear" }}
          />
        </g>
      ))}
    </g>
  )
}

function Sweat() {
  return (
    <motion.path
      d="M53 22 Q56 27 53 29 Q50 27 53 22Z"
      className="fill-primary/60"
      animate={{ y: [0, 8], opacity: [0, 1, 0] }}
      transition={{ ...forever, duration: 0.9, ease: "easeIn", repeatDelay: 0.5 }}
    />
  )
}

/** The rainbow glow behind the bot at max, breathing in and out. */
function Aura({ id }: { id: string }) {
  return (
    <motion.circle
      cx={32}
      cy={34}
      r={27}
      fill={`url(#${id}-glow)`}
      animate={{ scale: [0.92, 1.08, 0.92], opacity: [0.5, 0.85, 0.5] }}
      transition={{ ...forever, duration: 1.6, ease: "easeInOut" }}
      style={{ transformOrigin: "32px 34px" }}
    />
  )
}

/** A ring of bits flung out when the level goes up. */
function Burst({ rainbow }: { rainbow: boolean }) {
  return (
    <g>
      {Array.from({ length: 8 }, (_, n) => {
        const angle = (n / 8) * Math.PI * 2
        return (
          <motion.circle
            key={n}
            cx={32}
            cy={34}
            r={2}
            className={rainbow ? undefined : "fill-primary"}
            style={rainbow ? { fill: RAINBOW[n % RAINBOW.length] } : undefined}
            initial={{ opacity: 1, scale: 1 }}
            animate={{ cx: 32 + Math.cos(angle) * 32, cy: 34 + Math.sin(angle) * 30, opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        )
      })}
    </g>
  )
}

function Eyes({ level, move }: { level: Level; move: boolean }) {
  const ink = "fill-foreground"
  const line = { fill: "none", strokeWidth: 2.2, strokeLinecap: "round" as const, className: "stroke-foreground" }
  if (level === "off") return <path d="M20 33 Q24.5 36.5 29 33 M35 33 Q39.5 36.5 44 33" {...line} />
  if (level === "low") {
    // Content: happy closed eyes that open for a peek now and then.
    return <path d="M20 34 Q24.5 29.5 29 34 M35 34 Q39.5 29.5 44 34" {...line} />
  }
  if (level === "max") {
    return (
      <g>
        {[25, 39].map((cx, n) => (
          <motion.path
            key={cx}
            d="M0 -5.5 L1.6 -1.6 L5.5 0 L1.6 1.6 L0 5.5 L-1.6 1.6 L-5.5 0 L-1.6 -1.6Z"
            style={{ x: cx, y: 33, fill: RAINBOW[n ? 4 : 0] }}
            animate={move ? { rotate: [0, 90, 180], scale: [1, 1.25, 1] } : {}}
            transition={{ ...forever, duration: 1.2, ease: "easeInOut", delay: n * 0.2 }}
          />
        ))}
      </g>
    )
  }
  const open = level === "minimal" ? 0.45 : level === "high" ? 0.7 : level === "xhigh" ? 1.2 : 1
  // Eyes that look around (medium), blink now and then, and blink fast when hyped.
  const look = move && level === "medium" ? { x: [0, -2.5, -2.5, 2.5, 2.5, 0] } : { x: 0 }
  const lookTime = move && level === "medium" ? { ...forever, duration: 4, times: [0, 0.12, 0.4, 0.52, 0.8, 1] } : { duration: 0.2 }
  const period = level === "minimal" ? 3.2 : level === "xhigh" ? 1.4 : 3.6
  const blink = move ? { scaleY: [open, open, 0.1, open, open] } : { scaleY: open }
  const blinkTime = move ? { ...forever, duration: period, times: [0, 0.44, 0.5, 0.56, 1] } : { duration: 0.2 }
  return (
    <motion.g animate={look} transition={lookTime}>
      {[25, 39].map((cx) => (
        <g key={cx}>
          <motion.ellipse cx={cx} cy={33} rx={3.4} ry={3.8} className={ink} style={box} animate={blink} transition={blinkTime} />
          {level !== "minimal" ? <circle cx={cx + 1.2} cy={31.6} r={1} className="fill-card" /> : null}
        </g>
      ))}
    </motion.g>
  )
}

function Mouth({ level, move }: { level: Level; move: boolean }) {
  const line = { fill: "none", strokeWidth: 2, strokeLinecap: "round" as const, className: "stroke-foreground" }
  switch (level) {
    case "off":
      return (
        <g>
          <circle cx={32} cy={42} r={1.4} className="fill-foreground" />
          {/* A sleep bubble that swells and pops. */}
          {move ? (
            <motion.circle
              cx={35}
              cy={42}
              r={3}
              fill="none"
              strokeWidth={0.9}
              className="stroke-primary/60"
              animate={{ scale: [0.2, 1.3, 1.5, 0], opacity: [0.6, 0.9, 0.9, 0] }}
              transition={{ ...forever, duration: 4, times: [0, 0.7, 0.9, 1] }}
              style={{ transformOrigin: "33px 42px" }}
            />
          ) : null}
        </g>
      )
    case "minimal":
      // A big yawn now and then.
      return (
        <motion.ellipse
          cx={32}
          cy={42}
          rx={3}
          ry={0.8}
          className="fill-foreground"
          animate={move ? { ry: [0.8, 0.8, 3.6, 3.6, 0.8], rx: [3, 3, 3.6, 3.6, 3] } : {}}
          transition={{ ...forever, duration: 6, times: [0, 0.6, 0.7, 0.85, 1] }}
        />
      )
    case "low":
      return <path d="M26 40 Q32 45 38 40" {...line} />
    case "medium":
      return <path d="M28 41.5 Q32 43 36 41.5" {...line} />
    case "high":
      return <path d="M27 42 L37 41" {...line} />
    case "xhigh":
      return <path d="M25.5 39.5 Q32 47 38.5 39.5Z" className="fill-foreground" />
    case "max":
      return (
        <g>
          <path d="M24 38.5 Q32 50 40 38.5Z" className="fill-foreground" />
          <path d="M28.5 44.5 Q32 47.5 35.5 44.5 Q32 43 28.5 44.5Z" style={{ fill: "var(--rainbow-1)" }} />
        </g>
      )
  }
}

export function EffortMascot({ level, className }: { level: string; className?: string }) {
  const calm = useReducedMotion() ?? false
  const name: Level = (LEVELS as readonly string[]).includes(level) ? (level as Level) : "medium"
  const id = `m${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  const move = !calm
  const rank = LEVELS.indexOf(name)

  // A reaction each time the level changes: which way it went, and a fresh key to replay it.
  const last = useRef(rank)
  const [change, setChange] = useState<{ n: number; up: boolean }>({ n: 0, up: true })
  useEffect(() => {
    if (rank === last.current) return
    setChange((now) => ({ n: now.n + 1, up: rank > last.current }))
    last.current = rank
  }, [rank])

  const idle = idleOf(name)
  const rainbow = name === "max"
  const stroke = rainbow ? { stroke: `url(#${id}-rainbow)` } : undefined
  const react: TargetAndTransition | undefined =
    !move || change.n === 0
      ? undefined
      : change.up
        ? { y: [0, -9, 0, 0], scaleX: [1, 0.9, 1.1, 1], scaleY: [1, 1.12, 0.9, 1] }
        : { y: [0, 0, 0], scaleX: [1, 1.12, 1], scaleY: [1, 0.84, 1] }

  return (
    <svg viewBox="0 0 64 64" data-slot="effort-mascot" data-level={name} aria-hidden="true" focusable="false" className={cn("size-14 shrink-0 overflow-visible", className)}>
      <defs>
        <linearGradient id={`${id}-rainbow`} x1="0" y1="0" x2="1" y2="1">
          {RAINBOW.map((colour, n) => (
            <stop key={n} offset={n / (RAINBOW.length - 1)} stopColor={colour} />
          ))}
          {move && rainbow ? <animateTransform attributeName="gradientTransform" type="rotate" from="0 0.5 0.5" to="360 0.5 0.5" dur="2.4s" repeatCount="indefinite" /> : null}
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0.35" stopColor="var(--rainbow-6)" stopOpacity="0.45" />
          <stop offset="0.7" stopColor="var(--rainbow-1)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--rainbow-3)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {rainbow ? move ? <Aura id={id} /> : <circle cx={32} cy={34} r={27} fill={`url(#${id}-glow)`} /> : null}
      {move && name === "xhigh" ? <Orbits /> : null}

      <motion.g key={change.n} animate={react} transition={{ duration: change.up ? 0.55 : 0.45, ease: "easeOut" }} style={{ transformOrigin: "32px 56px" }}>
        <motion.g animate={move ? idle.animate : { rotate: name === "off" ? -5 : 0 }} transition={move ? idle.transition : { duration: 0 }} style={{ transformOrigin: "32px 56px" }}>
          {/* The antenna droops while asleep, wiggles when curious and spins its bulb when hyped. */}
          <motion.g
            style={{ transformOrigin: "32px 17px" }}
            animate={
              name === "off"
                ? { rotate: 32 }
                : name === "minimal"
                  ? { rotate: 14 }
                  : move && name === "medium"
                    ? { rotate: [0, -12, 10, 0] }
                    : move && (name === "xhigh" || name === "max")
                      ? { rotate: [-10, 10, -10] }
                      : { rotate: 0 }
            }
            transition={move && (name === "medium" || name === "xhigh" || name === "max") ? { ...forever, duration: name === "medium" ? 2 : 0.5, ease: "easeInOut" } : { type: "spring", stiffness: 200, damping: 14 }}
          >
            <path d="M32 17 V10" strokeWidth={2} strokeLinecap="round" className={rainbow ? undefined : "stroke-primary/70"} style={stroke} />
            <motion.circle
              cx={32}
              cy={7.5}
              r={3.2}
              className={rainbow ? undefined : name === "off" ? "fill-muted-foreground/40" : "fill-primary"}
              style={{ ...box, ...(rainbow ? { fill: `url(#${id}-rainbow)` } : {}) }}
              animate={
                !move
                  ? { scale: 1, opacity: 1 }
                  : name === "high"
                    ? { opacity: [1, 0.3, 1] }
                    : name === "medium"
                      ? { scale: [1, 1.25, 1] }
                      : rainbow || name === "xhigh"
                        ? { scale: [1, 1.5, 1] }
                        : { scale: 1, opacity: 1 }
              }
              transition={{ ...forever, duration: name === "high" ? 0.5 : name === "medium" ? 1.6 : 0.4 }}
            />
          </motion.g>
          {/* Ears flap when hyped. */}
          {[4.5, 54].map((x, n) => (
            <motion.rect
              key={x}
              x={x}
              y={29}
              width={5.5}
              height={11}
              rx={2.5}
              className={rainbow ? undefined : "fill-primary/25"}
              style={{ ...box, ...(rainbow ? { fill: RAINBOW[n ? 5 : 1], opacity: 0.6 } : {}) }}
              animate={move && (name === "xhigh" || rainbow) ? { rotate: n ? [0, 18, 0] : [0, -18, 0] } : { rotate: 0 }}
              transition={{ ...forever, duration: 0.35 }}
            />
          ))}
          <rect x={10} y={17} width={44} height={36} rx={11} strokeWidth={rainbow ? 2.6 : 2} className={rainbow ? "fill-primary/10" : "fill-primary/10 stroke-primary/75"} style={stroke} />
          <rect x={15} y={23} width={34} height={25} rx={7.5} className="fill-card stroke-border" strokeWidth={1} />
          {/* High effort sweeps a scan line across the face. */}
          {move && name === "high" ? (
            <motion.rect y={24} width={2} height={23} rx={1} className="fill-primary/25" animate={{ x: [16, 46, 16] }} transition={{ ...forever, duration: 1.6, ease: "easeInOut" }} />
          ) : null}
          {name === "low" || rainbow ? (
            <g className="fill-destructive/25">
              <ellipse cx={19.5} cy={39.5} rx={2.6} ry={1.6} />
              <ellipse cx={44.5} cy={39.5} rx={2.6} ry={1.6} />
            </g>
          ) : null}
          <Eyes level={name} move={move} />
          {name === "high" || name === "xhigh" ? (
            <path d="M20 27 L28.5 28.8 M44 27 L35.5 28.8" strokeWidth={1.9} strokeLinecap="round" className="stroke-foreground" />
          ) : null}
          <Mouth level={name} move={move} />
          <rect x={20} y={53} width={24} height={4} rx={2} className={rainbow ? undefined : "fill-primary/25"} style={rainbow ? { fill: `url(#${id}-rainbow)` } : undefined} />
        </motion.g>
      </motion.g>

      {name === "off" ? move ? <Zzz /> : <text x={48} y={14} fontSize="9" fontWeight="700" className="fill-muted-foreground">z</text> : null}
      {move && name === "minimal" ? <Zzz /> : null}
      {move && name === "low" ? <Notes /> : null}
      {move && name === "medium" ? <Question /> : null}
      {move && name === "high" ? <Sparkles spots={[[6, 14, 0], [58, 12, 0.6]]} /> : null}
      {move && name === "xhigh" ? <Sweat /> : null}
      {rainbow ? (
        move ? (
          <Sparkles rainbow spots={[[5, 12, 0], [59, 10, 0.2], [2, 44, 0.45], [62, 46, 0.65], [32, -2, 0.85], [14, 60, 1.05], [50, 60, 0.3]]} />
        ) : (
          <g>
            {[[5, 12], [59, 10], [32, -2]].map(([x, y], n) => <path key={n} d={STAR} style={{ x, y, fill: RAINBOW[n * 2] }} />)}
          </g>
        )
      ) : null}
      {move && change.n > 0 && change.up ? <Burst key={`burst-${change.n}`} rainbow={rainbow} /> : null}
    </svg>
  )
}
