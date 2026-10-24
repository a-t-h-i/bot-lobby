/**
 * The task board: one append-only log per task where the agents working on
 * it post short, typed entries (a contract they set, a decision, a blocker, a
 * finished piece) and read what the others posted, without routing it through
 * the oracle. Each role reads only the kinds it subscribes to, so the board
 * stays a shared reference rather than a chat everyone has to follow.
 *
 * It lives in the task's directory as `board.jsonl`, so later steps, the QA
 * gate and the oracle read the same record; a worker without a running desk
 * (a single step) appends to the file directly. A post may name recipients
 * (`to`) or files: those route its *delivery* — an addressed post is pushed
 * only to its targets, a file-named one to the workers holding those files —
 * while the board itself stays readable to every role.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { LOCK_BUSY, withFileLock } from "./lock.ts";

export const POST_KINDS = ["contract", "decision", "blocker", "question", "done", "note"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export function isPostKind(value: unknown): value is PostKind {
  return typeof value === "string" && (POST_KINDS as readonly string[]).includes(value);
}

export interface BoardPost {
  /** Order on the board, from 1. */
  seq: number;
  /** Stable unique id minted at append; posts written before it exists have none, and stay readable. */
  id?: string;
  /** Who posted it: a domain (`backend`, `designer`, `qa`), an assignment id (`backend:9f2c1e`), a child run id, or `oracle`. */
  from: string;
  kind: PostKind;
  text: string;
  /** Repository files the post is about, when it names any. */
  files?: string[];
  /** Recipients the post is addressed to (worker ids or domains): only they are pushed it; everyone can still read it. */
  to?: string[];
  at: string;
}

/** Env name that gives a worker process its task board's file. */
export const BOARD_ENV = "BOT_LOBBY_BOARD";

/** Tools every worker gets when its task has a board. */
export const BOARD_TOOLS: readonly string[] = ["post_board", "read_board", "ack_board"];

/**
 * What each role reads by default. A builder needs the contracts and
 * decisions it builds against and anything blocking; QA also follows what is
 * done, so it can run its tests against finished pieces.
 */
export const SUBSCRIPTIONS: Readonly<Record<string, readonly PostKind[]>> = {
  backend: ["contract", "decision", "blocker", "question"],
  designer: ["contract", "decision", "blocker", "question"],
  qa: ["contract", "decision", "blocker", "done"],
  oracle: POST_KINDS,
};

const DEFAULT_SUBSCRIPTION: readonly PostKind[] = ["contract", "decision", "blocker"];

/** Kinds a running peer is told about the moment they are posted, not only when it next reads: the consequential ones, never routine notes. */
export const PUSHED_KINDS: ReadonlySet<PostKind> = new Set(["contract", "decision", "blocker"]);

export function subscriptionFor(reader: string): readonly PostKind[] {
  return SUBSCRIPTIONS[reader] ?? SUBSCRIPTIONS[roleOf(reader) ?? ""] ?? DEFAULT_SUBSCRIPTION;
}

/** A recipient named the way posts address it: DEV/design/backend all mean `backend`; anything else (a child run id, `oracle`) is itself. */
export function recipientId(name: string): string {
  const key = name.trim().toLowerCase();
  const ids: Record<string, string> = { dev: "backend", backend: "backend", design: "designer", designer: "designer", qa: "qa", oracle: "oracle" };
  return ids[key] ?? name.trim();
}

/** The role a recipient answers to: `backend`, `backend:9f2c1e` and `DEV` are backend; an unrelated id (a bare child run id) has none. */
export function roleOf(name: string): string | undefined {
  const [head = ""] = name.trim().split(":", 1);
  const role = recipientId(head);
  return SUBSCRIPTIONS[role] ? role : undefined;
}

/** One assignment's board identity: unique per worker run (`backend:9f2c1e`), so two same-role workers never share delivery state while posts addressed to their role still reach both. */
export function assignmentId(domain: string): string {
  return `${recipientId(domain)}:${randomUUID().slice(0, 8)}`;
}

export const MAX_POST_CHARS = 1500;
const MAX_FILES = 20;

export function boardPath(taskDir: string): string {
  return join(taskDir, "board.jsonl");
}

