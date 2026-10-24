/**
 * The shared knowledge glossary: a derived, persisted catalogue over the
 * existing authoritative sources — the agents' knowledge files (knowledge,
 * standards, decisions, completed tasks) and the scouts' source-backed file
 * notes. The files stay canonical; the catalogue only records where each
 * passage is, what it is about, and whether it can still be found the way it
 * was indexed. Nothing here writes to knowledge.
 *
 * Identity: a passage is its text, not its line numbers. A refresh matches
 * passages by exact text and occurrence, so unrelated insertions and moves
 * keep their reference; a unique edited match keeps its reference marked
 * changed; anything deleted, duplicated or ambiguous goes stale and is never
 * silently replaced. A corrupt catalogue is rebuilt under a new generation
 * with fresh reference ids, so old persisted references cannot redirect.
 *
 * Refresh is incremental: sources are stat'ed and only changed ones are
 * re-read; the whole walk is bounded and cancellable, and reports complete,
 * partial, stale or unavailable coverage. Writes take a fail-closed lock
 * (stale locks from a crashed writer are broken only once clearly old) and
 * land through a unique temp file and an atomic rename.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { AGENT_DIR_NAMES, KNOWLEDGE_FILES, knowledgeDir, type KnowledgeAgent } from "./paths.ts";
import { parseEntries, type EntryKind } from "./edit.ts";
import { fileNotesPath, readFileNotes } from "./file-notes.ts";

export const CATALOGUE_VERSION = 1;
/** Longest the catalogue grows; the stale entries go first. */
export const MAX_CATALOGUE_ENTRIES = 2000;
export const MAX_TITLE_CHARS = 120;
export const MAX_DESCRIPTION_CHARS = 240;
export const MAX_TOPICS = 12;
/** How long a refresh walks before it reports partial coverage. */
export const REFRESH_BUDGET_MS = 1500;
/** The default character budget for a search page and for an opened passage response. */
export const RESPONSE_BUDGET_CHARS = 4000;
const LOCK_WAIT_MS = 2000;
/** A lock older than this was left by a crashed writer and is broken. */
const STALE_LOCK_MS = 30_000;
/**
 * A reference id, matched as one exact token, never split on hyphens: either
 * `K-<generation uuid>-<counter>` (every id minted now, so ids from different
 * catalogue generations can never collide) or a legacy `K-<counter>` preserved
 * from an older catalogue.
 */
export const REFERENCE_ID_PATTERN = /K-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-)?\d+/gi;
const GENERATION_REF = /^K-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d+)$/i;
const LEGACY_REF = /^K-(\d+)$/i;

/** True when the whole string is a well-formed reference id in either namespace. */
export function isReferenceId(text: string): boolean {
  return GENERATION_REF.test(text) || LEGACY_REF.test(text);
}

/** The generation a generation-tagged reference id was minted in; legacy ids carry none. */
export function generationOfRef(ref: string): string | undefined {
  return GENERATION_REF.exec(ref)?.[1];
}

/** A passage whose text looks like it carries a credential is never indexed. */
const SECRET_PATTERN = /(api[-_]?key|secret|password|passwd|credential|private[- ]key)\s*[:=]/i;

export type CatalogueKind = "knowledge" | "standard" | "decision" | "completed" | "finding";
export type CatalogueOrigin = "knowledge-file" | "file-note";
export type CatalogueScope = "project" | "task";
export type Freshness = "current" | "changed" | "stale";
export type Coverage = "complete" | "partial" | "stale" | "unavailable";

export interface PassageLocator {
  /** The nearest heading above the passage, when the file has one. */
  heading?: string;
  /** Where the passage sat when indexed; navigation hints, never identity. */
  start: number;
  end: number;
  /** The passage's exact text — what identity is reconciled against. */
  text: string;
  /** Which of the passages with this same text it is. */
  occurrence: number;
}

/** A repository file the passage's truth depends on, with its hash when recorded. */
export interface CodeDependency {
  path: string;
  hash: string;
}

export interface CatalogueEntry {
  id: string;
  sourceKey: string;
  title: string;
  description: string;
  kind: CatalogueKind;
  agent: string;
  origin: CatalogueOrigin;
  scope: CatalogueScope;
  locator: PassageLocator;
  /** Related paths, aliases and symbols the passage names, when any. */
  topics: string[];
  freshness: Freshness;
  /** Bumped when the passage changed under the same id. */
  revision: number;
  /** Reference ids this entry or its notes record as conflicting or superseding. */
  conflicts: string[];
  codeDependency?: CodeDependency;
  staleAt?: string;
}

