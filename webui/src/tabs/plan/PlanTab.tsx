/**
 * The Plan tab: the seating intro before a session, then the panel's
 * conversation across the page, like the Lobby's; once there is a draft, the
 * "View plan" bubble above the composer (or V) opens it in a slide-out; the
 * round, the seats and the session's actions sit in a rail at the right. The floating box
 * sends to the panel (its Panel target). The session is read again on every
 * `planner` topic change; the panel's questions arrive through the prompt
 * slideout, started by Answer questions. Line comments are remembered here
 * only (the snapshot does not carry them) and go with the session.
 */
import { useCallback, useRef, useState } from "react"
import { useOfferViewPlan } from "@/lib/composerBubbles"
import { ArrowDown, Route } from "lucide-react"
import { KeyHint } from "@/components/ui/kbd"
import { useHotkey } from "@/lib/hotkeys"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import type { PlannerSnapshot } from "@protocol"
import { PanelConversation } from "./Conversation"
import { PlanFailure, PlanRail } from "./Header"
import { PlanSheet } from "./PlanSheet"
import { PreviousPlans } from "./Previous"
import { INTRO_LEAD, PLAN_STEPS, isFresh, seatCells, seatedCount } from "./words"
import { ScrollHints } from "@/ui/ScrollHints"

import { useStickToBottom } from "@/lib/useStickToBottom"

type Comments = ReadonlyMap<string, string[]>

/**
 * Before anyone speaks: what planning is, how a plan comes together and
 * where to start; the panel's seats are already in the side rail, as during
 * a session, where they can be filled or left empty.
 */
function Intro({ snap, onDone }: { snap: PlannerSnapshot; onDone: () => void }) {
  const cells = seatCells(snap)
  const pane = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={pane} className="cs-scroll pb-dock">
        <div className="cs-pg cs-intro">
          <header className="cs-ih">
            <div className="cs-ic">
              <span aria-hidden="true" className="cs-ico"><Route className="size-5" /></span>
              <div>
                <h2>Plan with the panel</h2>
                <p>{INTRO_LEAD}</p>
              </div>
            </div>
          </header>
          <p className="cs-ipanel">
            {seatedCount(cells)}{snap.limit > 0 ? ` · up to ${snap.limit} rounds, the last the oracle's` : ""}. Click a seat in the rail at the right to leave it out of this plan.
          </p>

          <section aria-labelledby="plan-steps">
            <h3 id="plan-steps" className="cs-rl">How a plan comes together</h3>
            <ol className="cs-stepg">
              {PLAN_STEPS.map((step, index) => (
                <li key={step.title}>
                  <span aria-hidden="true" className="cs-no">{index + 1}</span>
                  <span className="min-w-0">
                    <b>{step.title}</b>
                    <span>{step.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <p className="cs-starth">
            <ArrowDown aria-hidden="true" className="size-4" />
            Start in the box below.
            <KeyHint chord="/">write</KeyHint>
            <KeyHint chord="Enter">send to the panel</KeyHint>
          </p>
        </div>
      </div>
      <ScrollHints target={pane} />
      <PlanRail snap={snap} onDone={onDone} />
    </>
  )
}

/** The one way to the draft (V, or "View plan" above the composer). */
function useViewPlanBubble(snap: PlannerSnapshot, onOpen: () => void) {
  const open = useRef(onOpen)
  open.current = onOpen
  const view = useCallback(() => open.current(), [])
  useHotkey("v", view, { enabled: Boolean(snap.draft) })
  useOfferViewPlan(snap.draft ? view : undefined)
}

function Session({ snap, reload }: { snap: PlannerSnapshot; reload: () => void }) {
  const [viewing, setViewing] = useState(false)
  const [comments, setComments] = useState<Comments>(new Map())
  useViewPlanBubble(snap, () => setViewing(true))
  const remember = (at: string, text: string) => setComments((now) => new Map(now).set(at, [...(now.get(at) ?? []), text]))
  const { ref, onScroll } = useStickToBottom(`${JSON.stringify(snap.messages)}${snap.busy}`)
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={ref} onScroll={onScroll} className="cs-thread min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 pb-dock">
        <PlanFailure snap={snap} />
        <PanelConversation messages={snap.messages} busy={snap.busy} />
      </div>
      <ScrollHints target={ref} />
      <PlanRail snap={snap} onDone={reload} />
      <PlanSheet open={viewing} onClose={() => setViewing(false)} snap={snap} comments={comments} onSent={remember} />
    </div>
  )
}

export function PlanTab({ rest = [] }: { rest?: string[] }) {
  if (rest[0] === "previous") return <PreviousPlans id={rest[1]} />
  return <CurrentPlan />
}

function CurrentPlan() {
  const read = useApiRead("planner.get", {}, ["planner"])
  const snap = read.data
  if (!snap && read.error) return <ErrorState message={`Could not load the plan. ${read.error}`} onRetry={read.reload} />
  if (!snap) return <p role="status" className="p-5 text-sm text-muted-foreground">Loading the plan…</p>
  const fresh = isFresh(snap)
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {fresh ? <Intro snap={snap} onDone={read.reload} /> : <Session snap={snap} reload={read.reload} />}
    </div>
  )
}
