/**
 * The thinking pane: each agent's latest thought, oldest first, with the live
 * one marked. The feed caps thoughts at 40, so the pane shows no more. The
 * empty wording is the terminal's, verbatim.
 */
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { Frame } from "@/ui/Frame"
import { Markdown } from "@/ui/Markdown"
import { latestThoughts, sourceColor, type ThoughtEntry } from "./types"

function ThoughtRow({ thought }: { thought: ThoughtEntry }) {
  return (
    <li className="flex items-start gap-[1ch] text-sm">
      <span className={cn("w-[9ch] shrink-0 overflow-hidden whitespace-nowrap", sourceColor(thought.source))}>{thought.source}</span>
      <span className="min-w-0 flex-1 text-muted-foreground italic">
        <Markdown text={thought.text} />
      </span>
      {thought.live ? (
        <span className="flex shrink-0 items-center gap-[1ch] text-primary">
          <Spinner aria-hidden="true" role="presentation" />
          thinking
        </span>
      ) : null}
    </li>
  )
}

export function Thoughts({ thoughts }: { thoughts: ThoughtEntry[] }) {
  const shown = latestThoughts(thoughts)
  return (
    <Frame className="max-h-44 shrink-0" aria-label="Thinking" title="Thinking">
      <div className="min-h-0 flex-1 overflow-y-auto px-[1ch] pb-1" role="log" aria-label="Thinking" tabIndex={0}>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">Thoughts from the oracle and every agent appear here, and only here.</p>
        ) : (
          <ul className="space-y-1">
            {shown.map((thought) => (
              <ThoughtRow key={thought.id} thought={thought} />
            ))}
          </ul>
        )}
      </div>
    </Frame>
  )
}
