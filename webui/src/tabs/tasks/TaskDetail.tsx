/**
 * A task's detail (batch-2 §f): title with its box, state facts, id, track and
 * branch (from the Lobby snapshot when it is the session's own task), plan
 * progress, comments and the actions the row allows. A saved plan has its own
 * body (`PlanDetail`). The plan text and the per-step checklist are not on the
 * wire yet, so the progress shows the count and the step under way only.
 */
import { RotateCcw } from "lucide-react"
import type { LobbySnapshot, SnapshotTask, TaskRow } from "@protocol"
import { useTopic } from "@/app/hooks"
import { Button } from "@/components/ui/button"
import { act } from "@/lib/act"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { NoteForm } from "@/ui/NoteForm"
import { Pips, trackText } from "@/ui/task-facts"
import { Comments } from "./Comments"
import { PlanDetail } from "./PlanDetail"
import { CHECK_MARKS, CHECK_WORDS, agoWords, stateWords } from "./words"

interface DetailProps {
  row: TaskRow
  /** The row went away (archived, deleted, started); leave the detail. */
  onGone: () => void
  /** The row itself changed (auto mode); reread the list. */
  onChanged: () => void
}

function factsLine(row: TaskRow): string {
  if (row.kind === "archived") return `archived ${agoWords(row.age ?? "now")}`
  const finished = row.check !== "open"
  const owner = row.owner ?? (row.section === "mine" ? "this session" : "")
  const when = finished && row.age ? `${row.check === "dropped" ? "dropped" : "done"} ${agoWords(row.age)}` : ""
  return [stateWords(row.status, row.paused), finished ? "" : owner, when].filter(Boolean).join(" · ")
}

function snapshotLine(task: SnapshotTask | undefined): string {
  if (!task) return ""
  return [trackText(task.track), task.domains.join(", ")].filter(Boolean).join(" · ")
}

function Progress({ row, task }: { row: TaskRow; task?: SnapshotTask }) {
  if (!row.progress) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <Pips done={row.progress.done} total={row.progress.total} />
      <span>
        {row.progress.done} of {row.progress.total} steps
      </span>
      {task?.currentStep ? (
        <span className="text-foreground">
          {task.currentStep} <span aria-hidden="true">◂ now</span>
          <span className="sr-only">(current step)</span>
        </span>
      ) : null}
    </p>
  )
}

function Header({ row, task }: { row: TaskRow; task?: SnapshotTask }) {
  const branch = task?.git ? `⎇ ${task.git.branch}${task.git.from ? ` · from ${task.git.from}` : ""}` : ""
  return (
    <header className="flex flex-col gap-1">
      <h2 className="flex gap-2 text-base font-medium">
        <span aria-hidden="true">{CHECK_MARKS[row.check]}</span>
        <span className="sr-only">{CHECK_WORDS[row.check]}:</span>
        <span className={row.check === "dropped" ? "min-w-0 break-words line-through" : "min-w-0 break-words"}>{row.title}</span>
      </h2>
      <p className="text-sm text-foreground">{factsLine(row)}</p>
      <p className="text-xs text-muted-foreground break-all">{[row.id, snapshotLine(task)].filter(Boolean).join(" · ")}</p>
      {branch ? <p className="text-xs text-muted-foreground">{branch}</p> : null}
      <Progress row={row} task={task} />
    </header>
  )
}

function useActions({ row, onGone, onChanged }: DetailProps) {
  const taskId = row.id
  const restore = async () => {
    if (await act("tasks.restore", { taskId }, { undo: () => void act("tasks.archive", { taskId }) })) onGone()
  }
  const archive = async () => {
    if (await act("tasks.archive", { taskId }, { undo: () => void act("tasks.restore", { taskId }) })) onGone()
  }
  const remove = async () => {
    if (await act("tasks.delete", { taskId, where: row.kind === "archived" ? "archive" : "list" })) onGone()
  }
  const toggleAuto = () => void act("tasks.auto", { taskId, on: !row.auto }).then(onChanged)
  return { restore, archive, remove, toggleAuto }
}

function ArchiveButton({ row, archive }: { row: TaskRow; archive: () => Promise<void> }) {
  if (row.check !== "open") {
    return (
      <Button variant="outline" className="h-10" onClick={() => void archive()}>
        Archive
      </Button>
    )
  }
  return (
    <ConfirmButton
      label="Archive"
      title={`Archive "${row.title}"?`}
      description="A task still under way is abandoned first, then moved to the archive. Restore brings it back."
      confirmLabel="Archive"
      onConfirm={() => void archive()}
    />
  )
}

function Actions(props: DetailProps) {
  const { row } = props
  const { restore, archive, remove, toggleAuto } = useActions(props)
  const archived = row.kind === "archived"
  return (
    <div className="flex flex-wrap gap-2">
      {archived ? (
        <Button variant="outline" className="h-10" onClick={() => void restore()}>
          <RotateCcw aria-hidden="true" />
          Restore
        </Button>
      ) : null}
      {row.check === "open" && !archived ? (
        <Button variant="outline" className="h-10" aria-pressed={Boolean(row.auto)} onClick={toggleAuto}>
          <span aria-hidden="true">⟳</span> Auto
        </Button>
      ) : null}
      {archived ? null : <ArchiveButton row={row} archive={archive} />}
      <ConfirmButton
        label={archived ? "Delete for good" : "Delete"}
        title={`Delete "${row.title}" for good?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </div>
  )
}

export function TaskDetail(props: DetailProps) {
  const { row } = props
  const snapshot = useTopic<LobbySnapshot>("lobby").data?.task
  const task = snapshot?.id === row.id ? snapshot : undefined
  if (row.kind === "plan") return <PlanDetail row={row} onGone={props.onGone} />
  const open = row.check === "open" && row.kind === "task"
  return (
    <article className="flex flex-col gap-5" aria-label={row.title}>
      <Header row={row} task={task} />
      <Comments taskId={row.id} finished={!open} canComment={open} />
      {open ? (
        <NoteForm
          label="Message the oracle"
          hint="Left for the oracle that owns this task."
          onSend={async (text) => (await act("tasks.message", { taskId: row.id, text })) !== undefined}
        />
      ) : null}
      <Actions {...props} />
    </article>
  )
}
