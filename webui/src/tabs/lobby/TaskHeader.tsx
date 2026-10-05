/**
 * The Lobby tab's task header as one slim line: the task's title and state,
 * its facts as quiet text (id, track, domains, git branch), how long the
 * agents have worked on it, and a progress bar with the step a worker is on
 * (`active · 1m 12s`, ticking) or else the next one. `lobby.snapshot.task`
 * carries the facts; without a task the line says how to start one.
 */
import { GitBranch, Timer } from "lucide-react"
import { motion } from "motion/react"
import type { SnapshotTask, StatusInfo } from "@protocol"
import { executionWords } from "@/lib/phaseTiming"
import { useElapsed } from "@/lib/useElapsed"
import { trackText } from "@/ui/task-facts"

function Dot({ children }: { children: React.ReactNode }) {
  return <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground md:inline-flex">{children}</span>
}

/** Time that ticks on from the snapshot's figure while `running`. */
function Ticking({ ms, running, sample }: { ms: number; running: boolean; sample: unknown }) {
  const elapsed = useElapsed(running, sample)
  return <span className="tabular-nums">{executionWords(ms + elapsed)}</span>
}

/** How long the agents have worked on the task, idle time left out. */
function Worked({ work }: { work: NonNullable<SnapshotTask["work"]> }) {
  return (
    <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground md:inline-flex" title="How long the agents have worked on this task (idle time left out)">
      <Timer aria-hidden="true" className="size-3 shrink-0" />
      worked <Ticking ms={work.workedMs} running={work.running} sample={work} />
    </span>
  )
}

/** The step a worker is on, with its time, or else the step up next. */
function Under({ active, current }: { active?: SnapshotTask["activeSteps"]; current?: string }) {
  const first = active?.[0]
  if (first) {
    return (
      <span className="hidden max-w-[20rem] min-w-0 items-center gap-1.5 xl:inline-flex">
        <span className="truncate text-foreground">{first.text}</span>
        <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-px font-medium text-primary">
          active · <Ticking ms={first.workedMs} running sample={first} />
        </span>
        {active!.length > 1 ? <span className="shrink-0">+{active!.length - 1}</span> : null}
      </span>
    )
  }
  return current ? (
    <span className="hidden max-w-[16rem] truncate xl:inline">
      next: <span className="text-foreground">{current}</span>
    </span>
  ) : null
}

function Progress({ done, total, current, active }: { done: number; total: number; current?: string; active?: SnapshotTask["activeSteps"] }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {done} of {total} steps
      </span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Plan progress">
        <motion.div className="h-full rounded-full bg-primary" initial={false} animate={{ width: `${percent}%` }} transition={{ type: "spring", stiffness: 260, damping: 30 }} />
      </div>
      <Under {...(active ? { active } : {})} {...(current ? { current } : {})} />
    </div>
  )
}

/** One line: the title and state, the facts in quiet text, then the progress. */
export function TaskHeader({ task, status }: { task?: SnapshotTask; status?: StatusInfo }) {
  const branch = status?.branch ?? status?.workspace.branch
  const where = task?.git?.branch ?? branch
  return (
    <section className="flex h-12 shrink-0 items-center gap-3 px-4" aria-label="Task" role="group">
      <h2 className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium" title={task?.title}>
        {task?.title ?? "No task yet"}
        {!task ? <span className="ml-2 font-normal text-muted-foreground">{status?.sessionName ?? "Type a request below to start one."}</span> : null}
      </h2>
      {task ? (
        <>
          <span className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-xs font-medium">{task.state.replace(/_/g, " ")}</span>
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
          {task.work ? <Worked work={task.work} /> : null}
          {task.progress ? <Progress done={task.progress.done} total={task.progress.total} {...(task.currentStep ? { current: task.currentStep } : {})} {...(task.activeSteps ? { active: task.activeSteps } : {})} /> : null}
        </>
      ) : null}
    </section>
  )
}
