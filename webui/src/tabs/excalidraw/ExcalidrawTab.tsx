/**
 * The Excalidraw page: the shared sessions on the left with their check mark,
 * name, masked link and agent count; on the right the selected session in
 * cards (its link, masked until revealed, its room, its agents, the boxes to
 * rename it or add another), or with nothing selected an overview: how many
 * of the five are in use, the three steps and the add boxes. With no session
 * at all the page is those steps beside the add boxes. Below 1024 px the
 * detail is a Sheet. `#/excalidraw/<id>` selects a session; the list is read
 * again on every `excalidraw` topic change. The board is never embedded:
 * `Open board` leaves for Excalidraw in a new tab.
 */
import { PenTool } from "lucide-react"
import { useState } from "react"
import type { ExcalidrawCheck } from "@protocol"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { KeyHint } from "@/components/ui/kbd"
import { act } from "@/lib/act"
import { cn } from "@/lib/utils"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { AddForms, Card, SessionDetail, Steps } from "./SessionDetail"
import { SessionList } from "./SessionList"
import { ADD_TITLE, EMPTY_HEADLINE, EMPTY_LEAD, EMPTY_LIMIT, LIST_TITLE, MAX_SESSIONS, OVERVIEW_PICK, OVERVIEW_TITLE, capacity } from "./words"

const close = () => go(tabHash("excalidraw"))
const select = (id: string) => go(tabHash("excalidraw", id))

/** Five slots, the used ones filled. */
function Capacity({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-2.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className="flex gap-1">
        {Array.from({ length: MAX_SESSIONS }, (_, slot) => (
          <span key={slot} className={cn("h-1.5 w-5 rounded-full", slot < count ? "bg-primary" : "bg-border")} />
        ))}
      </span>
      <span className="tabular-nums">{capacity(count)}</span>
    </span>
  )
}

/** With sessions but none chosen: the count, the steps, and the boxes to add one. */
function Overview({ count, onChanged }: { count: number; onChanged: () => void }) {
  return (
    <div className="@container flex max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">{OVERVIEW_TITLE}</h2>
          <p className="text-sm text-muted-foreground">{OVERVIEW_PICK}</p>
        </div>
        <Capacity count={count} />
      </header>
      <Steps row />
      {count < MAX_SESSIONS ? (
        <Card title={ADD_TITLE}>
          <AddForms onChanged={onChanged} />
        </Card>
      ) : null}
      <p className="flex flex-wrap items-center gap-4">
        <KeyHint chord="ArrowDown">next session</KeyHint>
        <KeyHint chord="ArrowRight">into its detail</KeyHint>
      </p>
    </div>
  )
}

/** No session at all: what a session is and the steps on one side, the boxes to add the first on the other. */
function ExcalidrawEmpty({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="@container flex-1 overflow-y-auto px-5 pt-10 pb-dock sm:px-8">
      <div className="mx-auto grid max-w-5xl gap-8 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex flex-col gap-5">
          <span aria-hidden="true" className="grid size-11 place-items-center rounded-xl border border-border bg-card text-primary shadow-card">
            <PenTool className="size-5" />
          </span>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-semibold tracking-tight">{EMPTY_HEADLINE}</h2>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{EMPTY_LEAD}</p>
          </div>
          <Steps />
          <p className="text-xs text-muted-foreground">{EMPTY_LIMIT}</p>
        </div>
        <Card title={ADD_TITLE} className="self-start">
          <AddForms onChanged={onChanged} stacked />
        </Card>
      </div>
    </div>
  )
}

export function ExcalidrawTab({ id }: { id?: string }) {
  const wide = useWide()
  const read = useApiRead("excalidraw.list", {}, ["excalidraw"])
  const [checks, setChecks] = useState<Record<string, ExcalidrawCheck>>({})
  const [checking, setChecking] = useState<string[]>([])
  const sessions = read.data?.sessions ?? []
  const selected = sessions.find((session) => session.id === id)
  const check = async (sessionId: string) => {
    setChecking((now) => [...now, sessionId])
    const result = await act("excalidraw.check", { id: sessionId })
    setChecking((now) => now.filter((entry) => entry !== sessionId))
    if (result) setChecks((now) => ({ ...now, [sessionId]: result }))
  }
  const remove = async () => {
    if (selected && (await act("excalidraw.remove", { id: selected.id }))) {
      read.reload()
      close()
    }
  }
  if (!read.data && read.error) return <ErrorState message={`Could not load sessions. ${read.error}`} onRetry={read.reload} />
  if (read.data && sessions.length === 0) return <ExcalidrawEmpty onChanged={read.reload} />
  const list = (
    <>
      <PaneHeader title={LIST_TITLE} count={read.data ? `${sessions.length}/${MAX_SESSIONS}` : undefined} />
      {read.data ? (
        <SessionList sessions={sessions} checks={checks} checking={checking} selectedId={id} onSelect={select} />
      ) : (
        <ListSkeleton />
      )}
    </>
  )
  const detail = selected ? (
    <SessionDetail
      session={selected}
      check={checks[selected.id]}
      checking={checking.includes(selected.id)}
      onCheck={() => void check(selected.id)}
      onChanged={read.reload}
      onRemove={() => void remove()}
    />
  ) : wide && read.data ? (
    <Overview count={sessions.length} onChanged={read.reload} />
  ) : null
  return (
    <SplitPane
      wide={wide}
      list={list}
      detail={detail}
      open={selected !== undefined}
      onClose={close}
      hint="Select a session to see its link and agents."
      describe="Session detail"
    />
  )
}
