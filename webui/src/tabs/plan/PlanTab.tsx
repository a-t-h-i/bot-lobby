/**
 * The Plan tab: the seating intro before a session, then the panel's
 * conversation beside the draft plan (stacked below 1024 px); the floating box
 * sends to the panel (its Panel target). The session is read again on every
 * `planner` topic change; the panel's questions arrive through the prompt
 * slideout, started by Answer questions. Line comments are remembered here
 * only (the snapshot does not carry them) and go with the session.
 */
import { useState } from "react"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { cn } from "@/lib/utils"
import type { PlannerSnapshot } from "@protocol"
import { Pane, useWide } from "@/ui/SplitPane"
import { PanelConversation } from "./Conversation"
import { DraftBody, SeatNeeds } from "./Draft"
import { PlanHeader } from "./Header"
import { LineComment } from "./LineComment"
import { Roster } from "./Roster"
import { DRAFT_WAITS, NO_DRAFT, introText, isFresh, seatCells } from "./words"
import { Rule } from "@/ui/Frame"

import { useStickToBottom } from "@/lib/useStickToBottom"

type Comments = ReadonlyMap<string, string[]>

function Intro({ snap, onDone }: { snap: PlannerSnapshot; onDone: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6 sm:p-10">
      <h2 className="text-xl font-semibold tracking-tight">Plan</h2>
      <p className="text-sm text-muted-foreground">{introText(snap.limit)}</p>
      <Roster cells={seatCells(snap)} intro onToggled={onDone} />
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
      <div ref={ref} onScroll={onScroll} className={cn("min-h-0 overflow-y-auto", wide ? "flex-1 px-5 pt-5 pb-dock" : "max-h-[45svh] p-5")}>
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
      <div className={cn("flex min-h-0 flex-col gap-5 overflow-y-auto px-5 pt-5 pb-dock", wide && "flex-1")}>
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
