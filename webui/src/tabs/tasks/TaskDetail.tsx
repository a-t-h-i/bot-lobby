/**
 * A task's detail: title with its mark, state facts, id, track and branch
 * (from the Lobby snapshot when it is the session's own task), the request,
 * the plan checklist and text (`tasks.get`), comments, amendments, what the
 * task waits on, recent runs and the actions the row allows. Comments and
 * messages to the task's oracle are written in the floating box below. A saved
 * plan has its own body (`PlanDetail`).
 */
import { useEffect, useRef } from "react"
import { go } from "@/app/router"
import { call } from "@/lib/api"
import { selectedProject } from "@/lib/project"
import { toast } from "@/lib/toast"
import { PhaseTiming } from "./PhaseTiming"
import { DeliveryReview } from "./DeliveryReview"
import { Archive, MessageSquare, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import type { LobbySnapshot, SnapshotTask, TaskRow } from "@protocol"
import { useTopic } from "@/app/hooks"
import { useApiRead } from "@/app/useApiRead"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { act } from "@/lib/act"
import { ActionBar, ActionButton } from "@/ui/Actions"
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
  if (row.check !== "open") return <ActionButton label="Archive" icon={Archive} onClick={() => void archive()} />
  return (
    <ConfirmButton
      label="Archive"
      icon={Archive}
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
    <ActionBar>
      {row.kind === "task" ? <OpenTask taskId={row.id} /> : null}
      {archived ? <ActionButton label="Restore" icon={RotateCcw} onClick={() => void restore()} /> : null}
      {row.check === "open" && !archived ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <RefreshCw aria-hidden="true" className="size-4" />
              <Switch checked={Boolean(row.auto)} onCheckedChange={toggleAuto} aria-label="Auto mode" />
            </label>
          </TooltipTrigger>
          <TooltipContent>Auto mode: the oracle decides without asking</TooltipContent>
        </Tooltip>
      ) : null}
      {archived ? null : <ArchiveButton row={row} archive={archive} />}
      <ConfirmButton
        icon={Trash2}
        label={archived ? "Delete for good" : "Delete"}
        title={`Delete "${row.title}" for good?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </ActionBar>
  )
}

function OpenTask({ taskId }: { taskId: string }) {
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function open() {
    const project = selectedProject()
    try {
      const result = await call("tasks.open", { taskId })
      if (!alive.current || selectedProject() !== project) return
      if (result.notice) toast.info(result.notice)
      const status = await call("status.get", {})
      if (!alive.current || selectedProject() !== project) return
      const id = result.key ?? (result.sessionId === status.sessionId ? "here" : result.sessionId)
      if (id) go(`#/sessions/${encodeURIComponent(id)}`)
      else if (!result.notice) toast.info("This task has no active session. No replacement session was created.")
    } catch (e) { if (alive.current && selectedProject() === project) toast.error(e instanceof Error ? e.message : String(e)) }
  }
  return <ActionButton label="Open task conversation" icon={MessageSquare} onClick={() => void open()} />
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
      <Actions {...props} />
      <Header row={row} task={task} />
      <p className="text-sm text-muted-foreground"><PhaseTiming timing={detail.data?.timing ?? row.timing} stopped={row.check !== "open"} /></p>
      {detail.data?.delivery ? <DeliveryReview key={row.id} taskId={row.id} title={row.title} delivery={detail.data.delivery} onChanged={detail.reload} /> : null}
      {detail.data ? <PlanSections detail={detail.data} finished={!open} /> : null}
      <Comments taskId={row.id} finished={!open} canComment={open} />
      {detail.data ? <DetailTrailer detail={detail.data} /> : null}
      {detail.error && !detail.data ? <p className="text-sm text-muted-foreground">Could not load the plan detail. {detail.error}</p> : null}
    </article>
  )
}
