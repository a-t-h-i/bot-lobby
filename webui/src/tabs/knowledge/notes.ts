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
import type { KnowledgeEntryInfo, KnowledgeFileInfo, KnowledgeNoteInfo, KnowledgeViewData } from "@protocol"
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
    })
  })
  return notes
}

export interface KnowledgeRead {
  files: KnowledgeFileInfo[]
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
  const [state, setState] = useState<Omit<KnowledgeRead, "reload">>({ files: [], models: {}, views: [], notes: [], loading: true })
  useEffect(() => {
    let alive = true
    setState((now) => ({ ...now, loading: true }))
    void (async () => {
      try {
        const listed = await call("knowledge.files", {})
        const views = await Promise.all(listed.files.map((info) => call("knowledge.open", { agent: info.agent, file: info.file }).then((read) => read.view)))
        const notes: Note[] = []
        for (const view of views) notes.push(...notesOf(view, notes.length))
        if (alive) setState({ files: listed.files, models: listed.models ?? {}, views, notes, loading: false })
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

/** Whether a note matches the search: its text, file, agent, tags and comments. */
export function matches(note: Note, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [note.text, note.file, AGENT_LABELS[note.agent], ...note.tags.map((tag) => `#${tag}`), ...note.comments.map((comment) => comment.text)].join(" ").toLowerCase()
  return words.every((word) => hay.includes(word))
}

/** The file a note moved to `agent` lands in: the same file name when that agent keeps one, else its first file, else `knowledge.md`. */
export function targetFile(files: readonly KnowledgeFileInfo[], agent: KnowledgeAgentName, file: string): string {
  const own = files.filter((info) => info.agent === agent)
  return own.find((info) => info.file === file)?.file ?? own[0]?.file ?? "knowledge.md"
}
