/**
 * The Knowledge tab over HTTP: every agent's files, one file read as entries
 * with its notes, and the tab's edits (edit, add, delete, whole-file replace,
 * comment, take a note back). Actions answer with the same notice text the
 * terminal shows; an edit whose entry changed on disk since it was drawn is
 * refused with a 409, like the tab's reload hint.
 */
import type { KnowledgeAgent } from "../../knowledge/paths.ts";
import type { EntryRef } from "../../lobby/knowledge.ts";
import type { KnowledgeFileInfo, KnowledgeViewData } from "../protocol.ts";
import type { ApiContext } from "./index.ts";
import { fail } from "./index.ts";

/** The terminal's stale-entry refusal, as `KnowledgeBook` words it. */
function isStale(notice: string): boolean {
  return notice.startsWith("that entry changed on disk");
}

/** Refuse a stale entry with the terminal's own words. */
function stale(notice: string): never {
  fail(409, "conflict", notice);
}

interface FileBody {
  agent: KnowledgeAgent;
  file: string;
}

interface RefBody extends FileBody {
  ref: EntryRef;
}

/** Every agent's files with their size and note counts, in tab order. */
export function knowledgeFiles(ctx: ApiContext): { files: KnowledgeFileInfo[] } {
  return { files: ctx.service.knowledge.files() };
}

/** One file as entries with their notes. */
export function knowledgeOpen(body: FileBody, ctx: ApiContext): { view: KnowledgeViewData } {
  return { view: ctx.service.knowledge.open(body.agent, body.file) };
}

/** Replace one entry with `text`, exactly as written. */
export function knowledgeEdit(body: RefBody & { text: string }, ctx: ApiContext): { notice: string } {
  const notice = ctx.service.knowledge.edit(body.agent, body.file, body.ref, body.text);
  if (isStale(notice)) stale(notice);
  return { notice };
}

/** Add a bullet after an entry (at the end when there is none). */
export function knowledgeAdd(body: FileBody & { ref?: EntryRef; text: string }, ctx: ApiContext): { notice: string } {
  const notice = ctx.service.knowledge.add(body.agent, body.file, body.ref, body.text);
  if (isStale(notice)) stale(notice);
  return { notice };
}

/** Delete an entry, and the notes on it. */
export function knowledgeRemove(body: RefBody, ctx: ApiContext): { notice: string } {
  const notice = ctx.service.knowledge.remove(body.agent, body.file, body.ref);
  if (isStale(notice)) stale(notice);
  return { notice };
}

/** Replace a whole file. */
export function knowledgeReplaceFile(body: FileBody & { text: string }, ctx: ApiContext): { notice: string } {
  return { notice: ctx.service.knowledge.replaceFile(body.agent, body.file, body.text) };
}

/** Leave a note on an entry. */
export function knowledgeComment(body: RefBody & { text: string }, ctx: ApiContext): { notice: string } {
  const notice = ctx.service.knowledge.comment(body.agent, body.file, body.ref, body.text);
  if (isStale(notice)) stale(notice);
  return { notice };
}

/** Take a note back. */
export function knowledgeUnnote(body: { id: string }, ctx: ApiContext): { notice: string } {
  return { notice: ctx.service.knowledge.unnote(body.id) };
}
