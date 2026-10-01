/**
 * The conversation pane: chat newest-last, your messages as bubbles on the
 * right and the oracle's as Markdown on the left, notes as centred rules, the
 * streaming reply marked, older history loaded from `lobby.history` at the
 * top, and a "Jump to latest" button while scrolled up. Settled messages are
 * memoised by id, so only the streaming reply redraws on each delta.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { call } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { Markdown } from "@/ui/Markdown"
import type { ChatEntry } from "./types"

const OLDER_NOTE = "↑ earlier messages load as you scroll up"
const NO_TASK = "No task is running in this session."
const NO_TASK_HINT = "Type a request below and press enter to start one: the oracle scouts, proposes, plans and delegates."
const NO_TASK_ALT = "Or plan it first with the whole planning panel in 3 Plan, or make a direct change in 4 Quick fix."
const NOTHING_SAID = "Nothing said yet. Type below to talk to the oracle about this task."

function NoteEntry({ entry }: { entry: ChatEntry }) {
  const failed = entry.text.startsWith("✗")
  return (
    <div className={failed ? "flex items-center gap-2 text-xs text-destructive" : "flex items-center gap-2 text-xs text-muted-foreground"}>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span>
        {entry.text}
        {entry.at ? ` · ${formatClock(entry.at)}` : ""}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  )
}

function MessageBody({ entry }: { entry: ChatEntry }) {
  if (entry.role === "you") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-muted-foreground">
          {formatClock(entry.at)} You ●
        </span>
        <div className="max-w-[85%] rounded-lg bg-primary/10 px-3 py-2">
          <Markdown text={entry.text} />
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        ◆ {entry.role === "panel" ? "Panel" : "Oracle"} {formatClock(entry.at)}
      </span>
      <Markdown text={entry.text} />
    </div>
  )
}

const Message = memo(
  function Message({ entry }: { entry: ChatEntry }) {
    return entry.role === "note" ? <NoteEntry entry={entry} /> : <MessageBody entry={entry} />
  },
  (before, after) =>
    before.entry.id === after.entry.id &&
    before.entry.text === after.entry.text &&
    before.entry.at === after.entry.at
)

function LiveReply({ text, busy }: { text?: string; busy: boolean }) {
  const writing = Boolean(text?.trim())
  if (!writing && !busy) return null
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        ◆ Oracle
        {busy ? (
          <>
            <Spinner className="size-3" aria-hidden="true" role="presentation" />
            {writing ? "writing" : "working…"}
          </>
        ) : null}
      </span>
      {writing ? <Markdown text={text ?? ""} /> : null}
    </div>
  )
}

function ConversationEmpty({ hasTask }: { hasTask: boolean }) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        {hasTask ? null : <EmptyTitle>{NO_TASK}</EmptyTitle>}
        <EmptyDescription>
          {hasTask ? NOTHING_SAID : NO_TASK_HINT}
          {hasTask ? null : (
            <>
              {" "}
              {NO_TASK_ALT}
            </>
          )}
        </EmptyDescription>
      </EmptyHeader>
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

function useStickToBottom(revision: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const stick = useCallback(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])
  useEffect(() => {
    if (atBottom) stick()
  }, [atBottom, stick, revision])
  const onScroll = useCallback(() => {
    const el = ref.current
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }, [])
  return { ref, atBottom, stick, onScroll }
}

export function Conversation({
  chat,
  reply,
  busy,
  hasOlder,
  hasTask,
}: {
  chat: ChatEntry[]
  reply?: string
  busy: boolean
  hasOlder: boolean
  hasTask: boolean
}) {
  const { ref, atBottom, stick, onScroll } = useStickToBottom(chat.length + (reply?.length ?? 0))
  const { merged, more, loading, load } = useOlderChat(chat, hasOlder, ref)
  const handleScroll = useCallback(() => {
    onScroll()
    const el = ref.current
    if (el && el.scrollTop < 80 && more && !loading) void load()
  }, [onScroll, ref, more, loading, load])
  const empty = merged.length === 0 && !reply?.trim() && !busy
  return (
    <section className="relative flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card" aria-label="Conversation">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-medium">Conversation</h2>
        {more ? <span className="text-xs text-muted-foreground">{OLDER_NOTE}</span> : null}
      </header>
      <div ref={ref} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="log" aria-label="Conversation">
        {empty ? (
          <ConversationEmpty hasTask={hasTask} />
        ) : (
          <div className="flex flex-col gap-4">
            {merged.map((entry) => (
              <Message key={entry.id} entry={entry} />
            ))}
            <LiveReply text={reply} busy={busy} />
          </div>
        )}
      </div>
      {!atBottom ? (
        <Button type="button" size="lg" className="absolute right-4 bottom-4 h-10" onClick={stick}>
          <ArrowDown aria-hidden="true" />
          Jump to latest
        </Button>
      ) : null}
    </section>
  )
}
