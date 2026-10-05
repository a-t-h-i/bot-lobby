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

/**
 * A token colour per source, mirroring `tabs/home.ts`; meaning is also carried
 * by a mark. Chart tokens are tuned for fills and fail 4.5:1 as text, so the
 * hues come from the accessible `--source-*` palette (D-19).
 */
const SOURCE_COLORS: Record<string, string> = {
  MASTER: "text-primary",
  DEV: "text-source-dev",
  DESIGN: "text-source-design",
  QA: "text-source-qa",
  RESEARCH: "text-source-research",
  "QUICK FIX": "text-source-quickfix",
  ORACLE: "text-primary",
  LOBBY: "text-muted-foreground",
}

/** A source as it reads on the page: `MASTER` → `Master`, `QUICK FIX` → `Quick fix`, `QA` stays. */
export function sourceLabel(source: string): string {
  if (source.length <= 2) return source
  return source.charAt(0) + source.slice(1).toLowerCase()
}

export function sourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? "text-muted-foreground"
}

/** The same colours as CSS values, for what glows in an agent's colour (the Thinking orb and its bubbles). */
const SOURCE_TONES: Record<string, string> = {
  MASTER: "var(--primary)",
  DEV: "var(--source-dev)",
  DESIGN: "var(--source-design)",
  QA: "var(--source-qa)",
  RESEARCH: "var(--source-research)",
  "QUICK FIX": "var(--source-quickfix)",
  ORACLE: "var(--primary)",
  LOBBY: "var(--muted-foreground)",
}

export function sourceTone(source: string): string {
  return SOURCE_TONES[source] ?? "var(--muted-foreground)"
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
