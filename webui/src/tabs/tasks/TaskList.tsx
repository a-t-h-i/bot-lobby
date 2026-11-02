/**
 * The Tasks list: one table (Task, Progress, Worked, Age) with a section
 * label over the first row of each section. A row is the task's mark, its
 * title and a quiet line of facts (amber while it waits on you), the plan's
 * pips, how long its agents worked and how old it is. The open row is lit.
 * Beside the detail pane the list is narrow, so each row (`compact`) is two
 * lines instead: the title and its age, then the facts with the pips.
 */
import type { TaskRow } from "@protocol"
import { executionWords } from "@/lib/phaseTiming"
import { useElapsed } from "@/lib/useElapsed"
import { CheckMark, Pips } from "@/ui/task-facts"
import { CHECK_WORDS, SECTION_TITLES, detailsLine, groupRows } from "./words"

/** How long the agents worked, ticking while they work: `14m`, `1h 4m`. */
function Worked({ row }: { row: TaskRow }) {
  const work = row.work
  const counting = Boolean(work?.running) && row.check === "open" && !row.timing?.waiting
  const elapsed = useElapsed(counting, work ?? { workedMs: 0, running: false })
  if (!work || row.kind === "plan") return <span className="cs-ttm" />
  const words = executionWords(work.workedMs + elapsed)
  return <span className="cs-ttm" data-work-clock={counting ? "running" : "stopped"}>{words.replace(/ \d+s$/, "")}</span>
}

function facts(row: TaskRow): string {
  if (row.kind === "archived") return ""
  if (row.delivery) return `delivery ${row.delivery.status.replaceAll("_", " ")}`
  if (row.kind === "plan" || row.check === "open") return `${row.timing?.waiting ? "waiting for you · " : ""}${detailsLine(row)}${row.auto ? " · auto" : ""}`
  return ""
}

function titleKind(row: TaskRow): string {
  if (row.check === "dropped") return "drop"
  if (row.kind === "archived") return "arch"
  return row.check === "done" ? "done" : "open"
}

export function TaskItem({ row, selected, onSelect, head, count }: { row: TaskRow; selected: boolean; onSelect: (id: string) => void; head: boolean; count: number }) {
  const track = row.kind !== "plan" && row.progress && row.progress.total > 0 ? row.progress : undefined
  return (
    <li>
      {head ? <h3 className="cs-tsec">{SECTION_TITLES[row.section]}<b>{count}</b></h3> : null}
      <button type="button" data-row aria-current={selected ? "true" : undefined} aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help" onClick={() => onSelect(row.id)} className="cs-trw">
        <CheckMark check={row.check} />
        <span className="cs-tt1">
          <span className="sr-only">{CHECK_WORDS[row.check]}:</span>
          <span className="cs-t" data-k={titleKind(row)}>{row.title}</span>
          <span className="cs-mt" data-w={row.timing?.waiting ? "warn" : undefined}>{facts(row)}</span>
        </span>
        <span className="cs-tpg">
          {track ? <><Pips done={track.done} total={track.total} /><span>{track.done}/{track.total}</span></> : null}
        </span>
        <Worked row={row} />
        <span className="cs-tag">{row.age ?? ""}</span>
      </button>
    </li>
  )
}

/** A row of the narrow list beside the detail: the mark, the title and its age, and under them the facts and progress. */
function CompactItem({ row, selected, onSelect, head, count }: { row: TaskRow; selected: boolean; onSelect: (id: string) => void; head: boolean; count: number }) {
  const track = row.kind !== "plan" && row.progress && row.progress.total > 0 ? row.progress : undefined
  const line = facts(row)
  return (
    <li>
      {head ? <h3 className="cs-tsec">{SECTION_TITLES[row.section]}<b>{count}</b></h3> : null}
      <button type="button" data-row aria-current={selected ? "true" : undefined} aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help" onClick={() => onSelect(row.id)} className="cs-tr2">
        <CheckMark check={row.check} />
        <span className="cs-t2a">
          <span className="sr-only">{CHECK_WORDS[row.check]}:</span>
          <span className="cs-t" data-k={titleKind(row)}>{row.title}</span>
          <span className="cs-tag">{row.age ?? ""}</span>
        </span>
        {line || track ? (
          <span className="cs-t2b">
            <span className="cs-mt" data-w={row.timing?.waiting ? "warn" : undefined}>{line}</span>
            {track ? <span className="cs-tpg"><Pips done={track.done} total={track.total} /><span>{track.done}/{track.total}</span></span> : null}
          </span>
        ) : null}
      </button>
    </li>
  )
}

export function TaskList({ rows, selectedId, onSelect, compact }: { rows: readonly TaskRow[]; selectedId?: string; onSelect: (id: string) => void; compact?: boolean }) {
  if (compact) {
    return (
      <ul className="cs-lst cs-lst2">
        {groupRows(rows).flatMap(({ rows: group }, _, groups) =>
          group.map((row, at) => <CompactItem key={`${row.kind}-${row.id}`} row={row} head={at === 0 && groups.length > 1} count={group.length} selected={row.id === selectedId} onSelect={onSelect} />),
        )}
      </ul>
    )
  }
  return (
    <>
      <div className="cs-tbh" aria-hidden="true">
        <span />
        <span>Task</span>
        <span>Progress</span>
        <span>Worked</span>
        <span>Age</span>
      </div>
      <ul className="cs-lst">
        {groupRows(rows).flatMap(({ rows: group }, _, groups) =>
          // One section alone needs no label: the Tasks / Archived switch above already names it and counts it.
          group.map((row, at) => <TaskItem key={`${row.kind}-${row.id}`} row={row} head={at === 0 && groups.length > 1} count={group.length} selected={row.id === selectedId} onSelect={onSelect} />),
        )}
      </ul>
    </>
  )
}
