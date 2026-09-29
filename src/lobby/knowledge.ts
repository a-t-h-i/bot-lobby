/**
 * The Knowledge tab's side of the disk: every agent's knowledge files, one
 * file read as entries with the user's notes on them, and the edits the user
 * can make — replace, add or delete an entry, edit the whole file — plus
 * notes. Every write goes through the compactor's path, which archives the
 * previous version first (`archive/<Agent>/…bak`), so an edit can be undone by
 * hand. An entry is found again by its exact text; when the file changed on
 * disk since the tab drew it, the edit is refused with a line saying so.
 */
import { join } from "node:path";
import { compactKnowledgeFile } from "../knowledge/compactor.ts";
import { findEntry, insertAfter, parseEntries, removeEntry, replaceEntry, type KnowledgeEntry } from "../knowledge/edit.ts";
import { addNote, moveNotes, readNotes, removeNote, removeNotesOn, type KnowledgeNote } from "../knowledge/notes.ts";
import { AGENT_DIR_NAMES, KNOWLEDGE_FILES, knowledgeDir, type KnowledgeAgent } from "../knowledge/paths.ts";
import { readFirstExisting } from "../knowledge/store.ts";
import { dataRoot, readDataRoots } from "../state/project.ts";

/** What each knowledge file is, in words. */
export const FILE_LABELS: Record<string, string> = {
  "knowledge.md": "Knowledge",
  "decisions.md": "Decisions",
  "completed-tasks.md": "Completed tasks",
  "standards.md": "Standards",
  "design-language.md": "Design language",
  "engineering-standards.md": "Engineering standards",
  "testing-standards.md": "Testing standards",
};

/** Who the agents are, as the lobby names them. */
export const AGENT_LABELS: Record<KnowledgeAgent, string> = { master: "Master (oracle)", designer: "Designer", backend: "Backend", qa: "QA" };

export interface KnowledgeFileInfo {
  agent: KnowledgeAgent;
  file: string;
  label: string;
  chars: number;
  /** Past the compaction threshold: the Master should compact it. */
  over: boolean;
  notes: number;
}

export interface KnowledgeView extends KnowledgeFileInfo {
  content: string;
  entries: KnowledgeEntry[];
  /** Notes on entries this file has. */
  attached: KnowledgeNote[];
  /** Notes whose entry has changed or gone: kept, shown apart. */
  detached: KnowledgeNote[];
}

/** An entry picked in the tab: its text, and which of several identical ones it is. */
export interface EntryRef {
  text: string;
  occurrence: number;
}

export interface KnowledgeDeps {
  root: string;
  configDir: string;
  /** Characters past which a file is over its compaction threshold. */
  threshold: () => number;
  /** Backups of a file kept in the archive. */
  backups: () => number;
  sessionId?: () => string | undefined;
  now?: () => Date;
}

const CHANGED = "that entry changed on disk since it was drawn — r reloads the file";

export class KnowledgeBook {
  private readonly deps: KnowledgeDeps;

  constructor(deps: KnowledgeDeps) {
    this.deps = deps;
  }

  private get data(): string {
    return dataRoot(this.deps.root, this.deps.configDir);
  }

  private read(agent: KnowledgeAgent, file: string): string {
    return readFirstExisting(readDataRoots(this.deps.root, this.deps.configDir).map((root) => join(knowledgeDir(root, agent), file)));
  }

  /** Every agent's files in the order the tab lists them, with their size and notes. */
  files(): KnowledgeFileInfo[] {
    const notes = readNotes(this.data);
    return (Object.keys(AGENT_DIR_NAMES) as KnowledgeAgent[]).flatMap((agent) =>
      KNOWLEDGE_FILES[agent].map((file) => {
        const chars = this.read(agent, file).length;
        return { agent, file, label: FILE_LABELS[file] ?? file, chars, over: chars > this.deps.threshold(), notes: notes.filter((note) => note.agent === agent && note.file === file).length };
      }),
    );
  }

