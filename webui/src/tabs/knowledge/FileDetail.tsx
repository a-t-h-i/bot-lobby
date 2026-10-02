/**
 * One knowledge file's detail (batch-2 §l): its entries with `▸` on the
 * picked one, the notes under the entries they are about, and `Notes on
 * entries that changed` at the end. The picked entry can be edited, commented
 * on, deleted or added after; the whole file can be replaced. Every write
 * rereads the file, so a `409` conflict shows the server's message and the
 * file comes back fresh.
 */
import { useState } from "react"
import type { KnowledgeEntryInfo, KnowledgeNoteInfo, KnowledgeViewData } from "@protocol"
import { useApiRead } from "@/app/useApiRead"
import { Button } from "@/components/ui/button"
import { act } from "@/lib/act"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Markdown } from "@/ui/Markdown"
import { NoteForm } from "@/ui/NoteForm"
import { Section } from "@/ui/Section"
import { Spinner } from "@/components/ui/spinner"
import { EntryEditor, FileEditor } from "./Editors"
import { AGENT_DIR_NAMES, ARCHIVE_HINT, entryRef, overWarning, sizeWords, type KnowledgeAgentName } from "./words"

interface Draft {
  kind: "edit" | "comment" | "add"
  /** The picked entry the draft is about; `undefined` for an add with none. */
  entry?: KnowledgeEntryInfo
}

function NoteLine({ note, about, onTakeBack, busy }: { note: KnowledgeNoteInfo; about?: string; onTakeBack: (id: string) => void; busy: boolean }) {
  const text = about ? `about "${about.replace(/\s+/g, " ").trim().slice(0, 50)}": ${note.text}` : note.text
  return (
    <li className="flex items-start gap-2 text-sm text-muted-foreground">
      <span className="shrink-0 text-primary" aria-hidden="true">
        ✎
      </span>
      <span className="min-w-0 flex-1 break-words">{text}</span>
      <Button variant="ghost" className="h-10 shrink-0 text-xs" disabled={busy} onClick={() => onTakeBack(note.id)}>
        Take back
      </Button>
    </li>
  )
}

