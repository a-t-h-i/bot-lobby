/**
 * The conversation pane: chat newest-last in a centred column, each reply as
 * Markdown under its speaker's icon, name and time (the Master, or the agent
 * that answered: Design, Dev, QA, Research, a scout), yours in a tinted bubble
 * on the right with who it went to when that was not the Master, messages from one speaker within five minutes
 * under one header (a follow-on shows its time when pointed at), notes as
 * rules across the column, the agents' activity folded in place between the
 * messages it came between (see `InlineActivity.tsx`), the speaker's name shimmering until the reply starts (not while a working step already shows), older history loaded from
 * `lobby.history` at the top, and a "Jump to latest" button while scrolled
 * up. New messages ease in; settled ones are memoised by id, so only the
 * streaming reply redraws on each delta.
 */
import { memo, useCallback, useEffect, useMemo, useState, type RefObject } from "react"
import { useStickToBottom } from "@/lib/useStickToBottom"
import { AgentMessage, ChatNote, YourMessage } from "./ChatParts"
import { motion } from "motion/react"
import { JumpToLatest } from "@/ui/JumpToLatest"
import { ScrollHints } from "@/ui/ScrollHints"
import { AUTO_NOTE } from "@/ui/task-facts"
import { agentColor } from "@/ui/AgentIcon"
import { call } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { Frame } from "@/ui/Frame"
import { Markdown } from "@/ui/Markdown"
import { InlineActivity, summary } from "./InlineActivity"
import { InlineThinking, freshThoughts } from "./InlineThinking"
import { sourceLabel, speakerOf, type ActivityEntry, type ChatEntry, type ThoughtEntry } from "./types"
import { weave } from "./weave"
import { splitRoutes, type Split } from "./route"

/** Messages from one speaker this close together share a header. */
const GROUP_MS = 5 * 60_000

const GREETING = "What's on your mind?"
const GREETING_HINT = "Ask a question or for a change below."
const NOTHING_SAID = "Talk about this task"
const NOTHING_SAID_HINT = "The oracle answers here."

function NoteEntry({ entry }: { entry: ChatEntry }) {
  if (entry.text === AUTO_NOTE) return <ChatNote auto>{AUTO_NOTE}</ChatNote>
  return (
    <ChatNote failed={entry.text.startsWith("✗")}>
      {entry.text}
      {entry.at ? ` · ${formatClock(entry.at)}` : ""}
    </ChatNote>
  )
}

/** Who your message went to (`@Scout`) or the command it began with (`/plan`), set off at its start in their colour. */
function leadOf(entry: ChatEntry): { token: string; color: string; text: string } | undefined {
  const command = /^\/[a-z][\w-]*(?=\s|$)/i.exec(entry.text)
  if (command) return { token: command[0], color: "var(--primary)", text: entry.text.slice(command[0].length).trimStart() }
  if (entry.to && entry.to !== "MASTER") return { token: `@${sourceLabel(entry.to)}`, color: agentColor(entry.to), text: entry.text }
  return undefined
}

function MessageBody({ entry, head, fresh }: { entry: ChatEntry; head: boolean; fresh: boolean }) {
  if (entry.role === "you") {
    const lead = leadOf(entry)
    return (
      <YourMessage time={formatClock(entry.at)} head={head} fresh={fresh}>
        {lead ? <span className="cs-lead" style={{ color: lead.color }}>{lead.token}</span> : null}
        <Markdown text={lead ? lead.text : entry.text} />
      </YourMessage>
    )
  }
  const source = speakerOf(entry)
  return (
    <AgentMessage source={source} name={source === "PLANNER" ? "Panel" : sourceLabel(source)} time={formatClock(entry.at)} head={head} named>
      <Markdown text={entry.text} />
    </AgentMessage>
  )
}

const Message = memo(
  function Message({ entry, head, fresh }: { entry: ChatEntry; head: boolean; fresh: boolean }) {
    return (
      // Your own message pops in by itself (the bubble's own animation); the others rise into place.
      <motion.div initial={fresh && entry.role !== "you" ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.221, ease: [0.22, 1, 0.36, 1] }}>
        {entry.role === "note" ? <NoteEntry entry={entry} /> : <MessageBody entry={entry} head={head} fresh={fresh} />}
      </motion.div>
    )
  },
  (before, after) =>
    before.head === after.head &&
    before.entry.id === after.entry.id &&
    before.entry.text === after.entry.text &&
    before.entry.at === after.entry.at &&
    before.entry.to === after.entry.to
)

/** The reply on its way: the oracle's as it streams, or another agent's (`answering`); until it starts, its speaker's name shimmers, unless a working step above already says the work is under way. */
function LiveReply({ text, busy, working, answering }: { text?: string; busy: boolean; working: boolean; answering?: string }) {
  const writing = Boolean(text?.trim())
  if (!writing && (!busy || working)) return null
  const source = writing ? "MASTER" : (answering ?? "MASTER")
  return (
    <AgentMessage source={source} name={sourceLabel(source)} head named live={busy} waiting={!writing} aside={busy && writing ? "writing…" : undefined}>
      {writing ? <Markdown text={text ?? ""} /> : null}
    </AgentMessage>
  )
}

