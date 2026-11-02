/**
 * The Tasks tab: every task and saved plan, grouped by section, or the
 * archived ones alone (never both at once, picked by the switch in the title
 * row). On a wide window the list is a narrow pane on the left and the chosen
 * row's detail fills the pane on the right, a hairline between them; on a
 * narrow one the list is a table and the detail slides over from the right.
 * `#/tasks/<id>` opens a row; the lists are read again whenever the `tasks` or
 * `plans` topic changes.
 */
import { ListChecks, MousePointerClick } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useMediaQuery } from "@/app/hooks"
import { hasOverlay } from "@/lib/overlay"
import { horizontalStep, isTyping, stepRows, verticalStep } from "@/prompts/nav"
import { ScrollHints } from "@/ui/ScrollHints"
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
import { EMPTY_ARCHIVE, EMPTY_LIST } from "./words"
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

/** Whether a key on a pane is the pane's to handle: no pop-up, no typing, no modifier. */
function paneKey(event: KeyboardEvent<HTMLElement>): boolean {
  return !(event.defaultPrevented || event.nativeEvent.isComposing || hasOverlay() || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target) || event.target instanceof HTMLInputElement)
}

/** What the detail pane shows before a row is chosen. */
function PickHint() {
  return (
    <div className="cs-tsh">
      <MousePointerClick aria-hidden="true" />
      <p>Choose a task to see its plan, progress and comments.</p>
    </div>
  )
}

interface SplitProps {
  aside: ReactNode
  list: ReactNode
  head: ReactNode
  detail: ReactNode
  /** The open row is gone from the lists; say so in the detail pane. */
  missing: boolean
}

/**
 * The wide layout: the title, the switch and the list on the left, a hairline, then the chosen row's
 * action bar over its detail. Up and Down (or j and k) walk the rows, Right goes into the detail, Left
 * (or Esc) comes back to the open row.
 */
function Split({ aside, list, head, detail, missing }: SplitProps) {
  const listPane = useRef<HTMLDivElement>(null)
  const detailPane = useRef<HTMLDivElement>(null)
  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    const root = listPane.current
    if (!root || !paneKey(event)) return
    const step = verticalStep(event.key)
    if (step) {
      event.preventDefault()
      stepRows(root, event.target as Element, step)
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      stepRows(root, event.target as Element, event.key === "Home" ? "first" : "last")
    } else if (horizontalStep(event.key) === 1 && detailPane.current) {
      event.preventDefault()
      detailPane.current.focus()
    }
  }
  function onDetailKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!paneKey(event) || (horizontalStep(event.key) !== -1 && event.key !== "Escape")) return
    const row = listPane.current?.querySelector<HTMLElement>("[data-row][aria-current='true']") ?? listPane.current?.querySelector<HTMLElement>("[data-row]")
    if (!row) return
    event.preventDefault()
    row.focus()
  }
  return (
    <div className="cs-tsp">
      <section className="cs-tsl" aria-label="Tasks">
        <div className="cs-pgh cs-tslh">
          <h1 className="cs-hd1">Tasks</h1>
          {aside}
        </div>
        <div className="cs-tsbox">
          <div ref={listPane} data-pane="list" className="cs-tss" onKeyDown={onListKey}>{list}</div>
          <ScrollHints target={listPane} />
        </div>
      </section>
      <div className="cs-tsdv" aria-hidden="true" />
      <section className="cs-tsd" aria-label="Task detail">
        {detail ? (
          <>
            <div className="cs-tsdh">{head}</div>
            <div className="cs-tsbox">
              <div ref={detailPane} data-pane="detail" tabIndex={-1} className="cs-tss cs-tsds" onKeyDown={onDetailKey}>{detail}</div>
              <ScrollHints target={detailPane} />
            </div>
          </>
        ) : missing ? (
          <div className="cs-tsh"><p>That task is not on the list any more.</p></div>
        ) : (
          <PickHint />
        )}
      </section>
    </div>
  )
}

export function TasksTab({ id }: { id?: string }) {
  const [showArchived, setShowArchived] = useState(false)
  const wide = useMediaQuery("(min-width: 900px)")
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
  const shown = <Shown archived={showArchived} current={current.length} old={old.length} onChange={setShowArchived} />
  const loaded = Boolean((showArchived ? archived : tasks).data)
  const list = !loaded ? <ListSkeleton /> : rows.length === 0 ? <p className="cs-tnone">{showArchived ? EMPTY_ARCHIVE : EMPTY_LIST}</p> : <TaskList rows={rows} selectedId={id} onSelect={select} compact={wide} />
  if (wide) {
    return (
      <Split
        aside={shown}
        list={list}
        head={props ? <TaskActions key={props.row.id} {...props} /> : null}
        detail={props ? <TaskDetail key={props.row.id} {...props} /> : null}
        missing={Boolean(id) && Boolean(tasks.data && archived.data) && !props}
      />
    )
  }
  return (
    <>
      <Page title="Tasks" className="cs-ts" aside={shown}>
        {list}
      </Page>
      <SlideOver open={Boolean(id)} onClose={close} label={selected?.title ?? "Task"} className="cs-tdw" head={props ? <TaskActions key={props.row.id} {...props} /> : null}>
        {props ? <TaskDetail key={props.row.id} {...props} /> : id ? <p className="text-sm text-muted-foreground">That task is not on the list any more.</p> : null}
      </SlideOver>
    </>
  )
}
