/**
 * A task's detail: title with its mark, state facts, id, track and branch
 * (from the Lobby snapshot when it is the session's own task), the request,
 * the plan checklist and text (`tasks.get`), comments, amendments, what the
 * task waits on, recent runs and the actions the row allows (Resume carries a
 * paused or stopped task on without opening it in a session). Comments and
 * messages to the task's oracle are written in the floating box below. A saved
 * plan has its own body (`PlanDetail`).
 */
import { PhaseTiming } from "./PhaseTiming"
import { DeliveryReview } from "./DeliveryReview"
import { Archive, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { useId, useState } from "react"
import type { LobbySnapshot, SnapshotTask, TaskRow } from "@protocol"
import { useTopic } from "@/app/hooks"
import { useApiRead } from "@/app/useApiRead"
import { Keys } from "@/components/ui/kbd"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { act } from "@/lib/act"
import { useHotkey } from "@/lib/hotkeys"
import { ActionBar, ActionButton } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { CheckMark, Pips, trackText } from "@/ui/task-facts"
import { Comments } from "./Comments"
import { DetailTrailer, PlanSections } from "./DetailSections"
import { OpenInSession } from "./OpenInSession"
import { PlanActions, PlanDetail } from "./PlanDetail"
import { TaskInterventions } from "./TaskInterventions"
import { CHECK_WORDS, agoWords, stateWords } from "./words"

interface DetailProps {
  row: TaskRow
  /** The row went away (archived, deleted, started); leave the detail. */
  onGone: () => void
  /** The row itself changed (auto mode); reread the list. */
  onChanged: () => void
}

/** The state as one word or two, and the rest of the facts (who owns it, when it ended) as quiet text. */
function factParts(row: TaskRow): { state: string; rest: string } {
  if (row.kind === "archived") return { state: "archived", rest: agoWords(row.age ?? "now") }
  const finished = row.check !== "open"
  const owner = row.owner ?? (row.section === "mine" ? "this session" : "")
  const when = finished && row.age ? `${row.check === "dropped" ? "dropped" : "done"} ${agoWords(row.age)}` : ""
  return { state: stateWords(row.status, row.paused), rest: [finished ? "" : owner, when].filter(Boolean).join(" · ") }
}

function snapshotLine(task: SnapshotTask | undefined): string {
  if (!task) return ""
  return [trackText(task.track), task.domains.join(", ")].filter(Boolean).join(" · ")
}

function Progress({ row }: { row: TaskRow }) {
  if (!row.progress) return null
  return (
    <p className="cs-prog">
      <Pips done={row.progress.done} total={row.progress.total} />
      <span>
        {row.progress.done} of {row.progress.total} steps
      </span>
    </p>
  )
}

/** The title with its mark, the state as a badge with the rest of the facts, the ids behind Details, and the progress. */
function Header({ row, task }: { row: TaskRow; task?: SnapshotTask }) {
  const branch = task?.git ? `branch ${task.git.branch}${task.git.from ? ` · from ${task.git.from}` : ""}` : ""
  const { state, rest } = factParts(row)
  const [ids, setIds] = useState(false)
  const idsId = useId()
  return (
    <header>
      <h2>
        <CheckMark check={row.check} />
        <span className="sr-only">{CHECK_WORDS[row.check]}:</span>
        <span className={row.check === "dropped" ? "min-w-0 break-words line-through" : "min-w-0 break-words"}>{row.title}</span>
      </h2>
      <p className="cs-sub">
        <span className="cs-bdg" data-t={row.check === "done" ? "ok" : row.timing?.waiting ? "warn" : row.check === "open" ? "acc" : undefined}>{state}</span>
        {rest ? <span>{rest}</span> : null}
        <button type="button" className="cs-dtl" aria-expanded={ids} aria-controls={idsId} onClick={() => setIds((on) => !on)}>{ids ? "Hide details" : "Details"}</button>
      </p>
      {ids ? <p id={idsId} className="cs-ids">{[row.id, snapshotLine(task), branch].filter(Boolean).join(" · ")}</p> : null}
      <Progress row={row} />
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
  if (row.check !== "open") return <ActionButton label="Archive" icon={Archive} shortcut="E" onClick={() => void archive()} />
  return (
    <ConfirmButton
      label="Archive"
      icon={Archive}
      shortcut="E"
      title={`Archive "${row.title}"?`}
      description="A task still under way is abandoned first, then moved to the archive. Restore brings it back."
      confirmLabel="Archive"
      onConfirm={() => void archive()}
    />
  )
}

/** Auto mode: the oracle decides without asking. A bare row with a small switch and its key. */
function AutoMode({ on, toggle }: { on: boolean; toggle: () => void }) {
  useHotkey("a", toggle)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="cs-autol">
          <RefreshCw aria-hidden="true" className="size-3.5" />
          <span>Auto</span>
          <Switch small checked={on} onCheckedChange={toggle} aria-label="Auto mode" aria-keyshortcuts="A" />
          <Keys chord="A" className="kbd-hint" />
        </label>
      </TooltipTrigger>
      <TooltipContent>Auto mode: the oracle decides without asking</TooltipContent>
    </Tooltip>
  )
}

/** The action bar at the top of the slide-over: a task's or a saved plan's. */
export function TaskActions(props: DetailProps) {
  return props.row.kind === "plan" ? <PlanActions row={props.row} onGone={props.onGone} /> : <Actions {...props} />
}

function Actions(props: DetailProps) {
  const { row } = props
  const { restore, archive, remove, toggleAuto } = useActions(props)
  const archived = row.kind === "archived"
  const resumable = row.kind === "task" && row.check === "open" && Boolean(row.resumable)
  return (
    <ActionBar>
      {row.kind === "task" && row.check === "open" ? <OpenInSession row={row} quiet={resumable} /> : null}
      {archived ? <ActionButton label="Restore" icon={RotateCcw} shortcut="R" onClick={() => void restore()} /> : null}
      {row.check === "open" && !archived ? <AutoMode on={Boolean(row.auto)} toggle={toggleAuto} /> : null}
      {archived ? null : <ArchiveButton row={row} archive={archive} />}
      <ConfirmButton
        icon={Trash2}
        label={archived ? "Delete for good" : "Delete"}
        text="Delete"
        shortcut="Delete"
        title={`Delete "${row.title}" for good?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </ActionBar>
  )
}

export function TaskDetail(props: DetailProps) {
  const { row } = props
  const isPlan = row.kind === "plan"
  const detail = useApiRead("tasks.get", { taskId: row.id }, ["tasks"], !isPlan)
  const snapshot = useTopic<LobbySnapshot>("lobby").data?.task
  const task = snapshot?.id === row.id ? snapshot : undefined
  if (isPlan) return <PlanDetail row={row} />
  const open = row.check === "open" && row.kind === "task"
  // The detail, once read, says whether the task keeps work time; the row stands in until then.
  const work = detail.data ? detail.data.work : row.work
  return (
    <article className="cs-dt flex min-w-0 flex-col" aria-label={row.title}>
      <Header row={row} task={task} />
      {detail.data ? <TaskInterventions row={row} detail={detail.data} onChanged={() => { detail.reload(); props.onChanged() }} /> : null}
      <p className="mt-2 text-[12.5px] text-muted-foreground"><PhaseTiming timing={detail.data?.timing ?? row.timing} {...(work ? { work } : {})} stopped={row.check !== "open"} /></p>
      {detail.data?.delivery ? <DeliveryReview key={row.id} taskId={row.id} title={row.title} delivery={detail.data.delivery} onChanged={detail.reload} /> : null}
      {detail.data ? <PlanSections detail={detail.data} finished={!open} {...(open && detail.data.canSkip ? { skip: { taskId: row.id, onSkipped: () => { detail.reload(); props.onChanged() } } } : {})} /> : null}
      <Comments taskId={row.id} finished={!open} canComment={open} />
      {detail.data ? <DetailTrailer detail={detail.data} /> : null}
      {detail.error && !detail.data ? <p className="text-sm text-muted-foreground">Could not load the plan detail. {detail.error}</p> : null}
    </article>
  )
}
