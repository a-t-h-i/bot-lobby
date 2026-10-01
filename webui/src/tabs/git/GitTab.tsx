/**
 * The Git page (batch-2 §k): the open pull requests on the left with their
 * checks, draft mark, review outcome and size, and the selected pull's facts,
 * review, Jev's read, files, description and comments on the right (a Sheet
 * below 1024 px). `#/git/<number>` selects a pull request; the list is read
 * again on every `git` topic change, which also carries a running review's
 * steps. Nothing here is ever posted to GitHub.
 */
import { useCallback } from "react"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { act } from "@/lib/act"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { PullDetail } from "./PullDetail"
import { PullList } from "./PullList"
import { EMPTY_LIST, LIST_TITLE, LOADING_LIST, NOT_LOADED } from "./words"

const close = () => go(tabHash("git"))
const select = (number: number) => go(tabHash("git", String(number)))

/** `rest[0]` as a pull request number; anything non-numeric means the list. */
export function pullNumber(rest: readonly string[]): number | undefined {
  const value = Number(rest[0])
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function NoPulls({ loading, loaded, error, onRetry }: { loading: boolean; loaded: boolean; error?: string; onRetry: () => void }) {
  const text = error ? `✗ ${error}` : loaded ? EMPTY_LIST : loading ? LOADING_LIST : NOT_LOADED
  return (
    <Empty className="m-4 flex-1 border border-border bg-card">
      <EmptyHeader>
        <EmptyDescription className={error ? "text-destructive" : undefined}>{text}</EmptyDescription>
      </EmptyHeader>
      {error ? (
        <Button variant="outline" className="h-10" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </Empty>
  )
}

export function GitTab({ rest }: { rest: readonly string[] }) {
  const wide = useWide()
  const read = useApiRead("git.pulls", {}, ["git"])
  const id = pullNumber(rest)
  const pulls = read.data?.pulls ?? []
  const refresh = useCallback(() => {
    void act("git.pulls", { refresh: true }).then(() => read.reload())
  }, [read])
  if (!read.data && read.error) return <ErrorState message={`Could not load pull requests. ${read.error}`} onRetry={read.reload} />
  if (read.data && pulls.length === 0) return <NoPulls loading={read.data.loading} loaded={read.data.loaded} error={read.data.error} onRetry={read.reload} />
  const busy = read.loading || Boolean(read.data?.loading)
  const list = (
    <>
      <PaneHeader title={LIST_TITLE} count={read.data ? `${pulls.length} open` : undefined}>
        <Button variant="outline" className="h-10" disabled={busy} onClick={refresh}>
          {busy ? <Spinner className="size-3.5" /> : null}
          Refresh
        </Button>
      </PaneHeader>
      {read.data?.error ? <p className="px-3 pt-2 text-sm text-destructive">✗ {read.data.error}</p> : null}
      {read.data ? <PullList pulls={pulls} selectedId={id} onSelect={select} /> : <ListSkeleton />}
    </>
  )
  const detail = id !== undefined ? <PullDetail key={id} number={id} onChanged={read.reload} /> : null
  return (
    <SplitPane wide={wide} list={list} detail={detail} open={id !== undefined} onClose={close} hint="Select a pull request to see its detail." describe="Pull request detail" />
  )
}
