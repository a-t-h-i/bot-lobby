/**
 * The Lobby tab's task header, as the terminal's task detail draws it (D-21):
 * `□ title  state`, then the facts dimmed under it. `lobby.snapshot.task`
 * carries the widened fields the terminal's `taskDetailLines` shows (track,
 * domains, the git branch, plan progress and the step under way), so the
 * page mirrors that header. The wording comes from `src/lobby/tabs/tasks.ts`;
 * the empty state is unchanged.
 */
import type { SnapshotTask, StatusInfo } from "@protocol"
import { Pips, trackText } from "@/ui/task-facts"

function Facts({ task, branch }: { task: SnapshotTask; branch?: string }) {
  const track = trackText(task.track)
  const where = task.git?.branch ?? branch
  const from = task.git?.from
  return (
    <div className="flex flex-col pl-[2ch] text-sm text-muted-foreground">
      <p>{[task.id, track, (task.domains ?? []).join(", ")].filter(Boolean).join(" · ")}</p>
      {where ? <p>⎇ {where}{from ? ` · from ${from}` : ""} · owner: this window</p> : null}
      {task.progress ? (
        <p className="flex flex-wrap items-center gap-x-[1ch]">
          <Pips done={task.progress.done} total={task.progress.total} />
          <span>{task.progress.done} of {task.progress.total} steps</span>
          {task.currentStep ? (
            <span className="text-foreground">
              current: {task.currentStep} <span className="text-primary">◂ now</span>
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

export function TaskHeader({ task, status }: { task?: SnapshotTask; status?: StatusInfo }) {
  const branch = status?.branch ?? status?.workspace.branch
  return (
    <div className="shrink-0 pt-1 text-sm" aria-label="Task" role="group">
      <p className="flex flex-wrap items-baseline gap-x-[1ch]">
        <span aria-hidden="true" className="text-muted-foreground">□</span>
        <span className="font-bold">{task?.title ?? "No task is running in this session."}</span>
        {task ? <span className="text-primary">{task.state}</span> : null}
      </p>
      {task ? (
        <Facts task={task} branch={branch} />
      ) : (
        <p className="pl-[2ch] text-muted-foreground">{status?.sessionName ?? "Type a request below to start one."}</p>
      )}
    </div>
  )
}