  /** One file as entries with their notes. */
  open(agent: KnowledgeAgent, file: string): KnowledgeView {
    const content = this.read(agent, file);
    const entries = parseEntries(content);
    const notes = readNotes(this.data).filter((note) => note.agent === agent && note.file === file);
    const known = new Set(entries.map((entry) => entry.text));
    return {
      agent,
      file,
      label: FILE_LABELS[file] ?? file,
      chars: content.length,
      over: content.length > this.deps.threshold(),
      notes: notes.length,
      content,
      entries,
      attached: notes.filter((note) => known.has(note.entry)),
      detached: notes.filter((note) => !known.has(note.entry)),
    };
  }

  /** Write a file's new content with the previous one archived; the notice says where it went. */
  private write(agent: KnowledgeAgent, file: string, content: string): string {
    compactKnowledgeFile({ dataRoot: this.data, agent, file, content, backupCount: this.deps.backups(), ...(this.deps.now ? { now: this.deps.now() } : {}) });
    return `saved ${agent}/${file} — the version before is in archive/${AGENT_DIR_NAMES[agent]}`;
  }

  /** Replace one entry with `text`, exactly as written; its notes move with it. */
  edit(agent: KnowledgeAgent, file: string, ref: EntryRef, text: string): string {
    const content = this.read(agent, file);
    const entry = findEntry(content, ref.text, ref.occurrence);
    if (!entry) return CHANGED;
    if (!text.trim()) return "nothing to save — d d deletes an entry, esc cancels";
    const next = replaceEntry(content, entry, text);
    if (next.trim() === content.trim()) return "nothing changed";
    const notice = this.write(agent, file, next);
    const moved = moveNotes(this.data, agent, file, entry.text, text.replace(/\s+$/, ""), this.deps.now?.());
    return `${notice}${moved > 0 ? `; ${moved} note${moved === 1 ? "" : "s"} stayed with it` : ""}`;
  }

  /** Add a bullet after an entry (at the end when there is none). */
  add(agent: KnowledgeAgent, file: string, after: EntryRef | undefined, text: string): string {
    const content = this.read(agent, file);
    const entry = after ? findEntry(content, after.text, after.occurrence) : undefined;
    if (after && !entry) return CHANGED;
    const next = insertAfter(content, entry, text);
    if (next === content) return "nothing to add";
    return this.write(agent, file, next);
  }

  /** Delete an entry, and the notes on it. */
  remove(agent: KnowledgeAgent, file: string, ref: EntryRef): string {
    const content = this.read(agent, file);
    const entry = findEntry(content, ref.text, ref.occurrence);
    if (!entry) return CHANGED;
    const notice = this.write(agent, file, removeEntry(content, entry));
    const gone = removeNotesOn(this.data, agent, file, entry.text, this.deps.now?.());
    return `${notice}${gone > 0 ? `; its ${gone} note${gone === 1 ? "" : "s"} went with it` : ""}`;
  }

  /** Replace a whole file (edited in pi's editor). */
  replaceFile(agent: KnowledgeAgent, file: string, text: string): string {
    const content = this.read(agent, file);
    if (text.trim() === content.trim()) return "nothing changed";
    return this.write(agent, file, text);
  }

  /** Leave a note on an entry: every agent that reads this knowledge reads it under the entry. */
  comment(agent: KnowledgeAgent, file: string, ref: EntryRef, text: string): string {
    const entry = findEntry(this.read(agent, file), ref.text, ref.occurrence);
    if (!entry) return CHANGED;
    try {
      addNote(this.data, { agent, file, entry: entry.text, text, ...(this.deps.sessionId?.() ? { by: this.deps.sessionId!()! } : {}) }, this.deps.now?.());
    } catch (error) {
      return (error as Error).message;
    }
    return "note saved — every agent reads it under this entry";
  }

  /** Take a note back. */
  unnote(id: string): string {
    removeNote(this.data, id, this.deps.now?.());
    return "note removed";
  }
}
