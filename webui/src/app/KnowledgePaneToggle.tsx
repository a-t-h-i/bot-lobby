import { go } from "./router"
import { knowledgeHash, knowledgeView } from "./knowledgeView"
import { cn } from "@/lib/utils"

export function KnowledgePaneToggle({ rest }: { rest: string[] }) {
  const { chat } = knowledgeView(rest)
  return (
    <div role="group" aria-label="Knowledge pane" className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {["Chat", "Docs"].map((label) => (
        <button key={label} type="button" aria-pressed={chat === (label === "Chat")}
          onClick={() => go(knowledgeHash(rest, label === "Chat"))}
          className={cn("h-6 rounded-md border px-2.5 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
            chat === (label === "Chat") ? "btn-raised btn-soft bg-card text-foreground" : "btn-ghost text-muted-foreground hover:text-foreground")}>
          {label}
        </button>
      ))}
    </div>
  )
}
