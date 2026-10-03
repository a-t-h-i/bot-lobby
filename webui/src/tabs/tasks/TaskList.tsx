/**
 * The Tasks list: a heading over each section, then one row per task or saved
 * plan: its mark, title, plan progress or age, and a line of facts under it.
 * The chosen row is lit.
 */
import type { TaskRow } from "@protocol"
import { cn } from "@/lib/utils"
import { CheckMark, Pips } from "@/ui/task-facts"
import { CHECK_WORDS, SECTION_TITLES, detailsLine, groupRows } from "./words"
import { Rule } from "@/ui/Frame"

function Trailing({ row }: { row: TaskRow }) {
  if (row.check === "open" && row.progress) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
        <Pips done={row.progress.done} total={row.progress.total} />
        <span>
          {row.progress.done}/{row.progress.total}
        </span>
      </span>
    )
  }
  return row.age && row.check !== "open" ? <span className="shrink-0 text-xs text-muted-foreground">{row.age}</span> : null
}

function titleClass(row: TaskRow): string {
  if (row.check === "dropped") return "text-muted-foreground line-through"
  if (row.kind === "archived" || row.check === "done") return "text-muted-foreground"
  return "text-foreground"
}

function Row({ row, selected, onSelect }: { row: TaskRow; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(row.id)}
        className="flex min-h-11 w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=true]:bg-accent"
      >
        <span className="flex items-start gap-2 text-sm">
          <CheckMark check={row.check} className="mt-0.5" />
          <span className="sr-only">{CHECK_WORDS[row.check]}:</span>
          <span className={cn("min-w-0 flex-1 break-words", titleClass(row), selected && "font-medium text-foreground")}>{row.title}</span>
          <Trailing row={row} />
        </span>
        {row.check === "open" ? <span className="pl-6 text-xs text-muted-foreground">{detailsLine(row)}</span> : null}
      </button>
    </li>
  )
}

export function TaskList({ rows, selectedId, onSelect }: { rows: readonly TaskRow[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-col pb-2">
      {groupRows(rows).map(({ section, rows: group }) => (
        <div key={section}>
          <h3 className="px-4 pt-3 pb-1 text-xs">
            <Rule title={SECTION_TITLES[section]} right={String(group.length)} className="[&>span:first-child]:font-medium [&>span:first-child]:text-muted-foreground" />
          </h3>
          <ul className="flex flex-col gap-0.5 px-2 pt-1">
            {group.map((row) => (
              <Row key={`${row.kind}-${row.id}`} row={row} selected={row.id === selectedId} onSelect={onSelect} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
