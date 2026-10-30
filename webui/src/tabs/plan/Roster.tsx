/**
 * The panel on the Plan tab's start page, as seat cards: the oracle chairing,
 * then DEV, DESIGN, QA and RESEARCH, each a checkbox (several can sit). During
 * a session the seats live in the side rail (`Header.tsx`).
 */
import { act } from "@/lib/act"
import type { CSSProperties } from "react"
import { sourceLabel } from "../lobby/types"
import { AgentIcon, agentColor } from "@/ui/AgentIcon"
import { SEAT_ROLES, type SeatCell } from "./words"

/** One seat on the start page: a keycap card in its colour with what it brings and a checkbox (dashed when it sits out; the oracle always chairs). */
function SeatCard({ cell, onToggled }: { cell: SeatCell; onToggled: () => void }) {
  const { member } = cell
  const name = sourceLabel(cell.label)
  const style = { "--c": agentColor(cell.label) } as CSSProperties
  const body = (
    <>
      <span className="cs-sht">
        <span>
          <span aria-hidden="true" className="cs-tile" style={{ "--ac": agentColor(cell.label) } as CSSProperties}><AgentIcon source={cell.label} /></span>
          {name}
        </span>
        {member ? <span aria-hidden="true" className="cs-cb" data-on={cell.seated ? "true" : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span> : null}
      </span>
      <p>{SEAT_ROLES[cell.label]}</p>
      <small>{member ? (cell.seated ? "seated" : "sits this one out") : "always chairs"}</small>
    </>
  )
  if (!member) return <li><div className="cs-seatc" data-on="true" data-fixed="true" style={style}>{body}</div></li>
  return (
    <li>
      <button type="button" role="checkbox" aria-checked={cell.seated} aria-label={`${name} sits on the panel`} className="cs-seatc" data-on={cell.seated ? "true" : "false"} style={style} onClick={() => void toggle(member, onToggled)}>{body}</button>
    </li>
  )
}

async function toggle(member: NonNullable<SeatCell["member"]>, onToggled: () => void) {
  if (await act("planner.toggleSeat", { member })) onToggled()
}

/** The panel on the start page, as seat cards. */
export function Seats({ cells, onToggled }: { cells: SeatCell[]; onToggled: () => void }) {
  return (
    <ul aria-label="Panel" className="cs-seatg">
      {cells.map((cell) => (
        <SeatCard key={cell.label} cell={cell} onToggled={onToggled} />
      ))}
    </ul>
  )
}
