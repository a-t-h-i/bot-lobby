/**
 * The agents' latest thoughts. A glowing orb (see `Orb.tsx`) floats on the
 * Lobby in the colour of the agent thinking (taking turns when several are),
 * with that agent's name beside it; it opens a pane lit in the same colour, with no
 * title bar, where every agent has its own labelled bubble and each thought
 * reads as steps rather than one block of text. Esc, the backdrop or the
 * Thinking key closes it.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { formatSince } from "@/lib/format"
import { Popup } from "@/components/ui/popup"
import { PRIORITY, useAnyOverlay, useOverlaySlot } from "@/lib/overlay"
import { matchKey } from "@/app/useLobbyKeys"
import { AgentIcon } from "@/ui/AgentIcon"
import { Markdown } from "@/ui/Markdown"
import { ThinkingOrb } from "./Orb"
import { latestThoughts, sourceLabel, sourceTone, type ThoughtEntry } from "./types"
import { thoughtSteps } from "./thoughtSteps"

/** Steps a bubble shows before the earlier ones fold away. */
const SHOWN_STEPS = 4
/** How long each thinking agent holds the orb when several are. */
const TURN_MS = 1800

const toneStyle = (tone: string) => ({ "--orb": tone }) as CSSProperties

/** The agent in the spotlight: the one thinking, or each in turn when several are. */
function useSpotlight(sources: string[]): string | undefined {
  const [turn, setTurn] = useState(0)
  const key = sources.join("|")
  useEffect(() => {
    setTurn(0)
    if (sources.length < 2) return
    const timer = window.setInterval(() => setTurn((now) => now + 1), TURN_MS)
    return () => window.clearInterval(timer)
    // Keyed on the names, not the array: a new snapshot with the same agents keeps the turn going.
  }, [key, sources.length])
  return sources.length ? sources[turn % sources.length] : undefined
}

function ThoughtBubble({ thought }: { thought: ThoughtEntry }) {
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
        <span className="text-xs text-muted-foreground">
          {thought.live ? (
            <span className="thought-live">
              thinking<span aria-hidden="true" className="thought-ellipsis" />
            </span>
          ) : (
            formatSince(Date.now() - thought.at)
          )}
        </span>
        {steps.length > 1 ? <span className="ml-auto text-xs text-muted-foreground tabular-nums">{steps.length} steps</span> : null}
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

/** The Thinking key closes the open pane again (typing in a field is never interrupted). */
function useThinkingKey(open: boolean, shortcut: string | undefined, onToggle: () => void) {
  useEffect(() => {
    if (!open || !shortcut) return
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing || !matchKey(event, shortcut)) return
      if ((event.target as HTMLElement)?.closest("input, textarea, [contenteditable='true']")) return
      event.preventDefault()
      onToggle()
    }
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [open, shortcut, onToggle])
}

/** Thinking agents first, newest first, then the rest, newest first. */
function byNow(thoughts: ThoughtEntry[]): ThoughtEntry[] {
  return [...thoughts].sort((a, b) => Number(b.live) - Number(a.live) || b.at - a.at)
}

export function Thoughts({ thoughts, collapsed, onToggle, shortcut }: { thoughts: ThoughtEntry[]; collapsed: boolean; onToggle: () => void; shortcut?: string | undefined }) {
  const shown = byNow(latestThoughts(thoughts))
  const thinking = shown.filter((thought) => thought.live).map((thought) => thought.source)
  const spotlight = useSpotlight(thinking)
  const tone = spotlight ? sourceTone(spotlight) : "var(--orb-idle)"
  const bubble = useRef<HTMLButtonElement>(null)
  const minimized = useRef(collapsed)
  minimized.current = collapsed
  useEffect(() => () => { if (!minimized.current) onToggle() }, [onToggle])
  const visible = useOverlaySlot(!collapsed, PRIORITY.sheet)
  const overlay = useAnyOverlay()
  useThinkingKey(visible, shortcut, onToggle)
  return (
    <>
      {createPortal(
        <ThinkingOrb
          ref={bubble}
          spotlight={spotlight}
          thinking={thinking}
          tone={tone}
          expanded={!collapsed}
          hidden={overlay}
          shortcut={shortcut}
          onOpen={onToggle}
        />,
        document.body
      )}
      <Popup
        open={visible}
        onOpenChange={(open) => { if (!open && !collapsed) onToggle() }}
        label="Thinking"
        className="thought-pane max-w-xl"
        style={toneStyle(tone)}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          requestAnimationFrame(() => { if (!document.querySelector("[role='dialog']")) bubble.current?.focus() })
        }}
      >
        <div aria-hidden="true" className="thought-aura" data-thinking={spotlight ? "" : undefined} />
        <div className="relative min-h-0 overflow-y-auto p-3 outline-none sm:p-4" role="log" aria-label="Latest thoughts" tabIndex={0}>
          {shown.length ? (
            <ul className="flex flex-col gap-2.5">
              {shown.map((thought) => <ThoughtBubble key={thought.id} thought={thought} />)}
            </ul>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Thoughts from the oracle and every agent appear here, and only here.</p>
          )}
        </div>
      </Popup>
    </>
  )
}
