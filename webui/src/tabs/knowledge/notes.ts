/**
 * The Knowledge page's notes: every entry of every knowledge file read as a
 * note card (headings are not notes; they tag the notes under them), with the
 * comments left on it and its tags (the heading it sits under and any
 * `#word` in its text). The files are read together and again whenever the
 * `knowledge` topic changes.
 */
import { useEffect, useState } from "react"
import { useStoreVersion } from "@/app/hooks"
import { call } from "@/lib/api"
import { lobbyStore } from "@/lib/store"
import type { KnowledgeEntryInfo, KnowledgeEventInfo, KnowledgeFileInfo, KnowledgeLedgerData, KnowledgeNoteInfo, KnowledgeProposalInfo, KnowledgeViewData } from "@protocol"
import { AGENT_LABELS, type KnowledgeAgentName } from "./words"

export interface Note {
  /** `agent/file#index`: stable while the file does not change above it. */
  key: string
  agent: KnowledgeAgentName
  file: string
  entry: KnowledgeEntryInfo
  /** The text without its list marker. */
  text: string
  tags: string[]
  comments: KnowledgeNoteInfo[]
  /** Its place across all notes, newest file order first. */
  order: number
  pinned: boolean
  /** What happened to it, oldest first. */
  history: KnowledgeEventInfo[]
  /** Where it came from and when, as the card's last line says it. */
  source?: string
  since?: string
  /** Runs of its agent in the last 30 days since it was written (each run loads it), newest first. */
  uses: Array<{ at: string; taskId?: string }>
  /** Not used for a long while, or a waiting proposal would replace it. */
  flag?: { kind: "stale"; days: number } | { kind: "conflict"; proposal: string }
}

const DAY = 24 * 3600 * 1000
/** Days without a run before a note counts as stale. */
export const STALE_DAYS = 60

const plainKey = (text: string) => text.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ x]\]\s+)?/i, "").trim().toLowerCase()

/** The note with what the ledger knows about it: pin, history, uses and flag. */
export function withLedger(note: Note, ledger: KnowledgeLedgerData | undefined, now = Date.now()): Note {
  if (!ledger) return note
  const key = plainKey(note.entry.text)
  const mine = (one: { agent: string; file: string; entry: string }) => one.agent === note.agent && one.file === note.file && plainKey(one.entry) === key
  const history = ledger.events.filter(mine).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const first = history[0]
  const born = first ? Date.parse(first.at) : 0
  const runs = ledger.runs[note.agent]
  const uses = (runs?.recent ?? []).filter((run) => Date.parse(run.at) >= born)
  const conflict = ledger.proposals.find((proposal) => proposal.agent === note.agent && proposal.replaces && plainKey(proposal.replaces) === key)
  const last = runs?.lastAt ? Date.parse(runs.lastAt) : 0
  const idle = last ? Math.floor((now - last) / DAY) : 0
  const flag: Note["flag"] = conflict ? { kind: "conflict", proposal: conflict.id } : last && idle >= STALE_DAYS && (!born || now - born >= STALE_DAYS * DAY) ? { kind: "stale", days: idle } : undefined
  const source = history.find((event) => event.source)?.source
  return {
    ...note,
    pinned: ledger.pins.some(mine),
    history,
    ...(source ? { source } : {}),
    ...(first ? { since: first.at } : {}),
    uses,
    ...(flag ? { flag } : {}),
  }
}

