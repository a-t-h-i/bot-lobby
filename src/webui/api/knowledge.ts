/**
 * The Knowledge tab over HTTP: every agent's files, one file read as entries
 * with its notes, and the tab's edits (edit, add, delete, whole-file replace,
 * comment, take a note back). Actions answer with the same notice text the
 * terminal shows; an edit whose entry changed on disk since it was drawn is
 * refused with a 409, like the tab's reload hint.
 */
import type { KnowledgeAgent } from "../../knowledge/paths.ts";
import type { EntryRef } from "../../lobby/knowledge.ts";
import type { KnowledgeAgentName, KnowledgeFileInfo, KnowledgeViewData } from "../protocol.ts";
import { INHERIT_MODEL, type BotLobbyConfig } from "../../schemas/configuration.ts";
import { loadConfig } from "../../state/project.ts";
import type { ApiContext } from "./index.ts";
import { fail } from "./index.ts";
import { withAttachments } from "../uploads.ts";

/** Ask the oracle directly; a knowledge question never starts a task. */
export function knowledgeAsk(body: { text: string; attachments?: string[] }, ctx: ApiContext): { notice: string } {
  if (!body.text.trim() && !body.attachments?.length) fail(400, "bad_request", "type a question first");
  const busy = ctx.service.masterBusy();
  ctx.service.askKnowledge(withAttachments(body.text, body.attachments, undefined, ctx.service.projectRoot?.()));
  return { notice: busy ? "question queued — the oracle answers after its current turn" : "the oracle is checking project knowledge" };
}

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
export function knowledgeFiles(ctx: ApiContext): { files: KnowledgeFileInfo[]; models: Record<KnowledgeAgentName, string> } {
  return { files: ctx.service.knowledge.files(), models: agentModels(ctx.service.config?.() ?? loadConfig()) };
}

/** The model each knowledge-keeping agent runs on, as the tree names it ("session model" when none is pinned). */
export function agentModels(config: BotLobbyConfig): Record<KnowledgeAgentName, string> {
  const named = (model: string) => (model === INHERIT_MODEL || !model.trim() ? "session model" : model);
  return { master: named(config.master.model), designer: named(config.agents.designer.model), backend: named(config.agents.backend.model), qa: named(config.agents.qa.model) };
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
