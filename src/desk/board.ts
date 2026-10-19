/**
 * The task board: one append-only log per task where the agents working on
 * it post short, typed entries (a contract they set, a decision, a blocker, a
 * finished piece) and read what the others posted, without routing it through
 * the oracle. Each role reads only the kinds it subscribes to, so the board
 * stays a shared reference rather than a chat everyone has to follow.
 *
 * It lives in the task's directory as `board.jsonl`, so later steps, the QA
 * gate and the oracle read the same record; a worker without a running desk
 * (a single step) appends to the file directly.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const POST_KINDS = ["contract", "decision", "blocker", "question", "done", "note"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export function isPostKind(value: unknown): value is PostKind {
  return typeof value === "string" && (POST_KINDS as readonly string[]).includes(value);
}

export interface BoardPost {
  /** Order on the board, from 1. */
  seq: number;
  /** Who posted it: a domain (`backend`, `designer`, `qa`), a child run id, or `oracle`. */
  from: string;
  kind: PostKind;
  text: string;
  /** Repository files the post is about, when it names any. */
  files?: string[];
  at: string;
}

/** Env name that gives a worker process its task board's file. */
export const BOARD_ENV = "BOT_LOBBY_BOARD";

/** Tools every worker gets when its task has a board. */
export const BOARD_TOOLS: readonly string[] = ["post_board", "read_board"];

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

/** Kinds a running peer is told about the moment they are posted, not only when it next reads. */
export const PUSHED_KINDS: ReadonlySet<PostKind> = new Set(["contract", "blocker"]);

export function subscriptionFor(reader: string): readonly PostKind[] {
  return SUBSCRIPTIONS[reader] ?? DEFAULT_SUBSCRIPTION;
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
}

/** Append a post and return it as stored. Throws on an empty text, so the caller can tell the agent. */
export function appendPost(path: string, post: NewPost, now = new Date()): BoardPost {
  const text = clean(post.text, MAX_POST_CHARS);
  if (!text) throw new Error("a board post needs text");
  const files = (post.files ?? []).map((file) => file.trim()).filter(Boolean).slice(0, MAX_FILES);
  const seq = (readBoard(path).at(-1)?.seq ?? 0) + 1;
  const stored: BoardPost = { seq, from: post.from, kind: post.kind, text, ...(files.length > 0 ? { files } : {}), at: now.toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(stored)}\n`, "utf8");
  return stored;
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
  return NAMES[from] ?? (from.length > 12 ? `child ${from.slice(0, 8)}` : from.toUpperCase());
}

export function formatPost(post: BoardPost): string {
  const files = post.files?.length ? ` (${post.files.join(", ")})` : "";
  return `#${post.seq} [${post.kind}] ${posterName(post.from)}${files}: ${post.text}`;
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
