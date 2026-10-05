/**
 * The conversation pane: chat newest-last, the oracle's replies as Markdown
 * on the left under their name and time, yours in a tinted bubble on the right,
 * messages from one speaker within five minutes under one header, notes as
 * centred rules, the streaming reply marked, older history loaded from
 * `lobby.history` at the top, and a "Jump to latest" button while scrolled
 * up. New messages ease in; settled ones are memoised by id, so only the
 * streaming reply redraws on each delta.
 */
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react"
import { useStickToBottom } from "@/lib/useStickToBottom"
import { ArrowDown, MessageSquare } from "lucide-react"
import { motion } from "motion/react"
import { ActionButton } from "@/ui/Actions"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Keys } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
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
  const failed = entry.text.startsWith("✗")
  return (
    <div className={failed ? "flex justify-center text-sm text-destructive" : "flex justify-center text-sm text-muted-foreground"}>
      <span className="max-w-[80%] text-center">
        {entry.text}
        {entry.at ? ` · ${formatClock(entry.at)}` : ""}
      </span>
    </div>
  )
}

/** The speaker's name with the time (or what it is doing) at the far end. */
function OracleHead({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-sm">
      <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
      <span className="font-medium">{name}</span>
      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">{children}</span>
    </span>
  )
}

function MessageBody({ entry, head }: { entry: ChatEntry; head: boolean }) {
  if (entry.role === "you") {
    return (
      <div className="flex flex-col items-end gap-1">
        {head ? (
          <span className="flex items-baseline gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{formatClock(entry.at)}</span>
            <span className="font-medium">You</span>
          </span>
        ) : null}
        <div className="max-w-[78%] rounded-xl rounded-tr-sm border border-primary/10 bg-you px-3.5 py-2">
          <Markdown text={entry.text} />
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      {head ? (
        <OracleHead name={entry.role === "panel" ? "Panel" : "Oracle"}>
          <time>{formatClock(entry.at)}</time>
        </OracleHead>
      ) : null}
      <div className="max-w-[88%] pl-4">
        <Markdown text={entry.text} />
      </div>
    </div>
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
    <div className="flex flex-col gap-1">
      <OracleHead name="Oracle">
        {busy ? (
          <>
            <Spinner aria-hidden="true" role="presentation" className="size-3" />
            {writing ? "writing" : "working…"}
          </>
        ) : null}
      </OracleHead>
      {writing ? (
        <div className="max-w-[88%] pl-4">
          <Markdown text={text ?? ""} />
        </div>
      ) : null}
    </div>
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
      <div ref={ref} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-dock outline-none focus-visible:bg-muted/30" role="log" aria-label="Conversation" tabIndex={0}>
        {empty ? (
          <ConversationEmpty hasTask={hasTask} />
        ) : (
          <div className="flex flex-col gap-5">
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
