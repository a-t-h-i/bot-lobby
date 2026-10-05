/**
 * A session's conversation: oldest first, the oracle's and your messages as
 * Markdown under their name and time, notes as rules. Background and other
 * terminal sessions page back with `before` through `sessions.chat`; this
 * window's own conversation comes from the Lobby snapshot.
 */
import { useState } from "react"
import { ChevronsUp } from "lucide-react"
import { ActionButton } from "@/ui/Actions"
import { useApiRead } from "@/app/useApiRead"
import { act } from "@/lib/act"
import { formatClock } from "@/lib/format"
import { Markdown } from "@/ui/Markdown"
import type { ChatEntry } from "../lobby/types"

function Line({ entry }: { entry: ChatEntry }) {
  const time = entry.at ? formatClock(entry.at) : ""
  if (entry.role === "note") {
    return (
      <li className="text-center text-xs text-muted-foreground">
        {entry.text}
        {time ? ` · ${time}` : ""}
      </li>
    )
  }
  const you = entry.role === "you"
  if (you) {
    return (
      <li className="flex flex-col items-end gap-1">
        <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
          {time} <span className="font-medium text-foreground">You</span>
        </span>
        <div className="max-w-[85%] rounded-xl rounded-tr-sm border border-primary/10 bg-you px-3.5 py-2">
          <Markdown text={entry.text} />
        </div>
      </li>
    )
  }
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
        <span className="font-medium text-foreground">Oracle</span> {time}
      </span>
      <div className="max-w-[90%] pl-4">
        <Markdown text={entry.text} />
      </div>
    </li>
  )
}

interface ChatViewProps {
  entries: ChatEntry[]
  more: boolean
  loading?: boolean
  onMore?: () => void
  empty: string
}

export function ChatView({ entries, more, loading, onMore, empty }: ChatViewProps) {
  return (
    <div className="flex flex-col gap-3">
      {more ? (
        <div className="flex self-center">
          <ActionButton label="Load earlier messages" icon={ChevronsUp} disabled={loading} onClick={onMore ?? (() => undefined)} />
        </div>
      ) : null}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol aria-label="Conversation" className="flex flex-col gap-4">
          {entries.map((entry) => (
            <Line key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </div>
  )
}

type Address = { key: string } | { sessionId: string }

/** The conversation of a session read through `sessions.chat`, with earlier pages on request. */
export function RemoteChat({ address, empty }: { address: Address; empty: string }) {
  const read = useApiRead("sessions.chat", address, ["sessions"])
  const [older, setOlder] = useState<{ entries: ChatEntry[]; more: boolean }>()
  const [loading, setLoading] = useState(false)
  const latest = (read.data?.entries ?? []) as ChatEntry[]
  const seen = new Set(latest.map((entry) => entry.id))
  const entries = [...(older?.entries ?? []).filter((entry) => !seen.has(entry.id)), ...latest]
  const loadOlder = async () => {
    const first = entries[0]
    if (!first) return
    setLoading(true)
    const page = await act("sessions.chat", { ...address, before: first.id })
    if (page) setOlder({ entries: [...(page.entries as ChatEntry[]), ...(older?.entries ?? [])], more: page.hasOlder })
    setLoading(false)
  }
  const more = older?.more ?? read.data?.hasOlder ?? false
  return <ChatView entries={entries} more={more} loading={loading} onMore={() => void loadOlder()} empty={read.loading && !read.data ? "Loading the conversation…" : empty} />
}
