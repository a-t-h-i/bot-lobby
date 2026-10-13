/**
 * Effort (the thinking level) as a chunky drag slider, one stop per level from `off` to `max`. A model supports
 * only some levels: the others stay on the track as hollow dots, and the thumb never rests on one. Dragging snaps
 * to the nearest supported stop and saves on release, a press anywhere on the track jumps there, the arrow keys
 * skip unsupported stops, and quick presses add up (see `useEffortSlider`).
 *
 * A slim 8px rail inside a 40px (44px on phones) hit area. Every level moves its fill differently (see
 * `.effort-fill` in index.css), and the top level turns the fill into a twinkling mosaic with a sweeping sheen.
 * Reduced motion keeps the colours and the mosaic and drops the movement.
 */
import type { CSSProperties } from "react"
import { Brain, CircleHelp } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { EFFORT_HINTS, nearestSupported } from "./effortLevels"
import { useEffortSlider } from "./useEffortSlider"

export interface EffortSliderProps {
  /** The saved level. */
  value: string
  /** Every level from lowest to highest. */
  levels: readonly string[]
  /** The levels the model supports; the others cannot be chosen. */
  supported: readonly string[]
  /** The level this agent is meant to run at, marked under its stop. */
  recommended?: string
  /** Said beside an unsupported stop: the model's name. */
  model?: string
  label: string
  disabled?: boolean
  /** Save the level. Return the save (a promise) and the slider keeps showing quick key presses until it comes back. */
  onChange: (level: string) => void | Promise<unknown>
}

const NAMES: Record<string, string> = { xhigh: "Extra high" }
const nameOf = (level: string) => NAMES[level] ?? `${level.charAt(0).toUpperCase()}${level.slice(1)}`
const SPRING = { type: "spring", stiffness: 520, damping: 38 } as const

/** Each level's colour, cool and quiet at the bottom, pink near the top. */
const TONES: Record<string, string> = {
  off: "var(--muted-foreground)",
  minimal: "oklch(0.68 0.07 250)",
  low: "oklch(0.66 0.12 255)",
  medium: "oklch(0.62 0.17 270)",
  high: "oklch(0.6 0.2 292)",
  xhigh: "oklch(0.66 0.21 335)",
  max: "oklch(0.64 0.21 300)",
}
// The stops run this far in from each end of the rail, so the 20px thumb sits inside it at both ends.
const INSET = "0.625rem"
const MOSAIC = ["oklch(0.62 0.22 300)", "oklch(0.7 0.19 340)", "oklch(0.8 0.12 215)", "oklch(0.55 0.2 275)"]
const MOSAIC_COLUMNS = 160
const MOSAIC_ROWS = 2

