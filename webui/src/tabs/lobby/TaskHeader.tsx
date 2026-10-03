/**
 * The Lobby tab's task header as one slim line: the task's title and state,
 * its facts as quiet text (id, track, domains, git branch) and a progress bar
 * with the step under way. `lobby.snapshot.task` carries the facts; without a
 * task the line says how to start one.
 */
import { GitBranch } from "lucide-react"
import { motion } from "motion/react"
import type { SnapshotTask, StatusInfo } from "@protocol"
import { trackText } from "@/ui/task-facts"

function Dot({ children }: { children: React.ReactNode }) {
  return <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground md:inline-flex">{children}</span>
}

function Progress({ done, total, current }: { done: number; total: number; current?: string }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {done} of {total} steps
      </span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Plan progress">
        <motion.div className="h-full rounded-full bg-primary" initial={false} animate={{ width: `${percent}%` }} transition={{ type: "spring", stiffness: 260, damping: 30 }} />
      </div>
      {current ? (
        <span className="hidden max-w-[16rem] truncate xl:inline">
          now: <span className="text-foreground">{current}</span>
        </span>
      ) : null}
    </div>
  )
}

/** One line: the title and state, the facts in quiet text, then the progress. */
export function TaskHeader({ task, status }: { task?: SnapshotTask; status?: StatusInfo }) {
  const branch = status?.branch ?? status?.workspace.branch
  const where = task?.git?.branch ?? branch
  return (
    <section className="glass flex h-10 shrink-0 items-center gap-3 rounded-lg px-3" aria-label="Task" role="group">
      <h2 className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium" title={task?.title}>
        {task?.title ?? "No task is running in this session."}
        {!task ? <span className="ml-2 font-normal text-muted-foreground">{status?.sessionName ?? "Type a request below to start one."}</span> : null}
      </h2>
      {task ? (
        <>
          <span className="shrink-0 rounded-lg bg-accent px-2 py-0.5 text-xs font-medium">{task.state.replace(/_/g, " ")}</span>
          <Dot>{task.id}</Dot>
          {task.track ? <Dot>{trackText(task.track)}</Dot> : null}
          {(task.domains ?? []).length > 0 ? <Dot>{task.domains.join(", ")}</Dot> : null}
          {where ? (
            <span className="hidden max-w-48 shrink-0 items-center gap-1 text-xs text-muted-foreground lg:inline-flex">
              <GitBranch aria-hidden="true" className="size-3 shrink-0" />
              <span className="truncate">
                {where}
                {task.git?.from ? ` · from ${task.git.from}` : ""}
              </span>
            </span>
          ) : null}
          {task.progress ? <Progress done={task.progress.done} total={task.progress.total} current={task.currentStep} /> : null}
        </>
      ) : null}
    </section>
  )
}
