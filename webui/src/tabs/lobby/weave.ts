/**
 * The Lobby's conversation and its activity as one timeline: each run of
 * activity steps sits after the message it followed, so the work reads in
 * place, between what was asked and what came back. Pure, so the node tests
 * can check it.
 */

interface Timed {
  id: number
  at: number
}

export type Woven<M extends Timed, A extends Timed> =
  | { kind: "message"; entry: M }
  | { kind: "activity"; key: string; entries: A[] }

/**
 * `messages` in their order, each followed by the activity steps that came
 * after it and before the next one; steps older than every message go first.
 * A step at the same moment as a message follows it.
 */
export function weave<M extends Timed, A extends Timed>(messages: readonly M[], activity: readonly A[]): Array<Woven<M, A>> {
  const steps = [...activity].sort((a, b) => a.at - b.at || a.id - b.id)
  const out: Array<Woven<M, A>> = []
  let next = 0
  const take = (until: number) => {
    const run: A[] = []
    while (next < steps.length && steps[next]!.at < until) run.push(steps[next++]!)
    if (run.length) out.push({ kind: "activity", key: `steps-${run[0]!.id}`, entries: run })
  }
  for (const entry of messages) {
    take(entry.at)
    out.push({ kind: "message", entry })
  }
  take(Number.POSITIVE_INFINITY)
  return out
}