/** `retries` from `## Retries and backoff`: the heading's first words, as a tag. */
function headingTag(text: string): string {
  return text.replace(/^#+\s*/, "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().split(/\s+/).slice(0, 2).join("-")
}

function plain(entry: KnowledgeEntryInfo): string {
  return entry.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim()
}

/** The notes of one file, in its order. */
export function notesOf(view: KnowledgeViewData, start = 0): Note[] {
  const notes: Note[] = []
  let heading = ""
  view.entries.forEach((entry, index) => {
    if (entry.kind === "heading") {
      heading = headingTag(entry.text)
      return
    }
    const text = plain(entry)
    if (!text) return
    const inline = [...text.matchAll(/(?:^|\s)#([a-z][\w-]{1,30})/gi)].map((match) => match[1]!.toLowerCase())
    const tags = [...new Set([...(heading ? [heading] : []), ...inline])]
    notes.push({
      key: `${view.agent}/${view.file}#${index}`,
      agent: view.agent,
      file: view.file,
      entry,
      text,
      tags,
      comments: view.attached.filter((note) => note.entry === entry.text),
      order: start + notes.length,
      pinned: false,
      history: [],
      uses: [],
    })
  })
  return notes
}

export interface KnowledgeRead {
  files: KnowledgeFileInfo[]
  /** Characters past which a file is over its compaction threshold. */
  threshold?: number
  proposals: KnowledgeProposalInfo[]
  ledger?: KnowledgeLedgerData
  models: Partial<Record<KnowledgeAgentName, string>>
  views: KnowledgeViewData[]
  notes: Note[]
  error?: string
  loading: boolean
  reload: () => void
}

/** Every knowledge file, opened, as notes; read again when the knowledge changes or the stream reconnects. */
export function useKnowledge(): KnowledgeRead {
  useStoreVersion()
  const version = `${lobbyStore.status().connection},${lobbyStore.get("knowledge").version}`
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<Omit<KnowledgeRead, "reload">>({ files: [], models: {}, views: [], notes: [], proposals: [], loading: true })
  useEffect(() => {
    let alive = true
    setState((now) => ({ ...now, loading: true }))
    void (async () => {
      try {
        const [listed, ledger] = await Promise.all([call("knowledge.files", {}), call("knowledge.ledger", {}).catch(() => undefined)])
        const views = await Promise.all(listed.files.map((info) => call("knowledge.open", { agent: info.agent, file: info.file }).then((read) => read.view)))
        const notes: Note[] = []
        for (const view of views) notes.push(...notesOf(view, notes.length))
        const now = Date.now()
        if (alive) setState({ files: listed.files, ...(listed.threshold ? { threshold: listed.threshold } : {}), models: listed.models ?? {}, views, notes: notes.map((note) => withLedger(note, ledger, now)), proposals: ledger?.proposals ?? [], ...(ledger ? { ledger } : {}), loading: false })
      } catch (error) {
        if (alive) setState((now) => ({ ...now, error: error instanceof Error ? error.message : String(error), loading: false }))
      }
    })()
    return () => {
      alive = false
    }
  }, [version, tick])
  return { ...state, reload: () => setTick((count) => count + 1) }
}

/** An agent's colour on this page. */
export const AGENT_COLORS: Record<KnowledgeAgentName, string> = {
  master: "var(--c-orc)",
  designer: "var(--c-des)",
  backend: "var(--c-dev)",
  qa: "var(--c-qa)",
}

/** The agent's initial, for its small tile. */
export const initial = (agent: KnowledgeAgentName) => AGENT_LABELS[agent][0]!

/** Whether a note matches the search: its text, file, agent, source, tags and comments. */
export function matches(note: Note, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [note.text, note.file, AGENT_LABELS[note.agent], note.source ?? "", ...note.tags.map((tag) => `#${tag}`), ...note.comments.map((comment) => comment.text)].join(" ").toLowerCase()
  return words.every((word) => hay.includes(word))
}

/** The file a note moved to `agent` lands in: the same file name when that agent keeps one, else its first file, else `knowledge.md`. */
export function targetFile(files: readonly KnowledgeFileInfo[], agent: KnowledgeAgentName, file: string): string {
  const own = files.filter((info) => info.agent === agent)
  return own.find((info) => info.file === file)?.file ?? own[0]?.file ?? "knowledge.md"
}

/** "3d ago", "today", "Sep 14": how long ago, as the page says it. */
export function ago(at: string | undefined, now = Date.now()): string {
  const time = at ? Date.parse(at) : NaN
  if (Number.isNaN(time)) return ""
  const days = Math.floor((now - time) / DAY)
  if (days < 1) return now - time < 3600 * 1000 ? "just now" : "today"
  if (days < 14) return `${days}d ago`
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** "14 uses", "1 use", "Never used". */
export const usesWords = (count: number) => (count === 0 ? "Never used" : `${count} ${count === 1 ? "use" : "uses"}`)

/** The last 14 days of uses, oldest first, as bar heights (0 when there were none). */
export function useBars(uses: Note["uses"], now = Date.now()): number[] {
  const days = Array.from({ length: 14 }, () => 0)
  for (const use of uses) {
    const back = Math.floor((now - Date.parse(use.at)) / DAY)
    if (back >= 0 && back < 14) days[13 - back]! += 1
  }
  const most = Math.max(1, ...days)
  return days.map((count) => (count ? Math.max(24, Math.round((count / most) * 100)) : 0))
}
