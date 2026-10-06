/**
 * The Sessions page's wording and entry model: this window, the background
 * sessions it started and the sessions running in other terminals. "Not
 * running" tasks are the Tasks tab's business here.
 */
import type { BackgroundSessionInfo, LiveSession, LobbySnapshot, SessionDialog, StatusInfo } from "@protocol"

export type Where = "this window" | "background" | "other terminal"

export const SECTION_OF: Record<Where, string> = { "this window": "This window", background: "Background", "other terminal": "Other terminals" }
export const SECTION_ORDER: readonly Where[] = ["this window", "background", "other terminal"]

export const NOTHING_SAID = "Nothing said yet."
export const OTHER_TERMINAL_NOTE =
  "This session runs in another terminal: its conversation shows here and your messages reach its oracle within seconds, but live activity only streams from sessions started in this window."
export const NO_OTHERS = "No other sessions. Start one below."

export interface Entry {
  /** The route key: `here`, a background key such as `S1`, or a live session id. */
  id: string
  where: Where
  name: string
  status: string
  waiting: number
  pid?: number
  key?: string
  sessionId?: string
  alive: boolean
  dialogs: SessionDialog[]
  task?: NonNullable<LobbySnapshot["task"]>
}

function hereEntry(status: StatusInfo | undefined, lobby: LobbySnapshot | undefined, waiting: number): Entry {
  const task = lobby?.task
  return {
    id: "here",
    where: "this window",
    name: status?.sessionName ?? task?.title ?? "unnamed session",
    status: status?.busy ? "working" : (task?.state ?? "no task"),
    waiting,
    alive: true,
    dialogs: [],
    ...(task ? { task } : {}),
  }
}

function backgroundEntry(session: BackgroundSessionInfo): Entry {
  const status = session.status === "exited" ? "ended" : session.status === "starting" ? "starting" : session.busy ? "working" : "idle"
  return {
    id: session.key,
    where: "background",
    name: session.name,
    status,
    waiting: session.dialogs.length,
    key: session.key,
    alive: session.alive,
    dialogs: session.dialogs,
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
  }
}

function liveEntry(live: LiveSession): Entry {
  return { id: live.sessionId, where: "other terminal", name: live.name ?? "unnamed session", status: "running", waiting: 0, pid: live.pid, sessionId: live.sessionId, alive: true, dialogs: [] }
}

/** This window first, then background sessions, then live sessions elsewhere (never the ones already shown). */
export function buildEntries(
  status: StatusInfo | undefined,
  lobby: LobbySnapshot | undefined,
  waiting: number,
  background: readonly BackgroundSessionInfo[],
  live: readonly LiveSession[]
): Entry[] {
  const shown = new Set<string>([status?.sessionId, ...background.map((session) => session.sessionId)].filter((id): id is string => Boolean(id)))
  const others = live.filter((session) => !shown.has(session.sessionId))
  return [hereEntry(status, lobby, waiting), ...background.map(backgroundEntry), ...others.map(liveEntry)]
}

/** `2 questions waiting for you`. */
export function waitingText(n: number): string {
  return `${n} question${n === 1 ? "" : "s"} waiting for you`
}

/** What a background session says when it has no conversation yet. */
export function emptyNote(entry: Entry): string {
  if (entry.status === "starting") return `starting ${entry.name}…`
  if (!entry.alive) return `${entry.name} has ended.`
  return `${entry.name} has not said anything yet.`
}

/** The facts line: `background · working · pid 1234`. */
export function factsLine(entry: Entry): string {
  return [entry.where, entry.status.replace(/_/g, " "), entry.pid ? `pid ${entry.pid}` : ""].filter(Boolean).join(" · ")
}

/** The address of an entry's conversation for `sessions.chat` / `sessions.message`. */
export function addressOf(entry: Entry): { key: string } | { sessionId: string } | undefined {
  if (entry.key) return { key: entry.key }
  return entry.sessionId ? { sessionId: entry.sessionId } : undefined
}
