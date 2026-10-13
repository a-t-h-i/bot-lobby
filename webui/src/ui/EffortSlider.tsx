/**
 * Effort (the thinking level) as a drag slider, one stop per level from `off`
 * to `max`, each named under the track. A model supports only some levels:
 * the others stay on the track, hollow and dimmed, and the thumb never rests
 * on one. Dragging snaps to the nearest supported stop and saves on release;
 * a name under the track jumps there; the arrow keys skip unsupported stops,
 * and quick presses add up (see `useEffortSlider`).
 *
 * The fill and the thumb follow with a spring, the thumb swells while held,
 * and a line under the track says what the level does. Reduced motion jumps.
 */
import { motion, useReducedMotion } from "motion/react"
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

export function EffortSlider({ value, levels, supported, recommended, model, label, disabled, onChange }: EffortSliderProps) {
  const reduce = useReducedMotion() ?? false
  const slider = useEffortSlider({ levels, supported, value, disabled, onChange })
  const { shown, dragging } = slider
  const last = Math.max(levels.length - 1, 1)
  const at = Math.max(shown, 0)
  const percent = (at / last) * 100
  const level = levels[shown] ?? value
  const clamped = shown >= 0 && !dragging && level !== value
  const recommendedAt = recommended ? nearestSupported(levels, supported, Math.max(0, levels.indexOf(recommended))) : -1
  const modelName = model ?? "this model"
  const motionFor = dragging || reduce ? { duration: 0 } : SPRING

  return (
    <div className={cn("grid min-w-0 gap-2", disabled && "opacity-64")}>
      <div className="flex items-baseline justify-between gap-3" aria-hidden="true">
        <span className="text-xs text-muted-foreground">Faster</span>
        <span data-slot="effort-value" className="text-sm font-medium text-foreground">{nameOf(level)}</span>
        <span className="text-xs text-muted-foreground">Smarter</span>
      </div>
      <div
        ref={slider.track}
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
        data-dragging={dragging || undefined}
        className="group/effort relative mx-2.5 h-6 cursor-pointer touch-none rounded-full outline-none select-none max-md:h-11"
      >
        <span aria-hidden="true" className="absolute inset-x-[-0.625rem] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] group-focus-visible/effort:ring-2 group-focus-visible/effort:ring-ring group-focus-visible/effort:ring-offset-2 group-focus-visible/effort:ring-offset-background" />
        <motion.span
          aria-hidden="true"
          data-slot="effort-fill"
          className="absolute top-1/2 left-[-0.625rem] h-1.5 -translate-y-1/2 rounded-full bg-primary"
          initial={false}
          animate={{ width: `calc(${percent}% + 0.625rem)` }}
          transition={motionFor}
        />
        {levels.map((name, index) => {
          const ok = supported.includes(name)
          return (
            <span
              key={name}
              aria-hidden="true"
              data-stop={name}
              title={ok ? nameOf(name) : `Not supported by ${modelName}`}
              className={cn(
                "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-150",
                !ok ? "bg-background ring-1 ring-muted-foreground/40" : index <= at ? "bg-primary-foreground/80" : "bg-muted-foreground/50"
              )}
              style={{ left: `${(index / last) * 100}%` }}
            />
          )
        })}
        <motion.span
          aria-hidden="true"
          data-slot="effort-thumb"
          className="absolute top-1/2 z-10"
          initial={false}
          animate={{ left: `${percent}%` }}
          transition={motionFor}
        >
          <motion.span
            className="block size-[1.125rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/10 bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2),0_0_0_4px_color-mix(in_srgb,var(--primary)_14%,transparent)] dark:border-white/10"
            animate={{ scale: dragging ? 1.18 : 1 }}
            transition={{ type: "spring", stiffness: 600, damping: 26 }}
          />
        </motion.span>
      </div>
      <div className="relative mx-2.5 h-5 text-xs">
        {levels.map((name, index) => {
          const ok = supported.includes(name)
          const edge = index === 0 ? "left-[-0.625rem]" : index === last ? "right-[-0.625rem]" : "-translate-x-1/2"
          return (
            <button
              key={name}
              type="button"
              tabIndex={-1}
              disabled={disabled || !ok}
              data-label={name}
              aria-hidden="true"
              onClick={() => slider.jump(index)}
              className={cn(
                "absolute top-0 whitespace-nowrap rounded-sm px-0.5 transition-colors duration-150 outline-none",
                edge,
                // On a narrow card only the ends, the chosen level and the recommended one keep their names.
                index !== 0 && index !== last && index !== at && index !== recommendedAt && "max-[30rem]:hidden",
                index === at ? "font-medium text-foreground" : ok ? "text-muted-foreground hover:text-foreground" : "cursor-not-allowed text-muted-foreground/45"
              )}
              style={index === 0 || index === last ? undefined : { left: `${(index / last) * 100}%` }}
            >
              {nameOf(name)}
            </button>
          )
        })}
      </div>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
        <span>{EFFORT_HINTS[level] ?? ""}</span>
        {recommendedAt >= 0 ? (
          <span data-slot="effort-recommended" className={cn("rounded-full border px-1.5 py-px text-3xs font-medium", at === recommendedAt ? "border-primary/30 bg-primary/8 text-primary" : "border-border")}>
            {at === recommendedAt ? "Recommended" : `Recommended: ${nameOf(levels[recommendedAt]!)}`}
          </span>
        ) : null}
      </p>
      {clamped ? (
        <p className="text-xs text-warning">
          {value} is not supported by {modelName}, so it runs at {level}.
        </p>
      ) : null}
    </div>
  )
}
