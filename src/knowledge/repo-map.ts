/**
 * The repository map: what an agent would otherwise spend its first turns on
 * `find`, `grep` and `read` to learn. The repository's layout, and the files
 * whose path, opening comment or top-level names match the step, each with
 * what it says it is for, the names it declares, and what an earlier scout
 * noted about it while the file is unchanged. It is read from the file index
 * (refreshed by size and modification time) with no model, so it works with
 * the classifier off; a large repository that is not indexed in time is left
 * out rather than waited for.
 */
import type { FileHinter, FileScope, IndexedFile } from "../classifier/files.ts";
import { indexFiles, terms } from "../classifier/files.ts";
import { dataRoot } from "../state/project.ts";
import { currentNotes, type FileNote } from "./file-notes.ts";

export interface RepoMapOptions {
  exclude?: readonly string[];
  /** The map's size, header included. */
  maxChars?: number;
  /** Matching files listed at most. */
  maxFiles?: number;
  /** How long to wait for the index; the map is left out after that (the index still finishes and is cached). */
  budgetMs?: number;
}

export const REPO_MAP_CHARS = 3500;
export const REPO_MAP_FILES = 20;
export const REPO_MAP_BUDGET_MS = 2500;
/** A file needs at least this much in common with the step to be listed: a path word, or a name and an excerpt word. */
const MIN_SCORE = 3;
const LINE_CHARS = 240;
const NAMES_SHOWN = 8;
const PURPOSE_SHOWN = 90;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A word matches a token that is the same word, or the same stem when both are four letters or more (`classifier`, `classifiers`). */
function matches(word: string, tokens: ReadonlySet<string>): boolean {
  if (tokens.has(word)) return true;
  if (word.length < 4) return false;
  for (const token of tokens) if (token.length >= 4 && (token.startsWith(word) || word.startsWith(token))) return true;
  return false;
}

/** How much a file has in common with the step: named outright, then words in its path, names and excerpt. */
function scoreFile(file: IndexedFile, words: readonly string[], query: string, note?: FileNote): number {
  const path = file.path.toLowerCase();
  const name = path.slice(path.lastIndexOf("/") + 1);
  const stem = name.replace(/\.[^.]+$/, "");
  let score = 0;
  if (query.includes(path)) score += 10;
  else if (stem.length >= 4 && new RegExp(`(^|[^\\w-])${escapeRegExp(name)}\\b|\\b${escapeRegExp(stem)}\\.\\w+\\b`).test(query)) score += 6;
  const pathTokens = new Set(terms(file.path));
  const symbolTokens = new Set(terms((file.symbols ?? []).join(" ")));
  const excerptTokens = new Set(terms(file.excerpt));
  const noteTokens = new Set(note ? terms(note.note) : []);
  for (const word of words) {
    if (matches(word, pathTokens)) score += 3;
    if (matches(word, symbolTokens)) score += 2;
    if (matches(word, excerptTokens)) score += 1;
    if (matches(word, noteTokens)) score += 1;
  }
  return score;
}

/** The files most worth listing for a step, best first: at most `max`, each sharing enough with it. */
export function rankForMap(query: string, files: readonly IndexedFile[], max = REPO_MAP_FILES, notes: ReadonlyMap<string, FileNote> = new Map()): IndexedFile[] {
  const words = terms(query);
  const lowered = query.toLowerCase();
  return files
    .map((file, index) => ({ file, index, score: scoreFile(file, words, lowered, notes.get(file.path)), depth: file.path.split("/").length }))
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.depth - b.depth || a.index - b.index)
    .slice(0, max)
    .map((entry) => entry.file);
}

/** The layout in one line: top-level folders by size, with the folders inside the large ones, then root files. */
export function layoutLine(files: readonly IndexedFile[], max = 600): string {
  const top = new Map<string, { count: number; inner: Map<string, number> }>();
  const rootFiles: string[] = [];
  for (const { path } of files) {
    const parts = path.split("/");
    if (parts.length === 1) {
      rootFiles.push(path);
      continue;
    }
    const dir = top.get(parts[0]!) ?? { count: 0, inner: new Map<string, number>() };
    dir.count += 1;
    if (parts.length > 2) dir.inner.set(parts[1]!, (dir.inner.get(parts[1]!) ?? 0) + 1);
    top.set(parts[0]!, dir);
  }
  const dirs = [...top].sort((a, b) => b[1].count - a[1].count).map(([name, dir]) => {
    const inner = [...dir.inner].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([child]) => child);
    return dir.count >= 20 && inner.length > 1 ? `${name}/ (${dir.count}: ${inner.join(", ")})` : `${name}/ (${dir.count})`;
  });
  const line = [...dirs, ...rootFiles.slice(0, 6)].join(" · ");
  return line.length > max ? `${line.slice(0, max - 1).replace(/\s*·?\s*\S*$/, "")} …` : line;
}

