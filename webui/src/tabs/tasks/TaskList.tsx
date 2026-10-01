/**
 * The Tasks list (batch-2 §f): a rule over each section, then one 44 px row
 * per task or saved plan — check mark, title, plan pips or age, and a line of
 * facts under it. The selected row carries `▸` and an inset ring.
 */
import type { TaskRow } from "@protocol"
import { cn } from "@/lib/utils"
import { Pips } from "@/ui/task-facts"
import { CHECK_MARKS, CHECK_WORDS, SECTION_TITLES, detailsLine, groupRows } from "./words"

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
        className="flex min-h-11 w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=true]:bg-muted aria-[current=true]:ring-2 aria-[current=true]:ring-inset aria-[current=true]:ring-ring"
      >
        <span className="flex items-start gap-2 text-sm">
          <span className="w-3 shrink-0 text-foreground" aria-hidden="true">
            {selected ? "▸" : ""}
          </span>
          <span className="shrink-0 text-foreground" aria-hidden="true">
            {CHECK_MARKS[row.check]}
          </span>
          <span className="sr-only">{CHECK_WORDS[row.check]}:</span>
          <span className={cn("min-w-0 flex-1 break-words", titleClass(row), selected && "font-medium text-foreground")}>{row.title}</span>
          <Trailing row={row} />
        </span>
        {row.check === "open" ? <span className="pl-[2.125rem] text-xs text-muted-foreground">{detailsLine(row)}</span> : null}
      </button>
    </li>
  )
}

export function TaskList({ rows, selectedId, onSelect }: { rows: readonly TaskRow[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-col pb-2">
      {groupRows(rows).map(({ section, rows: group }) => (
        <div key={section}>
          <h3 className="flex items-center justify-between border-b px-3 pt-4 pb-1 text-xs font-medium tracking-wide text-muted-foreground">
            <span>{SECTION_TITLES[section]}</span>
            <span className="tabular-nums">{group.length}</span>
          </h3>
          <ul className="flex flex-col gap-0.5 px-1 pt-1">
            {group.map((row) => (
              <Row key={`${row.kind}-${row.id}`} row={row} selected={row.id === selectedId} onSelect={onSelect} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
