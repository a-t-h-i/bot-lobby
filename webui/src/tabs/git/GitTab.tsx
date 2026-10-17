/**
 * The Git page: the open pull requests on the left with their
 * checks, draft mark, review outcome and size, and the selected pull's facts,
 * review, Jev's read, files, description and comments on the right (a Sheet
 * below 1024 px). A Pull requests / Issues switch heads the list: `#/git/issues`
 * and `#/git/issues/<number>` show the issues (see IssuesTab), `#/git/<number>`
 * selects a pull request; the list is read
 * again on every `git` topic change, which also carries a running review's
 * steps. Nothing here is ever posted to GitHub.
 */
import { useCallback, type ReactNode } from "react"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { RefreshCw, GitPullRequest } from "lucide-react"
import { ActionButton } from "@/ui/Actions"
import { Segmented } from "@/ui/Segmented"
import { Button } from "@/components/ui/button"
import { Empty, EmptyMedia, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { act } from "@/lib/act"
import { cn } from "@/lib/utils"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { PullDetail } from "./PullDetail"
import { PullList } from "./PullList"
import { EMPTY_LIST, LIST_TITLE, LOADING_LIST, NOT_LOADED } from "./words"
import { IssuesView, useIssues, type IssuesRead } from "../issues/IssuesTab"
import { LIST_TITLE as ISSUES_TITLE } from "../issues/words"

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
    <Empty className="m-4 flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitPullRequest aria-hidden="true" />
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

type View = "pulls" | "issues"
const VIEWS: Array<{ id: View; label: string; hash: string }> = [
  { id: "pulls", label: LIST_TITLE, hash: tabHash("git") },
  { id: "issues", label: ISSUES_TITLE, hash: tabHash("git", "issues") },
]

/** The Pull requests / Issues switch: route-driven, arrow keys move between the two. */
function ViewSwitch({ view }: { view: View }) {
  return <Segmented label="Show" items={VIEWS} value={view} idPrefix="git-view" onChange={(id) => go(VIEWS.find((item) => item.id === id)!.hash)} />
}

/** One R for the page: both lists refresh on their own, so one failing never holds up the other. */
function useRefresh(pulls: { reload: () => void }, issues: IssuesRead) {
  return useCallback(() => {
    void act("git.pulls", { refresh: true }).then(() => pulls.reload())
    if (issues.enabled) void act("issues.list", { refresh: true }).then(() => issues.read.reload())
  }, [pulls, issues])
}

function Header({ view, count, busy, refresh }: { view: View; count?: string; busy: boolean; refresh: () => void }) {
  return (
    <PaneHeader title={view === "issues" ? ISSUES_TITLE : LIST_TITLE} count={count} lead={<ViewSwitch view={view} />}>
      <ActionButton label="Refresh" icon={RefreshCw} iconOnly shortcut="R" disabled={busy} className={cn("size-7", busy && "[&_svg]:animate-spin")} onClick={refresh} />
    </PaneHeader>
  )
}

function PullsView({ read, rest, top }: { read: ReturnType<typeof usePulls>; rest: readonly string[]; top: ReactNode }) {
  const wide = useWide()
  const id = pullNumber(rest)
  const pulls = read.data?.pulls ?? []
  if (!read.data && read.error) return <>{top}<ErrorState message={`Could not load pull requests. ${read.error}`} onRetry={read.reload} /></>
  if (read.data && pulls.length === 0) return <>{top}<NoPulls loading={read.data.loading} loaded={read.data.loaded} error={read.data.error} onRetry={read.reload} /></>
  const list = (
    <>
      {top}
      {read.data?.error ? <p className="px-3 pt-2 text-sm text-destructive">✗ {read.data.error}</p> : null}
      {read.data ? <PullList pulls={pulls} selectedId={id} onSelect={select} /> : <ListSkeleton />}
    </>
  )
  const detail = id !== undefined ? <PullDetail key={id} number={id} onChanged={read.reload} /> : null
  return <SplitPane wide={wide} list={list} detail={detail} open={id !== undefined} onClose={close} hint="Select a pull request to see its detail." describe="Pull request detail" />
}

const usePulls = () => useApiRead("git.pulls", {}, ["git"])

function headerFacts(view: View, pulls: ReturnType<typeof usePulls>, issues: IssuesRead) {
  const read = view === "issues" ? issues.read : pulls
  const items = view === "issues" ? issues.read.data?.issues : pulls.data?.pulls
  const busy = pulls.loading || Boolean(pulls.data?.loading) || (issues.enabled && (issues.read.loading || Boolean(issues.read.data?.loading)))
  const count = items && (view === "pulls" || issues.enabled) ? `${items.length} open` : undefined
  return { busy: busy || read.loading, count }
}

export function GitTab({ rest }: { rest: readonly string[] }) {
  const pulls = usePulls()
  const issues = useIssues()
  const refresh = useRefresh(pulls, issues)
  const view: View = rest[0] === "issues" ? "issues" : "pulls"
  const { busy, count } = headerFacts(view, pulls, issues)
  const top = <Header view={view} count={count} busy={busy} refresh={refresh} />
  const body = view === "issues"
    ? <IssuesView issues={issues} rest={rest.slice(1)} top={top} />
    : <PullsView read={pulls} rest={rest} top={top} />
  return <div className="flex min-h-0 flex-1 flex-col">{body}</div>
}
