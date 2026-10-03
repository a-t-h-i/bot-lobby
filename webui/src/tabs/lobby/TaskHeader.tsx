/**
 * The Lobby tab's task header: the task's title and state, its facts as small
 * chips (id, track, domains, git branch) and a progress bar with the step
 * under way. `lobby.snapshot.task` carries the facts; without a task the card
 * says how to start one.
 */
import { GitBranch } from "lucide-react"
import { motion } from "motion/react"
import type { SnapshotTask, StatusInfo } from "@protocol"
import { trackText } from "@/ui/task-facts"

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground">{children}</span>
}

function Progress({ done, total, current }: { done: number; total: number; current?: string }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {done} of {total} steps
        </span>
        {current ? (
          <span className="min-w-0 truncate">
            now: <span className="text-foreground">{current}</span>
          </span>
        ) : null}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Plan progress">
        <motion.div className="h-full rounded-full bg-primary" initial={false} animate={{ width: `${percent}%` }} transition={{ type: "spring", stiffness: 260, damping: 30 }} />
      </div>
    </div>
  )
}

export function TaskHeader({ task, status }: { task?: SnapshotTask; status?: StatusInfo }) {
  const branch = status?.branch ?? status?.workspace.branch
  const where = task?.git?.branch ?? branch
  return (
    <section className="glass flex shrink-0 flex-col gap-3 rounded-lg px-5 py-4" aria-label="Task" role="group">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0 truncate text-base font-medium">{task?.title ?? "No task is running in this session."}</h2>
        {task ? <span className="rounded-lg bg-accent px-2.5 py-0.5 text-xs font-medium">{task.state.replace(/_/g, " ")}</span> : null}
      </div>
      {task ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip>{task.id}</Chip>
            {task.track ? <Chip>{trackText(task.track)}</Chip> : null}
            {(task.domains ?? []).length > 0 ? <Chip>{task.domains.join(", ")}</Chip> : null}
            {where ? (
              <Chip>
                <GitBranch aria-hidden="true" className="size-3" />
                {where}
                {task.git?.from ? ` · from ${task.git.from}` : ""}
              </Chip>
            ) : null}
          </div>
          {task.progress ? <Progress done={task.progress.done} total={task.progress.total} current={task.currentStep} /> : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{status?.sessionName ?? "Type a request below to start one."}</p>
      )}
    </section>
  )
}
