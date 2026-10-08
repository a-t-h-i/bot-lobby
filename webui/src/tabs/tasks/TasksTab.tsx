/**
 * The Tasks tab: the checklist of every task and saved plan on the left, the
 * selected row's detail on the right (a sheet below 1024 px).
 * `#/tasks/<id>` selects a row; the lists are read again whenever the `tasks`
 * or `plans` topic changes.
 */
import { ListChecks } from "lucide-react"
import { Tabs } from "radix-ui"
import { TaskBoard } from "./TaskBoard"
import { useEffect, useState } from "react"
import { go, tabHash } from "@/app/router"
import { setComposerTask } from "@/lib/composerContext"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyMedia, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { TaskDetail } from "./TaskDetail"
import { TaskList } from "./TaskList"
import { EMPTY_LIST, listCount } from "./words"
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

function ArchivedToggle({ shown, count, onToggle }: { shown: boolean; count: number; onToggle: () => void }) {
  return (
    <label className="btn-raised flex h-7 cursor-pointer items-center gap-2 rounded-lg border bg-card px-2 text-xs font-medium transition-[box-shadow]">
      <Checkbox checked={shown} onCheckedChange={onToggle} aria-label="Show archived tasks" className="size-4" />
      Archived
      <Badge variant="secondary" className="h-5 px-1.5">{count}</Badge>
    </label>
  )
}

export function TasksTab({ id, board = false }: { id?: string; board?: boolean }) {
  return <Tabs.Root value={board ? "board" : "list"} onValueChange={(value) => go(tabHash("tasks", ...(value === "board" ? ["board"] : [])))} className="flex min-h-0 flex-1 flex-col">
    <Tabs.List aria-label="Task views" className="flex gap-1 border-b border-border px-4 py-2">
      <Tabs.Trigger value="list" className="rounded-lg border border-input px-3 py-1.5 text-sm text-muted-foreground data-[state=active]:bg-tab-fill data-[state=active]:text-foreground focus-visible:ring-3 focus-visible:ring-ring">List</Tabs.Trigger>
      <Tabs.Trigger value="board" className="rounded-lg border border-input px-3 py-1.5 text-sm text-muted-foreground data-[state=active]:bg-tab-fill data-[state=active]:text-foreground focus-visible:ring-3 focus-visible:ring-ring">Board</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="list" className="flex min-h-0 flex-1 flex-col"><TasksListView id={id} /></Tabs.Content>
    <Tabs.Content value="board" className="flex min-h-0 flex-1 flex-col"><TaskBoard id={id} /></Tabs.Content>
  </Tabs.Root>
}

function TasksListView({ id }: { id?: string }) {
  const wide = useWide()
  const [showArchived, setShowArchived] = useState(false)
  const tasks = useApiRead("tasks.list", {}, ["tasks", "plans"])
  const archived = useApiRead("tasks.archived", {}, ["tasks"])
  const current = tasks.data?.rows ?? []
  const old = archived.data?.rows ?? []
  const rows = showArchived ? [...current, ...old] : current
  const chosen = id ?? (wide ? rows[0]?.id : undefined)
  const commentable = [...rows, ...old].find((row) => row.id === chosen && row.kind === "task")?.id
  // The floating box can comment on the task that is open.
  useEffect(() => {
    setComposerTask(commentable)
    return () => setComposerTask(undefined)
  }, [commentable])
  if (!tasks.data && tasks.error) return <ErrorState message={`Could not load tasks. ${tasks.error}`} onRetry={tasks.reload} />
  if (tasks.data && current.length === 0 && old.length === 0) return <NoTasks />
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
