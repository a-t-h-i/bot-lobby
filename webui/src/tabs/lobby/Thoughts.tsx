/**
 * The thinking pane: each agent's latest thought, oldest first, with the live
 * one marked. The feed caps thoughts at 40, so the pane shows no more. The
 * empty wording is the terminal's, verbatim.
 */
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { Markdown } from "@/ui/Markdown"
import { latestThoughts, sourceColor, type ThoughtEntry } from "./types"

function ThoughtRow({ thought }: { thought: ThoughtEntry }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className={cn("w-20 shrink-0 truncate font-mono font-medium", sourceColor(thought.source))}>{thought.source}</span>
      <span className="min-w-0 flex-1 text-muted-foreground italic">
        <Markdown text={thought.text} />
      </span>
      {thought.live ? (
        <span className="flex shrink-0 items-center gap-1 text-primary">
          <Spinner className="size-3" aria-hidden="true" role="presentation" />
          thinking
        </span>
      ) : null}
    </li>
  )
}

export function Thoughts({ thoughts }: { thoughts: ThoughtEntry[] }) {
  const shown = latestThoughts(thoughts)
  return (
    <section className="flex max-h-44 min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border bg-card" aria-label="Thinking">
      <header className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <h2 className="text-sm font-medium">Thinking</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" role="log" aria-label="Thinking">
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">Thoughts from the oracle and every agent appear here, and only here.</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((thought) => (
              <ThoughtRow key={thought.id} thought={thought} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
