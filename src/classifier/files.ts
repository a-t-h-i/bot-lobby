/**
 * Likely files: instead of an agent spending its first turns on `find` and
 * `grep`, the engine ranks the repository's files against the step and hands
 * the agent a short list up front (and, inside subagents, a
 * `find_relevant_files` tool for later lookups).
 *
 * Every file gets a short excerpt — its leading comment, imports and
 * signatures, never the whole file — kept in a cache that is refreshed by
 * size and modification time. A lexical prefilter narrows a large repository
 * to the most promising candidates; the classifier then judges each one
 * independently (one yes/no per file, in parallel batches), so batches merge
 * by sorting. Secrets and anything matching `classifier.exclude` are never
 * indexed.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { dataRoot } from "../state/project.ts";
import type { Classifier } from "./classifier.ts";
import { noul, yesOf, type SystemOneRequest } from "./client.ts";
import { clip, LIMITS } from "./limits.ts";

const run = promisify(execFile);

export const FIND_FILES_TOOL = "find_relevant_files";

/** Where the index lives and which tree it describes. */
export interface FileScope {
  cwd: string;
  root: string;
  configDir: string;
}

export interface IndexedFile {
  path: string;
  excerpt: string;
}

export interface LikelyFile {
  path: string;
  relevance: number;
}

export interface LikelyFiles {
  files: LikelyFile[];
  /** How likely any candidate answers the query at all. */
  anyRelevant: number;
  /** Files the classifier judged. */
  judged: number;
  ms: number;
}

/** Never sent anywhere: keys, certificates, env files and the like. */
export const SECRET_EXCLUDES: readonly string[] = [
  ".env", ".env.*", "*.env", "*.pem", "*.key", "*.p12", "*.pfx", "*.keystore", "*.jks", "*.kdbx",
  "id_rsa*", "id_dsa*", "id_ecdsa*", "id_ed25519*", "**/secrets/**", "**/.ssh/**", "**/.aws/**",
  "*.secret", "*secrets.json", "*secrets.yaml", "*secrets.yml", "*secrets.toml", "credentials", "credentials.json",
  ".npmrc", ".pypirc", ".netrc", ".git-credentials",
];

/** Directories never walked (when git is not there to list files). */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".nuxt", ".cache", "vendor", "target", ".venv", "venv", "__pycache__", ".pi", ".idea", ".vscode"]);

/** Files that carry no signal for "which file does this step need". */
const SKIP_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "svgz", "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "war",
  "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4", "mov", "avi", "webm", "wav", "ogg", "flac", "exe", "dll", "so", "dylib", "bin",
  "class", "o", "a", "pyc", "wasm", "map", "lock", "sqlite", "db",
]);
const SKIP_NAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "Cargo.lock", "poetry.lock", "composer.lock", "Gemfile.lock", "go.sum"]);

export const MAX_FILES = 20_000;
export const MAX_FILE_BYTES = 256 * 1024;
const HEAD_BYTES = 8 * 1024;
export const EXCERPT_CHARS = 400;
/** Candidates per classifier call; each costs its excerpt plus one short question. */
export const BATCH_SIZE = 150;
const BATCH_CHARS = 90_000;
/** Below this, no list is shown: pointing an agent at the least irrelevant files would mislead it. */
export const ANY_RELEVANT_FLOOR = 0.3;

