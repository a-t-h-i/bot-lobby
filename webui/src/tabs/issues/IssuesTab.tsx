/**
 * The Issues page: the open issues on the left, the selected
 * one's body and comments on the right (a Sheet below 1024 px), and the box
 * that files a new one underneath. `#/issues/<number>` selects an issue; the
 * list is read again on every `issues` topic change. With `lobby.issues` off
 * the server refuses every call and the page says so.
 */
import { useCallback } from "react"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useTopic } from "@/app/hooks"
import { useApiRead } from "@/app/useApiRead"
import { RefreshCw } from "lucide-react"
import { ActionButton } from "@/ui/Actions"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { act } from "@/lib/act"
import { NoteForm } from "@/ui/NoteForm"
import { ListSkeleton, Pane, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import type { StatusInfo } from "@protocol"
import { IssueDetail } from "./IssueDetail"
import { IssueList } from "./IssueList"
import { EMPTY_LIST, LIST_TITLE, LOADING_LIST, NOT_LOADED, OFF } from "./words"

const close = () => go(tabHash("issues"))
const select = (number: number) => go(tabHash("issues", String(number)))

/** `rest[0]` as an issue number; anything non-numeric means the list. */
export function issueNumber(rest: readonly string[]): number | undefined {
  const value = Number(rest[0])
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function IssuesOff() {
  return (
    <Empty className="glass m-4 flex-1 border">
      <EmptyHeader>
        <EmptyTitle>Issues are off</EmptyTitle>
        <EmptyDescription className="font-mono">{OFF}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function NoIssues({ loading, loaded, error, onRetry }: { loading: boolean; loaded: boolean; error?: string; onRetry: () => void }) {
  const text = error ? `✗ ${error}` : loaded ? EMPTY_LIST : loading ? LOADING_LIST : NOT_LOADED
  return (
    <Empty className="glass m-4 flex-1 border">
      <EmptyHeader>
        <EmptyDescription className={error ? "text-destructive" : undefined}>{text}</EmptyDescription>
      </EmptyHeader>
      {error ? (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </Empty>
  )
}

function CreateBox({ onCreate }: { onCreate: (text: string) => Promise<boolean> }) {
  return (
    <Pane className="mx-4 mb-4 shrink-0 p-3">
      <NoteForm
        label="New issue"
        hint="The first line becomes the title; the rest is the body. Enter files it."
        buttonLabel="File issue"
        onSend={onCreate}
      />
    </Pane>
  )
}

export function IssuesTab({ rest }: { rest: readonly string[] }) {
  const wide = useWide()
  const enabled = useTopic<StatusInfo>("status").data?.issuesEnabled ?? true
  const read = useApiRead("issues.list", {}, ["issues"], enabled)
  const id = issueNumber(rest)
  const issues = read.data?.issues ?? []
  const now = Date.now()
  const refresh = useCallback(() => {
    void act("issues.list", { refresh: true }).then(() => read.reload())
  }, [read])
  const create = async (text: string) => {
    const result = await act("issues.create", { text })
    if (!result) return false
    read.reload()
    return true
  }
  if (!enabled) return <IssuesOff />
  if (!read.data && read.error) {
    return read.error.includes("issues are off") ? <IssuesOff /> : <ErrorState message={`Could not load issues. ${read.error}`} onRetry={read.reload} />
  }
  const busy = read.loading || Boolean(read.data?.loading)
  const list = (
    <>
      <PaneHeader title={LIST_TITLE} count={read.data ? `${issues.length} open` : undefined}>
        <ActionButton label="Refresh" icon={RefreshCw} disabled={busy} className={busy ? "[&_svg]:animate-spin" : undefined} onClick={refresh} />
      </PaneHeader>
      {read.data?.error ? <p className="px-3 pt-2 text-sm text-destructive">✗ {read.data.error}</p> : null}
      {read.data ? <IssueList issues={issues} selectedId={id} now={now} onSelect={select} /> : <ListSkeleton />}
    </>
  )
  const detail = id !== undefined ? <IssueDetail key={id} number={id} /> : null
  const body = read.data && issues.length === 0
    ? <NoIssues loading={read.data.loading} loaded={read.data.loaded} error={read.data.error} onRetry={read.reload} />
    : <SplitPane wide={wide} list={list} detail={detail} open={id !== undefined} onClose={close} hint="Select an issue to read it." describe="Issue detail" />
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {body}
      <CreateBox onCreate={create} />
    </div>
  )
}
