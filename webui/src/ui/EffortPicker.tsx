// Adapted from T3 Code (MIT), apps/web/src/components/chat/TraitsPicker.tsx
/**
 * Effort (the thinking level) as a drop-down: a field with a brain, the level
 * and a chevron, opening onto every level from `off` to `max` with a line on
 * what each one does. A model supports only some of them; the others stay in
 * the list, dimmed, and cannot be picked. The agent's recommended level wears
 * a badge.
 *
 * Keys: Enter, Space or Down opens the list. Left and Right step to the next
 * supported level without opening it, Home and End jump to the ends, and
 * quick presses add up while their saves are under way.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Brain, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/reui/badge"
import { SELECT_CHEVRON, SELECT_FIELD } from "@/components/reui/select"
import { Menu, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu"
import { nearestSupported, stepSupported } from "./effortLevels"

export interface EffortPickerProps {
  /** The saved level. */
  value: string
  /** Every level from lowest to highest. */
  levels: readonly string[]
  /** The levels the model supports; the others cannot be chosen. */
  supported: readonly string[]
  /** The level this agent is meant to run at, marked in the list. */
  recommended?: string
  /** Said beside an unsupported level: the model's name. */
  model?: string
  /** The trigger's accessible name. */
  label: string
  disabled?: boolean
  /** Save the level. Return the save (a promise) and quick key presses add up until it comes back. */
  onChange: (level: string) => void | Promise<unknown>
}

export const EFFORT_HINTS: Record<string, string> = {
  off: "No extra reasoning: the quickest, cheapest answer.",
  minimal: "A moment of reasoning, barely.",
  low: "Light reasoning for simple work.",
  medium: "Balanced reasoning for most work.",
  high: "Careful reasoning: slower, better on hard problems.",
  xhigh: "Very deep reasoning: slow and costly.",
  max: "As deep as the model goes.",
}

/** The stop a key chooses from `at`, or undefined for any other key. */
function keyTarget(key: string, levels: readonly string[], supported: readonly string[], at: number): number | undefined {
  if (key === "ArrowRight") return stepSupported(levels, supported, at, 1)
  if (key === "ArrowLeft") return stepSupported(levels, supported, at, -1)
  if (key === "Home") return nearestSupported(levels, supported, 0)
  if (key === "End") return nearestSupported(levels, supported, levels.length - 1)
  return undefined
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

export function EffortPicker({ value, levels, supported, recommended, model, label, disabled, onChange }: EffortPickerProps) {
  const keys = useQuickKeys(onChange)
  const saved = nearestSupported(levels, supported, Math.max(0, levels.indexOf(value)))
  const shown = keys.chosenByKey ?? saved
  const level = levels[shown] ?? value
  const clamped = shown >= 0 && keys.chosenByKey === undefined && level !== value
  const recommendedLevel = recommended ? levels[nearestSupported(levels, supported, Math.max(0, levels.indexOf(recommended)))] : undefined
  const modelName = model ?? "this model"

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || shown < 0) return
    const at = keys.intended.current ?? shown
    const next = keyTarget(event.key, levels, supported, at)
    if (next === undefined) return
    event.preventDefault()
    const chosen = levels[next]
    // Compared with the last stop chosen, not with what is saved or drawn: right then left in quick succession must end where it began.
    if (chosen && next !== at) keys.choose(next, chosen)
  }

  function pick(next: string) {
    if (next === level) return
    keys.choose(levels.indexOf(next), next)
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <Menu>
        <MenuTrigger
          disabled={disabled}
          aria-label={label}
          aria-keyshortcuts="Enter Space ArrowDown ArrowLeft ArrowRight Home End"
          aria-description="Enter, Space or Down lists the levels; Left and Right step through them."
          data-slot="effort-trigger"
          data-level={level}
          onKeyDown={onKeyDown}
          className={cn(SELECT_FIELD, "w-full min-w-0 max-md:h-11")}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Brain aria-hidden="true" className="size-4 text-muted-foreground" />
            <span data-slot="effort-value" className="truncate capitalize">{level}</span>
          </span>
          <ChevronDown aria-hidden="true" strokeWidth={2.25} className={SELECT_CHEVRON} />
        </MenuTrigger>
        <MenuPopup className="w-(--radix-dropdown-menu-trigger-width) min-w-64">
          <MenuGroupLabel>Effort</MenuGroupLabel>
          <MenuRadioGroup value={level} onValueChange={pick}>
            {levels.map((name) => {
              const ok = supported.includes(name)
              return (
                <MenuRadioItem key={name} value={name} disabled={!ok} data-level={name}>
                  <span className="flex w-full min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate capitalize">{name}</span>
                      {name === recommendedLevel ? <Badge variant="outline" size="sm" data-slot="effort-recommended">Recommended</Badge> : null}
                    </span>
                    <span className="max-w-64 text-pretty text-xs text-muted-foreground/80">
                      {ok ? EFFORT_HINTS[name] : `Not supported by ${modelName}.`}
                    </span>
                  </span>
                </MenuRadioItem>
              )
            })}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      {clamped ? (
        <p className="text-xs text-warning">
          {value} is not supported by {modelName}, so it runs at {level}.
        </p>
      ) : null}
    </div>
  )
}
