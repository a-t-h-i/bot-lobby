/**
 * The Quick fix tab (batch-2 §h): jobs newest first beside the selected job's
 * steps and report (a Sheet below 1024 px), with the box that submits a new
 * one underneath. `#/quickfix/<id>` selects a job; the list is read again on
 * every `quickfix` topic change, which is also how running steps arrive.
 */
import { useEffect, useState } from "react"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { JobDetail } from "./JobDetail"
import { JobList } from "./JobList"
import { SubmitBox } from "./SubmitBox"
import { INTRO, newestFirst } from "./words"

const close = () => go(tabHash("quickfix"))
const select = (id: string) => go(tabHash("quickfix", id))

/** The clock for running jobs' elapsed time; ticks once a second only while one runs. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return active ? now : Date.now()
}

function Intro() {
  return (
    <Empty className="m-4 flex-1 border border-border bg-card">
      <EmptyHeader>
        <EmptyDescription className="font-medium text-foreground">{INTRO}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function QuickfixTab({ id }: { id?: string }) {
  const wide = useWide()
  const read = useApiRead("quickfix.list", {}, ["quickfix"])
  const jobs = newestFirst(read.data?.jobs ?? [])
  const now = useNow(jobs.some((job) => job.status === "running"))
  if (!read.data && read.error) return <ErrorState message={`Could not load quick fixes. ${read.error}`} onRetry={read.reload} />
  const body = read.data && jobs.length === 0 ? <Intro /> : <Split id={id} wide={wide} loaded={Boolean(read.data)} jobs={jobs} now={now} />
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {body}
      <SubmitBox onSent={read.reload} />
    </div>
  )
}

function Split({ id, wide, loaded, jobs, now }: { id?: string; wide: boolean; loaded: boolean; jobs: ReturnType<typeof newestFirst>; now: number }) {
  const chosen = id ?? (wide ? jobs[0]?.id : undefined)
  const job = jobs.find((entry) => entry.id === chosen)
  const list = (
    <>
      <PaneHeader title="Quick fixes" count={String(jobs.length)} />
      {loaded ? <JobList jobs={jobs} selectedId={chosen} now={now} onSelect={select} /> : <ListSkeleton />}
    </>
  )
  const missing = id ? <p className="text-sm text-muted-foreground">That quick fix is not on the list any more.</p> : null
  const detail = job ? <JobDetail job={job} now={now} /> : missing
  return <SplitPane wide={wide} list={list} detail={detail} open={Boolean(id)} onClose={close} hint="Select a quick fix to see its steps." describe="Quick fix detail" />
}
