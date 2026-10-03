/**
 * The panel roster as chips: the oracle chairing, then DEV, DESIGN, QA and
 * RESEARCH. A seat is a toggle button (`aria-pressed`) whose text says what
 * it is doing; the oracle is a plain chip because it always sits.
 */
import { Button } from "@/components/ui/button"
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
  const look = "inline-flex min-h-8 items-center gap-2 rounded-lg px-3.5 text-sm"
  if (!member) return <li className={cn(look, "bg-muted")}><Inside cell={cell} intro={intro} /></li>
  const toggle = async () => {
    if (await act("planner.toggleSeat", { member })) onToggled()
  }
  return (
    <li>
      <Button
        type="button"
        variant="ghost"
        aria-pressed={cell.seated}
        onClick={() => void toggle()}
        className={cn(look, "h-auto font-normal", cell.seated ? "bg-muted hover:bg-accent" : "text-muted-foreground opacity-70 hover:bg-muted hover:opacity-100")}
      >
        <Inside cell={cell} intro={intro} />
      </Button>
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
