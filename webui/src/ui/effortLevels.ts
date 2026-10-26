/** Effort levels a model may or may not support, and how to step between the ones it does. */

/** The index of the supported stop nearest to `index` (ties go lower), or -1 when none is supported. */
export function nearestSupported(levels: readonly string[], supported: readonly string[], index: number): number {
  let best = -1
  for (let i = 0; i < levels.length; i += 1) {
    if (!supported.includes(levels[i]!)) continue
    if (best < 0 || Math.abs(i - index) < Math.abs(best - index)) best = i
  }
  return best
}

/** How each level is named in the effort drop-down. */
export const EFFORT_LABELS: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

/** What each level does, said under the drop-down. */
export const EFFORT_HINTS: Record<string, string> = {
  off: "No extra reasoning: the quickest, cheapest answer.",
  minimal: "A moment of reasoning, barely.",
  low: "Light reasoning for simple work.",
  medium: "Balanced reasoning for most work.",
  high: "Careful reasoning: slower, better on hard problems.",
  xhigh: "Very deep reasoning: slow and costly.",
  max: "As deep as the model goes.",
}
