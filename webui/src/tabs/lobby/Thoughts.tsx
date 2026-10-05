/** The latest agent thoughts, opened from the Lobby's floating bubble. */
import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { Brain, Minimize } from "lucide-react"
import { cn } from "@/lib/utils"
import { Popup } from "@/components/ui/popup"
import { Button } from "@/components/ui/button"
import { KBD_CLASS, Keys } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PRIORITY, useAnyOverlay, useOverlaySlot } from "@/lib/overlay"
import { matchKey } from "@/app/useLobbyKeys"
import { Markdown } from "@/ui/Markdown"
import { latestThoughts, sourceColor, sourceLabel, type ThoughtEntry } from "./types"

function ThoughtRow({ thought }: { thought: ThoughtEntry }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border py-3 text-sm last:border-0">
      <span className={cn("shrink-0 pt-0.5 text-xs font-medium", sourceColor(thought.source))}>{sourceLabel(thought.source)}</span>
      {thought.live ? (
        <span className="flex shrink-0 items-center gap-2 pt-0.5 text-xs text-primary">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
          thinking
        </span>
      ) : null}
      <div className="w-full min-w-0 text-muted-foreground italic">
        <Markdown text={thought.text} />
      </div>
    </li>
  )
}

/** The Thinking key closes the open dialog again (typing in a field is never interrupted). */
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

export function Thoughts({ thoughts, collapsed, onToggle, shortcut }: { thoughts: ThoughtEntry[]; collapsed: boolean; onToggle: () => void; shortcut?: string | undefined }) {
  const shown = latestThoughts(thoughts)
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={bubble}
              type="button"
              variant="outline"
              aria-label="Open Thinking"
              aria-haspopup="dialog"
              aria-expanded={!collapsed}
              aria-keyshortcuts={shortcut ? `${shortcut} Enter Space` : "Enter Space"}
              onClick={onToggle}
              className={cn("thinking-bubble fixed z-20 size-11 rounded-full shadow-card", overlay && "invisible")}
            >
              <Brain aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Thinking {shortcut ? <Keys chord={shortcut} /> : null}
          </TooltipContent>
        </Tooltip>,
        document.body
      )}
      <Popup
        open={visible}
        onOpenChange={(open) => { if (!open && !collapsed) onToggle() }}
        label="Thinking"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          requestAnimationFrame(() => { if (!document.querySelector("[role='dialog']")) bubble.current?.focus() })
        }}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <h2 className="text-[0.9375rem] font-medium">Thinking</h2>
          <Button variant="ghost" aria-keyshortcuts="Escape Enter Space" onClick={onToggle}>
            <Minimize aria-hidden="true" />
            Minimize <kbd data-slot="kbd" className={cn(KBD_CLASS, "ml-0.5")}>Esc</kbd>
          </Button>
        </header>
        <div className="min-h-0 overflow-y-auto px-4 py-2 outline-none focus-visible:bg-muted/30" role="log" aria-label="Latest thoughts" tabIndex={0}>
          {shown.length ? (
            <ul>
              {shown.map((thought) => <ThoughtRow key={thought.id} thought={thought} />)}
            </ul>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">Thoughts from the oracle and every agent appear here, and only here.</p>
          )}
        </div>
      </Popup>
    </>
  )
}
