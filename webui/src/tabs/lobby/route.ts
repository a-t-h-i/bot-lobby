/**
 * Who answers a Lobby message, read back from the step the service logs for it (`DEV answers: the classifier
 * picked DEV (0.83)`, `DEV answers: you named DEV`, `a knowledge question (0.71): …`). The classifier's pick shows
 * as one plain line; a name you typed needs none (your message already starts with it).
 */
import type { ActivityEntry } from "./types.ts"

export type Route = { agent: string } | { knowledge: true } | "named"

export function routeOf(entry: Pick<ActivityEntry, "source" | "text">): Route | undefined {
  if (entry.source !== "LOBBY") return undefined
  if (/^a knowledge question\b/.test(entry.text)) return { knowledge: true }
  const answers = /^([A-Z]+) answers: (.*)$/.exec(entry.text)
  if (!answers) return undefined
  return answers[2]!.startsWith("you named") ? "named" : { agent: answers[1]! }
}

export type Split<M> = { kind: "message"; entry: M } | { kind: "activity"; key: string; entries: ActivityEntry[] } | { kind: "route"; key: string; route: Exclude<Route, "named"> }

/** Each run of steps with the routing steps taken out: a classifier's pick becomes its own line, a named one goes. */
export function splitRoutes<M>(items: ReadonlyArray<{ kind: "message"; entry: M } | { kind: "activity"; key: string; entries: ActivityEntry[] }>): Array<Split<M>> {
  const out: Array<Split<M>> = []
  for (const item of items) {
    if (item.kind === "message") {
      out.push(item)
      continue
    }
    let run: ActivityEntry[] = []
    const flush = () => {
      if (run.length) out.push({ kind: "activity", key: `steps-${run[0]!.id}`, entries: run })
      run = []
    }
    for (const entry of item.entries) {
      const route = routeOf(entry)
      if (!route) run.push(entry)
      else {
        flush()
        if (route !== "named") out.push({ kind: "route", key: `route-${entry.id}`, route })
      }
    }
    flush()
  }
  return out
}
