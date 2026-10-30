/**
 * The Tasks tab: one table of every task and saved plan, grouped by section, or
 * of the archived ones alone (never both at once, picked by the switch in the
 * title row); the chosen row's detail slides over from the right. `#/tasks/<id>` opens a
 * row; the lists are read again whenever the `tasks` or `plans` topic changes.
 */
import { ListChecks } from "lucide-react"
import { useEffect, useState } from "react"
import { go, tabHash } from "@/app/router"
import { setComposerTask } from "@/lib/composerContext"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { Button } from "@/components/ui/button"
import { Empty, EmptyMedia, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { Page } from "@/ui/Page"
import { Segmented } from "@/ui/Segmented"
import { SlideOver } from "@/ui/SlideOver"
import { ListSkeleton } from "@/ui/SplitPane"
import { TaskActions, TaskDetail } from "./TaskDetail"
import { TaskList } from "./TaskList"
import { EMPTY_ARCHIVE, EMPTY_LIST, listCount } from "./words"
import type { TaskRow } from "@protocol"

const close = () => go(tabHash("tasks"))
const select = (id: string) => go(tabHash("tasks", id))

function NoTasks() {
  return (
    <Empty className="m-4 flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ListChecks aria-hidden="true" />
        </EmptyMedia>
        <EmptyDescription>{EMPTY_LIST}</EmptyDescription>
      </EmptyHeader>
      <Button onClick={() => go(tabHash("plan"))}>
        Plan a task
      </Button>
    </Empty>
  )
}

/** Which list shows: the tasks under way and finished, or the archived ones. */
function Shown({ archived, current, old, onChange }: { archived: boolean; current: number; old: number; onChange: (archived: boolean) => void }) {
  return (
    <Segmented
      label="Show"
      className="cs-tshow"
      value={archived ? "archived" : "active"}
      onChange={(id) => onChange(id === "archived")}
      items={[
        { id: "active", name: "Tasks", label: <>Tasks<span className="cs-cn">{current}</span></> },
        { id: "archived", name: "Archived", label: <>Archived<span className="cs-cn">{old}</span></> },
      ]}
    />
  )
}

export function TasksTab({ id }: { id?: string }) {
  const [showArchived, setShowArchived] = useState(false)
  const tasks = useApiRead("tasks.list", {}, ["tasks", "plans"])
  const archived = useApiRead("tasks.archived", {}, ["tasks"])
  const current = tasks.data?.rows ?? []
  const old = archived.data?.rows ?? []
  const rows = showArchived ? old : current
  const commentable = [...current, ...old].find((row) => row.id === id && row.kind === "task")?.id
  // The floating box can comment on the task that is open.
  useEffect(() => {
    setComposerTask(commentable)
    return () => setComposerTask(undefined)
  }, [commentable])
  if (!tasks.data && tasks.error) return <ErrorState message={`Could not load tasks. ${tasks.error}`} onRetry={tasks.reload} />
  if (tasks.data && current.length === 0 && old.length === 0) return <NoTasks />
  const selected: TaskRow | undefined = [...current, ...old].find((row) => row.id === id)
  const props = selected ? { row: selected, onGone: close, onChanged: tasks.reload } : undefined
  return (
    <>
      <Page title="Tasks" sub={listCount(rows)} className="cs-ts" aside={<Shown archived={showArchived} current={current.length} old={old.length} onChange={setShowArchived} />}>
        {!(showArchived ? archived : tasks).data ? <ListSkeleton /> : rows.length === 0 ? <p className="cs-tnone">{showArchived ? EMPTY_ARCHIVE : EMPTY_LIST}</p> : <TaskList rows={rows} selectedId={id} onSelect={select} />}
      </Page>
      <SlideOver open={Boolean(id)} onClose={close} label={selected?.title ?? "Task"} className="cs-tdw" head={props ? <TaskActions key={props.row.id} {...props} /> : null}>
        {props ? <TaskDetail key={props.row.id} {...props} /> : id ? <p className="text-sm text-muted-foreground">That task is not on the list any more.</p> : null}
      </SlideOver>
    </>
  )
}
