/**
 * The Plan tab: the seating intro before a session, then the panel's
 * conversation beside the draft plan (stacked below 1024 px); the floating box
 * sends to the panel (its Panel target). The session is read again on every
 * `planner` topic change; the panel's questions arrive through the prompt
 * slideout, started by Answer questions. Line comments are remembered here
 * only (the snapshot does not carry them) and go with the session.
 */
import { useState } from "react"
import { ArrowDown, Route } from "lucide-react"
import { KeyHint } from "@/components/ui/kbd"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { cn } from "@/lib/utils"
import type { PlannerSnapshot } from "@protocol"
import { Pane, useWide } from "@/ui/SplitPane"
import { PanelConversation } from "./Conversation"
import { DraftBody, SeatNeeds } from "./Draft"
import { PlanHeader } from "./Header"
import { LineComment } from "./LineComment"
import { Seats } from "./Roster"
import { DRAFT_WAITS, INTRO_LEAD, NO_DRAFT, PLAN_STEPS, isFresh, seatCells, seatedCount } from "./words"
import { Rule } from "@/ui/Frame"

import { useStickToBottom } from "@/lib/useStickToBottom"

type Comments = ReadonlyMap<string, string[]>

/** The rounds the panel has, the last one the oracle's. */
function Rounds({ limit }: { limit: number }) {
  if (limit <= 0) return null
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className="flex gap-1">
        {Array.from({ length: limit }, (_, round) => (
          <span key={round} className={cn("h-1.5 w-4 rounded-full", round === limit - 1 ? "bg-primary" : "bg-border")} />
        ))}
      </span>
      <span>
        up to {limit} rounds, the last the oracle's
      </span>
    </span>
  )
}

/**
 * Before anyone speaks: what planning is, the panel as seats you can fill or
 * leave empty, how a plan comes together, and where to start.
 */
function Intro({ snap, onDone }: { snap: PlannerSnapshot; onDone: () => void }) {
  const cells = seatCells(snap)
  return (
    <div className="@container flex-1 overflow-y-auto px-5 pt-8 pb-dock sm:px-8 sm:pt-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 @3xl:flex-row @3xl:items-end @3xl:justify-between">
          <div className="flex items-start gap-4">
            <span aria-hidden="true" className="card-raised grid size-11 shrink-0 place-items-center rounded-xl border text-primary">
              <Route className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold tracking-tight">Plan with the panel</h2>
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{INTRO_LEAD}</p>
            </div>
          </div>
          <Rounds limit={snap.limit} />
        </header>

        <section aria-labelledby="plan-panel" className="flex flex-col gap-3">
          <h3 id="plan-panel" className="text-xs text-muted-foreground">
            <Rule title="The panel" right={seatedCount(cells)} />
          </h3>
          <Seats cells={cells} onToggled={onDone} />
        </section>

        <section aria-labelledby="plan-steps" className="flex flex-col gap-3">
          <h3 id="plan-steps" className="text-xs text-muted-foreground">
            <Rule title="How a plan comes together" />
          </h3>
          <ol className="grid gap-3 @2xl:grid-cols-2 @4xl:grid-cols-4">
            {PLAN_STEPS.map((step, index) => (
              <li key={step.title} className="card-raised relative flex gap-3 rounded-xl border p-3.5">
                <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-primary tabular-nums">
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{step.title}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <ArrowDown aria-hidden="true" className="size-4 text-primary motion-safe:animate-bounce" />
          Start in the box below.
          <KeyHint chord="/">write</KeyHint>
          <KeyHint chord="Enter">send to the panel</KeyHint>
        </p>
      </div>
    </div>
  )
}

function ConversationPane({ snap, wide }: { snap: PlannerSnapshot; wide: boolean }) {
  const { ref, onScroll } = useStickToBottom(JSON.stringify(snap.messages))
  return (
    <Pane className="flex flex-col">
      <h2 className="flex min-h-12 shrink-0 items-center border-b border-border px-4 text-sm font-medium">
        <Rule title="Conversation" className="w-full" />
      </h2>
      <div ref={ref} onScroll={onScroll} className={cn("min-h-0 overflow-y-auto overscroll-y-contain", wide ? "flex-1 px-5 pt-5 pb-dock" : "max-h-[45svh] p-5")}>
        <PanelConversation messages={snap.messages} busy={snap.busy} />
      </div>
    </Pane>
  )
}

function DraftPane({ snap, comments, onComment, wide }: { snap: PlannerSnapshot; comments: Comments; onComment: (line: string) => void; wide: boolean }) {
  return (
    <Pane className="flex flex-col">
      <h2 className="flex min-h-12 shrink-0 items-center border-b border-border px-4 text-sm font-medium">
        <Rule title="Draft plan" className="w-full" />
      </h2>
      <div className={cn("flex min-h-0 flex-col gap-5 overflow-y-auto overscroll-y-contain px-5 pt-5 pb-dock", wide && "flex-1")}>
        {snap.draft ? <DraftBody draft={snap.draft} comments={comments} onComment={onComment} /> : <p className="text-sm text-muted-foreground">{snap.busy ? DRAFT_WAITS : NO_DRAFT}</p>}
        <SeatNeeds notes={snap.notes} />
      </div>
    </Pane>
  )
}

function Session({ snap, reload }: { snap: PlannerSnapshot; reload: () => void }) {
  const wide = useWide()
  const [line, setLine] = useState<string>()
  const [comments, setComments] = useState<Comments>(new Map())
  const remember = (at: string, text: string) => setComments((now) => new Map(now).set(at, [...(now.get(at) ?? []), text]))
  const grid = wide
    ? "grid min-h-0 flex-1 grid-cols-[minmax(0,46fr)_minmax(0,54fr)] grid-rows-[minmax(0,1fr)] divide-x divide-border"
    : "flex flex-col divide-y divide-border"
  return (
    <>
      <PlanHeader snap={snap} onDone={reload} />
      <div className={grid}>
        <ConversationPane snap={snap} wide={wide} />
        <DraftPane snap={snap} comments={comments} onComment={setLine} wide={wide} />
      </div>
      <LineComment line={line} onClose={() => setLine(undefined)} onSent={remember} />
    </>
  )
}

export function PlanTab() {
  const read = useApiRead("planner.get", {}, ["planner"])
  const snap = read.data
  if (!snap && read.error) return <ErrorState message={`Could not load the plan. ${read.error}`} onRetry={read.reload} />
  if (!snap) return <p role="status" className="p-5 text-sm text-muted-foreground">Loading the plan…</p>
  const fresh = isFresh(snap)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {fresh ? <Intro snap={snap} onDone={read.reload} /> : <Session snap={snap} reload={read.reload} />}
    </div>
  )
}
