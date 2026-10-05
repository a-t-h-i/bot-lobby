/**
 * Who is at work right now, for the Thinking orb on every page: the oracle
 * while it answers, each agent with a run going, anything the activity log
 * still marks as under way, and the sessions busy in the background. Pure, so
 * it is the same wherever it is asked.
 */
import { agentName, sourceLabel, type LobbyRun } from "./types.ts"

export interface BusyInput {
  oracleBusy: boolean
  runs: readonly LobbyRun[]
  activity: ReadonlyArray<{ source: string; pending: boolean }>
  background: ReadonlyArray<{ name: string; busy: boolean; alive: boolean }>
}

/** The names, oracle first, each once; background sessions as one entry. */
export function busyAgents({ oracleBusy, runs, activity, background }: BusyInput): string[] {
  const names = new Set<string>()
  if (oracleBusy) names.add("Oracle")
  for (const run of runs) if (run.status === "running") names.add(sourceLabel(agentName(run)))
  for (const entry of activity) if (entry.pending && entry.source !== "LOBBY") names.add(entry.source === "MASTER" ? "Oracle" : sourceLabel(entry.source))
  const elsewhere = background.filter((session) => session.alive && session.busy).length
  if (elsewhere) names.add(elsewhere === 1 ? "1 in the background" : `${elsewhere} in the background`)
  return [...names]
}

/** What the orb's tag says for them: `Dev`, `Dev, QA`, `Oracle, Dev +2`. */
export function busyLabel(names: readonly string[]): string {
  if (names.length <= 2) return names.join(", ")
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`
}
