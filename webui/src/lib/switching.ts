/**
 * Whether the tab bar is playing a switch. A long page renders its first
 * screenful at once and holds the rest back until the switch has played, so
 * the animation keeps every frame however much the page has to build.
 */
let playing = false
let waiting: Array<() => void> = []
let safety = 0

/** The longest a switch holds anything back, should it never report its end (interrupted, unmounted). */
const MOST_MS = 900

export function switchStarted(): void {
  playing = true
  window.clearTimeout(safety)
  safety = window.setTimeout(switchEnded, MOST_MS)
}

export function switchEnded(): void {
  playing = false
  window.clearTimeout(safety)
  const run = waiting
  waiting = []
  for (const fn of run) fn()
}

/** Run `fn` once no switch is playing (now, when none is); returns a cancel. */
export function afterSwitch(fn: () => void): () => void {
  if (!playing) {
    fn()
    return () => {}
  }
  const entry = () => fn()
  waiting.push(entry)
  return () => {
    waiting = waiting.filter((other) => other !== entry)
  }
}
