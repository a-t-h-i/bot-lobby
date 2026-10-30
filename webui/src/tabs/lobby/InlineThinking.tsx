/**
 * Thinking, inline in the Lobby: under the latest message, a folded row says who is thinking and the step they
 * are on (or who thought, once they have stopped); opened, each agent's thought reads as steps. Thoughts from
 * before the latest message are not repeated. Alt+T opens or folds it; a row opened or folded by hand keeps that
 * until the key is pressed again.
 */
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react"
import { ChevronDown } from "lucide-react"
import { useCollapsed } from "@/lib/collapsed"
import { formatSince } from "@/lib/format"
import { AgentIcon } from "@/ui/AgentIcon"
import { Markdown } from "@/ui/Markdown"
import { latestThoughts, sourceLabel, sourceTone, type ThoughtEntry } from "./types"
import { thoughtSteps } from "./thoughtSteps"

/** Steps an agent's thought shows before the earlier ones fold away. */
const SHOWN_STEPS = 4

const toneStyle = (tone: string) => ({ "--orb": tone }) as CSSProperties

function ThoughtSteps({ thought }: { thought: ThoughtEntry }) {
  const steps = useMemo(() => thoughtSteps(thought.text), [thought.text])
  const [all, setAll] = useState(false)
  const folded = all ? 0 : Math.max(0, steps.length - SHOWN_STEPS)
  const shown = steps.slice(folded)
  const label = sourceLabel(thought.source)
  return (
    <li className="thought" style={toneStyle(sourceTone(thought.source))} data-live={thought.live || undefined} aria-label={`${label}${thought.live ? ", thinking" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="thought-label">
          <AgentIcon source={thought.source} strokeWidth={2.25} className="size-3.5" />
          {label}
        </span>
        <span className="text-xs text-muted-foreground">{thought.live ? "thinking…" : formatSince(Date.now() - thought.at)}</span>
      </div>
      {folded ? (
        <button type="button" data-compact className="thought-more" onClick={() => setAll(true)}>
          {folded} earlier {folded === 1 ? "step" : "steps"}
        </button>
      ) : null}
      <ol className="thought-steps" data-single={shown.length === 1 || undefined}>
        {shown.map((step, index) => (
          <li key={folded + index} data-current={(thought.live && index === shown.length - 1) || undefined}>
            {step.title ? <p className="text-sm font-medium text-foreground">{step.title}</p> : null}
            {step.text ? <Markdown text={step.text} className="thought-text" /> : null}
          </li>
        ))}
      </ol>
    </li>
  )
}

/** The latest step of a thought, as one line. */
function lastStep(thought: ThoughtEntry): string {
  const step = thoughtSteps(thought.text).at(-1)
  return (step?.title || step?.text || "").replace(/\s+/g, " ").trim()
}

/** The thoughts worth showing under the latest message: anyone thinking now, and anything thought since it. */
export function freshThoughts(thoughts: ThoughtEntry[], since: number): ThoughtEntry[] {
  return latestThoughts(thoughts)
    .filter((thought) => thought.live || thought.at >= since)
    .sort((a, b) => Number(b.live) - Number(a.live) || b.at - a.at || b.id - a.id)
}

export function InlineThinking({ thoughts }: { thoughts: ThoughtEntry[] }) {
  // The Thinking key's store: unfolded means every thinking row is open.
  const [folded] = useCollapsed("lobby.thinking")
  const [own, setOwn] = useState<boolean>()
  useEffect(() => setOwn(undefined), [folded])
  const open = own ?? !folded
  const list = useId()
  if (!thoughts.length) return null
  const live = thoughts.find((thought) => thought.live)
  const names = [...new Set(thoughts.map((thought) => sourceLabel(thought.source)))].join(", ")
  return (
    <div className="cs-work activity-run cs-think" data-live={live ? true : undefined} data-open={open || undefined} style={live ? toneStyle(sourceTone(live.source)) : undefined}>
      <button type="button" aria-expanded={open} aria-controls={list} onClick={() => setOwn(!open)} className="cs-wrow activity-toggle">
        {live ? (
          <>
            <span className="cs-wtx">Thinking</span>
            <span key={live.id} className="activity-live-step min-w-0 truncate">
              <span className="font-medium">{sourceLabel(live.source)}</span> {lastStep(live)}
            </span>
          </>
        ) : (
          <span className="min-w-0 truncate">Thought · {names}</span>
        )}
        <ChevronDown aria-hidden="true" className="cs-chev size-3.5 shrink-0" />
      </button>
      <div className="cs-wbody" inert={!open}>
        <div className="cs-wi">
          <ul id={list} aria-label="Thinking" className="flex flex-col gap-2.5 py-1">
            {open ? thoughts.map((thought) => <ThoughtSteps key={thought.id} thought={thought} />) : null}
          </ul>
        </div>
      </div>
    </div>
  )
}
