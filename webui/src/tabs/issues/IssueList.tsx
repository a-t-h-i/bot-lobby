/**
 * The Issues list: one 44 px row per open issue — number, title
 * and its first two labels — with the author and age under it. The selected
 * row carries an inset ring.
 */
import type { IssueInfo } from "@protocol"
import { cn } from "@/lib/utils"
import { ROW, ROWS } from "@/ui/rows"
import { labelText, rowFacts } from "./words"

function Row({ issue, selected, now, onSelect }: { issue: IssueInfo; selected: boolean; now: number; onSelect: (number: number) => void }) {
  const labels = labelText(issue.labels)
  return (
    <li>
      <button
        type="button"
        data-row
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(issue.number)}
        className={ROW}
      >
        <span className="flex items-start gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground tabular-nums">#{issue.number}</span>
          <span className={cn("min-w-0 flex-1 break-words text-foreground", selected && "font-medium")}>{issue.title}</span>
          {labels ? <span className="shrink-0 text-xs text-muted-foreground">{labels}</span> : null}
        </span>
        <span className="pl-9 text-xs text-muted-foreground">{rowFacts(issue, now)}</span>
      </button>
    </li>
  )
}

export function IssueList({ issues, selectedId, now, onSelect }: { issues: readonly IssueInfo[]; selectedId?: number; now: number; onSelect: (number: number) => void }) {
  return (
    <ul className={ROWS}>
      {issues.map((issue) => (
        <Row key={issue.number} issue={issue} selected={issue.number === selectedId} now={now} onSelect={onSelect} />
      ))}
    </ul>
  )
}