/** The classifier's pick, said in one plain line, the agent's name in its colour. */
function RouteLine({ route }: { route: Extract<Split<ChatEntry>, { kind: "route" }>["route"] }) {
  if ("knowledge" in route) return <p className="cs-route">Classifier chose <b style={{ color: "var(--primary)" }}>the project's knowledge</b></p>
  return <p className="cs-route">Classifier chose <b style={{ color: agentColor(route.agent) }}>{sourceLabel(route.agent)}</b></p>
}

/** An empty Lobby: one quiet greeting, centred, as on the Plan tab. */
function ConversationEmpty({ hasTask }: { hasTask: boolean }) {
  return (
    <div className="cs-pg cs-blank">
      <h2>{hasTask ? NOTHING_SAID : GREETING}</h2>
      <p>{hasTask ? NOTHING_SAID_HINT : GREETING_HINT}</p>
    </div>
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


/** The feed keeps 400 steps; so does the conversation. */
const STEPS_CAP = 400
const NO_STEPS: ActivityEntry[] = []
const NO_THOUGHTS: ThoughtEntry[] = []

export function Conversation({
  chat,
  activity = NO_STEPS,
  thoughts = NO_THOUGHTS,
  reply,
  busy,
  answering,
  hasOlder,
  hasTask,
}: {
  chat: ChatEntry[]
  /** The agents' steps, woven in between the messages; none when the Activity panel is off. */
  activity?: ActivityEntry[]
  /** The agents' thoughts, shown inline under the latest message; none when Thinking is off. */
  thoughts?: ThoughtEntry[]
  reply?: string
  busy: boolean
  /** The agent other than the oracle answering now. */
  answering?: string
  hasOlder: boolean
  hasTask: boolean
}) {
  const steps = useMemo(() => activity.slice(-STEPS_CAP), [activity])
  const { ref, atBottom, stick, onScroll } = useStickToBottom(`${chat.length}:${reply?.length ?? 0}:${steps.length}:${steps.at(-1)?.pending ?? ""}:${answering ?? ""}:${thoughts.at(-1)?.id ?? ""}:${thoughts.at(-1)?.text.length ?? 0}`)
  const { merged, more, loading, load } = useOlderChat(chat, hasOlder, ref)
  const handleScroll = useCallback(() => {
    onScroll()
    const el = ref.current
    if (el && el.scrollTop < 80 && more && !loading) void load()
  }, [onScroll, ref, more, loading, load])
  const timeline = useMemo(() => splitRoutes<ChatEntry>(weave(merged, steps)), [merged, steps])
  const empty = merged.length === 0 && steps.length === 0 && thoughts.length === 0 && !reply?.trim() && !busy
  const last = timeline.at(-1)
  const thinking = useMemo(() => freshThoughts(thoughts, merged.at(-1)?.at ?? 0), [thoughts, merged])
  const liveRun = last?.kind === "activity" && Boolean(summary(last.entries).live)
  // Messages present when the pane first drew do not ease in; later ones do.
  const [settled, setSettled] = useState(false)
  useEffect(() => setSettled(true), [])
  return (
    <Frame aria-label="Conversation" data-bare className="flex-1 rounded-none border-0 shadow-none">
      <div ref={ref} onScroll={handleScroll} className="cs-thread min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 pb-dock outline-none" role="log" aria-label="Conversation" tabIndex={0}>
        {empty ? (
          <ConversationEmpty hasTask={hasTask} />
        ) : (
          <div className="chat-column">
            {more ? <p className="mb-4 text-center text-xs text-muted-foreground">Earlier messages load as you scroll up.</p> : null}
            {timeline.map((item, index) => {
              if (item.kind === "activity") return <InlineActivity key={item.key} entries={item.entries} />
              if (item.kind === "route") return <RouteLine key={item.key} route={item.route} />
              const before = timeline[index - 1]
              const previous = before?.kind === "message" ? before.entry : undefined
              // Steps in between start the next message afresh, with its speaker.
              const head = !previous || speakerOf(previous) !== speakerOf(item.entry) || item.entry.at - previous.at > GROUP_MS
              return <Message key={item.entry.id} entry={item.entry} head={head} fresh={settled} />
            })}
            <InlineThinking thoughts={thinking} />
            <LiveReply text={reply} busy={busy} working={liveRun} {...(answering ? { answering } : {})} />
          </div>
        )}
      </div>
      <ScrollHints target={ref} down={false} />
      {!atBottom ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-dock z-10 flex justify-center [&>*]:pointer-events-auto">
          <JumpToLatest onClick={stick} />
        </div>
      ) : null}
    </Frame>
  )
}
