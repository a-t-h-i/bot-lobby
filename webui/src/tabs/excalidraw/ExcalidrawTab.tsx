/**
 * The Excalidraw page: the shared sessions on the left with their
 * check mark, name, masked link and agent count, and the selected session's
 * link (masked until revealed), its draw state, the last check and the agent
 * checklist on the right (a Sheet below 1024 px). `#/excalidraw/<id>` selects a
 * session; the list is read again on every `excalidraw` topic change. The board
 * is never embedded: `Open board` leaves for Excalidraw in a new tab.
 */
import { useState } from "react"
import type { ExcalidrawCheck } from "@protocol"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { act } from "@/lib/act"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { AddForms, SessionDetail } from "./SessionDetail"
import { SessionList } from "./SessionList"
import { EMPTY_ADD, EMPTY_HEADLINE, EMPTY_LIMIT, EMPTY_NEW, LIST_TITLE, MAX_SESSIONS } from "./words"

const close = () => go(tabHash("excalidraw"))
const select = (id: string) => go(tabHash("excalidraw", id))

function ExcalidrawEmpty({ onChanged }: { onChanged: () => void }) {
  return (
    <Empty className="glass m-4 flex-1 border">
      <EmptyHeader>
        <EmptyTitle>{EMPTY_HEADLINE}</EmptyTitle>
        <EmptyDescription className="font-mono">{EMPTY_ADD}</EmptyDescription>
        <EmptyDescription className="font-mono">{EMPTY_NEW}</EmptyDescription>
        <EmptyDescription>{EMPTY_LIMIT}</EmptyDescription>
      </EmptyHeader>
      <div className="flex w-full max-w-md flex-col gap-4 text-left">
        <AddForms onChanged={onChanged} />
      </div>
    </Empty>
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
