/**
 * The Tasks tab (batch-2 §f): the checklist of every task and saved plan on
 * the left, the selected row's detail on the right (a Sheet below 1024 px).
 * `#/tasks/<id>` selects a row; the lists are read again whenever the `tasks`
 * or `plans` topic changes.
 */
import { useState } from "react"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { TaskDetail } from "./TaskDetail"
import { TaskList } from "./TaskList"
import { EMPTY_LIST, listCount } from "./words"
import type { TaskRow } from "@protocol"

const close = () => go(tabHash("tasks"))
const select = (id: string) => go(tabHash("tasks", id))

function NoTasks() {
  return (
    <Empty className="m-4 flex-1 border border-border bg-card">
      <EmptyHeader>
        <EmptyDescription>{EMPTY_LIST}</EmptyDescription>
      </EmptyHeader>
      <Button className="h-10" onClick={() => go(tabHash("plan"))}>
        Plan a task
      </Button>
    </Empty>
  )
}

function ArchivedToggle({ shown, count, onToggle }: { shown: boolean; count: number; onToggle: () => void }) {
  return (
    <Button variant="outline" className="h-10" aria-pressed={shown} onClick={onToggle}>
      Archived
      <Badge variant="secondary">{count}</Badge>
    </Button>
  )
}

export function TasksTab({ id }: { id?: string }) {
  const wide = useWide()
  const [showArchived, setShowArchived] = useState(false)
  const tasks = useApiRead("tasks.list", {}, ["tasks", "plans"])
  const archived = useApiRead("tasks.archived", {}, ["tasks"])
  const current = tasks.data?.rows ?? []
  const old = archived.data?.rows ?? []
  const rows = showArchived ? [...current, ...old] : current
  if (!tasks.data && tasks.error) return <ErrorState message={`Could not load tasks. ${tasks.error}`} onRetry={tasks.reload} />
  if (tasks.data && current.length === 0 && old.length === 0) return <NoTasks />
  const chosen = id ?? (wide ? rows[0]?.id : undefined)
  const selected: TaskRow | undefined = [...rows, ...old].find((row) => row.id === chosen)
  const list = (
    <>
      <PaneHeader title="Tasks" count={listCount(rows)}>
        <ArchivedToggle shown={showArchived} count={old.length} onToggle={() => setShowArchived((on) => !on)} />
      </PaneHeader>
      {!tasks.data ? <ListSkeleton /> : rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{EMPTY_LIST}</p> : <TaskList rows={rows} selectedId={chosen} onSelect={select} />}
    </>
  )
  const detail = selected ? <TaskDetail key={selected.id} row={selected} onGone={close} onChanged={tasks.reload} /> : id ? <Missing /> : null
  return <SplitPane wide={wide} list={list} detail={detail} open={Boolean(id)} onClose={close} hint="Select a task to see its detail." describe="Task detail" />
}

function Missing() {
  return <p className="text-sm text-muted-foreground">That task is not on the list any more.</p>
}
