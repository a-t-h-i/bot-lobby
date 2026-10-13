/**
 * The panel roster as slim chips on the header's row: the oracle chairing,
 * then DEV, DESIGN, QA and RESEARCH. A seat is a checkbox (several can sit)
 * beside a word on what it is doing once it has something to say; the oracle
 * is a plain chip because it always sits.
 */
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { act } from "@/lib/act"
import { cn } from "@/lib/utils"
import type { CSSProperties } from "react"
import { sourceColor, sourceLabel, sourceTone } from "../lobby/types"
import { AgentIcon } from "@/ui/AgentIcon"
import { SEAT_ROLES, type SeatCell } from "./words"

function Inside({ cell, intro }: { cell: SeatCell; intro: boolean }) {
  const state = intro ? (cell.member ? (cell.seated ? "seated" : "not seated") : "chairs") : cell.text
  return (
    <>
      <span className={cn("inline-flex items-center gap-1 font-medium", cell.seated ? sourceColor(cell.label) : "text-muted-foreground")}>
        <AgentIcon source={cell.label} className="size-3" />
        {sourceLabel(cell.label)}
      </span>
      {cell.working && !intro ? <Spinner className="size-3" aria-hidden="true" /> : null}
      {/* Nothing to say yet ("·") is left unsaid. */}
      {state === "·" ? null : <span className="text-muted-foreground">{state}</span>}
    </>
  )
}

function Chip({ cell, intro, onToggled }: { cell: SeatCell; intro: boolean; onToggled: () => void }) {
  const { member } = cell
  const look = "roster-chip inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap max-md:min-h-11"
  if (!member) return <li className={cn(look, "border-transparent bg-muted")}><Inside cell={cell} intro={intro} /></li>
  const toggle = async () => {
    if (await act("planner.toggleSeat", { member })) onToggled()
  }
  return (
    <li>
      <label className={cn(look, "cursor-pointer pl-1.5 transition-colors", cell.seated ? "border-border bg-card hover:bg-muted" : "border-dashed border-border text-muted-foreground hover:bg-muted")}>
        <Checkbox checked={cell.seated} onCheckedChange={() => void toggle()} aria-label={`${sourceLabel(cell.label)} sits on the panel`} className="size-3.5 rounded-[4px] [&_svg]:size-2.5" />
        <Inside cell={cell} intro={intro} />
      </label>
    </li>
  )
}

export function Roster({ cells, intro, onToggled, className }: { cells: SeatCell[]; intro: boolean; onToggled: () => void; className?: string }) {
  return (
    <ul aria-label="Panel" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {cells.map((cell) => (
        <Chip key={cell.label} cell={cell} intro={intro} onToggled={onToggled} />
      ))}
    </ul>
  )
}

/** One seat on the start page: its colour and name, what it brings, and a checkbox to seat it (the oracle always sits). */
function SeatCard({ cell, onToggled }: { cell: SeatCell; onToggled: () => void }) {
  const { member } = cell
  const name = sourceLabel(cell.label)
  const look = cn(
    "flex h-full flex-col gap-2 rounded-xl border p-3.5 transition-[background-color,border-color,box-shadow]",
    cell.seated ? "border-[color-mix(in_oklab,var(--orb)_26%,var(--border))] bg-[color-mix(in_oklab,var(--orb)_5%,var(--card))] shadow-card" : "border-dashed border-input bg-transparent"
  )
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={cn("grid size-6 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--orb)_14%,transparent)] text-[color-mix(in_oklab,var(--orb)_85%,var(--foreground))]", !cell.seated && "opacity-50 grayscale")}>
            <AgentIcon source={cell.label} className="size-3.5" />
          </span>
          <span className={cn("truncate text-sm font-semibold", cell.seated ? sourceColor(cell.label) : "text-muted-foreground")}>{name}</span>
        </span>
        {member ? <Checkbox checked={cell.seated} onCheckedChange={() => void toggle(member, onToggled)} aria-label={`${name} sits on the panel`} /> : null}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">{SEAT_ROLES[cell.label]}</span>
      <span className={cn("mt-auto text-xs font-medium", cell.seated ? "text-foreground" : "text-muted-foreground")}>{member ? (cell.seated ? "seated" : "sits this one out") : "always chairs"}</span>
    </>
  )
  const style = { "--orb": sourceTone(cell.label) } as CSSProperties
  if (!member) return <li style={style}><div className={look}>{body}</div></li>
  return (
    <li style={style}>
      <label className={cn(look, "cursor-pointer", cell.seated ? "hover:shadow-[0_0_0_3px_color-mix(in_oklab,var(--orb)_10%,transparent)]" : "hover:bg-muted")}>{body}</label>
    </li>
  )
}

async function toggle(member: NonNullable<SeatCell["member"]>, onToggled: () => void) {
  if (await act("planner.toggleSeat", { member })) onToggled()
}

/** The panel on the start page, as seat cards. */
export function Seats({ cells, onToggled }: { cells: SeatCell[]; onToggled: () => void }) {
  return (
    <ul aria-label="Panel" className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @4xl:grid-cols-5">
      {cells.map((cell) => (
        <SeatCard key={cell.label} cell={cell} onToggled={onToggled} />
      ))}
    </ul>
  )
}
