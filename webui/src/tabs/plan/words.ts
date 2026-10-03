/**
 * The Plan tab's wording and small pure helpers, copied from
 * `src/lobby/tabs/plan.ts` (which the page cannot import: it pulls in the
 * terminal layout). Seat text carries a glyph as well as words, so a seat's
 * state never rests on colour.
 */
import type { PanelMember, PlannerSnapshot } from "@protocol"

export const ORACLE = "ORACLE"
export const NO_DRAFT = "No draft yet."
export const DRAFT_WAITS = "The draft appears after the panel's first round."
export const SEATS_NEED = "What each seat needs"

export const MEMBER_ORDER: readonly PanelMember[] = ["backend", "designer", "qa", "researcher"]
export const MEMBER_LABELS: Record<PanelMember, string> = { backend: "DEV", designer: "DESIGN", qa: "QA", researcher: "RESEARCH" }

/** The seating intro before a session: one sentence, with the round bound when there is one. */
export function introText(limit: number): string {
  const bound = limit > 0 ? ` (at most ${limit} rounds; the last one the oracle settles alone)` : ""
  return `Describe a task below and the panel questions you until the plan is clear${bound}.`
}

/** `round 3/5`, `final round 5/5` or `round 6 · past the limit, revising`; `round 3` without a limit. */
export function roundLabel(turns: number, limit = 0): string {
  if (limit <= 0) return `round ${turns}`
  if (turns > limit) return `round ${turns} · past the limit, revising`
  return turns === limit ? `final round ${turns}/${limit}` : `round ${turns}/${limit}`
}

export function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

/** Whether nobody has spoken yet, so the seating intro shows instead of a conversation. */
export function isFresh(snap: PlannerSnapshot): boolean {
  return snap.round === 0 && snap.messages.length === 0 && !snap.busy
}

/** The first failed seat's error, first line only. */
export function failure(snap: PlannerSnapshot): string | undefined {
  const failed = snap.members.find((member) => member.status === "failed")
  if (!failed) return undefined
  return (failed.error ?? `${MEMBER_LABELS[failed.member]} failed`).split("\n")[0]
}

/** The status line's parts. */
export function statusParts(snap: PlannerSnapshot): string[] {
  const parts: string[] = []
  const error = failure(snap)
  if (snap.busy) parts.push(roundLabel(snap.round, snap.limit))
  else if (error) parts.push(`${error} — Retry runs the round again`)
  else if (snap.questions.length > 0) parts.push(`${count(snap.questions.length, "question")} waiting`)
  if (!snap.busy && snap.round > 0) parts.push(roundLabel(snap.round, snap.limit))
  if (!snap.busy && snap.limit > 0 && snap.round + 1 === snap.limit) parts.push("the next round is the last: the oracle settles the rest")
  return parts
}

export interface SeatCell {
  /** The member to toggle; the oracle always chairs and has none. */
  member?: PanelMember
  label: string
  seated: boolean
  working: boolean
  text: string
}

function memberCell(member: PanelMember, snap: PlannerSnapshot): SeatCell {
  const label = MEMBER_LABELS[member]
  const seated = snap.seats.includes(member)
  const state = snap.members.find((entry) => entry.member === member)
  const base = { member, label, seated, working: false }
  if (!seated) return { ...base, text: "off" }
  if (state?.status === "thinking") return { ...base, working: true, text: state.step ?? "thinking" }
  if (state?.status === "failed") return { ...base, text: "failed — Retry" }
  if (!state) return { ...base, text: "·" }
  if (state.reply?.status === "ready") return { ...base, text: "ready" }
  const asked = snap.questions.filter((question) => question.from === label).length
  return { ...base, text: asked === 0 ? "done" : count(asked, "question") }
}

/** The oracle first, then the four seats. */
export function seatCells(snap: PlannerSnapshot): SeatCell[] {
  const asked = snap.questions.filter((question) => question.from === ORACLE).length
  const oracle: SeatCell = { label: ORACLE, seated: true, working: snap.busy, text: snap.busy ? "chairing" : asked ? count(asked, "question") : "·" }
  return [oracle, ...MEMBER_ORDER.map((member) => memberCell(member, snap))]
}