export interface CatalogueSource {
  key: string;
  file: string;
  agent: string;
  kind: CatalogueKind;
  origin: CatalogueOrigin;
  fingerprint: string;
  size: number;
  mtimeMs: number;
}

export interface Catalogue {
  version: number;
  generation: string;
  nextId: number;
  revision: number;
  builtAt: string;
  sources: Record<string, CatalogueSource>;
  entries: CatalogueEntry[];
}

export interface SourceRef {
  key: string;
  file: string;
  agent: KnowledgeAgent;
  kind: CatalogueKind;
  origin: CatalogueOrigin;
}

export interface Passage {
  text: string;
  start: number;
  end: number;
  kind: EntryKind;
  heading?: string;
  occurrence: number;
  agent?: string;
  topics?: string[];
  codeDependency?: CodeDependency;
}

export interface RefreshOptions {
  now?: Date;
  budgetMs?: number;
  signal?: AbortSignal;
}

export interface RefreshResult {
  catalogue: Catalogue;
  coverage: Coverage;
  /** Passages not indexed because their text looks like it carries a secret. */
  skippedSecrets: number;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function cataloguePath(dataRoot: string): string {
  return join(dataRoot, "cache", "knowledge-catalogue.json");
}

/** The persisted catalogue, or undefined when it is missing, torn or corrupt. */
export function loadCatalogue(dataRoot: string): Catalogue | undefined {
  try {
    const parsed = JSON.parse(readFileSync(cataloguePath(dataRoot), "utf8")) as Partial<Catalogue>;
    const ok = parsed.version === CATALOGUE_VERSION
      && typeof parsed.generation === "string"
      && typeof parsed.nextId === "number"
      && typeof parsed.revision === "number"
      && typeof parsed.sources === "object"
      && Array.isArray(parsed.entries);
    return ok ? (parsed as Catalogue) : undefined;
  } catch {
    return undefined;
  }
}

function canonical(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function within(root: string, file: string): boolean {
  const base = root.endsWith(sep) ? root : root + sep;
  return file === root || file.startsWith(base);
}

/** The canonical file of a source, or undefined when it escapes its data tree (a symlink out, say). */
function canonicalSource(dataRoot: string, path: string): string | undefined {
  const file = canonical(path);
  const root = canonical(dataRoot);
  return file && root && within(root, file) ? file : undefined;
}

function kindOf(file: string): CatalogueKind {
  if (file === "decisions.md") return "decision";
  if (file === "completed-tasks.md") return "completed";
  return file === "knowledge.md" ? "knowledge" : "standard";
}

/**
 * The accepted sources: every agent's four knowledge files in every data
 * tree (the live one and the read-only pre-rename ones). Nothing else — no
 * repository contents, no session transcripts, no scratchpads — is indexed.
 */
export function knowledgeSourceRefs(dataRoots: readonly string[]): SourceRef[] {
  const refs: SourceRef[] = [];
  for (const dataRoot of dataRoots) {
    for (const agent of Object.keys(AGENT_DIR_NAMES) as KnowledgeAgent[]) {
      for (const file of KNOWLEDGE_FILES[agent]) {
        const path = canonicalSource(dataRoot, join(knowledgeDir(dataRoot, agent), file));
        if (path) refs.push({ key: `kf:${path}`, file: path, agent, kind: kindOf(file), origin: "knowledge-file" });
      }
    }
  }
  return refs;
}

/** The scouts' file notes, one source with one passage per note. */
export function fileNoteSourceRef(dataRoot: string | undefined): SourceRef | undefined {
  if (!dataRoot) return undefined;
  const path = canonicalSource(dataRoot, fileNotesPath(dataRoot));
  return path ? { key: `fn:${path}`, file: path, agent: "master", kind: "finding", origin: "file-note" } : undefined;
}

/** Every accepted source for these data trees, knowledge files first. */
export function allSourceRefs(dataRoots: readonly string[]): SourceRef[] {
  const notes = fileNoteSourceRef(dataRoots[0]);
  return notes ? [...knowledgeSourceRefs(dataRoots), notes] : knowledgeSourceRefs(dataRoots);
}

/** A source's stat and fingerprint, or undefined when it is missing or not a file. Unchanged sources are not re-read. */
function sourceState(file: string, known?: CatalogueSource): { fingerprint: string; size: number; mtimeMs: number } | undefined {
  try {
    const info = statSync(file);
    if (!info.isFile()) return undefined;
    if (known && known.size === info.size && known.mtimeMs === info.mtimeMs) {
      return { fingerprint: known.fingerprint, size: info.size, mtimeMs: info.mtimeMs };
    }
    const fingerprint = createHash("sha1").update(readFileSync(file)).digest("hex");
    return { fingerprint, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return undefined;
  }
}

/** A knowledge file's passages: bullets, paragraphs and inner headings, each with the heading above it. */
function filePassages(content: string): Passage[] {
  const passages: Passage[] = [];
  let heading: string | undefined;
  for (const entry of parseEntries(content)) {
    if (entry.kind === "heading") {
      if (!entry.text.startsWith("# ")) heading = entry.text.replace(/^#+\s*/, "# ");
      continue;
    }
    passages.push({ text: entry.text, start: entry.start, end: entry.end, kind: entry.kind, occurrence: entry.occurrence, ...(heading ? { heading } : {}) });
  }
  return passages;
}

/** One file note as a passage: the note is the content; the path it is about is the code dependency. */
export function fileNotePassages(dataRoot: string): Passage[] {
  return Object.entries(readFileNotes(dataRoot)).map(([path, note]) => ({
    text: `- ${path}: ${note.note}`,
    start: 0,
    end: 1,
    kind: "bullet" as const,
    occurrence: 0,
    agent: note.domain,
    topics: [path],
    codeDependency: { path, hash: note.hash },
  }));
}

function titleOf(text: string): string {
  const first = text.split("\n")[0] ?? "";
  return first.replace(/^#+\s*/, "").replace(/^[-*+]\s*/, "").trim().slice(0, MAX_TITLE_CHARS);
}

/** Paths and backticked symbols the passage names, bounded; aliases the ranking can use. */
function topicsOf(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/`([^`]+)`/g)) found.add(match[1]!.trim());
  for (const match of text.matchAll(/[\w./-]+\.(?:ts|tsx|js|jsx|json|md|sh)\b/g)) found.add(match[0]);
  return [...found].slice(0, MAX_TOPICS);
}

/** Reference ids the passage itself records as related conflicts or supersessions. */
function mentionedIds(text: string, self: string): string[] {
  return [...new Set((text.match(REFERENCE_ID_PATTERN) ?? []).filter((id) => id !== self))].slice(0, 8);
}

function newEntry(catalogue: Catalogue, ref: SourceRef, passage: Passage): CatalogueEntry {
  const id = `K-${catalogue.generation}-${catalogue.nextId}`;
  catalogue.nextId += 1;
  const clean = passage.text.replace(/\s+/g, " ").trim();
  return {
    id,
    sourceKey: ref.key,
    title: titleOf(passage.text),
    description: clean.slice(0, MAX_DESCRIPTION_CHARS),
    kind: ref.kind,
    agent: passage.agent ?? ref.agent,
    origin: ref.origin,
    scope: "project",
    locator: { start: passage.start, end: passage.end, text: passage.text, occurrence: passage.occurrence, ...(passage.heading ? { heading: passage.heading } : {}) },
    topics: passage.topics ?? topicsOf(passage.text),
    freshness: "current",
    revision: 1,
    conflicts: mentionedIds(passage.text, id),
    ...(passage.codeDependency ? { codeDependency: passage.codeDependency } : {}),
  };
}

/** Carry an id over to a passage found again (or uniquely re-matched after an edit). */
function carried(entry: CatalogueEntry, passage: Passage, freshness: Exclude<Freshness, "stale">): CatalogueEntry {
  const revision = freshness === "changed" ? entry.revision + 1 : entry.revision;
  const clean = passage.text.replace(/\s+/g, " ").trim();
  return {
    ...entry,
    title: titleOf(passage.text),
    description: clean.slice(0, MAX_DESCRIPTION_CHARS),
    locator: { start: passage.start, end: passage.end, text: passage.text, occurrence: passage.occurrence, ...(passage.heading ? { heading: passage.heading } : {}) },
    topics: passage.topics ?? topicsOf(passage.text),
    freshness,
    revision,
    conflicts: mentionedIds(passage.text, entry.id),
    staleAt: undefined,
  };
}

function staled(entry: CatalogueEntry, now: Date): CatalogueEntry {
  return { ...entry, freshness: "stale", staleAt: now.toISOString() };
}

function matchKey(text: string, occurrence: number): string {
  return `${occurrence}\u0000${text}`;
}

interface ReconcileContext {
  now: Date;
}

/**
 * Reconcile one changed source's passages against its previous entries.
 * Exact text + occurrence keeps the id; a unique edited-title match keeps it
 * marked changed; the rest of the old entries go stale and the rest of the
 * passages get fresh ids, so duplicates and guesses never cross-link.
 */
function reconcile(prior: CatalogueEntry[], passages: readonly Passage[], catalogue: Catalogue, ref: SourceRef, ctx: ReconcileContext): CatalogueEntry[] {
  const byText = new Map(prior.map((entry) => [matchKey(entry.locator.text, entry.locator.occurrence), entry]));
  const consumed = new Set<string>();
  const next: CatalogueEntry[] = [];
  const unmatched: Passage[] = [];
  for (const passage of passages) {
    const exact = byText.get(matchKey(passage.text, passage.occurrence));
    if (exact && !consumed.has(exact.id)) {
      consumed.add(exact.id);
      next.push(carried(exact, passage, "current"));
    } else unmatched.push(passage);
  }
  const edited = editedMatches(unmatched, prior.filter((entry) => !consumed.has(entry.id)), consumed);
  for (const passage of unmatched) {
    const match = edited.get(passage);
    if (match) next.push(carried(match, passage, "changed"));
    else next.push(newEntry(catalogue, ref, passage));
  }
  for (const entry of prior) if (!consumed.has(entry.id)) next.push(staled(entry, ctx.now));
  return next;
}

/** Passages and previous entries that share a unique first line keep the entry's id, marked changed. */
function editedMatches(passages: readonly Passage[], candidates: readonly CatalogueEntry[], consumed: Set<string>): Map<Passage, CatalogueEntry> {
  const byTitle = new Map<string, CatalogueEntry[]>();
  for (const entry of candidates) {
    const title = titleOf(entry.locator.text);
    byTitle.set(title, [...(byTitle.get(title) ?? []), entry]);
  }
  const byPassageTitle = new Map<string, Passage[]>();
  for (const passage of passages) {
    const title = titleOf(passage.text);
    byPassageTitle.set(title, [...(byPassageTitle.get(title) ?? []), passage]);
  }
  const matches = new Map<Passage, CatalogueEntry>();
  for (const [title, group] of byPassageTitle) {
    const priors = (byTitle.get(title) ?? []).filter((entry) => !consumed.has(entry.id));
    if (group.length === 1 && priors.length === 1) {
      matches.set(group[0]!, priors[0]!);
      consumed.add(priors[0]!.id);
    }
  }
  return matches;
}

interface WalkContext extends ReconcileContext {
  deadline: number;
  signal?: AbortSignal;
}

interface Walk {
  catalogue: Catalogue;
  coverage: Coverage;
  skippedSecrets: number;
}

function stopped(ctx: WalkContext): boolean {
  return Date.now() > ctx.deadline || (ctx.signal?.aborted ?? false);
}

/** Every entry of a source that is gone (or symlinked away) becomes stale; its source record is dropped. */
function markSourceMissing(catalogue: Catalogue, key: string, now: Date): void {
  delete catalogue.sources[key];
  catalogue.entries = catalogue.entries.map((entry) => (entry.sourceKey === key && entry.freshness !== "stale" ? staled(entry, now) : entry));
}

function indexSource(catalogue: Catalogue, ref: SourceRef, state: { fingerprint: string; size: number; mtimeMs: number }, ctx: WalkContext): number {
  const content = readFileSync(ref.file, "utf8");
  const parsed = ref.origin === "file-note" ? fileNotePassages(dirname(dirname(ref.file))) : filePassages(content);
  const kept = parsed.filter((passage) => !SECRET_PATTERN.test(passage.text));
  const prior = catalogue.entries.filter((entry) => entry.sourceKey === ref.key);
  const reconciled = reconcile(prior, kept, catalogue, ref, ctx);
  const others = catalogue.entries.filter((entry) => entry.sourceKey !== ref.key);
  catalogue.entries = [...others, ...reconciled];
  catalogue.sources[ref.key] = { key: ref.key, file: ref.file, agent: ref.agent, kind: ref.kind, origin: ref.origin, fingerprint: state.fingerprint, size: state.size, mtimeMs: state.mtimeMs };
  return parsed.length - kept.length;
}

/** Walk every accepted source, re-reading only the changed ones, within the budget. */
function walkSources(dataRoots: readonly string[], catalogue: Catalogue, ctx: WalkContext): Walk {
  const walk: Walk = { catalogue, coverage: "complete", skippedSecrets: 0 };
  const seen = new Set<string>();
  for (const ref of allSourceRefs(dataRoots)) {
    if (stopped(ctx)) return { ...walk, coverage: "partial" };
    seen.add(ref.key);
    const state = sourceState(ref.file, catalogue.sources[ref.key]);
    if (!state) {
      markSourceMissing(walk.catalogue, ref.key, ctx.now);
      continue;
    }
    if (walk.catalogue.sources[ref.key]?.fingerprint === state.fingerprint) continue;
    walk.skippedSecrets += indexSource(walk.catalogue, ref, state, ctx);
  }
  for (const key of Object.keys(walk.catalogue.sources)) if (!seen.has(key)) markSourceMissing(walk.catalogue, key, ctx.now);
  return walk;
}

/** Stale entries go first, then the lowest ids, until the catalogue is within its cap. */
function trimCatalogue(catalogue: Catalogue): Catalogue {
  const over = catalogue.entries.length - MAX_CATALOGUE_ENTRIES;
  if (over <= 0) return catalogue;
  const order = (entry: CatalogueEntry) => `${entry.staleAt ? `0${entry.staleAt}` : "1"}\u0000${entry.id.padStart(12, "0")}`;
  const dropped = new Set([...catalogue.entries].sort((a, b) => order(a).localeCompare(order(b))).slice(0, over).map((entry) => entry.id));
  return { ...catalogue, entries: catalogue.entries.filter((entry) => !dropped.has(entry.id)) };
}

function saveCatalogue(dataRoot: string, catalogue: Catalogue): void {
  const path = cataloguePath(dataRoot);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(catalogue)}\n`);
  renameSync(tmp, path);
}

/**
 * Hold the catalogue's lock and run `write`, or fail closed: a writer that
 * cannot get the lock in time throws instead of writing anyway. Only a lock
 * clearly older than any live writer (a crashed one's) is broken.
 */
function withLock<T>(path: string, write: () => T): T {
  const lock = `${path}.lock`;
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) rmSync(lock, { recursive: true, force: true });
      } catch {
        // Gone already.
      }
      if (Date.now() > until) throw new Error("the knowledge catalogue is busy; try again");
      sleep(5);
    }
  }
  try {
    return write();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Persist the catalogue under its lock; a caller must not write without it. */
export function persistCatalogue(dataRoot: string, catalogue: Catalogue): void {
  withLock(cataloguePath(dataRoot), () => saveCatalogue(dataRoot, catalogue));
}

/** A fresh catalogue starts a new generation namespace; its counters begin at 1 inside it. */
function emptyCatalogue(_dataRoot: string, now: Date): Catalogue {
  return {
    version: CATALOGUE_VERSION,
    generation: randomUUID(),
    nextId: 1,
    revision: 0,
    builtAt: now.toISOString(),
    sources: {},
    entries: [],
  };
}

function finishRefresh(walk: Walk, dataRoot: string, now: Date): RefreshResult {
  const next = trimCatalogue({ ...walk.catalogue, revision: walk.catalogue.revision + 1, builtAt: now.toISOString() });
  try {
    persistCatalogue(dataRoot, next);
  } catch {
    return { catalogue: walk.catalogue, coverage: "stale", skippedSecrets: walk.skippedSecrets };
  }
  const empty = next.entries.length === 0 && Object.keys(next.sources).length === 0;
  return { catalogue: next, coverage: empty ? "unavailable" : "complete", skippedSecrets: walk.skippedSecrets };
}

/**
 * Bring the catalogue up to date with the sources: stat every accepted
 * source, re-read and re-reconcile only the changed ones, and persist the
 * result. Bounded and cancellable; a budget or lock that gives out is
 * reported as partial or stale coverage, never as a silent full refresh.
 */
export function refreshCatalogue(dataRoots: readonly string[], options: RefreshOptions = {}): RefreshResult {
  const now = options.now ?? new Date();
  const dataRoot = dataRoots[0]!;
  const prior = loadCatalogue(dataRoot);
  const start = prior ?? emptyCatalogue(dataRoot, now);
  const ctx: WalkContext = { now, deadline: Date.now() + (options.budgetMs ?? REFRESH_BUDGET_MS), ...(options.signal ? { signal: options.signal } : {}) };
  const walk = walkSources(dataRoots, start, ctx);
  if (walk.coverage !== "complete") return { catalogue: start, coverage: walk.coverage, skippedSecrets: 0 };
  return finishRefresh(walk, dataRoot, now);
}