/** One file's map entry: path, purpose and names on one line, an unchanged file's scout note under it. */
function fileEntry(file: IndexedFile, note?: FileNote): string {
  const symbols = file.symbols ?? [];
  const names = symbols.length > NAMES_SHOWN ? `${symbols.slice(0, NAMES_SHOWN).join(", ")}, …` : symbols.join(", ");
  const purpose = file.purpose && file.purpose.length > PURPOSE_SHOWN ? `${file.purpose.slice(0, PURPOSE_SHOWN - 1).replace(/\s+\S*$/, "")}…` : file.purpose;
  const head = [`- \`${file.path}\``, purpose ? ` — ${purpose}` : "", names ? ` · ${names}` : ""].join("");
  const line = head.length > LINE_CHARS ? `${head.slice(0, LINE_CHARS - 1)}…` : head;
  if (!note) return line;
  return `${line}\n  scout (${note.domain}, ${note.at.slice(0, 10)}${note.lines ? `, lines ${note.lines}` : ""}): ${note.note}`;
}

const MAP_INTRO = "The repository's layout and the files that match this step, read from the files themselves: path — what the file says it is for · the top-level names it declares. Scout notes are what an earlier scout found in a file that has not changed since. Go straight to the file you need; search only for what the map does not answer, and verify what you rely on.";

/** The map's text for ranked files, kept within `maxChars`; "" when no file matches. */
export function renderRepoMap(layout: string, files: readonly IndexedFile[], notes: ReadonlyMap<string, FileNote>, maxChars = REPO_MAP_CHARS): string {
  if (files.length === 0) return "";
  const lines = ["## Repository map", "", MAP_INTRO, "", `Layout: ${layout}`, "", "Files that match this step:"];
  let size = lines.join("\n").length;
  let listed = 0;
  for (const file of files) {
    const entry = fileEntry(file, notes.get(file.path));
    if (size + entry.length + 1 > maxChars) break;
    lines.push(entry);
    size += entry.length + 1;
    listed += 1;
  }
  return listed > 0 ? lines.join("\n") : "";
}

/** Resolve with the value, or undefined once `ms` pass first. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** The repository map for a step; "" when nothing matches, the index fails or it is not ready within the budget. */
export async function repoMap(scope: FileScope, query: string, options: RepoMapOptions = {}): Promise<string> {
  const indexing = indexFiles(scope, options.exclude ?? []);
  indexing.catch(() => undefined);
  const files = await within(indexing.catch(() => undefined), options.budgetMs ?? REPO_MAP_BUDGET_MS);
  if (!files || files.length === 0) return "";
  const max = options.maxFiles ?? REPO_MAP_FILES;
  // Rank twice: notes only exist for some files, so read them for a wider first cut, then rank with them.
  const wide = rankForMap(query, files, max * 2);
  const notes = await currentNotes(dataRoot(scope.root, scope.configDir), scope.cwd, wide.map((file) => file.path));
  return renderRepoMap(layoutLine(files), rankForMap(query, wide, max, notes), notes, options.maxChars ?? REPO_MAP_CHARS);
}

/** A hinter that also hands each step the repository map, while `on()` says so. */
export function withRepoMap(hinter: FileHinter, scope: FileScope, settings: () => { on: boolean; exclude: readonly string[] }): FileHinter {
  return {
    async block(query, signal, context) {
      const { on, exclude } = settings();
      const map = on ? repoMap(scope, query, { exclude }).catch(() => "") : Promise.resolve("");
      const [likely, mapped] = await Promise.all([hinter.block(query, signal, context), map]);
      return [likely, mapped].filter(Boolean).join("\n\n");
    },
    tools: () => hinter.tools(),
  };
}
