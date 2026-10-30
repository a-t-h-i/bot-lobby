/**
 * The Plan tab's side rail, at the right of the conversation: the round
 * counter (`4/5`, the status in its tooltip), the panel's seats as icon
 * toggles in their agent's colour (dashed when off, a badge with how many
 * questions each asked), then under a hairline the session's actions as icon
 * buttons with their keys in left tooltips: Retry when a round can be run
 * again, Previous (H), Save (Ctrl+S) and New plan (N). A failed round also
 * says so in a note over the conversation.
 */
import { FilePlus, History, RotateCw, Save } from "lucide-react"
import type { CSSProperties } from "react"
import { go, tabHash } from "@/app/router"
import { act } from "@/lib/act"
import type { PlannerSnapshot, StatusInfo } from "@protocol"
import { useTopic } from "@/app/hooks"
import { ActionButton } from "@/ui/Actions"
import { AgentIcon, agentColor } from "@/ui/AgentIcon"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { sourceLabel } from "../lobby/types"
import { failure, seatCells, statusParts, type SeatCell } from "./words"

/** To the plans left behind without being saved as a task. */
export function PreviousButton({ iconOnly, className, side }: { iconOnly?: boolean; className?: string; side?: "left" }) {
  return <ActionButton label="Previous plans" text="Previous" icon={History} shortcut="H" iconOnly={iconOnly} {...(className ? { className } : {})} {...(side ? { side } : {})} onClick={() => go(tabHash("plan", "previous"))} />
}

/** A failed round, over the conversation: what went wrong and that Retry runs it again. */
export function PlanFailure({ snap }: { snap: PlannerSnapshot }) {
  if (snap.busy || failure(snap) === undefined) return null
  return <p role="status" className="cs-note mx-auto mb-4 max-w-[48.75rem] text-[var(--bad)]">{statusParts(snap).join(" · ")}</p>
}

function Seat({ cell, asked, onToggled }: { cell: SeatCell; asked: number; onToggled: () => void }) {
  const name = sourceLabel(cell.label)
  const state = cell.member ? (cell.seated ? `${name} sits on the panel` : `${name} sits this one out`) : `${name} chairs the panel`
  const tip = `${state}${cell.text && cell.text !== "·" && cell.text !== "off" ? ` · ${cell.text}` : ""}${cell.member ? " · click to toggle" : ""}`
  const toggle = async () => {
    if (cell.member && (await act("planner.toggleSeat", { member: cell.member }))) onToggled()
  }
  return (
    <li>
      <button
        type="button"
        className="cs-sq cs-tipl"
        data-tip={tip}
        aria-label={tip}
        aria-pressed={cell.member ? cell.seated : undefined}
        data-on={cell.seated ? "true" : "false"}
        data-fixed={cell.member ? undefined : "true"}
        data-working={cell.working ? "true" : undefined}
        style={{ "--c": agentColor(cell.label) } as CSSProperties}
        onClick={cell.member ? () => void toggle() : undefined}
      >
        <AgentIcon source={cell.label} className="size-[17px]" />
        {asked > 0 ? <span className="cs-sqn">{asked}</span> : null}
      </button>
    </li>
  )
}

export function PlanRail({ snap, onDone }: { snap: PlannerSnapshot; onDone: () => void }) {
  const shortcut = useTopic<StatusInfo>("status").data?.keys.find((key) => key.action === "savePlan")?.label
  const run = (name: "planner.retry" | "planner.save") => async () => {
    if (await act(name, {})) onDone()
  }
  const status = statusParts(snap).join(" · ") || "No rounds yet"
  const round = snap.busy ? snap.round + 1 : Math.max(snap.round, 1)
  return (
    <aside className="cs-pside" aria-label="Planning">
      {snap.limit > 0 ? (
        <span className="cs-rcnt cs-tipl" data-tip={status} role="status" aria-label={status}>
          <b>{Math.min(round, snap.limit)}</b>
          <i>/{snap.limit}</i>
        </span>
      ) : <span className="sr-only" role="status">{status}</span>}
      <ul className="cs-chips" aria-label="Panel">
        {seatCells(snap).map((cell) => (
          <Seat key={cell.label} cell={cell} asked={snap.questions.filter((question) => question.from === cell.label).length} onToggled={onDone} />
        ))}
      </ul>
      <div className="cs-sqsep" />
      <ul className="cs-chips" aria-label="Plan actions">
        {snap.retryable ? <li><ActionButton iconOnly side="left" className="cs-sq cs-act" label="Retry the round" icon={RotateCw} shortcut="R" onClick={() => void run("planner.retry")()} /></li> : null}
        <li><PreviousButton iconOnly side="left" className="cs-sq cs-act" /></li>
        <li><ActionButton iconOnly side="left" className="cs-sq cs-act" data-plan-save label="Save the plan" icon={Save} shortcut={shortcut ?? "Ctrl+S"} disabled={!snap.draft || snap.busy} onClick={() => void run("planner.save")()} /></li>
        <li>
          <ConfirmButton
            iconOnly
            side="left"
            className="cs-sq cs-act"
            icon={FilePlus}
            label="New plan"
            shortcut="N"
            title="Start a new plan?"
            description="The conversation and the draft are left behind. Saved plans are not touched."
            confirmLabel="New plan"
            onConfirm={() => void act("planner.new", {}).then(onDone)}
          />
        </li>
      </ul>
    </aside>
  )
}