// A fixed pseudo-random sequence, so the mosaic looks the same on every render.
function seeded(index: number): number {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

export function EffortSlider({ value, levels, supported, recommended, model, label, disabled, onChange }: EffortSliderProps) {
  const reduce = useReducedMotion() ?? false
  const slider = useEffortSlider({ levels, supported, value, disabled, onChange })
  const { shown, dragging } = slider
  const last = Math.max(levels.length - 1, 1)
  const at = Math.max(shown, 0)
  const level = levels[shown] ?? value
  const top = at === levels.length - 1 && levels.length > 1
  const clamped = shown >= 0 && !dragging && level !== value
  const recommendedAt = recommended ? nearestSupported(levels, supported, Math.max(0, levels.indexOf(recommended))) : -1
  const modelName = model ?? "this model"
  const motionFor = dragging || reduce ? { duration: 0 } : SPRING
  const tone = TONES[level] ?? "var(--primary)"
  const along = (index: number) => `calc(${INSET} + (100% - 2 * ${INSET}) * ${index / last})`

  return (
    <div className={cn("grid min-w-0 gap-1", disabled && "opacity-64")} style={{ "--effort-tone": tone } as CSSProperties}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-hidden="true">
          Effort{" "}
          <span
            data-slot="effort-value"
            className={cn("font-semibold transition-colors duration-200", top ? "text-[oklch(0.72_0.12_225)] dark:text-[oklch(0.82_0.1_220)]" : "text-(--effort-tone)", level === "off" && "text-foreground")}
          >
            {nameOf(level)}
          </span>
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="About effort" className="rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <CircleHelp className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>More effort means more reasoning before each answer: slower and costlier, better on hard problems.</TooltipContent>
        </Tooltip>
      </div>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={levels.length - 1}
        aria-valuenow={at}
        aria-valuetext={level}
        aria-disabled={disabled || undefined}
        {...slider.handlers}
        data-slot="effort-track"
        data-level={level}
        data-top={top || undefined}
        data-dragging={dragging || undefined}
        className="effort-track relative h-11 cursor-pointer md:h-10 touch-none rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span aria-hidden="true" data-slot="effort-rail" className="effort-rail absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full">
          <motion.span
            data-slot="effort-fill"
            className="effort-fill absolute inset-y-0 left-0"
            initial={false}
            animate={{ width: `calc(${INSET} + (100% - 2 * ${INSET}) * ${at / last} + ${INSET})` }}
            transition={motionFor}
          >
            {top ? <Mosaic /> : null}
          </motion.span>
        </span>
        <div ref={slider.track} aria-hidden="true" className="absolute inset-y-0" style={{ left: INSET, right: INSET }} />
        {levels.map((name, index) => {
          const ok = supported.includes(name)
          return (
            <span
              key={name}
              aria-hidden="true"
              data-stop={name}
              data-supported={ok}
              title={ok ? nameOf(name) : `Not supported by ${modelName}`}
              className={cn(
                "absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200",
                !ok ? "ring-1 ring-muted-foreground/45" : index <= at ? "bg-white/70" : "bg-muted-foreground/45"
              )}
              style={{ left: along(index) }}
            />
          )
        })}
        {recommendedAt >= 0 && recommendedAt !== at ? (
          <span aria-hidden="true" data-slot="effort-recommended-mark" className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/35" style={{ left: along(recommendedAt) }} />
        ) : null}
        <motion.span
          aria-hidden="true"
          data-slot="effort-thumb"
          className="absolute top-1/2 z-10"
          initial={false}
          animate={{ left: along(at) }}
          transition={motionFor}
        >
          <motion.span
            key={level}
            className="effort-brain relative flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
            initial={reduce ? false : { scale: 0.86 }}
            animate={{ scale: dragging !== undefined ? 1.12 : 1 }}
            transition={{ type: "spring", stiffness: 600, damping: 18 }}
          >
            <Brain className="size-3" strokeWidth={2.25} />
          </motion.span>
        </motion.span>
      </div>
      <div className="relative h-4 text-xs" hidden={recommendedAt < 0} aria-hidden={recommendedAt < 0 || undefined}>
        {recommendedAt >= 0 ? (
          <span
            data-slot="effort-recommended"
            className={cn("absolute top-0 -translate-x-1/2 whitespace-nowrap transition-colors", at === recommendedAt ? "font-medium text-foreground" : "text-muted-foreground")}
            style={{ left: `clamp(2.5rem, ${along(recommendedAt)}, calc(100% - 2.5rem))` }}
          >
            Recommended
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {EFFORT_HINTS[level] ?? ""}
      </p>
      {clamped ? (
        <p className="text-xs text-warning">
          {value} is not supported by {modelName}, so it runs at {level}.
        </p>
      ) : null}
    </div>
  )
}

/** The top level's fill: a mosaic of small squares that twinkle under a sweeping sheen, inside the rail. */
function Mosaic() {
  const cells = Array.from({ length: MOSAIC_ROWS * MOSAIC_COLUMNS }, (_, index) => index)
  return (
    <span className="effort-mosaic absolute inset-0 grid content-center" data-slot="effort-mosaic">
      {cells.map((index) => (
        <i
          key={index}
          style={{
            background: MOSAIC[Math.floor(seeded(index) * MOSAIC.length)],
            opacity: 0.35 + seeded(index + 997) * 0.65,
            "--twinkle": `${(seeded(index + 31) * 3).toFixed(2)}s`,
          } as CSSProperties}
        />
      ))}
    </span>
  )
}
