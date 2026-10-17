/**
 * The sessions the sidebar lists, in one order: this window's own first, then
 * the background sessions it started (the ones it can switch to), then the
 * live sessions in other terminals (shown, but they stay where they run).
 * Pure, so the page and its tests read the same list.
 */
import type { BackgroundSessionInfo, LiveSession, StatusInfo } from "@protocol"

export type SessionWhere = "here" | "background" | "elsewhere"
export type SessionState = "working" | "idle" | "starting" | "exited" | "asking"

export interface SessionEntry {
  /** Stable across reads: the key, the session id, or `here`. */
  id: string
  name: string
  where: SessionWhere
  state: SessionState
  /** Questions it waits on you for. */
  waiting: number
  key?: string
  sessionId?: string
}

/** What the row says under the name. */
export function sessionNote(entry: SessionEntry): string {
  if (entry.where === "here") return entry.state === "working" ? "This window · working" : "This window"
  if (entry.where === "elsewhere") return "Another terminal"
  if (entry.waiting > 0) return entry.waiting === 1 ? "1 question for you" : `${entry.waiting} questions for you`
  return { working: "Working", idle: "Idle", starting: "Starting…", exited: "Ended", asking: "Asking" }[entry.state]
}

function backgroundState(session: BackgroundSessionInfo): SessionState {
  if (session.waiting > 0 && session.alive) return "asking"
  if (session.status === "exited" || !session.alive) return "exited"
  if (session.busy || session.status === "working") return "working"
  return session.status === "starting" ? "starting" : "idle"
}

export function sessionEntries(status: Pick<StatusInfo, "sessionId" | "sessionName" | "busy"> | undefined, list: { background: BackgroundSessionInfo[]; live: LiveSession[] } | undefined): SessionEntry[] {
  const own = status?.sessionId
  const here: SessionEntry = { id: "here", name: status?.sessionName?.trim() || "This window", where: "here", state: status?.busy ? "working" : "idle", waiting: 0, ...(own ? { sessionId: own } : {}) }
  const background = (list?.background ?? [])
    .filter((session) => !own || session.sessionId !== own)
    .map((session): SessionEntry => ({
      id: `bg:${session.key}`,
      name: session.name,
      where: "background",
      state: backgroundState(session),
      waiting: session.alive ? session.waiting : 0,
      key: session.key,
      ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    }))
  const known = new Set([own, ...background.map((entry) => entry.sessionId)].filter(Boolean))
  const elsewhere = (list?.live ?? [])
    .filter((session) => !known.has(session.sessionId))
    .map((session): SessionEntry => ({ id: `live:${session.sessionId}`, name: session.name?.trim() || "Unnamed session", where: "elsewhere", state: "idle", waiting: 0, sessionId: session.sessionId }))
  // Ended background sessions go last among their kind: the live ones are what you switch between.
  background.sort((a, b) => Number(a.state === "exited") - Number(b.state === "exited"))
  return [here, ...background, ...elsewhere]
}

/** The letter a folded rail shows of a session. */
export function sessionInitial(name: string): string {
  const letter = name.trim().match(/[\p{L}\p{N}]/u)?.[0]
  return (letter ?? "•").toUpperCase()
}
