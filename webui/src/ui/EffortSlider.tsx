/**
 * Effort (the thinking level) as a chunky drag slider, one stop per level from `off` to `max`. A model supports
 * only some levels: the others stay on the track as hollow dots, and the thumb never rests on one. Dragging snaps
 * to the nearest supported stop and saves on release, a press anywhere on the track jumps there, the arrow keys
 * skip unsupported stops, and quick presses add up (see `useEffortSlider`).
 *
 * After the user's reference: "Effort High" over a deep track with soft corners, a fill running up under a white
 * thumb, a dot per stop, and "Recommended" under the stop this agent is meant to run at, between "Faster" and
 * "Smarter" at the ends. The fill is alive at every level and gets hotter as it climbs: a slow cool drift low down,
 * a warm flow in the middle, embers rising from High, and at Max a time warp through space (deep space, stars
 * rushing past, streaks of light) under a slow, heavy aura. Climbing to Extra high or Max powers up: the thumb
 * travels slowly and heavily, the track trembles and the aura flares when it lands. The level's one-line meaning
 * is the help button's description. Reduced motion keeps the colours and drops the movement.
 */
import { useEffect, useRef, useState } from "react"
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
const SPRING = { type: "spring", stiffness: 520, damping: 36 } as const
// Powering up: heavy and slow, the way the top levels should feel.
const CHARGE = {
  xhigh: { type: "spring", stiffness: 120, damping: 20, mass: 1.4 },
  max: { type: "spring", stiffness: 46, damping: 13, mass: 2.2 },
} as const
const CHARGE_MS = { xhigh: 1100, max: 2000 } as const
type Charge = keyof typeof CHARGE
const STARS = 3

/** Set for a moment when the level climbs to Extra high or Max (not on first draw). */
function useCharge(level: string, reduce: boolean): Charge | undefined {
  const [charge, setCharge] = useState<Charge | undefined>()
  const was = useRef(level)
  useEffect(() => {
    const from = was.current
    was.current = level
    if (reduce || from === level || !(level === "xhigh" || level === "max")) return
    if (level === "xhigh" && from === "max") return
    setCharge(level)
    const timer = window.setTimeout(() => setCharge(undefined), CHARGE_MS[level])
    return () => window.clearTimeout(timer)
  }, [level, reduce])
  return charge
}
// The stops run this far in from each end of the track, so the pill of a thumb sits inside it at both ends.
const INSET = "1.625rem"
// Half the thumb's width: the fill runs on under the thumb to about its far edge.
const HALF_THUMB = "1.25rem"

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
  const charge = useCharge(level, reduce)
  const motionFor = dragging || reduce ? { duration: 0 } : charge ? CHARGE[charge] : SPRING
  const hot = ["high", "xhigh", "max"].includes(level)
  const along = (index: number) => `calc(${INSET} + (100% - 2 * ${INSET}) * ${index / last})`
  const hintId = `${label.replace(/\W+/g, "-")}-hint`

  return (
    <div className={cn("effort grid min-w-0 gap-1", disabled && "opacity-64")} data-off={level === "off" || undefined}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-hidden="true">
          Effort{" "}
          <span data-slot="effort-value" className="font-semibold text-foreground">
            {nameOf(level)}
          </span>
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="About effort" aria-describedby={hintId} data-compact className="effort-help inline-flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              ?
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{EFFORT_HINTS[level] ?? ""} More effort means more reasoning before each answer: slower and costlier, better on hard problems.</TooltipContent>
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
        aria-describedby={hintId}
        aria-disabled={disabled || undefined}
        {...slider.handlers}
        data-slot="effort-track"
        data-level={level}
        data-top={top || undefined}
        data-dragging={dragging || undefined}
        data-charge={charge}
        className="effort-track relative h-10 cursor-pointer touch-none rounded-md outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-md:h-11"
      >
        {level === "max" ? <span aria-hidden="true" data-slot="effort-aura" className="effort-aura pointer-events-none absolute -inset-1 rounded-lg" /> : null}
        <span aria-hidden="true" data-slot="effort-rail" className="effort-rail absolute inset-0 overflow-hidden rounded-md">
          <motion.span
            data-slot="effort-fill"
            className="effort-fill absolute inset-y-0 left-0 rounded-md"
            initial={false}
            animate={{ width: `calc(${along(at)} + ${HALF_THUMB})` }}
            transition={motionFor}
          >
            <span className="effort-flow absolute inset-y-0 left-0" />
            {hot && level !== "max" ? <span data-slot="effort-embers" className="effort-embers absolute inset-0" /> : null}
            {level === "max" ? (
              <span data-slot="effort-warp" className="effort-warp absolute inset-0">
                {Array.from({ length: STARS }, (_, layer) => <span key={layer} className="effort-stars absolute inset-y-0 left-0" data-layer={layer} />)}
                <span className="effort-streaks absolute inset-y-0 left-0" />
                <span className="effort-tunnel absolute inset-0" />
              </span>
            ) : null}
            {top ? <span data-slot="effort-sheen" className="effort-sheen absolute inset-0" /> : null}
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
                "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200",
                !ok ? "ring-1 ring-muted-foreground/50" : index <= at ? "effort-dot-lit" : "effort-dot"
              )}
              style={{ left: along(index) }}
            />
          )
        })}
        {recommendedAt >= 0 && recommendedAt !== at ? (
          <span aria-hidden="true" data-slot="effort-recommended-mark" className="effort-mark absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: along(recommendedAt) }} />
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
            className="effort-thumb block h-8 w-10 -translate-x-1/2 -translate-y-1/2 rounded-md"
            initial={false}
            animate={{ scale: dragging !== undefined ? 1.08 : 1, scaleX: dragging !== undefined ? 1.12 : 1 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 600, damping: 20 }}
          />
        </motion.span>
      </div>
      <div aria-hidden="true" className="relative flex h-4 justify-between px-1 text-xs text-muted-foreground">
        {/* The scale's ends, unless the Recommended mark sits too near one to share the line. */}
        <span className={cn(recommendedAt >= 0 && recommendedAt / last < 0.3 && "invisible")}>Faster</span>
        <span className={cn(recommendedAt >= 0 && recommendedAt / last > 0.7 && "invisible")}>Smarter</span>
        {recommendedAt >= 0 ? (
          <span
            data-slot="effort-recommended"
            className={cn("absolute top-0 -translate-x-1/2 whitespace-nowrap transition-colors", at === recommendedAt ? "font-medium text-foreground" : "text-muted-foreground")}
            style={{ left: `clamp(2.75rem, ${along(recommendedAt)}, calc(100% - 2.75rem))` }}
          >
            Recommended
          </span>
        ) : null}
      </div>
      <p id={hintId} data-slot="effort-hint" className="sr-only" aria-live="polite">
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
