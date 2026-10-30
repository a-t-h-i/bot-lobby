/**
 * One icon per kind of agent, so an agent reads the same everywhere it shows
 * (the Thinking orb, its bubbles, the planning panel, the menus), as the
 * design draws them: a crown for the oracle, code for DEV, a palette for
 * DESIGN, a shield for QA, a globe for RESEARCH, an eye for a scout, a
 * checklist for the lint gate. Anything else is a robot.
 */
import { Bot, Brain, CodeXml, Compass, ListChecks, MessagesSquare, Palette, Route, ShieldCheck, Tags, Telescope, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  DEV: CodeXml,
  DESIGN: Palette,
  QA: ShieldCheck,
  RESEARCH: Telescope,
  SCOUT: Compass,
  PLANNER: Route,
  CLASSIFIER: Tags,
  LOBBY: MessagesSquare,
  LINT: ListChecks,
}

/** The icon of an agent by its source name (`DEV`, `QA`, …); with none, the thinking brain. */
export function agentIcon(source: string | undefined): LucideIcon {
  if (!source) return Brain
  return ICONS[source.toUpperCase()] ?? Bot
}

/** The design's own glyphs for the agents it names: a crown for the oracle, a palette, code, a shield, a globe, an eye. */
const GLYPHS: Record<string, string[]> = {
  MASTER: ["M2 7l5 4 5-7 5 7 5-4-2 12H4z"],
  DESIGN: ["M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z", "M7.5 11h.01M10 7h.01M15 7h.01"],
  DEV: ["M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"],
  QA: ["M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z", "M8.5 12l2.5 2.5 4.5-5"],
  RESEARCH: ["M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z", "M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"],
  SCOUT: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z"],
}

function Glyph({ name, className, strokeWidth = 2, source }: { name: string; className?: string; strokeWidth?: number; source?: string }) {
  return (
    <svg aria-hidden="true" data-agent-icon={source} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0", name === "MASTER" && "agent-oracle", className)}>
      {GLYPHS[name]!.map((d) => <path key={d} d={d} />)}
    </svg>
  )
}

/** The glyph's key for an agent's source name (`DEV`, `QA`, …), or the chat agents' keys (`backend`, `designer`, …). */
function glyphKey(source: string | undefined): string | undefined {
  const name = source?.toUpperCase()
  if (!name) return undefined
  if (name === "ORACLE" || name === "MASTER") return "MASTER"
  if (name === "BACKEND") return "DEV"
  if (name === "DESIGNER" || name === "FRONTEND") return "DESIGN"
  if (name === "RESEARCHER") return "RESEARCH"
  return GLYPHS[name] ? name : undefined
}

/** An agent's colour as a CSS value: the oracle wears the accent, the others their fixed colours. */
export function agentColor(source: string | undefined): string {
  const key = glyphKey(source)
  if (key === "MASTER") return "var(--c-orc)"
  if (key === "DESIGN") return "var(--c-des)"
  if (key === "DEV") return "var(--c-dev)"
  if (key === "QA") return "var(--c-qa)"
  if (key === "RESEARCH") return "var(--c-res)"
  if (key === "SCOUT") return "var(--c-sc)"
  if (source?.toUpperCase() === "PLANNER" || source?.toUpperCase() === "PANEL") return "var(--c-pl)"
  return "var(--muted-foreground)"
}

/** Whether two source names (`DEV`, `backend`, `Dev`, …) are the same agent. */
export function sameAgent(a: string | undefined, b: string | undefined): boolean {
  const key = glyphKey(a)
  return key ? key === glyphKey(b) : a?.toUpperCase() === b?.toUpperCase()
}

export function isOracle(source: string | undefined): boolean {
  const name = source?.toUpperCase()
  return name === "ORACLE" || name === "MASTER"
}

export function AgentIcon({ source, className, strokeWidth }: { source: string | undefined; className?: string; strokeWidth?: number }) {
  const key = glyphKey(source)
  if (key) return <Glyph name={key} source={source} className={className} strokeWidth={strokeWidth} />
  const Icon = agentIcon(source)
  return <Icon aria-hidden="true" data-agent-icon={source ?? "thinking"} strokeWidth={strokeWidth} className={cn("shrink-0", className)} />
}
