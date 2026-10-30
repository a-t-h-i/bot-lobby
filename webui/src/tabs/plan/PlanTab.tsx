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
import { PlanFailure, PlanRail, PreviousButton } from "./Header"
import { PlanSheet } from "./PlanSheet"
import { PreviousPlans } from "./Previous"
import { Seats } from "./Roster"
import { INTRO_LEAD, PLAN_STEPS, isFresh, seatCells, seatedCount } from "./words"
import { ScrollHints } from "@/ui/ScrollHints"

import { useStickToBottom } from "@/lib/useStickToBottom"

type Comments = ReadonlyMap<string, string[]>

/** The rounds the panel has, the last one the oracle's. */
function Rounds({ limit }: { limit: number }) {
  if (limit <= 0) return null
  return (
    <span className="cs-rounds">
      <span aria-hidden="true" className="cs-bars">
        {Array.from({ length: limit }, (_, round) => <i key={round} data-last={round === limit - 1 || undefined} />)}
      </span>
      <span>up to {limit} rounds, the last the oracle's</span>
    </span>
  )
}

/**
 * Before anyone speaks: what planning is, the panel as seats you can fill or
 * leave empty, how a plan comes together, and where to start.
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
            <div className="cs-ir">
              <PreviousButton />
              <Rounds limit={snap.limit} />
            </div>
          </header>

          <section aria-labelledby="plan-panel">
            <h3 id="plan-panel" className="cs-rl">The panel<span className="cs-rr">{seatedCount(cells)}</span></h3>
            <Seats cells={cells} onToggled={onDone} />
          </section>

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
    <div className="flex min-h-0 flex-1 flex-col">
      {fresh ? <Intro snap={snap} onDone={read.reload} /> : <Session snap={snap} reload={read.reload} />}
    </div>
  )
}
