/**
 * The word that says an agent is at work, shimmering in the agent's colour, with a small motion that acts out its
 * job: the oracle's word glows like a lamp, the panel draws a dotted route step by step, the scout sweeps a lens
 * across, research turns a page, dev types the word out behind a caret, QA scans it and ticks it, design sketches a
 * freehand line under it. Under reduced motion it is the plain word.
 */
import type { CSSProperties } from "react"
import { agentColor } from "@/ui/AgentIcon"

export type Role = "oracle" | "planner" | "scout" | "research" | "dev" | "qa" | "design" | "agent"

export function roleOf(source: string | undefined): Role {
  const key = (source ?? "").toUpperCase()
  if (key === "MASTER" || key === "ORACLE") return "oracle"
  if (key === "PLANNER" || key === "PANEL") return "planner"
  if (key === "SCOUT") return "scout"
  if (key === "RESEARCH" || key === "RESEARCHER") return "research"
  if (key === "DEV" || key === "BACKEND" || key === "WORKER") return "dev"
  if (key === "QA") return "qa"
  if (key === "DESIGN" || key === "DESIGNER") return "design"
  return "agent"
}

const VERBS: Record<Role, string> = {
  oracle: "Thinking",
  planner: "Planning",
  scout: "Scouting",
  research: "Reading",
  dev: "Writing",
  qa: "Checking",
  design: "Sketching",
  agent: "Working",
}

/** `text` overrides the role's verb (an agent's name while its reply is on its way, or "Thinking"). */
export function RoleWord({ source, text, className }: { source: string | undefined; text?: string; className?: string }) {
  const role = roleOf(source)
  const word = text ?? VERBS[role]
  return (
    <span className={className ? `cs-rw ${className}` : "cs-rw"} data-role={role} style={{ "--tone": agentColor(source), "--n": word.length } as CSSProperties}>
      <span className="cs-wtx">{word}</span>
      <span className="cs-rw-o" aria-hidden="true" />
    </span>
  )
}
