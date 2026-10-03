/**
 * A task's detail: title with its mark, state facts, id, track and branch
 * (from the Lobby snapshot when it is the session's own task), the request,
 * the plan checklist and text (`tasks.get`), comments, amendments, what the
 * task waits on, recent runs and the actions the row allows. Comments and
 * messages to the task's oracle are written in the floating box below. A saved
 * plan has its own body (`PlanDetail`).
 */
import { RefreshCw, RotateCcw } from "lucide-react"
import type { LobbySnapshot, SnapshotTask, TaskRow } from "@protocol"
import { useTopic } from "@/app/hooks"
import { useApiRead } from "@/app/useApiRead"
import { Button } from "@/components/ui/button"
import { act } from "@/lib/act"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { CheckMark, Pips, trackText } from "@/ui/task-facts"
import { Comments } from "./Comments"
import { DetailTrailer, PlanSections } from "./DetailSections"
import { PlanDetail } from "./PlanDetail"
import { CHECK_WORDS, agoWords, stateWords } from "./words"

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
          {task.currentStep} <span className="rounded-lg bg-accent px-2 py-0.5 text-xs font-medium">now</span>
          <span className="sr-only">(current step)</span>
        </span>
      ) : null}
    </p>
  )
}

function Header({ row, task }: { row: TaskRow; task?: SnapshotTask }) {
  const branch = task?.git ? `branch ${task.git.branch}${task.git.from ? ` · from ${task.git.from}` : ""}` : ""
  return (
    <header className="flex flex-col gap-1.5">
      <h2 className="flex items-start gap-2.5 text-lg font-medium">
        <CheckMark check={row.check} className="mt-1.5" />
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
      <Button variant="outline" onClick={() => void archive()}>
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
        <Button variant="outline" onClick={() => void restore()}>
          <RotateCcw aria-hidden="true" />
          Restore
        </Button>
      ) : null}
      {row.check === "open" && !archived ? (
        <Button variant="outline" aria-pressed={Boolean(row.auto)} onClick={toggleAuto} className="aria-pressed:border-primary aria-pressed:bg-accent">
          <RefreshCw aria-hidden="true" /> Auto
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
  const isPlan = row.kind === "plan"
  const detail = useApiRead("tasks.get", { taskId: row.id }, ["tasks"], !isPlan)
  const snapshot = useTopic<LobbySnapshot>("lobby").data?.task
  const task = snapshot?.id === row.id ? snapshot : undefined
  if (isPlan) return <PlanDetail row={row} onGone={props.onGone} />
  const open = row.check === "open" && row.kind === "task"
  return (
    <article className="flex flex-col gap-5" aria-label={row.title}>
      <Header row={row} task={task} />
      {detail.data ? <PlanSections detail={detail.data} finished={!open} /> : null}
      <Comments taskId={row.id} finished={!open} canComment={open} />
      {detail.data ? <DetailTrailer detail={detail.data} /> : null}
      {detail.error && !detail.data ? <p className="text-sm text-muted-foreground">Could not load the plan detail. {detail.error}</p> : null}
      <Actions {...props} />
    </article>
  )
}
