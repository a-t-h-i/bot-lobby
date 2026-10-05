/**
 * The panel roster as chips: the oracle chairing, then DEV, DESIGN, QA and
 * RESEARCH. A seat is a checkbox (several can sit) beside text that says what
 * it is doing; the oracle is a plain chip because it always sits.
 */
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { act } from "@/lib/act"
import { cn } from "@/lib/utils"
import { sourceColor, sourceLabel } from "../lobby/types"
import type { SeatCell } from "./words"

function Inside({ cell, intro }: { cell: SeatCell; intro: boolean }) {
  const state = intro ? (cell.member ? (cell.seated ? "seated" : "not seated") : "chairs") : cell.text
  return (
    <>
      <span className={cn("font-medium", cell.seated ? sourceColor(cell.label) : "text-muted-foreground")}>{sourceLabel(cell.label)}</span>
      {cell.working && !intro ? <Spinner className="size-3.5" aria-hidden="true" /> : null}
      <span className="text-muted-foreground">{state}</span>
    </>
  )
}

function Chip({ cell, intro, onToggled }: { cell: SeatCell; intro: boolean; onToggled: () => void }) {
  const { member } = cell
  const look = "inline-flex min-h-8 items-center gap-2 rounded-lg border border-border px-3 text-[0.8125rem]"
  if (!member) return <li className={cn(look, "bg-muted")}><Inside cell={cell} intro={intro} /></li>
  const toggle = async () => {
    if (await act("planner.toggleSeat", { member })) onToggled()
  }
  return (
    <li>
      <label className={cn(look, "cursor-pointer transition-colors", cell.seated ? "btn-raised bg-card" : "border-dashed text-muted-foreground hover:bg-muted")}>
        <Checkbox checked={cell.seated} onCheckedChange={() => void toggle()} aria-label={`${sourceLabel(cell.label)} sits on the panel`} />
        <Inside cell={cell} intro={intro} />
      </label>
    </li>
  )
}

export function Roster({ cells, intro, onToggled }: { cells: SeatCell[]; intro: boolean; onToggled: () => void }) {
  return (
    <ul aria-label="Panel" className="flex flex-wrap gap-2">
      {cells.map((cell) => (
        <Chip key={cell.label} cell={cell} intro={intro} onToggled={onToggled} />
      ))}
    </ul>
  )
}
