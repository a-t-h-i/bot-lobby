/**
 * The Knowledge tab: what the agents keep between sessions. Three modes:
 * Notes (every entry of every agent's knowledge files as a card, two columns)
 * beside a rail of agents (with the selected agent's files) and tags that
 * filter them, where a note dragged onto an agent moves to it; search, the
 * Pinned, Stale and Conflicts filters, the sort (pinned first or most used)
 * and New note sit above the cards. A question asked from the composer ("Ask
 * the knowledge") is answered in a card over the notes, and a note opens in
 * the slide-over. Agents (`#/knowledge/agents`) shows a card per agent, and
 * Inbox (`#/knowledge/inbox`) the notes finished work proposed.
 */
import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react"
import { BookOpen, Pin, Plus, Search, X } from "lucide-react"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { act } from "@/lib/act"
import { Segmented } from "@/ui/Segmented"
import { ListSkeleton } from "@/ui/SplitPane"
import { ScrollHints } from "@/ui/ScrollHints"
import { SlideOver } from "@/ui/SlideOver"
import { AgentCards } from "./AgentCards"
import { AnswerCard } from "./AnswerCard"
import { InboxList } from "./InboxList"
import { NoteCard, NoteEditor } from "./NoteCard"
import { NoteHead, NoteSheet } from "./NoteSheet"
import { AGENT_COLORS, initial, matches, targetFile, useKnowledge, type Note } from "./notes"
import { AGENT_LABELS, AGENT_ORDER, entryRef, groupFiles, sizeWords, type KnowledgeAgentName } from "./words"

