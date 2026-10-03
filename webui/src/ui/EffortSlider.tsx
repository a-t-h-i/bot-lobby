/**
 * Effort (the thinking level) as a slider with one stop per level, from
 * `off` to `max`. A model supports only some of them: the stops it does not
 * support stay on the track, dimmed and struck through, but the thumb never
 * rests on one. Dragging snaps to the nearest supported stop, the arrow keys
 * jump over unsupported ones, and the drop-in is only committed on release.
 * The thumb and the fill glide between stops on a spring.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

export interface EffortSliderProps {
  /** The saved level. */
  value: string
  /** Every level from lowest to highest. */
  levels: readonly string[]
  /** The levels the model supports; the others cannot be chosen. */
  supported: readonly string[]
  /** Said in the tooltip of an unsupported stop: the model's name. */
  model?: string
  label: string
  disabled?: boolean
  onChange: (level: string) => void
}

const SHORT: Record<string, string> = { minimal: "min", medium: "med" }

const HINTS: Record<string, string> = {
  off: "No extra reasoning: the quickest, cheapest answer.",
  minimal: "A moment of reasoning, barely.",
  low: "Light reasoning for simple work.",
  medium: "Balanced reasoning for most work.",
  high: "Careful reasoning: slower, better on hard problems.",
  xhigh: "Very deep reasoning: slow and costly.",
  max: "As deep as the model goes.",
}

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

export function EffortSlider({ value, levels, supported, model, label, disabled, onChange }: EffortSliderProps) {
  const track = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<number | undefined>()
  const last = Math.max(levels.length - 1, 1)
  const saved = nearestSupported(levels, supported, Math.max(0, levels.indexOf(value)))
  const shown = dragging ?? saved
  const percent = shown < 0 ? 0 : (shown / last) * 100
  const level = levels[shown] ?? value
  const clamped = shown >= 0 && level !== value

  const indexAt = useCallback(
    (clientX: number): number => {
      const box = track.current?.getBoundingClientRect()
      if (!box || box.width === 0) return saved
      const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
      return nearestSupported(levels, supported, Math.round(ratio * last))
    },
    [last, levels, saved, supported]
  )

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || supported.length === 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(indexAt(event.clientX))
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragging === undefined) return
    const next = indexAt(event.clientX)
    if (next !== dragging) setDragging(next)
  }

  function onPointerUp() {
    if (dragging === undefined) return
    const chosen = levels[dragging]
    setDragging(undefined)
    if (chosen && chosen !== value) onChange(chosen)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || shown < 0) return
    const keys: Record<string, number> = {
      ArrowRight: stepSupported(levels, supported, shown, 1),
      ArrowUp: stepSupported(levels, supported, shown, 1),
      ArrowLeft: stepSupported(levels, supported, shown, -1),
      ArrowDown: stepSupported(levels, supported, shown, -1),
      Home: nearestSupported(levels, supported, 0),
      End: nearestSupported(levels, supported, last),
    }
    const next = keys[event.key]
    if (next === undefined) return
    event.preventDefault()
    const chosen = levels[next]
    if (chosen && chosen !== value) onChange(chosen)
  }

  return (
    <div className={cn("flex flex-col gap-1", disabled && "opacity-60")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.8125rem] font-medium capitalize" aria-hidden="true">
          {level}
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{HINTS[level] ?? ""}</span>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={levels.length - 1}
        aria-valuenow={Math.max(shown, 0)}
        aria-valuetext={level}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragging(undefined)}
        onKeyDown={onKeyDown}
        className="relative mx-2.5 h-6 touch-none cursor-pointer rounded-full outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        <motion.span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-primary"
          animate={{ width: `${percent}%` }}
          transition={{ type: "spring", stiffness: 520, damping: 34 }}
        />
        {levels.map((name, index) => {
          const ok = supported.includes(name)
          return (
            <span
              key={name}
              aria-hidden="true"
              title={ok ? name : `${model ?? "This model"} does not support ${name}`}
              className={cn(
                "absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
                ok ? (index <= shown ? "bg-primary-foreground/80" : "bg-muted-foreground/40") : "bg-transparent ring-1 ring-muted-foreground/30"
              )}
              style={{ left: `${(index / last) * 100}%` }}
            />
          )
        })}
        <motion.span
          aria-hidden="true"
          className={cn("absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-white shadow-sm", dragging !== undefined && "scale-110")}
          animate={{ left: `${percent}%` }}
          transition={{ type: "spring", stiffness: 520, damping: 28 }}
        />
      </div>
      <div className="relative mx-2.5 h-3.5 text-[0.68rem] text-muted-foreground" aria-hidden="true">
        {levels.map((name, index) => {
          const ok = supported.includes(name)
          return (
            <span
              key={name}
              title={ok ? undefined : `${model ?? "This model"} does not support ${name}`}
              className={cn("absolute -translate-x-1/2 whitespace-nowrap", index === shown && "font-medium text-foreground", !ok && "opacity-40")}
              style={{ left: `${(index / last) * 100}%` }}
            >
              {SHORT[name] ?? name}
            </span>
          )
        })}
      </div>
      {clamped ? (
        <p className="text-xs text-warning">
          {value} is not supported by {model ?? "this model"}, so it runs at {level}.
        </p>
      ) : null}
    </div>
  )
}