function EntryRow({
  entry,
  index,
  selected,
  notes,
  onPick,
  onTakeBack,
  busy,
}: {
  entry: KnowledgeEntryInfo
  index: number
  selected: boolean
  notes: KnowledgeNoteInfo[]
  onPick: (index: number) => void
  onTakeBack: (id: string) => void
  busy: boolean
}) {
  const pick = () => onPick(index)
  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={pick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        pick()
      }}
      className={selected ? "flex min-h-11 cursor-pointer flex-col gap-1 rounded-sm bg-accent p-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50" : "flex min-h-11 cursor-pointer flex-col gap-1 rounded-sm p-2 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"}
    >
      <div className="flex gap-2">
        <span className={selected ? "shrink-0 text-primary" : "shrink-0 text-muted-foreground"} aria-hidden="true">
          {selected ? "▸" : " "}
        </span>
        <div className="min-w-0 flex-1">
          <Markdown text={entry.text} />
        </div>
      </div>
      {notes.length > 0 ? (
        <ul className="flex flex-col gap-1 pl-4">
          {notes.map((note) => (
            <NoteLine key={note.id} note={note} onTakeBack={onTakeBack} busy={busy} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function Detached({ notes, onTakeBack, busy }: { notes: KnowledgeNoteInfo[]; onTakeBack: (id: string) => void; busy: boolean }) {
  if (notes.length === 0) return null
  return (
    <Section title="Notes on entries that changed" right={String(notes.length)}>
      <ul className="flex flex-col gap-1">
        {notes.map((note) => (
          <NoteLine key={note.id} note={note} about={note.entry} onTakeBack={onTakeBack} busy={busy} />
        ))}
      </ul>
    </Section>
  )
}

function Header({ view }: { view: KnowledgeViewData }) {
  const entries = view.entries.length
  return (
    <header className="flex flex-col gap-1">
      <h2 className="text-sm font-bold">
        {AGENT_DIR_NAMES[view.agent]} · {view.file}
      </h2>
      <p className="text-xs text-muted-foreground">
        {entries} {entries === 1 ? "entry" : "entries"} · {sizeWords(view.chars)} chars
      </p>
      {view.over ? <p className="text-sm text-foreground">{overWarning(view.file)}</p> : null}
    </header>
  )
}

function Actions({ draft, picked, setDraft, onEditFile, onDelete }: { draft?: Draft; picked?: KnowledgeEntryInfo; setDraft: (draft?: Draft) => void; onEditFile: () => void; onDelete: () => void }) {
  const off = Boolean(draft)
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" className="h-10" disabled={off || !picked} onClick={() => setDraft({ kind: "edit", entry: picked })}>
        Edit
      </Button>
      <Button variant="outline" className="h-10" disabled={off} onClick={() => setDraft({ kind: "add", entry: picked })}>
        {picked ? "Add after" : "Add entry"}
      </Button>
      <Button variant="outline" className="h-10" disabled={off || !picked} onClick={() => setDraft({ kind: "comment", entry: picked })}>
        Comment
      </Button>
      <ConfirmButton
        label="Delete"
        title="Delete this entry?"
        description="The entry and its notes are removed. The version before is archived."
        confirmLabel="Delete entry"
        variant="destructive"
        disabled={off || !picked}
        onConfirm={onDelete}
      />
      <Button variant="outline" className="h-10" disabled={off} onClick={onEditFile}>
        Edit file
      </Button>
    </div>
  )
}

export function FileDetail({ agent, file, onChanged }: { agent: KnowledgeAgentName; file: string; onChanged: () => void }) {
  const read = useApiRead("knowledge.open", { agent, file }, ["knowledge"])
  const [cursor, setCursor] = useState(0)
  const [draft, setDraft] = useState<Draft>()
  const [fileOpen, setFileOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const view = read.data?.view
  const entries = view?.entries ?? []
  const picked = entries[Math.min(cursor, Math.max(0, entries.length - 1))]

  const run = async (call: () => Promise<unknown>) => {
    setBusy(true)
    await call()
    setDraft(undefined)
    read.reload()
    onChanged()
    setBusy(false)
  }
  const takeBack = (id: string) => void run(() => act("knowledge.unnote", { id }))
  const remove = () => {
    if (picked) void run(() => act("knowledge.remove", { agent, file, ref: entryRef(picked) }))
  }
  const saveDraft = (text: string) => {
    const target = draft?.entry
    if (draft?.kind === "edit" && target) return void run(() => act("knowledge.edit", { agent, file, ref: entryRef(target), text }))
    if (draft?.kind === "comment" && target) return void run(() => act("knowledge.comment", { agent, file, ref: entryRef(target), text }))
    return void run(() => act("knowledge.add", { agent, file, ...(picked ? { ref: entryRef(picked) } : {}), text }))
  }
  const saveFile = (text: string) => {
    setFileOpen(false)
    void run(() => act("knowledge.replaceFile", { agent, file, text }))
  }

  if (!view) {
    return read.error ? <p className="text-sm text-muted-foreground">Could not read the file. {read.error}</p> : <p className="text-sm text-muted-foreground">reading…</p>
  }
  return (
    <article className="flex flex-col gap-4" aria-label={`${AGENT_DIR_NAMES[agent]} ${file}`}>
      <Header view={view} />
      {entries.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here yet. Add the first entry below.</p> : null}
      <ul className="flex flex-col gap-1">
        {entries.map((entry, index) => (
          <EntryRow
            key={`${index}-${entry.text}`}
            entry={entry}
            index={index}
            selected={index === cursor}
            notes={view.attached.filter((note) => note.entry === entry.text)}
            onPick={setCursor}
            onTakeBack={takeBack}
            busy={busy}
          />
        ))}
      </ul>
      {draft?.kind === "edit" ? <EntryEditor initial={draft.entry!.text} busy={busy} onSave={saveDraft} onCancel={() => setDraft(undefined)} /> : null}
      {draft?.kind === "comment" ? <NoteForm label="Comment on this entry" hint={ARCHIVE_HINT} buttonLabel="Add note" onSend={async (text) => (saveDraft(text), true)} /> : null}
      {draft?.kind === "add" ? <NoteForm label="Add an entry" hint={ARCHIVE_HINT} buttonLabel="Add entry" onSend={async (text) => (saveDraft(text), true)} /> : null}
      {busy && !draft ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> saving…</p> : null}
      <Detached notes={view.detached} onTakeBack={takeBack} busy={busy} />
      <Actions draft={draft} picked={picked} setDraft={setDraft} onEditFile={() => setFileOpen(true)} onDelete={remove} />
      <FileEditor open={fileOpen} file={file} initial={view.content} busy={busy} onClose={() => setFileOpen(false)} onSave={saveFile} />
    </article>
  )
}
