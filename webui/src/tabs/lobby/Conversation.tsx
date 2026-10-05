/**
 * The conversation pane: chat newest-last in a centred column, the oracle's
 * replies as Markdown beside its avatar under its name and time, yours in a
 * tinted bubble on the right, messages from one speaker within five minutes
 * under one header (a follow-on shows its time when pointed at), notes as
 * rules across the column, three dots until the reply starts, older history loaded from
 * `lobby.history` at the top, and a "Jump to latest" button while scrolled
 * up. New messages ease in; settled ones are memoised by id, so only the
 * streaming reply redraws on each delta.
 */
import { memo, useCallback, useEffect, useMemo, useState, type RefObject } from "react"
import { useStickToBottom } from "@/lib/useStickToBottom"
import { ArrowDown, MessageSquare } from "lucide-react"
import { AgentMessage, ChatNote, TypingDots, YourMessage } from "./ChatParts"
import { motion } from "motion/react"
import { ActionButton } from "@/ui/Actions"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Keys } from "@/components/ui/kbd"
import { call } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { Frame } from "@/ui/Frame"
import { Markdown } from "@/ui/Markdown"
import type { ChatEntry } from "./types"

/** Messages from one speaker this close together share a header. */
const GROUP_MS = 5 * 60_000

const OLDER_NOTE = "earlier messages load as you scroll up"
const NO_TASK = "No task is running in this session."
const NO_TASK_HINT = "Type a request below and press enter to start one: the oracle scouts, proposes, plans and delegates."
const NOTHING_SAID = "Nothing said yet. Type below to talk to the oracle about this task."

function NoteEntry({ entry }: { entry: ChatEntry }) {
  return (
    <ChatNote failed={entry.text.startsWith("✗")}>
      {entry.text}
      {entry.at ? ` · ${formatClock(entry.at)}` : ""}
    </ChatNote>
  )
}

function MessageBody({ entry, head }: { entry: ChatEntry; head: boolean }) {
  if (entry.role === "you") {
    return (
      <YourMessage time={formatClock(entry.at)} head={head}>
        <Markdown text={entry.text} />
      </YourMessage>
    )
  }
  const panel = entry.role === "panel"
  return (
    <AgentMessage source={panel ? "PLANNER" : "ORACLE"} name={panel ? "Panel" : "Oracle"} time={formatClock(entry.at)} head={head}>
      <Markdown text={entry.text} />
    </AgentMessage>
  )
}

const Message = memo(
  function Message({ entry, head, fresh }: { entry: ChatEntry; head: boolean; fresh: boolean }) {
    return (
      <motion.div initial={fresh ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 420, damping: 32 }}>
        {entry.role === "note" ? <NoteEntry entry={entry} /> : <MessageBody entry={entry} head={head} />}
      </motion.div>
    )
  },
  (before, after) =>
    before.head === after.head &&
    before.entry.id === after.entry.id &&
    before.entry.text === after.entry.text &&
    before.entry.at === after.entry.at
)

function LiveReply({ text, busy }: { text?: string; busy: boolean }) {
  const writing = Boolean(text?.trim())
  if (!writing && !busy) return null
  return (
    <AgentMessage source="ORACLE" name="Oracle" head live={busy} aside={busy && writing ? "writing…" : undefined}>
      {writing ? <Markdown text={text ?? ""} /> : <TypingDots className="mt-1" />}
    </AgentMessage>
  )
}

function ConversationEmpty({ hasTask }: { hasTask: boolean }) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageSquare aria-hidden="true" />
        </EmptyMedia>
        {hasTask ? null : <EmptyTitle>{NO_TASK}</EmptyTitle>}
        <EmptyDescription>{hasTask ? NOTHING_SAID : NO_TASK_HINT}</EmptyDescription>
      </EmptyHeader>
      {hasTask ? null : (
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li className="flex items-center justify-center gap-2">
            Or plan it first with the whole panel in <Keys chord="3" /> Plan
          </li>
          <li className="flex items-center justify-center gap-2">
            or make a direct change in <Keys chord="4" /> Quick fix
          </li>
        </ul>
      )}
    </Empty>
  )
}

async function fetchOlder(before: number): Promise<{ entries: ChatEntry[]; hasOlder: boolean }> {
  const result = await call("lobby.history", { before })
  return { entries: result.entries as ChatEntry[], hasOlder: result.hasOlder }
}

function useOlderChat(chat: ChatEntry[], hasOlder: boolean, scrollRef: RefObject<HTMLDivElement | null>) {
  const [older, setOlder] = useState<ChatEntry[]>([])
  const [more, setMore] = useState(hasOlder)
  const [loading, setLoading] = useState(false)
  const merged = useMemo(() => {
    const seen = new Set(chat.map((entry) => entry.id))
    return [...older.filter((entry) => !seen.has(entry.id)), ...chat]
  }, [older, chat])
  const load = useCallback(async () => {
    const oldest = merged[0]?.id
    if (oldest === undefined || loading || !more) return
    setLoading(true)
    const el = scrollRef.current
    const height = el?.scrollHeight ?? 0
    const top = el?.scrollTop ?? 0
    try {
      const result = await fetchOlder(oldest)
      setOlder((current) => [...result.entries, ...current])
      setMore(result.hasOlder)
      window.requestAnimationFrame(() => {
        const node = scrollRef.current
        if (node) node.scrollTop = node.scrollHeight - height + top
      })
    } catch {
      setMore(false)
    } finally {
      setLoading(false)
    }
  }, [merged, loading, more, scrollRef])
  return { merged, more, loading, load }
}


export function Conversation({
  chat,
  reply,
  busy,
  hasOlder,
  hasTask,
  bare,
}: {
  chat: ChatEntry[]
  reply?: string
  busy: boolean
  hasOlder: boolean
  hasTask: boolean
  /** Without its own title row (the switcher above already names it). */
  bare?: boolean
}) {
  const { ref, atBottom, stick, onScroll } = useStickToBottom(chat.length + (reply?.length ?? 0))
  const { merged, more, loading, load } = useOlderChat(chat, hasOlder, ref)
  const handleScroll = useCallback(() => {
    onScroll()
    const el = ref.current
    if (el && el.scrollTop < 80 && more && !loading) void load()
  }, [onScroll, ref, more, loading, load])
  const empty = merged.length === 0 && !reply?.trim() && !busy
  // Messages present when the pane first drew do not ease in; later ones do.
  const [settled, setSettled] = useState(false)
  useEffect(() => setSettled(true), [])
  return (
    <Frame aria-label="Conversation" {...(bare ? {} : { title: "Conversation" })} note={more ? OLDER_NOTE : undefined} className="flex-1">
      <div ref={ref} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 pt-4 pb-dock outline-none focus-visible:bg-muted/30" role="log" aria-label="Conversation" tabIndex={0}>
        {empty ? (
          <ConversationEmpty hasTask={hasTask} />
        ) : (
          <div className="chat-column">
            {merged.map((entry, index) => {
              const previous = merged[index - 1]
              const head = !previous || previous.role !== entry.role || entry.at - previous.at > GROUP_MS
              return <Message key={entry.id} entry={entry} head={head} fresh={settled} />
            })}
            <LiveReply text={reply} busy={busy} />
          </div>
        )}
      </div>
      {!atBottom ? (
        <div className="absolute right-4 bottom-dock z-10">
          <ActionButton label="Jump to latest" text="Latest" icon={ArrowDown} tone="primary" className="rounded-full shadow-sm" onClick={stick} />
        </div>
      ) : null}
    </Frame>
  )
}