/** A path glob as a regular expression: `**` spans directories, `*` and `?` stay within one. */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      pattern += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") pattern += "[^/]*";
    else if (char === "?") pattern += "[^/]";
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`, "i");
}

/** A path is excluded when a glob matches it, or its file name for a glob without a slash. */
export function excludedBy(globs: readonly string[]): (path: string) => boolean {
  const tests = globs.map((glob) => ({ regex: globToRegExp(glob), basename: !glob.includes("/") }));
  return (path) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return tests.some(({ regex, basename }) => regex.test(path) || (basename && regex.test(name)));
  };
}

function skippable(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (SKIP_NAMES.has(name) || /\.min\.(js|css)$/i.test(name)) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && SKIP_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

const SIGNATURE = /^(export\s|(?:pub(?:\(\w+\))?\s+)?(?:async\s+)?(?:fn|func|def|class|function|interface|type|enum|struct|trait|impl|module|namespace|protocol|record)\s|const\s+\w+\s*=\s*(?:async\s*)?(?:\(|function)|(?:public|private|protected|internal)\s+(?:static\s+)?[\w<>[\],\s]+\s+\w+\s*\(|@(?:app|router)\.\w+\(|describe\(|test\(|it\()/;
const IMPORT = /^(import\s|from\s+\S+\s+import\s|(?:const|let|var)\s+\w+\s*=\s*require\(|use\s+[\w:]+|#include\s|using\s+[\w.]+;|package\s+[\w.]+)/;
const COMMENT = /^(\/\/|\/\*|\*|#(?![!#])|"""|'''|<!--|--\s|;)/;

/**
 * What a file is about in a few hundred characters: its leading comment, its
 * signatures (headings for Markdown), then its imports; the first lines when
 * none of those exist.
 */
export function excerptOf(path: string, text: string, max = EXCERPT_CHARS): string {
  const lines = text.split(/\r?\n/).slice(0, 600);
  const markdown = /\.(md|mdx|markdown|rst|txt)$/i.test(path);
  const lead: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (lead.length > 0) break;
      continue;
    }
    if (trimmed.startsWith("#!")) continue;
    if (markdown || !COMMENT.test(trimmed)) break;
    const words = trimmed.replace(/^(\/\*+|\*+\/?|\/\/+|#+|"""|'''|<!--|--|;+)\s*/, "").replace(/\*\/$|-->$/, "").trim();
    if (words) lead.push(words);
    if (lead.length >= 4) break;
  }
  const signatures: string[] = [];
  const imports: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (markdown ? /^#{1,3}\s+\S/.test(trimmed) : SIGNATURE.test(trimmed)) {
      if (signatures.length < 14) signatures.push(trimmed.replace(/\s*\{\s*\}?\s*$/, "").replace(/\s+/g, " ").slice(0, 120));
    } else if (!markdown && IMPORT.test(trimmed) && imports.length < 6) {
      imports.push(trimmed.replace(/\s+/g, " ").slice(0, 80));
    }
  }
  // Half the room at most for the comment, so the signatures always show.
  const parts = [clip(lead.join(" "), Math.floor(max / 2)), signatures.join("\n"), imports.length > 0 ? imports.join("; ") : ""].filter(Boolean);
  const body = parts.length > 0 ? parts.join("\n") : lines.map((line) => line.trim()).filter(Boolean).slice(0, 6).join("\n");
  return clip(body, max);
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  excerpt: string;
}

interface CacheFile {
  version: 1;
  cwd: string;
  files: Record<string, CacheEntry>;
}

export function fileCachePath(scope: FileScope): string {
  return join(dataRoot(scope.root, scope.configDir), "cache", "files.json");
}

function readCache(scope: FileScope): Record<string, CacheEntry> {
  try {
    const parsed = JSON.parse(readFileSync(fileCachePath(scope), "utf8")) as Partial<CacheFile>;
    return parsed.version === 1 && parsed.cwd === scope.cwd && parsed.files && typeof parsed.files === "object" ? parsed.files : {};
  } catch {
    return {};
  }
}

function writeCache(scope: FileScope, files: Record<string, CacheEntry>): void {
  const path = fileCachePath(scope);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, cwd: scope.cwd, files } satisfies CacheFile));
    renameSync(`${path}.tmp`, path);
  } catch {
    // The cache is an optimisation; a read-only tree just re-reads next time.
  }
}

/** Files git tracks or would track (untracked but not ignored); undefined outside a git work tree. */
async function gitFiles(cwd: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await run("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 10_000 });
    return stdout.split("\0").filter(Boolean).slice(0, MAX_FILES);
  } catch {
    return undefined;
  }
}

async function walkFiles(cwd: string): Promise<string[]> {
  const found: string[] = [];
  const queue = [""];
  while (queue.length > 0 && found.length < MAX_FILES) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(join(cwd, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) queue.push(path);
      } else if (entry.isFile()) found.push(path);
    }
  }
  return found.slice(0, MAX_FILES);
}

async function readHead(path: string): Promise<string | undefined> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    const head = buffer.subarray(0, bytesRead);
    return head.includes(0) ? undefined : head.toString("utf8");
  } finally {
    await handle.close();
  }
}

/**
 * The repository's files with their excerpts. Unchanged files come from the
 * cache (same size and modification time); new or changed ones are read
 * (their first 8 KB) and the cache is rewritten.
 */
export async function indexFiles(scope: FileScope, exclude: readonly string[] = []): Promise<IndexedFile[]> {
  const listed = (await gitFiles(scope.cwd)) ?? (await walkFiles(scope.cwd));
  const excluded = excludedBy([...SECRET_EXCLUDES, ...exclude]);
  const paths = listed.filter((path) => !path.startsWith(`${scope.configDir}/`) && !skippable(path) && !excluded(path));
  const cached = readCache(scope);
  const next: Record<string, CacheEntry> = {};
  let changed = Object.keys(cached).length !== paths.length;
  const indexed: IndexedFile[] = [];
  const CONCURRENCY = 64;
  for (let start = 0; start < paths.length; start += CONCURRENCY) {
    const slice = paths.slice(start, start + CONCURRENCY);
    const entries = await Promise.all(slice.map(async (path): Promise<[string, CacheEntry] | undefined> => {
      try {
        const info = await stat(join(scope.cwd, path));
        if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined;
        const hit = cached[path];
        if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return [path, hit];
        const head = await readHead(join(scope.cwd, path));
        if (head === undefined) return undefined;
        changed = true;
        return [path, { mtimeMs: info.mtimeMs, size: info.size, excerpt: excerptOf(path, head) }];
      } catch {
        return undefined;
      }
    }));
    for (const entry of entries) {
      if (!entry) continue;
      next[entry[0]] = entry[1];
      indexed.push({ path: entry[0], excerpt: entry[1].excerpt });
    }
  }
  if (changed) writeCache(scope, next);
  return indexed;
}

const STOPWORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "when", "then", "than", "should", "must", "will", "not", "are", "was", "has", "have", "its", "you", "our", "use", "add", "make", "file", "files", "code", "step", "task", "all", "any", "new", "can", "get", "set"]);

/** Words of three letters or more, camelCase and snake_case split, stopwords dropped. */
export function terms(text: string): string[] {
  return [...new Set(text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !STOPWORDS.has(word)))];
}

/**
 * The most promising candidates for a query, at most `max`: files whose path
 * (weighted three times) or excerpt share its words first, then the
 * shallowest files, so a small repository is judged whole.
 */
export function prefilter(query: string, files: readonly IndexedFile[], max: number): IndexedFile[] {
  if (files.length <= max) return [...files];
  const words = terms(query);
  const scored = files.map((file, index) => {
    const path = file.path.toLowerCase();
    const excerpt = file.excerpt.toLowerCase();
    const score = words.reduce((total, word) => total + (path.includes(word) ? 3 : 0) + (excerpt.includes(word) ? 1 : 0), 0);
    return { file, index, score, depth: file.path.split("/").length };
  });
  scored.sort((a, b) => b.score - a.score || a.depth - b.depth || a.index - b.index);
  return scored.slice(0, max).map((entry) => entry.file);
}

const ANY_KEY = "any_relevant";

/** Split candidates into requests that fit one call each. */
export function rankRequests(query: string, candidates: readonly IndexedFile[], context?: string): Array<{ request: SystemOneRequest; keys: Map<string, string> }> {
  const batches: Array<{ request: SystemOneRequest; keys: Map<string, string> }> = [];
  let entries: Record<string, string> = {};
  let questions: SystemOneRequest["questions"] = {};
  let keys = new Map<string, string>();
  let size = 0;
  const flush = () => {
    if (keys.size === 0) return;
    questions[ANY_KEY] = noul("Does at least one entry in `candidates` hold what `query` needs?");
    batches.push({ request: { state: { query: clip(query, 3000), ...(context ? { context: clip(context, 2000) } : {}), candidates: entries }, questions }, keys });
    entries = {};
    questions = {};
    keys = new Map();
    size = 0;
  };
  candidates.forEach((file, index) => {
    const key = `c${index + 1}`;
    const text = `${file.path}\n${file.excerpt}`;
    const question = noul(`Would an agent doing \`query\` need to read or change \`candidates.${key}\` (a file path, then its opening lines and signatures)? Yes if it holds the code, config, tests or docs the task touches; no if it is about something else or only shares words with it.`);
    const cost = text.length + JSON.stringify(question).length + 16;
    if (keys.size >= BATCH_SIZE || (keys.size > 0 && size + cost > BATCH_CHARS)) flush();
    entries[key] = text;
    questions[key] = question;
    keys.set(key, file.path);
    size += cost;
  });
  flush();
  return batches.filter((batch) => JSON.stringify(batch.request).length <= LIMITS.requestChars);
}

