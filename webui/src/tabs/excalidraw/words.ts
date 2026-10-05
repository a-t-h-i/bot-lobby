/**
 * The Excalidraw page's wording and small helpers, copied verbatim from
 * `src/lobby/tabs/excalidraw.ts` and `src/excalidraw/sessions.ts` (which the
 * page cannot import: one draws through the terminal layout, the other reads
 * `node:crypto`). Pure and free of the DOM.
 */
import type { ExcalidrawAgentName, ExcalidrawCheck } from "@protocol"

export const LIST_TITLE = "Sessions"
export const MAX_SESSIONS = 5
export const EMPTY_HEADLINE = "No sessions yet. A session is a live Excalidraw room that you and your agents draw in together."
export const EMPTY_ADD = "a  add one: in Excalidraw, Share → Live collaboration → Start session, then paste the link"
export const EMPTY_NEW = "n  or make a new room here and open its link in Excalidraw"
export const EMPTY_LIMIT = "Up to 5 sessions; each can be assigned to one agent or several."
export const DRAW_LINE = "Agents may draw here."
export const LOOK_LINE = "Agents may only look."
export const CHECKING_ROOM = "checking the room…"
export const CHECK_HINT = "Check that the room can be reached."
export const ASSIGNED_TO = "Assigned to"
export const AGENT_NOTE = "Assigned agents read the board and draw on it with excalidraw_read and excalidraw_draw, and appear in the room under their own name."
export const MANAGE_TITLE = "Add or rename"
export const ADD_LABEL = "Add by link"
export const ADD_HINT = "In Excalidraw, Share → Live collaboration → Start session, then paste the link. Enter adds it."
export const ADD_BUTTON = "Add"
export const NEW_ROOM_LABEL = "New room"
export const NEW_ROOM_HINT = "Makes a fresh room link to open in Excalidraw; the name is optional."
export const RENAME_LABEL = "Rename"
export const DRAW_BADGE = "draw"
export const LOOK_BADGE = "look only"
export const COPIED = "Copied to the clipboard"
export const REVEAL_FAILED = "Could not reveal the link."

export const EXCALIDRAW_AGENTS: readonly ExcalidrawAgentName[] = ["master", "designer", "backend", "qa", "scout", "researcher", "quickfix", "planner"]

export const AGENT_LABELS: Record<ExcalidrawAgentName, string> = {
  master: "Master (oracle)",
  designer: "Designer",
  backend: "Backend",
  qa: "QA",
  scout: "Scouts",
  researcher: "Researcher",
  quickfix: "Quick fix",
  planner: "Planner",
}

/** `1 agent` / `no agents`, as the terminal's `agentCount` writes it. */
export function agentCount(count: number): string {
  return count === 0 ? "no agents" : `${count} agent${count === 1 ? "" : "s"}`
}

/** The check's mark, a glyph as well as a tone (`⠋ ✓ !`). */
export function checkMark(check: ExcalidrawCheck | undefined): string {
  return check ? (check.ok ? "✓" : "!") : ""
}
