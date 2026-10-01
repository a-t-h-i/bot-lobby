/**
 * A session's conversation (batch-2 §i): oldest first, your messages marked
 * "You ●", the oracle's as Markdown, notes as rules. Background and other
 * terminal sessions page back with `before` through `sessions.chat`; this
 * window's own conversation comes from the Lobby snapshot.
 */
import { useState } from "react"
import { Button } from "@/components/ui/button"
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
  return (
    <li className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        {time} {you ? "You ●" : "◆ Oracle"}
      </span>
      <Markdown text={entry.text} />
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
        <Button variant="outline" className="h-10 self-center" disabled={loading} onClick={onMore}>
          Load earlier messages
        </Button>
      ) : null}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol aria-label="Conversation" className="flex flex-col gap-3">
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
