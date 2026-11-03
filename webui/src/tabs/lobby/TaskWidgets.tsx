/**
 * The Lobby's side widget on a wide window: the tasks under way, one row each
 * by name with how many steps are done. A row opens (one at a time, like an
 * accordion) into the task's plan as a checklist, the step being worked on
 * marked live. Nothing shows while no task runs, or while the window is too
 * narrow to give it room beside the chat (surface.css hides it there).
 */
import { useState } from "react"
import { ArrowUpRight, ChevronDown } from "lucide-react"
import type { TaskRow } from "@protocol"
import { useApiRead } from "@/app/useApiRead"
import { go, tabHash } from "@/app/router"
import { CheckMark } from "@/ui/task-facts"

/** A task still under way: on the list, not yet done or dropped. */
const underWay = (row: TaskRow) => row.kind === "task" && row.check === "open" && (row.section === "mine" || row.section === "others")
const waits = (row: TaskRow) => /wait|block|review|propos/i.test(row.status)

type Mark = "open" | "now" | "done" | "skip"

/** A step's mark, drawn like a terminal checklist: a dashed ring still to do, a turning arc under way, a tick done. */
function StepMark({ mark }: { mark: Mark }) {
  return (
    <svg className="cs-twm" data-m={mark} viewBox="0 0 16 16" aria-hidden="true" fill="none">
      {mark === "open" || mark === "skip" ? <circle cx="8" cy="8" r="6.25" strokeWidth="1.5" strokeDasharray="2.2 2.4" /> : null}
      {mark === "skip" ? <path d="M5 11L11 5" strokeWidth="1.5" strokeLinecap="round" /> : null}
      {mark === "now" ? (
        <>
          <circle cx="8" cy="8" r="6.25" strokeWidth="1.5" opacity="0.2" />
          <path className="cs-twa" d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : null}
      {mark === "done" ? (
        <>
          <circle cx="8" cy="8" r="7" className="cs-twd" />
          <path d="M5 8.2l2 2 4-4.2" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="cs-twk" />
        </>
      ) : null}
    </svg>
  )
}

function Steps({ taskId }: { taskId: string }) {
  const detail = useApiRead("tasks.get", { taskId }, ["tasks", "lobby"])
  const steps = detail.data?.steps ?? []
  if (!detail.data) return <p className="cs-twe">{detail.error ? "Couldn't load the steps." : "Loading…"}</p>
  if (steps.length === 0) return <p className="cs-twe">No plan yet.</p>
  return (
    <ol className="cs-tws" aria-label="Steps">
      {steps.map((step, index) => {
        const mark: Mark = step.status === "done" ? "done" : step.status === "skipped" ? "skip" : step.active || step.status === "current" ? "now" : "open"
        return (
          <li key={`${index}-${step.text}`} data-s={mark}>
            <StepMark mark={mark} />
            <span>{step.text}</span>
          </li>
        )
      })}
    </ol>
  )
}

function TaskItem({ row, open, onToggle }: { row: TaskRow; open: boolean; onToggle: () => void }) {
  const done = row.progress?.done ?? 0
  const total = row.progress?.total ?? 0
  const live = Boolean(row.work?.running)
  return (
    <li className="cs-twi" data-open={open ? "true" : undefined}>
      <button type="button" className="cs-twh" aria-expanded={open} onClick={onToggle}>
        {!live && waits(row) ? <CheckMark check="open" waiting /> : <StepMark mark={live ? "now" : "open"} />}
        <span className="cs-twt" title={row.title}>{row.title}</span>
        {total > 0 ? <span className="cs-twn">{done}/{total}</span> : null}
        <ChevronDown aria-hidden="true" className="cs-twc" />
      </button>
      <div className="cs-twb">
        <div>
          {open ? (
            <>
              <Steps taskId={row.id} />
              <button type="button" className="cs-two" onClick={() => go(tabHash("tasks", row.id))}>
                Open in Tasks <ArrowUpRight aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </li>
  )
}

export function TaskWidgets() {
  const list = useApiRead("tasks.list", {}, ["tasks", "lobby"])
  const rows = (list.data?.rows ?? []).filter(underWay)
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  if (rows.length === 0) return null
  // The first task starts open; after that the user's choice holds (null: all folded).
  const open = chosen === undefined ? rows[0]?.id : chosen
  return (
    <aside className="cs-tw" aria-label="Tasks under way">
      <h2 className="cs-twl">
        {rows.length === 1 ? "Task" : "Tasks"}
        {rows.length > 1 ? <b>{rows.length}</b> : null}
      </h2>
      <ul className="cs-twx" data-scroll-hints>
        {rows.map((row) => (
          <TaskItem key={row.id} row={row} open={open === row.id} onToggle={() => setChosen(open === row.id ? null : row.id)} />
        ))}
      </ul>
    </aside>
  )
}
