/** The Tasks tab's wording and grouping. Pure and free of the DOM. */
import type { TaskRow } from "@protocol"

export type TaskSection = TaskRow["section"]
export type CheckState = TaskRow["check"]

export const SECTION_TITLES: Record<TaskSection, string> = {
  mine: "This session",
  others: "Other sessions",
  pending: "Pending",
  recent: "Finished",
  archived: "Archived",
}

/** What a screen reader hears where the box is drawn. */
export const CHECK_WORDS: Record<CheckState, string> = { open: "open", done: "done", dropped: "abandoned" }

export const EMPTY_LIST = "No tasks yet. Start one from the Lobby tab, or plan one in the Plan tab."

/** A task's state in words: `awaiting approval`, `implementing · paused`. */
export function stateWords(status: string, paused?: boolean): string {
  return `${status.replace(/_/g, " ")}${paused ? " · paused" : ""}`
}

/** `just now` or `3h ago` for a row's age (`now`, `40s`, `3h`, `4d`). */
export function agoWords(age: string): string {
  return age === "now" ? "just now" : `${age} ago`
}

/** The line under an open row's title: state, who drives it, auto mode; a plan's age and issue. */
export function detailsLine(row: TaskRow): string {
  if (row.kind === "plan") {
    return ["planned", row.age ? (row.age === "now" ? "saved just now" : `saved ${row.age} ago`) : "", row.issue ? `#${row.issue}` : ""].filter(Boolean).join(" · ")
  }
  const owner = row.owner ?? (row.section === "mine" ? "this session" : "")
  return [stateWords(row.status, row.paused), row.auto ? "auto" : "", owner].filter(Boolean).join(" · ")
}

/** Rows grouped under their section, in the order the API sent them. */
export function groupRows(rows: readonly TaskRow[]): Array<{ section: TaskSection; rows: TaskRow[] }> {
  const groups: Array<{ section: TaskSection; rows: TaskRow[] }> = []
  for (const row of rows) {
    const last = groups.at(-1)
    if (last && last.section === row.section) last.rows.push(row)
    else groups.push({ section: row.section, rows: [row] })
  }
  return groups
}

/** The list's right-hand count: what is open and what is finished, plus archived when shown. */
export function listCount(rows: readonly TaskRow[]): string {
  const listed = rows.filter((row) => row.kind !== "archived")
  const open = listed.filter((row) => row.check === "open").length
  const finished = listed.length - open
  const archived = rows.length - listed.length
  return [open ? `${open} open` : "", finished ? `${finished} finished` : "", archived ? `${archived} archived` : ""].filter(Boolean).join(" · ") || "0"
}