type Mode = "notes" | "agents" | "inbox"
type Filter = "pinned" | "stale" | "conflict"

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function NoFiles() {
  return (
    <Empty className="m-4 flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon"><BookOpen aria-hidden="true" /></EmptyMedia>
        <EmptyDescription>No knowledge files yet. The agents write what they learn here as they work.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function KnowledgeTab({ rest }: { rest: string[] }) {
  const mode: Mode = rest[0] === "agents" ? "agents" : rest[0] === "inbox" ? "inbox" : "notes"
  const data = useKnowledge()
  const [agent, setAgent] = useState<KnowledgeAgentName>()
  const [file, setFile] = useState<string>()
  const [tags, setTags] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>()
  const [byUse, setByUse] = useState(false)
  const [writing, setWriting] = useState(false)
  const [openKey, setOpenKey] = useState<string>()
  const [editKey, setEditKey] = useState<string>()
  const [commenting, setCommenting] = useState(false)
  const [dragKey, setDragKey] = useState<string>()
  const [dropOn, setDropOn] = useState<KnowledgeAgentName | "">()
  const pane = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => {
    const kept = data.notes.filter((note) =>
      (!agent || note.agent === agent) && (!file || note.file === file) && tags.every((tag) => note.tags.includes(tag)) && matches(note, query)
      && (!filter || (filter === "pinned" ? note.pinned : note.flag?.kind === filter)))
    return byUse ? [...kept].sort((a, b) => b.uses.length - a.uses.length) : [...kept].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  }, [data.notes, agent, file, tags, query, filter, byUse])
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of data.notes) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12)
  }, [data.notes])
  const opened = data.notes.find((note) => note.key === openKey)
  const lastOpened = useRef<Note | undefined>(undefined)
  if (opened) lastOpened.current = opened

  const toggleTag = (tag: string) => setTags((now) => (now.includes(tag) ? now.filter((one) => one !== tag) : [...now, tag]))
  const setMode = (next: Mode) => go(tabHash("knowledge", ...(next === "notes" ? [] : [next])))
  const viewOf = (note: Note) => data.views.find((view) => view.agent === note.agent && view.file === note.file)
  const pickAgent = (who: KnowledgeAgentName | undefined) => {
    setAgent(who)
    setFile(undefined)
  }

  const edit = async (note: Note, text: string) => {
    const done = (await act("knowledge.edit", { agent: note.agent, file: note.file, ref: entryRef(note.entry), text })) !== undefined
    if (done) data.reload()
    return done
  }
  const remove = async (note: Note) => {
    if (await act("knowledge.remove", { agent: note.agent, file: note.file, ref: entryRef(note.entry) })) {
      if (openKey === note.key) setOpenKey(undefined)
      data.reload()
    }
  }
  const pin = async (note: Note) => {
    if (await act("knowledge.pin", { agent: note.agent, file: note.file, ref: entryRef(note.entry), on: !note.pinned })) data.reload()
  }
  const move = async (note: Note, to: KnowledgeAgentName) => {
    if (to === note.agent) return
    if (!(await act("knowledge.move", { agent: note.agent, file: note.file, ref: entryRef(note.entry), to, toFile: targetFile(data.files, to, note.file) }))) return
    setOpenKey(undefined)
    data.reload()
  }
  const newAgent = agent ?? "master"
  const newFile = file ?? targetFile(data.files, newAgent, "knowledge.md")
  const add = async (text: string) => {
    const done = (await act("knowledge.add", { agent: newAgent, file: newFile, text: text.startsWith("-") ? text : `- ${text}` })) !== undefined
    if (done) data.reload()
    return done
  }

  const drop = (to: KnowledgeAgentName) => (event: DragEvent) => {
    event.preventDefault()
    setDropOn(undefined)
    const note = data.notes.find((one) => one.key === (event.dataTransfer.getData("text/plain") || dragKey))
    if (note) void move(note, to)
  }

  if (!data.views.length && data.error) return <ErrorState message={`Could not load the knowledge. ${data.error}`} onRetry={data.reload} />
  if (!data.loading && !data.files.length) return <NoFiles />
  const groups = groupFiles(data.files)
  const columns: [Note[], Note[]] = [[], []]
  shown.forEach((note, index) => columns[index % 2]!.push(note))
  const count = (kind: Filter) => data.notes.filter((note) => (kind === "pinned" ? note.pinned : note.flag?.kind === kind)).length
  const pinned = count("pinned")
  const inbox = data.proposals.length
  const flip = (kind: Filter) => setFilter((now) => (now === kind ? undefined : kind))

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={pane} className="cs-scroll pb-dock">
        <div className="cs-pg cs-kn">
          <div className="cs-knh">
            <div>
              <h1 className="cs-hd1">Knowledge</h1>
              <p className="cs-hd2">{plural(data.notes.length, "note")} · {plural(groups.length, "agent")} · {pinned} pinned</p>
            </div>
            <Segmented
              as="tab"
              label="Knowledge view"
              value={mode}
              onChange={setMode}
              items={[
                { id: "notes", label: "Notes" },
                { id: "agents", label: "Agents" },
                { id: "inbox", label: <>Inbox{inbox ? <span className="cs-kbn">{inbox}</span> : null}</>, name: inbox ? `Inbox, ${inbox} waiting` : "Inbox" },
              ]}
            />
          </div>
          {!data.views.length && data.loading ? <ListSkeleton /> : mode === "agents" ? (
            <AgentCards data={data} onOpen={(who) => { pickAgent(who); setMode("notes") }} />
          ) : mode === "inbox" ? (
            <InboxList proposals={data.proposals} onChanged={data.reload} />
          ) : (
            <div className="cs-knl">
              <nav className="cs-knr" aria-label="Filter notes">
                <div className="cs-knrh cs-f">Agents</div>
                <button type="button" className="cs-knri" data-sel={!agent || undefined} aria-pressed={!agent} onClick={() => pickAgent(undefined)}>
                  <span className="cs-nm">All notes</span>
                  <span className="cs-ct">{data.notes.length}</span>
                </button>
                {AGENT_ORDER.filter((who) => groups.some((group) => group.agent === who)).map((who) => (
                  <div key={who} className="contents">
                    <button
                      type="button"
                      className="cs-knri"
                      data-sel={(agent === who && !file) || undefined}
                      data-drop={dropOn === who || undefined}
                      aria-pressed={agent === who}
                      style={{ "--c": AGENT_COLORS[who] } as CSSProperties}
                      onClick={() => pickAgent(agent === who && !file ? undefined : who)}
                      onDragOver={(event) => { if (dragKey) { event.preventDefault(); setDropOn(who) } }}
                      onDragLeave={() => setDropOn((now) => (now === who ? undefined : now))}
                      onDrop={drop(who)}
                    >
                      <span className="cs-kd" aria-hidden="true" />
                      <span className="cs-nm">{AGENT_LABELS[who]}</span>
                      {data.files.some((info) => info.agent === who && info.over) ? <span className="cs-ovd" title="A file is over the compaction threshold" /> : null}
                      <span className="cs-ct">{data.notes.filter((note) => note.agent === who).length}</span>
                    </button>
                    {agent === who ? data.files.filter((info) => info.agent === who).map((info) => (
                      <button key={info.file} type="button" className="cs-knri" data-k="file" data-sel={file === info.file || undefined} aria-pressed={file === info.file} style={{ "--c": AGENT_COLORS[who] } as CSSProperties} onClick={() => setFile((now) => (now === info.file ? undefined : info.file))}>
                        <span className="cs-nm">{info.file}</span>
                        {info.over ? <span className="cs-ovd" title="Over the compaction threshold" /> : null}
                        <span className="cs-ct">{sizeWords(info.chars)}</span>
                      </button>
                    )) : null}
                  </div>
                ))}
                {tagCounts.length ? (
                  <>
                    <div className="cs-knrh">Tags</div>
                    <div className="cs-kntags">
                      {tagCounts.map(([tag, count]) => (
                        <button key={tag} type="button" className="cs-ktg" data-on={tags.includes(tag) || undefined} aria-pressed={tags.includes(tag)} onClick={() => toggleTag(tag)}>
                          #{tag}<span className="ml-[5px] opacity-60">{count}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                <p className="cs-knhint">Drag a note onto an agent to move it. Pinned notes always load first.</p>
              </nav>
              <div className="min-w-0">
                <div className="cs-knt">
                  <label className="cs-kns">
                    <Search aria-hidden="true" className="size-4 flex-none" />
                    <input type="text" value={query} placeholder="Search notes, tags and sources" aria-label="Search notes" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && query) { event.stopPropagation(); setQuery("") } }} />
                    {query ? <button type="button" className="cs-kx" aria-label="Clear the search" onClick={() => setQuery("")}><X aria-hidden="true" className="size-3.5" /></button> : null}
                  </label>
                  <button type="button" className="cs-kc cs-sm" data-on={filter === "pinned" ? "true" : undefined} aria-pressed={filter === "pinned"} onClick={() => flip("pinned")}><Pin aria-hidden="true" className="size-3.5" />Pinned <span className="cs-mut">{pinned}</span></button>
                  <button type="button" className="cs-kc cs-sm" data-on={filter === "stale" ? "true" : undefined} aria-pressed={filter === "stale"} onClick={() => flip("stale")}>Stale <span className="cs-mut">{count("stale")}</span></button>
                  <button type="button" className="cs-kc cs-sm" data-on={filter === "conflict" ? "true" : undefined} aria-pressed={filter === "conflict"} onClick={() => flip("conflict")}>Conflicts <span className="cs-mut">{count("conflict")}</span></button>
                  <button type="button" className="cs-kc cs-sm" title="Change the order" onClick={() => setByUse((now) => !now)}>{byUse ? "Most used" : "Pinned first"}</button>
                  <button type="button" className="cs-kc cs-sm cs-pri" disabled={writing} onClick={() => setWriting(true)}><Plus aria-hidden="true" className="size-3.5" />New note</button>
                </div>
                <AnswerCard notes={data.notes} onOpen={setOpenKey} onSaved={data.reload} />
                {writing ? (
                  <div className="cs-knc mb-3">
                    <div className="cs-knch" style={{ "--c": AGENT_COLORS[newAgent] } as CSSProperties}>
                      <span className="cs-kat" aria-hidden="true">{initial(newAgent)}</span>
                      <b>{AGENT_LABELS[newAgent]}</b>
                      <span className="cs-fl">· new note in {newFile}</span>
                    </div>
                    <NoteEditor initial="" label="New note" action="Add note" placeholder={`What should ${AGENT_LABELS[newAgent]} keep in mind?`} onSave={add} onCancel={() => setWriting(false)} />
                  </div>
                ) : null}
                {shown.length ? (
                  <div className="cs-kng">
                    {columns.map((column, index) => (
                      <div key={index} className="cs-kcol">
                        {column.map((note) => (
                          <NoteCard
                            key={note.key}
                            note={note}
                            selected={note.key === openKey}
                            dragging={note.key === dragKey}
                            activeTags={tags}
                            editing={editKey === note.key}
                            onEditing={(on) => setEditKey(on ? note.key : undefined)}
                            onOpen={() => { setCommenting(false); setOpenKey(note.key) }}
                            onTag={toggleTag}
                            onDragStart={() => setDragKey(note.key)}
                            onDragEnd={() => { setDragKey(undefined); setDropOn(undefined) }}
                            onSave={(text) => edit(note, text)}
                            onDelete={() => void remove(note)}
                            onPin={() => void pin(note)}
                            onReview={() => setMode("inbox")}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="cs-knempty">
                    <b>{data.notes.length ? "No notes match" : "No notes yet"}</b>
                    {data.notes.length ? "Try another word, or clear the filters." : "New note writes the first one."}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <ScrollHints target={pane} />
      <SlideOver
        open={Boolean(opened)}
        onClose={() => setOpenKey(undefined)}
        label="Note"
        className="cs-knw"
        head={lastOpened.current ? (
          <NoteHead
            note={lastOpened.current}
            onPin={() => void pin(lastOpened.current!)}
            onEdit={() => { const key = lastOpened.current!.key; setOpenKey(undefined); setEditKey(key) }}
            onComment={() => setCommenting(true)}
            onDelete={() => void remove(lastOpened.current!)}
          />
        ) : null}
      >
        {lastOpened.current ? (
          <NoteSheet
            key={lastOpened.current.key}
            note={lastOpened.current}
            view={viewOf(lastOpened.current)}
            commenting={commenting}
            onCommenting={setCommenting}
            onTag={(tag) => { setOpenKey(undefined); pickAgent(undefined); toggleTag(tag) }}
            onMove={(to) => void move(lastOpened.current!, to)}
            onChanged={data.reload}
          />
        ) : null}
      </SlideOver>
    </div>
  )
}
