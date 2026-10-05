/**
 * One icon per kind of agent, so an agent reads the same everywhere it shows
 * (the Thinking orb, its bubbles, the planning panel, the chats): the oracle's eye,
 * code for DEV, a palette for DESIGN, a shield for QA, a telescope for
 * RESEARCH, a bolt for Quick fix. Anything else is a robot.
 */
import { Bot, Brain, CodeXml, Compass, Eye, MessagesSquare, Palette, Route, ShieldCheck, Tags, Telescope, Zap, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  MASTER: Eye,
  ORACLE: Eye,
  DEV: CodeXml,
  DESIGN: Palette,
  QA: ShieldCheck,
  RESEARCH: Telescope,
  "QUICK FIX": Zap,
  SCOUT: Compass,
  PLANNER: Route,
  CLASSIFIER: Tags,
  LOBBY: MessagesSquare,
}

/** The icon of an agent by its source name (`DEV`, `QA`, …); with none, the thinking brain. */
export function agentIcon(source: string | undefined): LucideIcon {
  if (!source) return Brain
  return ICONS[source.toUpperCase()] ?? Bot
}

export function AgentIcon({ source, className, strokeWidth }: { source: string | undefined; className?: string; strokeWidth?: number }) {
  const Icon = agentIcon(source)
  return <Icon aria-hidden="true" data-agent-icon={source ?? "thinking"} strokeWidth={strokeWidth} className={cn("shrink-0", className)} />
}
