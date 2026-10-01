/**
 * The Lobby tab's view types and the few pure helpers its panes share. The
 * snapshot arrives as `unknown[]` for runs and the feed entries, so each is
 * narrowed here once instead of in every component.
 */
import type { LobbySnapshot } from "@protocol"

export interface ChatEntry {
  id: number
  at: number
  role: string
  text: string
}

export interface ActivityEntry {
  id: number
  at: number
  source: string
  text: string
  kind: string
  pending: boolean
}

export interface ThoughtEntry {
  id: number
  at: number
  source: string
  text: string
  live: boolean
}

/** An `AgentRun` as the snapshot carries it (a superset of what the strip shows). */
export interface LobbyRun {
  runId?: string
  role?: string
  domain?: string
  status?: string
  activity?: string
  step?: string
  error?: string
  startedAt?: string
  finishedAt?: string
}

/** A token colour per source, mirroring `tabs/home.ts`; meaning is also carried by a mark. */
const SOURCE_COLORS: Record<string, string> = {
  MASTER: "text-primary",
  DEV: "text-chart-2",
  DESIGN: "text-chart-4",
  QA: "text-chart-1",
  RESEARCH: "text-chart-3",
  "QUICK FIX": "text-chart-5",
  ORACLE: "text-primary",
  LOBBY: "text-muted-foreground",
}

export function sourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? "text-muted-foreground"
}

/** The agent slot a run belongs to (mirrors `agentName` in `src/pi/run-summary.ts`, and accepts the mock's `role`). */
export function agentName(run: LobbyRun): string {
  if (run.role === "researcher") return "RESEARCH"
  const key = run.domain ?? run.role
  if (key === "backend" || key === "dev") return "DEV"
  if (key === "designer" || key === "design") return "DESIGN"
  if (key === "researcher" || key === "research") return "RESEARCH"
  if (key === "qa") return "QA"
  return key ? String(key).toUpperCase() : "AGENT"
}

/** The snapshot's runs, whatever the server sent. */
export function runsOf(data: LobbySnapshot | undefined): LobbyRun[] {
  return (data?.runs as LobbyRun[] | undefined) ?? []
}

/** Each agent's latest thought, oldest first, capped like the feed. */
export function latestThoughts(thoughts: ThoughtEntry[], cap = 40): ThoughtEntry[] {
  const bySource = new Map<string, ThoughtEntry>()
  for (const thought of thoughts) bySource.set(thought.source, thought)
  return [...bySource.values()].sort((a, b) => a.at - b.at).slice(-cap)
}
