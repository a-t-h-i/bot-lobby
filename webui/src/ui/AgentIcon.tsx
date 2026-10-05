/**
 * One icon per kind of agent, so an agent reads the same everywhere it shows
 * (the Thinking orb, its bubbles, the planning panel, the chats): the oracle's
 * crystal ball (a picture, `assets/oracle.png`, drawn as the class
 * `agent-oracle`), code for DEV, a palette for DESIGN, a shield for QA, a
 * telescope for RESEARCH, a bolt for Quick fix, a checklist for the lint gate.
 * Anything else is a robot.
 */
import { Bot, Brain, CodeXml, Compass, ListChecks, MessagesSquare, Palette, Route, ShieldCheck, Tags, Telescope, Zap, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  DEV: CodeXml,
  DESIGN: Palette,
  QA: ShieldCheck,
  RESEARCH: Telescope,
  "QUICK FIX": Zap,
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

/** The oracle (your Pi session, MASTER in the feeds) is drawn, not a line icon. */
export function isOracle(source: string | undefined): boolean {
  const name = source?.toUpperCase()
  return name === "ORACLE" || name === "MASTER"
}

export function AgentIcon({ source, className, strokeWidth }: { source: string | undefined; className?: string; strokeWidth?: number }) {
  if (isOracle(source)) return <span aria-hidden="true" data-agent-icon={source} className={cn("agent-oracle shrink-0", className)} />
  const Icon = agentIcon(source)
  return <Icon aria-hidden="true" data-agent-icon={source ?? "thinking"} strokeWidth={strokeWidth} className={cn("shrink-0", className)} />
}
