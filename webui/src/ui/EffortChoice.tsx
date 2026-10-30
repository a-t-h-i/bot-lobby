/**
 * Effort (the thinking level) as the page's searchable drop-down, the same control as the model pickers beside
 * it: one row per level from `off` to `max` with what it does, the level this agent is meant to run at marked
 * Recommended. A model supports only some levels: the others stay in the list, said as unsupported, but cannot be
 * picked. A saved level the model cannot do says what it runs at instead.
 */
import { Choice, type ChoiceItem } from "@/tabs/settings/parts"
import { EFFORT_HINTS, EFFORT_LABELS, nearestSupported } from "./effortLevels"

export interface EffortChoiceProps {
  /** The saved level. */
  value: string
  /** Every level from lowest to highest. */
  levels: readonly string[]
  /** The levels the model supports; the others cannot be chosen. */
  supported: readonly string[]
  /** The level this agent is meant to run at, marked Recommended. */
  recommended?: string
  /** Said beside an unsupported level: the model's name. */
  model?: string
  label: string
  disabled?: boolean
  /** Save the level. */
  onChange: (level: string) => void | Promise<unknown>
}

/** The level actually run: the supported one nearest the saved level. */
function levelRun(levels: readonly string[], supported: readonly string[], value: string): string {
  const at = nearestSupported(levels, supported, Math.max(0, levels.indexOf(value)))
  return levels[Math.max(at, 0)] ?? value
}

export function EffortChoice({ value, levels, supported, recommended, model, label, disabled, onChange }: EffortChoiceProps) {
  const modelName = model ?? "this model"
  const at = levelRun(levels, supported, value)
  const items: ChoiceItem[] = levels.map((name) => {
    const ok = supported.includes(name)
    const help = ok ? EFFORT_HINTS[name] : `Not supported by ${modelName}.`
    return {
      value: name,
      label: EFFORT_LABELS[name] ?? name,
      help: ok && name === recommended ? `${help} Recommended.` : help,
      disabled: !ok,
      ...(ok && name === recommended ? { tag: "Recommended" } : {}),
    }
  })
  return (
    <div className="flex flex-col gap-2">
      <Choice value={at} items={items} label={label} disabled={disabled} onChange={(next) => void onChange(next)} />
      {value !== at ? (
        <p className="text-xs text-muted-foreground">
          {value} is not supported by {modelName}, so it runs at {at}.
        </p>
      ) : null}
    </div>
  )
}