function clean(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function isPost(value: unknown): value is BoardPost {
  if (!value || typeof value !== "object") return false;
  const post = value as Partial<BoardPost>;
  return typeof post.seq === "number" && typeof post.from === "string" && isPostKind(post.kind) && typeof post.text === "string" && typeof post.at === "string";
}

/** Every post on the board, oldest first; a missing board is empty and a torn line is skipped. */
export function readBoard(path: string): BoardPost[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const posts: BoardPost[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const post: unknown = JSON.parse(line);
      if (isPost(post)) posts.push(post);
    } catch {
      // A torn line (a crash mid-append) is skipped.
    }
  }
  return posts;
}

export interface NewPost {
  from: string;
  kind: PostKind;
  text: string;
  files?: readonly string[];
  /** Recipients the post is addressed to; an addressed post is pushed only to them. */
  to?: readonly string[];
}

/** Longest a board path in a post may be. */
const MAX_FILE_CHARS = 300;

/** Most recipients one post may name. */
const MAX_TARGETS = 8;

/** Append a post and return it as stored. Throws on an empty text or a busy board, so the caller can tell the agent. */
export function appendPost(path: string, post: NewPost, now = new Date()): BoardPost {
  const text = clean(post.text, MAX_POST_CHARS);
  if (!text) throw new Error("a board post needs text");
  const files = (post.files ?? []).map((file) => clean(file, MAX_FILE_CHARS)).filter(Boolean).slice(0, MAX_FILES);
  const to = [...new Set((post.to ?? []).map((target) => clean(target, 80)).filter(Boolean))].slice(0, MAX_TARGETS);
  mkdirSync(dirname(path), { recursive: true });
  try {
    return withFileLock(path, () => {
      const seq = (readBoard(path).at(-1)?.seq ?? 0) + 1;
      const stored: BoardPost = { seq, id: randomUUID(), from: post.from, kind: post.kind, text, ...(files.length > 0 ? { files } : {}), ...(to.length > 0 ? { to } : {}), at: now.toISOString() };
      appendFileSync(path, `${JSON.stringify(stored)}\n`, "utf8");
      return stored;
    });
  } catch (error) {
    throw new Error((error as Error).message === LOCK_BUSY ? `Not posted: ${LOCK_BUSY}` : (error as Error).message);
  }
}

/** The newest post already on the board with this sender, kind and exact text, if one exists: a retry can adopt it instead of duplicating it. */
export function recentPost(path: string, from: string, kind: PostKind, text: string): BoardPost | undefined {
  const wanted = clean(text, MAX_POST_CHARS);
  return readBoard(path)
    .filter((post) => post.from === from && post.kind === kind && post.text === wanted)
    .at(-1);
}

export interface BoardFilter {
  kinds?: readonly PostKind[];
  /** Only posts after this sequence number. */
  after?: number;
  /** Leave out the reader's own posts. */
  notFrom?: string;
  /** The newest N that match. */
  limit?: number;
}

export function filterPosts(posts: readonly BoardPost[], filter: BoardFilter): BoardPost[] {
  const matching = posts.filter(
    (post) => (!filter.kinds || filter.kinds.includes(post.kind)) && post.seq > (filter.after ?? 0) && post.from !== filter.notFrom,
  );
  return filter.limit && matching.length > filter.limit ? matching.slice(-filter.limit) : matching;
}

const NAMES: Record<string, string> = { backend: "DEV", designer: "DESIGN", qa: "QA", oracle: "ORACLE" };

export function posterName(from: string): string {
  const role = roleOf(from);
  if (role && from !== role) return `${NAMES[role] ?? role.toUpperCase()}(${from.slice(role.length + 1)})`;
  return NAMES[from] ?? (from.length > 12 ? `child ${from.slice(0, 8)}` : from.toUpperCase());
}

/** One post on one line: its text is flattened, so a post can never pass for a line of the engine's own. */
export function formatPost(post: BoardPost): string {
  const files = post.files?.length ? ` (${post.files.join(", ")})` : "";
  const to = post.to?.length ? ` → ${post.to.map(posterName).join(", ")}` : "";
  return `#${post.seq} [${post.kind}] ${posterName(post.from)}${to}${files}: ${post.text.replace(/\s+/g, " ")}`;
}

export function formatPosts(posts: readonly BoardPost[]): string {
  return posts.map(formatPost).join("\n");
}

/** The board as a context section for an agent starting a step: what its role subscribes to, newest last. */
export function boardContext(path: string, reader: string, limit = 30): string {
  const posts = filterPosts(readBoard(path), { kinds: subscriptionFor(reader), limit });
  if (posts.length === 0) return "";
  return `Task board (what the task's agents posted for each other; ${subscriptionFor(reader).join(", ")} posts):\n${formatPosts(posts)}`;
}
