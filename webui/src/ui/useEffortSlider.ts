/**
 * The state and handlers of the effort slider: drag preview with a save on release only, keyboard steps that skip
 * unsupported stops, and quick key presses that add up while their saves are under way.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react"
import { nearestSupported, stepSupported } from "./effortLevels"

export interface EffortSliderState {
  levels: readonly string[]
  supported: readonly string[]
  value: string
  disabled?: boolean
  onChange: (level: string) => void | Promise<unknown>
}

/** The stop a key chooses from `at`, or undefined for any other key. */
function keyTarget(key: string, levels: readonly string[], supported: readonly string[], at: number): number | undefined {
  const last = Math.max(levels.length - 1, 1)
  if (key === "ArrowRight" || key === "ArrowUp") return stepSupported(levels, supported, at, 1)
  if (key === "ArrowLeft" || key === "ArrowDown") return stepSupported(levels, supported, at, -1)
  if (key === "Home") return nearestSupported(levels, supported, 0)
  if (key === "End") return nearestSupported(levels, supported, last)
  return undefined
}

/** The supported stop under `clientX` on `track`, or `fallback` when the track has no width. */
function stopAt(track: RefObject<HTMLDivElement | null>, clientX: number, levels: readonly string[], supported: readonly string[], fallback: number): number {
  const box = track.current?.getBoundingClientRect()
  if (!box || box.width === 0) return fallback
  const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
  return nearestSupported(levels, supported, Math.round(ratio * Math.max(levels.length - 1, 1)))
}

// The stop the last key press chose, until every save it started has come back. The ref holds the same stop for
// the next key press, which can arrive before React has drawn the first one; `saving` counts the saves under way.
function useQuickKeys(onChange: (level: string) => void | Promise<unknown>) {
  const [chosenByKey, setChosenByKey] = useState<number | undefined>()
  const intended = useRef<number | undefined>(undefined)
  const saving = useRef(0)
  const settle = useCallback(() => {
    intended.current = undefined
    saving.current = 0
    setChosenByKey(undefined)
  }, [])
  useEffect(() => {
    // A safety net for a save that never answers: the saved level takes over again.
    if (chosenByKey === undefined) return
    const timer = window.setTimeout(settle, 10_000)
    return () => window.clearTimeout(timer)
  }, [chosenByKey, settle])
  const choose = (next: number, level: string) => {
    intended.current = next
    setChosenByKey(next)
    saving.current += 1
    void Promise.resolve(onChange(level))
      .catch(() => undefined)
      .then(() => {
        saving.current -= 1
        if (saving.current <= 0) settle()
      })
  }
  return { chosenByKey, intended, choose }
}

export function useEffortSlider({ levels, supported, value, disabled, onChange }: EffortSliderState) {
  const track = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<number | undefined>()
  const keys = useQuickKeys(onChange)
  const saved = nearestSupported(levels, supported, Math.max(0, levels.indexOf(value)))
  const shown = dragging ?? keys.chosenByKey ?? saved
  const indexAt = (clientX: number) => stopAt(track, clientX, levels, supported, saved)

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
    const at = keys.intended.current ?? shown
    const next = keyTarget(event.key, levels, supported, at)
    if (next === undefined) return
    event.preventDefault()
    const chosen = levels[next]
    // Compared with the last stop chosen, not with what is saved or drawn: right then left in quick succession must end where it began.
    if (chosen && next !== at) keys.choose(next, chosen)
  }

  /** Go straight to a stop, as a click on its name does. */
  function jump(index: number) {
    const chosen = levels[index]
    if (disabled || !chosen || !supported.includes(chosen) || index === (keys.intended.current ?? shown)) return
    keys.choose(index, chosen)
  }

  const onPointerCancel = () => setDragging(undefined)
  return { track, shown, dragging: dragging !== undefined, jump, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown } }
}
