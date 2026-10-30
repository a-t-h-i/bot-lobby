/**
 * The sessions the sidebar lists, in one order: this window's own first, then
 * the background sessions it started (the ones it can switch to), then the
 * live sessions in other terminals (shown, but they stay where they run), then
 * the project's saved sessions, newest first, which stay until archived or
 * deleted. Pure, so the page and its tests read the same list.
 */
import type { BackgroundSessionInfo, LiveSession, SavedSession, StatusInfo } from "@protocol"

export type SessionWhere = "here" | "background" | "elsewhere" | "saved"
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
  /** When it last changed (saved sessions). */
  at?: number
}

function backgroundState(session: BackgroundSessionInfo): SessionState {
  if (session.waiting > 0 && session.alive) return "asking"
  if (session.status === "exited" || !session.alive) return "exited"
  if (session.busy || session.status === "working") return "working"
  return session.status === "starting" ? "starting" : "idle"
}

export function sessionEntries(status: Pick<StatusInfo, "sessionId" | "sessionName" | "busy"> | undefined, list: { background: BackgroundSessionInfo[]; live: LiveSession[]; saved?: SavedSession[] } | undefined): SessionEntry[] {
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
  const listed = new Set([...known, ...elsewhere.map((entry) => entry.sessionId)])
  const saved = (list?.saved ?? [])
    .filter((session) => !session.archived && !listed.has(session.sessionId))
    .map((session): SessionEntry => ({ id: `saved:${session.sessionId}`, name: session.name, where: "saved", state: "exited", waiting: 0, sessionId: session.sessionId, at: session.at }))
  return [here, ...background, ...elsewhere, ...saved]
}
