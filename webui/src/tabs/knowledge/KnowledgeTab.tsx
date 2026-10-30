/**
 * The Knowledge tab: what the agents keep between sessions. Notes (every
 * entry of every agent's knowledge files as a card, two columns) beside a
 * rail of agents and tags that filter them; a note dragged onto an agent
 * moves to it. Search narrows by words, New note writes one for the agent
 * picked (the oracle when none is). A question asked from the composer
 * ("Ask the knowledge") is answered in a card over the notes. A note opens in
 * the slide-over. Agents (`#/knowledge/agents`) shows a card per agent.
 */
import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react"
import { BookOpen, Plus, Search, X } from "lucide-react"
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
import { NoteCard, NoteEditor } from "./NoteCard"
import { NoteHead, NoteSheet } from "./NoteSheet"
import { AGENT_COLORS, initial, matches, targetFile, useKnowledge, type Note } from "./notes"
import { AGENT_LABELS, AGENT_ORDER, entryRef, groupFiles, type KnowledgeAgentName } from "./words"

type Mode = "notes" | "agents"

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
  const mode: Mode = rest[0] === "agents" ? "agents" : "notes"
  const data = useKnowledge()
  const [agent, setAgent] = useState<KnowledgeAgentName>()
  const [tags, setTags] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [writing, setWriting] = useState(false)
  const [openKey, setOpenKey] = useState<string>()
  const [dragKey, setDragKey] = useState<string>()
  const [dropOn, setDropOn] = useState<KnowledgeAgentName | "">()
  const pane = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => data.notes.filter((note) => (!agent || note.agent === agent) && tags.every((tag) => note.tags.includes(tag)) && matches(note, query)), [data.notes, agent, tags, query])
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of data.notes) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14)
  }, [data.notes])
  const opened = data.notes.find((note) => note.key === openKey)
  const lastOpened = useRef<Note | undefined>(undefined)
  if (opened) lastOpened.current = opened

  const toggleTag = (tag: string) => setTags((now) => (now.includes(tag) ? now.filter((one) => one !== tag) : [...now, tag]))
  const setMode = (next: Mode) => go(tabHash("knowledge", ...(next === "agents" ? ["agents"] : [])))
  const viewOf = (note: Note) => data.views.find((view) => view.agent === note.agent && view.file === note.file)

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
  // A move is an add to the other agent's file, then a remove here; if the add fails the note stays put.
  const move = async (note: Note, to: KnowledgeAgentName) => {
    if (to === note.agent) return
    const file = targetFile(data.files, to, note.file)
    if (!(await act("knowledge.add", { agent: to, file, text: note.entry.text }))) return
    await act("knowledge.remove", { agent: note.agent, file: note.file, ref: entryRef(note.entry) })
    setOpenKey(undefined)
    data.reload()
  }
  const add = async (text: string) => {
    const who = agent ?? "master"
    const done = (await act("knowledge.add", { agent: who, file: targetFile(data.files, who, "knowledge.md"), text: text.startsWith("-") ? text : `- ${text}` })) !== undefined
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
  const pinnedAgent = agent ?? "master"
  const columns: [Note[], Note[]] = [[], []]
  shown.forEach((note, index) => columns[index % 2]!.push(note))

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={pane} className="cs-scroll pb-dock">
        <div className="cs-pg cs-kn">
          <div className="cs-knh">
            <div>
              <h1 className="cs-hd1">Knowledge</h1>
              <p className="cs-hd2">{plural(data.notes.length, "note")} · {plural(groups.length, "agent")} · {plural(data.files.length, "file")}</p>
            </div>
            <Segmented as="tab" label="Knowledge view" value={mode} onChange={setMode} items={[{ id: "notes", label: "Notes" }, { id: "agents", label: "Agents" }]} />
          </div>
          {!data.views.length && data.loading ? <ListSkeleton /> : mode === "agents" ? (
            <AgentCards data={data} onOpen={(who) => { setAgent(who); setMode("notes") }} />
          ) : (
            <div className="cs-knl">
              <nav className="cs-knr" aria-label="Filter notes">
                <div className="cs-knrh cs-f">Agents</div>
                <button type="button" className="cs-knri" data-sel={!agent || undefined} aria-pressed={!agent} onClick={() => setAgent(undefined)}>
                  <span className="cs-nm">All notes</span>
                  <span className="cs-ct">{data.notes.length}</span>
                </button>
                {AGENT_ORDER.filter((who) => groups.some((group) => group.agent === who)).map((who) => (
                  <button
                    key={who}
                    type="button"
                    className="cs-knri"
                    data-sel={agent === who || undefined}
                    data-drop={dropOn === who || undefined}
                    aria-pressed={agent === who}
                    style={{ "--c": AGENT_COLORS[who] } as CSSProperties}
                    onClick={() => setAgent((now) => (now === who ? undefined : who))}
                    onDragOver={(event) => { if (dragKey) { event.preventDefault(); setDropOn(who) } }}
                    onDragLeave={() => setDropOn((now) => (now === who ? undefined : now))}
                    onDrop={drop(who)}
                  >
                    <span className="cs-kd" aria-hidden="true" />
                    <span className="cs-nm">{AGENT_LABELS[who]}</span>
                    {data.files.some((info) => info.agent === who && info.over) ? <span className="cs-ovd" title="A file is over the compaction threshold" /> : null}
                    <span className="cs-ct">{data.notes.filter((note) => note.agent === who).length}</span>
                  </button>
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
                <p className="cs-knhint">Drag a note onto an agent to move it. Comments on a note go to its agent with it.</p>
              </nav>
              <div className="min-w-0">
                <div className="cs-knt">
                  <label className="cs-kns">
                    <Search aria-hidden="true" className="size-4 flex-none" />
                    <input type="text" value={query} placeholder="Search notes, tags and files" aria-label="Search notes" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && query) { event.stopPropagation(); setQuery("") } }} />
                    {query ? <button type="button" className="cs-kx" aria-label="Clear the search" onClick={() => setQuery("")}><X aria-hidden="true" className="size-3.5" /></button> : null}
                  </label>
                  <button type="button" className="cs-kc cs-sm cs-pri" disabled={writing} onClick={() => setWriting(true)}><Plus aria-hidden="true" className="size-3.5" />New note</button>
                </div>
                <AnswerCard notes={data.notes} onOpen={setOpenKey} onSaved={data.reload} />
                {writing ? (
                  <div className="cs-knc mb-3">
                    <div className="cs-knch" style={{ "--c": AGENT_COLORS[pinnedAgent] } as CSSProperties}>
                      <span className="cs-kat" aria-hidden="true">{initial(pinnedAgent)}</span>
                      <b>{AGENT_LABELS[pinnedAgent]}</b>
                      <span className="cs-fl">· new note in {targetFile(data.files, pinnedAgent, "knowledge.md")}</span>
                    </div>
                    <NoteEditor initial="" label="New note" action="Add note" placeholder={`What should ${AGENT_LABELS[pinnedAgent]} keep in mind?`} onSave={add} onCancel={() => setWriting(false)} />
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
                            onOpen={() => setOpenKey(note.key)}
                            onTag={toggleTag}
                            onDragStart={() => setDragKey(note.key)}
                            onDragEnd={() => { setDragKey(undefined); setDropOn(undefined) }}
                            onSave={(text) => edit(note, text)}
                            onDelete={() => void remove(note)}
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
      <SlideOver open={Boolean(opened)} onClose={() => setOpenKey(undefined)} label="Note" className="cs-knw" head={lastOpened.current ? <NoteHead note={lastOpened.current} /> : null}>
        {lastOpened.current ? (
          <NoteSheet
            key={lastOpened.current.key}
            note={lastOpened.current}
            view={viewOf(lastOpened.current)}
            onTag={(tag) => { setOpenKey(undefined); toggleTag(tag) }}
            onMove={(to) => void move(lastOpened.current!, to)}
            onDelete={() => void remove(lastOpened.current!)}
            onChanged={data.reload}
          />
        ) : null}
      </SlideOver>
    </div>
  )
}
