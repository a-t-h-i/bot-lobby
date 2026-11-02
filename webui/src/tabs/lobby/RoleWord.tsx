/**
 * The word that says an agent is at work, shimmering in the agent's colour, with a small motion that acts out its
 * job. Every agent (the oracle included) has five such indicators, each a verb and a motion: one is picked at random,
 * and after a random 30 to 60 seconds another takes its place. All words for the same agent share the current pick,
 * so a name in the chat and its activity row never disagree. Under reduced motion it is the plain word and never
 * changes.
 */
import { useSyncExternalStore, type CSSProperties } from "react"
import { agentColor } from "@/ui/AgentIcon"

export type Role = "oracle" | "planner" | "scout" | "research" | "dev" | "qa" | "design" | "agent"

export function roleOf(source: string | undefined): Role {
  const key = (source ?? "").toUpperCase()
  if (key === "MASTER" || key === "ORACLE" || key === "ORCHESTRATOR") return "oracle"
  if (key === "PLANNER" || key === "PANEL") return "planner"
  if (key === "SCOUT") return "scout"
  if (key === "RESEARCH" || key === "RESEARCHER") return "research"
  if (key === "DEV" || key === "BACKEND" || key === "WORKER") return "dev"
  if (key === "QA") return "qa"
  if (key === "DESIGN" || key === "DESIGNER" || key === "FRONTEND") return "design"
  return "agent"
}

type Indicator = { fx: string; verb: string }

/** Each role's indicators; `fx` names the motion in surface.css (`.cs-rw[data-fx]`). */
export const INDICATORS: Record<Role, readonly Indicator[]> = {
  oracle: [
    { fx: "lamp", verb: "Thinking" },
    { fx: "ripple", verb: "Considering" },
    { fx: "twinkle", verb: "Pondering" },
    { fx: "breathe", verb: "Reflecting" },
    { fx: "focus", verb: "Focusing" },
  ],
  planner: [
    { fx: "route", verb: "Planning" },
    { fx: "outline", verb: "Outlining" },
    { fx: "fork", verb: "Mapping" },
    { fx: "brackets", verb: "Scoping" },
    { fx: "stairs", verb: "Sequencing" },
  ],
  scout: [
    { fx: "lens", verb: "Scouting" },
    { fx: "radar", verb: "Surveying" },
    { fx: "sonar", verb: "Probing" },
    { fx: "spotlight", verb: "Exploring" },
    { fx: "needle", verb: "Navigating" },
  ],
  research: [
    { fx: "page", verb: "Reading" },
    { fx: "bookmark", verb: "Noting" },
    { fx: "highlight", verb: "Studying" },
    { fx: "skim", verb: "Skimming" },
    { fx: "riffle", verb: "Researching" },
  ],
  dev: [
    { fx: "type", verb: "Writing" },
    { fx: "braces", verb: "Coding" },
    { fx: "block", verb: "Editing" },
    { fx: "build", verb: "Building" },
    { fx: "code", verb: "Implementing" },
  ],
  qa: [
    { fx: "scan", verb: "Checking" },
    { fx: "frame", verb: "Inspecting" },
    { fx: "pulse", verb: "Testing" },
    { fx: "tests", verb: "Verifying" },
    { fx: "stamp", verb: "Reviewing" },
  ],
  design: [
    { fx: "sketch", verb: "Sketching" },
    { fx: "swatch", verb: "Styling" },
    { fx: "grid", verb: "Laying out" },
    { fx: "wave", verb: "Shaping" },
    { fx: "ruler", verb: "Measuring" },
  ],
  agent: [
    { fx: "dots", verb: "Working" },
    { fx: "glide", verb: "Processing" },
    { fx: "fade", verb: "Busy" },
    { fx: "march", verb: "Running" },
    { fx: "nudge", verb: "Progressing" },
  ],
}

const MIN_MS = 30_000
const MAX_MS = 60_000

type Slot = { index: number; timer?: ReturnType<typeof setTimeout>; listeners: Set<() => void> }
const slots = new Map<Role, Slot>()

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
}

/** A random index below `count`, never `not` (so a swap always shows something new). */
function pick(count: number, not?: number): number {
  if (count < 2) return 0
  const next = Math.floor(Math.random() * (not === undefined ? count : count - 1))
  return not !== undefined && next >= not ? next + 1 : next
}

function slot(role: Role): Slot {
  let found = slots.get(role)
  if (!found) {
    found = { index: pick(INDICATORS[role].length), listeners: new Set() }
    slots.set(role, found)
  }
  return found
}

function schedule(role: Role, current: Slot) {
  if (reducedMotion()) return
  current.timer = setTimeout(() => {
    current.index = pick(INDICATORS[role].length, current.index)
    for (const listener of current.listeners) listener()
    schedule(role, current)
  }, MIN_MS + Math.random() * (MAX_MS - MIN_MS))
}

function useIndicator(role: Role): Indicator {
  const current = slot(role)
  const index = useSyncExternalStore(
    (listener) => {
      current.listeners.add(listener)
      if (current.listeners.size === 1) schedule(role, current)
      return () => {
        current.listeners.delete(listener)
        if (!current.listeners.size) {
          clearTimeout(current.timer)
          current.timer = undefined
        }
      }
    },
    () => current.index,
    () => current.index,
  )
  return INDICATORS[role][index] ?? INDICATORS[role][0]
}

/** `text` overrides the indicator's verb (an agent's name while its reply is on its way, or "Thinking"). */
export function RoleWord({ source, text, className }: { source: string | undefined; text?: string; className?: string }) {
  const role = roleOf(source)
  const { fx, verb } = useIndicator(role)
  const word = text ?? verb
  return (
    <span className={className ? `cs-rw ${className}` : "cs-rw"} data-role={role} data-fx={fx} style={{ "--tone": agentColor(source), "--n": word.length } as CSSProperties}>
      <span key={fx} className="cs-wtx">{word}</span>
      <span key={`${fx}-o`} className="cs-rw-o" aria-hidden="true" />
    </span>
  )
}
