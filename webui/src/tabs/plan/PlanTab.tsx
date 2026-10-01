/**
 * The Plan tab (batch-2 §g): the seating intro before a session, then the
 * panel's conversation beside the draft plan (stacked below 1024 px), with a
 * box that sends to the panel underneath. The session is read again on every
 * `planner` topic change; the panel's questions arrive through the prompt
 * slideout, started by Answer questions. Line comments are remembered here
 * only (the snapshot does not carry them) and go with the session.
 */
import { useEffect, useRef, useState } from "react"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { act } from "@/lib/act"
import { cn } from "@/lib/utils"
import type { PlannerSnapshot } from "@protocol"
import { NoteForm } from "@/ui/NoteForm"
import { Pane, useWide } from "@/ui/SplitPane"
import { PanelConversation } from "./Conversation"
import { DraftBody, SeatNeeds } from "./Draft"
import { PlanHeader } from "./Header"
import { LineComment } from "./LineComment"
import { Roster } from "./Roster"
import { DRAFT_WAITS, NO_DRAFT, introText, isFresh, seatCells } from "./words"

type Comments = ReadonlyMap<string, string[]>

/** Keep a scrolling pane at its newest end as `revision` grows. */
function useFollowEnd(revision: number) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [revision])
  return ref
}

function Intro({ snap, onDone }: { snap: PlannerSnapshot; onDone: () => void }) {
  return (
    <Pane className="flex flex-col gap-4 p-4">
      <h2 className="text-base font-medium">Plan</h2>
      <p className="text-sm font-medium text-foreground">{introText(snap.limit)}</p>
      <Roster cells={seatCells(snap)} intro onToggled={onDone} />
    </Pane>
  )
}

function ConversationPane({ snap, wide }: { snap: PlannerSnapshot; wide: boolean }) {
  const ref = useFollowEnd(snap.messages.length)
  return (
    <Pane className="flex flex-col">
      <h2 className="border-b px-3 py-2 text-base font-medium">Conversation</h2>
      <div ref={ref} className={cn("min-h-0 overflow-y-auto p-4", wide ? "flex-1" : "max-h-[45svh]")}>
        <PanelConversation messages={snap.messages} />
      </div>
    </Pane>
  )
}

function DraftPane({ snap, comments, onComment }: { snap: PlannerSnapshot; comments: Comments; onComment: (line: string) => void }) {
  return (
    <Pane className="flex flex-col">
      <h2 className="border-b px-3 py-2 text-base font-medium">Draft plan</h2>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {snap.draft ? <DraftBody draft={snap.draft} comments={comments} onComment={onComment} /> : <p className="text-sm text-muted-foreground">{snap.busy ? DRAFT_WAITS : NO_DRAFT}</p>}
        <SeatNeeds notes={snap.notes} />
      </div>
    </Pane>
  )
}

function PanelBox({ fresh, onSent }: { fresh: boolean; onSent: () => void }) {
  const send = async (text: string) => {
    const result = await act("planner.send", { text })
    if (result) onSent()
    return result !== undefined
  }
  return (
    <Pane className="shrink-0 p-3">
      <NoteForm label={fresh ? "Describe a task" : "Message the panel"} hint="Enter sends · Shift+Enter adds a line" buttonLabel="Send to the panel" onSend={send} />
    </Pane>
  )
}

function Session({ snap, reload }: { snap: PlannerSnapshot; reload: () => void }) {
  const wide = useWide()
  const [line, setLine] = useState<string>()
  const [comments, setComments] = useState<Comments>(new Map())
  const remember = (at: string, text: string) => setComments((now) => new Map(now).set(at, [...(now.get(at) ?? []), text]))
  const grid = wide ? "grid min-h-0 flex-1 grid-cols-[minmax(0,46fr)_minmax(0,54fr)] grid-rows-[minmax(0,1fr)] gap-3" : "flex flex-col gap-3"
  return (
    <>
      <PlanHeader snap={snap} onDone={reload} />
      <div className={grid}>
        <ConversationPane snap={snap} wide={wide} />
        <DraftPane snap={snap} comments={comments} onComment={setLine} />
      </div>
      <LineComment line={line} onClose={() => setLine(undefined)} onSent={remember} />
    </>
  )
}

export function PlanTab() {
  const read = useApiRead("planner.get", {}, ["planner"])
  const snap = read.data
  if (!snap && read.error) return <ErrorState message={`Could not load the plan. ${read.error}`} onRetry={read.reload} />
  if (!snap) return <p role="status" className="p-4 text-sm text-muted-foreground">Loading the plan…</p>
  const fresh = isFresh(snap)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      {fresh ? <Intro snap={snap} onDone={read.reload} /> : <Session snap={snap} reload={read.reload} />}
      <PanelBox fresh={fresh} onSent={read.reload} />
    </div>
  )
}