export interface LikelyOptions {
  topK?: number;
  signal?: AbortSignal;
  /** Stop waiting after this long and go without (the index keeps building for next time). */
  budgetMs?: number;
  /** Shared context every file is judged against (the task, not only this step). */
  context?: string;
}

/** Rank the repository's files for a query; undefined when the classifier is off, fails or runs out of time. */
export async function likelyFiles(classifier: Classifier, scope: FileScope, query: string, options: LikelyOptions = {}): Promise<LikelyFiles | undefined> {
  if (!classifier.enabled("files") || !query.trim()) return undefined;
  const settings = classifier.config;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = options.budgetMs && options.budgetMs > 0
    ? new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(undefined);
        }, options.budgetMs);
      })
    : undefined;
  const work = (async (): Promise<LikelyFiles | undefined> => {
    const started = Date.now();
    const files = await indexFiles(scope, settings.exclude);
    if (files.length === 0 || controller.signal.aborted) return undefined;
    const candidates = prefilter(query, files, settings.fileHints.maxCandidates);
    const batches = rankRequests(query, candidates, options.context);
    const results = await Promise.all(batches.map((batch) => classifier.ask("files", batch.request, { signal: controller.signal })));
    if (results.every((result) => !result) || controller.signal.aborted) return undefined;
    const ranked: LikelyFile[] = [];
    let anyRelevant = 0;
    let judged = 0;
    results.forEach((result, index) => {
      if (!result) return;
      anyRelevant = Math.max(anyRelevant, yesOf(result.answers, ANY_KEY) ?? 0);
      for (const [key, path] of batches[index]!.keys) {
        const relevance = yesOf(result.answers, key);
        if (relevance === undefined) continue;
        judged += 1;
        ranked.push({ path, relevance });
      }
    });
    ranked.sort((a, b) => b.relevance - a.relevance);
    const topK = options.topK ?? settings.fileHints.topK;
    const files_ = ranked.filter((entry) => entry.relevance >= settings.thresholds.fileRelevantAt).slice(0, topK);
    return { files: files_, anyRelevant, judged, ms: Date.now() - started };
  })();
  try {
    return await (budget ? Promise.race([work, budget]) : work);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** The block an agent's context gets; empty when nothing stands out. */
export function likelyFilesBlock(result: LikelyFiles | undefined): string {
  if (!result || result.files.length === 0 || result.anyRelevant < ANY_RELEVANT_FLOOR) return "";
  return [
    "## Likely files",
    "",
    "The classifier ranked these as the files this step most likely needs (hints, not facts). Open them first; search with grep or find only for what they do not answer.",
    "",
    ...result.files.map((file) => `- \`${file.path}\` (${file.relevance.toFixed(2)})`),
  ].join("\n");
}

/** Hands likely files to agents: a block for their context and the lookup tool for their allowlist. */
export interface FileHinter {
  /** The Likely files block for a step, or "" (off, nothing stands out, out of time). */
  block(query: string, signal?: AbortSignal, context?: string): Promise<string>;
  /** Tools to add to a subagent's allowlist: `find_relevant_files` while file hints are on. */
  tools(): readonly string[];
}

export function fileHinter(classifier: Classifier, scope: FileScope, log?: (text: string) => void): FileHinter {
  return {
    async block(query, signal, context) {
      if (!classifier.enabled("files")) return "";
      const result = await likelyFiles(classifier, scope, query, { ...(signal ? { signal } : {}), budgetMs: classifier.config.fileHints.budgetMs, ...(context ? { context } : {}) });
      const block = likelyFilesBlock(result);
      if (result) log?.(block ? `likely files: ${result.files.map((file) => `${file.path} (${file.relevance.toFixed(2)})`).join(", ")} · ${result.ms} ms` : `no file stands out (${result.anyRelevant.toFixed(2)}) · ${result.ms} ms`);
      return block;
    },
    tools: () => (classifier.enabled("files") ? [FIND_FILES_TOOL] : []),
  };
}
