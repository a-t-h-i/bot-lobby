/**
 * The thinking pane: each agent's latest thought, oldest first, with the live
 * one marked. The feed caps thoughts at 40, so the pane shows no more.
 */
import { cn } from "@/lib/utils"
import { Frame } from "@/ui/Frame"
import { Markdown } from "@/ui/Markdown"
import { latestThoughts, sourceColor, sourceLabel, type ThoughtEntry } from "./types"

function ThoughtRow({ thought }: { thought: ThoughtEntry }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className={cn("w-24 shrink-0 overflow-hidden pt-0.5 text-xs font-medium whitespace-nowrap", sourceColor(thought.source))}>{sourceLabel(thought.source)}</span>
      <span className="min-w-0 flex-1 text-muted-foreground italic">
        <Markdown text={thought.text} />
      </span>
      {thought.live ? (
        <span className="flex shrink-0 items-center gap-2 pt-0.5 text-xs text-primary">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
          thinking
        </span>
      ) : null}
    </li>
  )
}

export function Thoughts({ thoughts, collapsed, onToggle, shortcut, bare, className }: { thoughts: ThoughtEntry[]; collapsed: boolean; onToggle?: () => void; shortcut?: string | undefined; bare?: boolean; className?: string }) {
  const shown = latestThoughts(thoughts)
  return (
    <Frame className={cn("max-h-48 shrink-0", className)} aria-label="Thinking" {...(bare ? {} : { title: "Thinking" })} collapsed={collapsed} {...(onToggle ? { onToggle } : {})} shortcut={shortcut}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none focus-visible:bg-muted/30" role="log" aria-label="Thinking" tabIndex={0}>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">Thoughts from the oracle and every agent appear here, and only here.</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((thought) => (
              <ThoughtRow key={thought.id} thought={thought} />
            ))}
          </ul>
        )}
      </div>
    </Frame>
  )
}
