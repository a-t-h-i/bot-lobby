/**
 * Effort (the thinking level) as a slider from Faster to Smarter, one dot per
 * level from `off` to `max`. A model supports only some of them: the dots it
 * does not support stay on the track, hollow, but the thumb never rests on
 * one. Dragging snaps to the nearest supported stop and saves on release; the
 * arrow keys jump over unsupported stops, and quick presses add up (see
 * `useEffortSlider`).
 *
 * A change travels: the thumb, the word, the bubble above the thumb and the
 * mascot step through every level in between, each dot pinging as it is
 * passed, and the fill warms from blue to violet to pink as it grows, with
 * sparks at xhigh and a shimmer at max. Dragging follows the pointer at once,
 * and reduced motion jumps straight to the level.
 */
import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { CircleHelp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { EffortMascot } from "./EffortMascot"
import { useEffortSlider } from "./useEffortSlider"

export interface EffortSliderProps {
  /** The saved level. */
  value: string
  /** Every level from lowest to highest. */
  levels: readonly string[]
  /** The levels the model supports; the others cannot be chosen. */
  supported: readonly string[]
  /** The level this agent is meant to run at, marked under its dot. */
  recommended?: string
  /** Said in the tooltip of an unsupported stop: the model's name. */
  model?: string
  label: string
  disabled?: boolean
  /** Save the level. Return the save (a promise) and the slider keeps showing quick key presses until it comes back. */
  onChange: (level: string) => void | Promise<unknown>
}

const HINTS: Record<string, string> = {
  off: "No extra reasoning: the quickest, cheapest answer.",
  minimal: "A moment of reasoning, barely.",
  low: "Light reasoning for simple work.",
  medium: "Balanced reasoning for most work.",
  high: "Careful reasoning: slower, better on hard problems.",
  xhigh: "Very deep reasoning: slow and costly.",
  max: "As deep as the model goes.",
}

/** Time spent on each level a change passes through. */
export const STEP_MS = 70
/** Sparks in the fill at the two top levels. */
const SPARKS = [
  { left: 8, top: 30, delay: 0 }, { left: 19, top: 65, delay: 0.5 }, { left: 31, top: 25, delay: 1.1 }, { left: 44, top: 70, delay: 0.2 },
  { left: 56, top: 35, delay: 0.8 }, { left: 67, top: 60, delay: 1.4 }, { left: 78, top: 28, delay: 0.35 }, { left: 90, top: 62, delay: 0.95 },
]

/** The index of the supported stop nearest to `index` (ties go lower), or -1 when none is supported. */
export function nearestSupported(levels: readonly string[], supported: readonly string[], index: number): number {
  let best = -1
  for (let i = 0; i < levels.length; i += 1) {
    if (!supported.includes(levels[i]!)) continue
    if (best < 0 || Math.abs(i - index) < Math.abs(best - index)) best = i
  }
  return best
}

/** The next supported stop from `index` in `direction`, or `index` when there is none. */
export function stepSupported(levels: readonly string[], supported: readonly string[], index: number, direction: 1 | -1): number {
  for (let i = index + direction; i >= 0 && i < levels.length; i += direction) if (supported.includes(levels[i]!)) return i
  return index
}

/** The stop on show: it walks one level per `STEP_MS` towards `target`, or jumps there when `immediate`. */
function useStepThrough(target: number, immediate: boolean): number {
  const [at, setAt] = useState(target)
  useEffect(() => {
    if (at === target) return
    if (immediate || at < 0 || target < 0) {
      setAt(target)
      return
    }
    const timer = window.setTimeout(() => setAt((now) => now + Math.sign(target - now)), STEP_MS)
    return () => window.clearTimeout(timer)
  }, [at, target, immediate])
  return at
}

/** The level word, rolling up as effort rises and down as it falls. */
function RollingWord({ level, direction, className, plain }: { level: string; direction: number; className?: string; plain?: boolean }) {
  return (
    <span className="relative inline-grid overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.span
          key={level}
          data-level={level}
          className={cn(!plain && "effort-word", "col-start-1 row-start-1 capitalize", className)}
          custom={direction}
          variants={{
            enter: (dir: number) => ({ y: dir >= 0 ? "70%" : "-70%", opacity: 0 }),
            center: { y: 0, opacity: 1 },
            exit: (dir: number) => ({ y: dir >= 0 ? "-70%" : "70%", opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: STEP_MS / 1000 + 0.06, ease: "easeOut" }}
        >
          {level}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="About effort" className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <CircleHelp aria-hidden="true" className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-56">{text} Higher effort thinks longer: smarter answers, more time and tokens.</TooltipContent>
    </Tooltip>
  )
}

export function EffortSlider({ value, levels, supported, recommended, model, label, disabled, onChange }: EffortSliderProps) {
  const reduce = useReducedMotion() ?? false
  const slider = useEffortSlider({ levels, supported, value, disabled, onChange })
  const { shown, dragging } = slider
  const passing = useStepThrough(shown, dragging || reduce)
  const [direction, setDirection] = useState(1)
  const [previous, setPrevious] = useState(passing)
  // Nothing pings on the first draw, only when the level moves.
  const [moved, setMoved] = useState(false)
  if (passing !== previous) {
    setDirection(Math.sign(passing - previous) || 1)
    setPrevious(passing)
    setMoved(true)
  }
  const [focused, setFocused] = useState(false)
  const last = Math.max(levels.length - 1, 1)
  const percent = passing < 0 ? 0 : (passing / last) * 100
  const level = levels[shown] ?? value
  const showing = levels[passing] ?? level
  const heat = Math.max(0, passing) / last
  const clamped = shown >= 0 && level !== value
  const recommendedAt = recommended ? nearestSupported(levels, supported, Math.max(0, levels.indexOf(recommended))) : -1
  const sparks = !reduce && passing >= levels.indexOf("xhigh") && levels.includes("xhigh")

  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-3 min-[360px]:flex-row", disabled && "opacity-60")}>
      <EffortMascot level={showing} />
      <div className="flex w-full min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-baseline gap-2 text-sm" aria-hidden="true">
            <span className="text-muted-foreground">Effort</span>
            <RollingWord level={showing} direction={direction} className="font-semibold" />
          </p>
          <HelpTip text={HINTS[showing] ?? ""} />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
          <span>Faster</span>
          <span>Smarter</span>
        </div>
        <div
          ref={slider.track}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={levels.length - 1}
          aria-valuenow={Math.max(shown, 0)}
          aria-valuetext={level}
          aria-disabled={disabled || undefined}
          {...slider.handlers}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          data-slot="effort-track"
          data-passing={showing}
          className="group/effort relative mx-3.5 h-7 touch-none cursor-pointer rounded-full outline-none select-none"
        >
          <span aria-hidden="true" className="absolute inset-x-[-0.875rem] top-1/2 h-2 -translate-y-1/2 rounded-full bg-[var(--effort-track)] group-focus-visible/effort:ring-3 group-focus-visible/effort:ring-ring/40" />
          <motion.span
            aria-hidden="true"
            data-slot="effort-fill"
            data-level={showing}
            className="effort-fill absolute inset-x-[-0.875rem] top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full"
            // The fill reaches past both ends under the thumb's halves; `--effort-p` (0 to 1) is how far along the stops it is.
            style={{ clipPath: "inset(0 calc(0.875rem + (1 - var(--effort-p)) * (100% - 1.75rem)) 0 0 round 999px)" }}
            initial={false}
            animate={{ "--effort-p": percent / 100, filter: `saturate(${0.75 + heat * 0.5})` } as Record<string, number | string>}
            transition={dragging || reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
          >
            {sparks ? SPARKS.map((spark) => (
              <span key={spark.left} className="effort-spark absolute size-[3px] rounded-full bg-white" style={{ left: `${spark.left}%`, top: `${spark.top}%`, animationDelay: `${spark.delay}s` }} />
            )) : null}
          </motion.span>
          {levels.map((name, index) => {
            const ok = supported.includes(name)
            return (
              <span
                key={name}
                aria-hidden="true"
                data-stop={name}
                title={ok ? name : `${model ?? "This model"} does not support ${name}`}
                className={cn(
                  "absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-150",
                  ok ? (index <= passing ? "bg-white/85" : "bg-muted-foreground/45") : "bg-transparent ring-1 ring-muted-foreground/35"
                )}
                style={{ left: `${(index / last) * 100}%` }}
              />
            )
          })}
          {passing >= 0 && moved && !reduce ? (
            <motion.span
              key={`ping-${passing}`}
              aria-hidden="true"
              data-slot="effort-ping"
              className="pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--effort-ping)]"
              style={{ left: `${percent}%` }}
              initial={{ scale: 0.6, opacity: 0.9 }}
              animate={{ scale: 3, opacity: 0 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            />
          ) : null}
          <motion.span
            aria-hidden="true"
            data-slot="effort-thumb"
            className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
            initial={false}
            animate={{ left: `${percent}%` }}
            transition={dragging || reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 30 }}
          >
            <motion.span
              className="effort-thumb block h-[1.125rem] w-7 rounded-full"
              data-level={showing}
              animate={{ scale: dragging ? 1.12 : 1, scaleX: dragging ? 1.18 : 1 }}
              transition={{ type: "spring", stiffness: 600, damping: 26 }}
            />
            <span
              data-slot="effort-bubble"
              className={cn(
                "pointer-events-none absolute bottom-[calc(100%+0.5rem)] rounded-md bg-foreground px-2 py-0.5 text-[0.7rem] font-semibold whitespace-nowrap text-background shadow-md transition-[opacity,translate] duration-150",
                "after:absolute after:top-full after:border-4 after:border-transparent after:border-t-foreground",
                // At the ends it hangs inwards, so it stays over the track and clear of Faster and Smarter.
                passing <= 0 ? "left-0 after:left-3" : passing >= last ? "right-0 after:right-3" : "left-1/2 -translate-x-1/2 after:left-1/2 after:-translate-x-1/2",
                dragging || focused ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0 group-hover/effort:translate-y-0 group-hover/effort:opacity-100"
              )}
            >
              <RollingWord level={showing} direction={direction} className="text-background" plain />
            </span>
          </motion.span>
        </div>
        <div className="relative mx-3.5 h-4 text-[0.7rem]" aria-hidden="true">
          {recommendedAt >= 0 ? (
            <span
              data-slot="effort-recommended"
              className={cn(
                "absolute whitespace-nowrap transition-colors duration-150",
                recommendedAt === 0 ? "left-[-0.875rem]" : recommendedAt === last ? "right-[-0.875rem]" : "-translate-x-1/2",
                passing === recommendedAt ? "font-medium text-foreground" : "text-muted-foreground"
              )}
              style={recommendedAt === 0 || recommendedAt === last ? undefined : { left: `${(recommendedAt / last) * 100}%` }}
            >
              Recommended
            </span>
          ) : null}
        </div>
        {clamped ? (
          <p className="text-xs text-warning">
            {value} is not supported by {model ?? "this model"}, so it runs at {level}.
          </p>
        ) : null}
      </div>
    </div>
  )
}
