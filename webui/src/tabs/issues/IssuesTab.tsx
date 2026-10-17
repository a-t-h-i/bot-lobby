/**
 * The Issues view inside Git: the open issues on the left, the selected
 * one's body and comments on the right (a Sheet below 1024 px), and the box
 * that files a new one underneath. `#/git/issues/<number>` selects an issue; the
 * list is read again on every `issues` topic change. With `lobby.issues` off
 * the server refuses every call and the page says so.
 */
import type { ReactNode } from "react"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useTopic } from "@/app/hooks"
import { useApiRead } from "@/app/useApiRead"
import { CircleDot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyMedia, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { act } from "@/lib/act"
import { NoteForm } from "@/ui/NoteForm"
import { ListSkeleton, Pane, SplitPane, useWide } from "@/ui/SplitPane"
import type { StatusInfo } from "@protocol"
import { IssueDetail } from "./IssueDetail"
import { IssueList } from "./IssueList"
import { EMPTY_LIST, LOADING_LIST, NOT_LOADED, OFF } from "./words"

const close = () => go(tabHash("git", "issues"))
const select = (number: number) => go(tabHash("git", "issues", String(number)))

/** `rest[0]` as an issue number; anything non-numeric means the list. */
export function issueNumber(rest: readonly string[]): number | undefined {
  const value = Number(rest[0])
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function IssuesOff() {
  return (
    <Empty className="m-4 flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleDot aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Issues are off</EmptyTitle>
        <EmptyDescription className="font-mono">{OFF}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function NoIssues({ loading, loaded, error, onRetry }: { loading: boolean; loaded: boolean; error?: string; onRetry: () => void }) {
  const text = error ? `✗ ${error}` : loaded ? EMPTY_LIST : loading ? LOADING_LIST : NOT_LOADED
  return (
    <Empty className="m-4 flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleDot aria-hidden="true" />
        </EmptyMedia>
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
    <Pane className="shrink-0 border-t border-border p-4">
      <NoteForm
        label="New issue"
        hint="The first line becomes the title; the rest is the body. Enter files it."
        buttonLabel="File issue"
        onSend={onCreate}
      />
    </Pane>
  )
}

export type IssuesRead = ReturnType<typeof useIssues>

/** The issue list read, never sent while `lobby.issues` is off. */
export function useIssues() {
  const enabled = useTopic<StatusInfo>("status").data?.issuesEnabled ?? true
  const read = useApiRead("issues.list", {}, ["issues"], enabled)
  return { enabled, read }
}

function issuesProblem({ enabled, read }: IssuesRead): ReactNode {
  if (!enabled || read.error?.includes("issues are off")) return <IssuesOff />
  if (!read.data && read.error) return <ErrorState message={`Could not load issues. ${read.error}`} onRetry={read.reload} />
  return null
}

/** The Issues half of the Git page: `rest` is what follows `#/git/issues`. */
export function IssuesView({ issues: state, rest, top }: { issues: IssuesRead; rest: readonly string[]; top: ReactNode }) {
  const wide = useWide()
  const { read } = state
  const id = issueNumber(rest)
  const issues = read.data?.issues ?? []
  const create = async (text: string) => {
    if (!(await act("issues.create", { text }))) return false
    read.reload()
    return true
  }
  const problem = issuesProblem(state)
  if (problem) return <>{top}{problem}</>
  if (read.data && issues.length === 0) {
    return <>{top}<NoIssues loading={read.data.loading} loaded={read.data.loaded} error={read.data.error} onRetry={read.reload} /><div className="shrink-0 pb-dock"><CreateBox onCreate={create} /></div></>
  }
  const list = (
    <>
      {top}
      {read.data?.error ? <p className="px-3 pt-2 text-sm text-destructive">✗ {read.data.error}</p> : null}
      {read.data ? <IssueList issues={issues} selectedId={id} now={Date.now()} onSelect={select} /> : <ListSkeleton />}
      <CreateBox onCreate={create} />
    </>
  )
  const detail = id !== undefined ? <IssueDetail key={id} number={id} /> : null
  return <SplitPane wide={wide} list={list} detail={detail} open={id !== undefined} onClose={close} hint="Select an issue to read it." describe="Issue detail" />
}
