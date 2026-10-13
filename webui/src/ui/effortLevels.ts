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

/** The next supported stop from `index` in `direction`, or `index` when there is none. */
export function stepSupported(levels: readonly string[], supported: readonly string[], index: number, direction: 1 | -1): number {
  for (let i = index + direction; i >= 0 && i < levels.length; i += direction) if (supported.includes(levels[i]!)) return i
  return index
}

/** What each level does, said under the slider. */
export const EFFORT_HINTS: Record<string, string> = {
  off: "No extra reasoning: the quickest, cheapest answer.",
  minimal: "A moment of reasoning, barely.",
  low: "Light reasoning for simple work.",
  medium: "Balanced reasoning for most work.",
  high: "Careful reasoning: slower, better on hard problems.",
  xhigh: "Very deep reasoning: slow and costly.",
  max: "As deep as the model goes.",
}
