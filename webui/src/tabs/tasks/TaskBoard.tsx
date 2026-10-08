import { useEffect } from "react"
import { go, tabHash } from "@/app/router"
import { useApiRead } from "@/app/useApiRead"
import { ErrorState } from "@/app/States"
import { setComposerTask } from "@/lib/composerContext"
import { ListSkeleton, SplitPane } from "@/ui/SplitPane"
import { TaskDetail } from "./TaskDetail"
import { TaskItem } from "./TaskList"
import type { TaskRow } from "@protocol"

const close = () => go(tabHash("tasks", "board"))
const select = (id: string) => go(tabHash("tasks", "board", id))
const columns = ["Backlog", "In progress", "Completed"] as const

function columnFor(row: TaskRow): typeof columns[number] | undefined {
  if (row.kind === "archived" || row.section === "archived") return undefined
  if (row.check === "done") return "Completed"
  if (row.kind === "plan" || row.status === "created" || row.check === "dropped") return "Backlog"
  return "In progress"
}

function BoardColumn({ title, rows, id }: { title: string; rows: TaskRow[]; id?: string }) {
  return <section aria-label={title} className="min-w-0 rounded-xl border border-input bg-muted p-3">
    <h2 className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold">{title}<span className="text-muted-foreground">{rows.length}</span></h2>
    <ul className="flex flex-col gap-3">
      {rows.map((row) => <TaskItem key={`${row.kind}-${row.id}`} row={row} selected={row.id === id} onSelect={select} card />)}
    </ul>
    {!rows.length ? <p className="py-4 text-sm text-muted-foreground">No tasks here.</p> : null}
  </section>
}

function Board({ rows, id }: { rows: TaskRow[]; id?: string }) {
  return <div className="grid items-start gap-4 p-4 md:grid-cols-3" aria-label="Task board">
    {columns.map((title) => <BoardColumn key={title} title={title} rows={rows.filter((row) => columnFor(row) === title)} id={id} />)}
  </div>
}

export function TaskBoard({ id }: { id?: string }) {
  const read = useApiRead("tasks.list", {}, ["tasks", "plans"])
  const rows = read.data?.rows ?? []
  const selected = rows.find((row) => row.id === id && columnFor(row) !== undefined)
  const commentable = selected?.kind === "task" ? selected.id : undefined
  useEffect(() => { setComposerTask(commentable); return () => setComposerTask(undefined) }, [commentable])
  if (!read.data && read.error) return <ErrorState message={`Could not load tasks. ${read.error}`} onRetry={read.reload} />
  const detail = selected ? <TaskDetail key={selected.id} row={selected} onGone={close} onChanged={read.reload} /> : null
  return <SplitPane wide={false} list={read.data ? <Board rows={rows} id={id} /> : <ListSkeleton />}
    detail={detail} open={Boolean(selected)} onClose={close} hint="Select a task to see its detail." describe="Task detail" />
}
