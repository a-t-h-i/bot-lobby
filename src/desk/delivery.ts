/**
 * Durable delivery of board posts to each recipient: who was actually shown
 * which post, kept beside the board so a post that lands while its reader is
 * not attached still reaches it at its next safe boundary, and a restart or
 * retry never re-delivers or skips one. `lastSeq` means the text reached the
 * recipient (a steer or a shown read); `handledSeq`/`handled` mean the
 * recipient said so itself — receipt is not proof of incorporation, so only
 * an explicit acknowledgement (`ack_board`) moves them. Posts seen out of
 * order (a fresh blocker pushed ahead of a long backlog) sit in `seen` until
 * the cursor grows past them, and the cursor itself only moves over posts
 * the recipient was actually shown: it never advances past an omitted one.
 * Relevance is routing: the recipient's kind subscription, a post's explicit
 * targets (its assignment id exactly, or the role it answers to), or — for a
 * post naming files — holding one of them; an unrouted post never holds a
 * cursor back. Two same-role workers are two recipients: each has its own
 * cursors, and only what each was shown and acknowledged moves them.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readBoard, recipientId, roleOf, subscriptionFor, type BoardPost, type PostKind } from "./board.ts";
import { tempName, withFileLock } from "./lock.ts";

/** How many undelivered posts one catch-up or push hands over at most. */
export const REPLAY_LIMIT = 8;

export interface RecipientState {
  /** Highest sequence the recipient was actually shown; nothing above it is assumed seen. */
  lastSeq: number;
  /** Sequences shown out of order above `lastSeq`, waiting for the cursor to grow past them. */
  seen?: number[];
  /** Sequences acknowledged above `handledSeq`, waiting for earlier relevant posts to be acknowledged too. */
  handled?: number[];
  /** Highest sequence the recipient itself acknowledged (contiguous; `ack_board`), when it has. */
  handledSeq?: number;
  at: string;
}

export interface DeliveryFile { version: 1; recipients: Record<string, RecipientState> }

/** What routes a post to one recipient: its identity, the kinds it follows, and the files it holds or is queued for. */
export interface RecipientScope {
  /** The recipient's identity (an assignment id like `backend:9f2c1e`, a domain, a child run id): a post addressing it reaches it alone. */
  recipient: string;
  /** The role (domain) the recipient also answers to: a post addressed to the role reaches every worker of that role. */
  role?: string;
  /** The post kinds the recipient follows. */
  kinds: readonly PostKind[];
  /** Repository files the recipient holds or is queued for: a post naming files reaches intersecting holders. */
  files?: readonly string[];
}

/** Whether one explicit target of a post names this recipient: its assignment id exactly, the role it answers to, or the same worker under its other spelling (`backend:9f2c1e` vs `9f2c1e`). */
export function addressesPost(target: string, scope: RecipientScope): boolean {
  const id = recipientId(target);
  const role = scope.role ?? roleOf(scope.recipient);
  if (id === scope.recipient || (!!role && id === recipientId(role))) return true;
  const tail = (name: string): string | undefined =>
    role !== undefined && roleOf(name) === role && name.includes(":") ? name.slice(role.length + 1) : undefined;
  const targetTail = tail(id);
  const recipientTail = tail(scope.recipient);
  return (targetTail !== undefined && targetTail === scope.recipient) || (recipientTail !== undefined && id === recipientTail);
}

/** Whether a post routes to one recipient: addressed posts to their targets alone (assignment or role), file-named ones to intersecting subscribed holders (or every subscribed reader when no claims are known), the rest to every subscribed reader. */
export function routedTo(post: BoardPost, scope: RecipientScope): boolean {
  if (post.to?.length) return post.to.some((target) => addressesPost(target, scope));
  if (post.files?.length) return scope.kinds.includes(post.kind) && (scope.files === undefined || scope.files.some((file) => post.files!.includes(file)));
  return scope.kinds.includes(post.kind);
}

/** Where the delivery state for the board at `boardPath` lives. */
export function deliveryPath(boardPath: string): string {
  return `${boardPath}.delivery.json`;
}

/** The delivery state, or an empty one when absent or corrupt; never throws. */
export function readDelivery(path: string): DeliveryFile {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DeliveryFile>;
    return parsed.version === 1 && typeof parsed.recipients === "object" && parsed.recipients !== null
      ? { version: 1, recipients: parsed.recipients }
      : { version: 1, recipients: {} };
  } catch {
    return { version: 1, recipients: {} };
  }
}

function writeDelivery(path: string, state: DeliveryFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = tempName(path);
  writeFileSync(temp, JSON.stringify(state), "utf8");
  renameSync(temp, path);
}

function update(path: string, recipient: string, next: RecipientState): RecipientState {
  return withFileLock(path, () => {
    const state = readDelivery(path);
    state.recipients[recipient] = next;
    writeDelivery(path, state);
    return next;
  });
}

/** Advance a recipient's delivered cursor to `seq`, never backwards; `seen` entries it covers are absorbed. Idempotent. */
export function markDelivered(path: string, recipient: string, seq: number, now = new Date()): RecipientState {
  const prior = readDelivery(path).recipients[recipient];
  if (prior && seq <= prior.lastSeq) return prior;
  const base = prior ?? { lastSeq: 0, at: now.toISOString() };
  return update(path, recipient, { ...base, lastSeq: Math.max(seq, base.lastSeq), seen: (base.seen ?? []).filter((entry) => entry > seq), at: now.toISOString() });
}

/** Record an out-of-order delivery without moving the cursor. Idempotent. */
export function markSeen(path: string, recipient: string, seq: number, now = new Date()): RecipientState {
  const prior = readDelivery(path).recipients[recipient] ?? { lastSeq: 0, at: now.toISOString() };
  if (seq <= prior.lastSeq || (prior.seen ?? []).includes(seq)) return prior;
  return update(path, recipient, { ...prior, seen: [...(prior.seen ?? []), seq].sort((a, b) => a - b), at: now.toISOString() });
}

/** Which posts an acknowledgement may cover: everything the recipient's subscription, its role or an explicit address makes its business — and so everything a kinds-only window (a read or a start context) must not be allowed to skip. */
export function ackRelevant(post: BoardPost, recipient: string, kinds: readonly PostKind[]): boolean {
  const role = roleOf(recipient);
  return kinds.includes(post.kind) || !!post.to?.some((target) => [recipient, ...(role ? [role] : [])].includes(recipientId(target)));
}

/** The post one acknowledged event names: a sequence (`3`, `#3`) or a stable post id. */
function resolveEvent(event: string | number, posts: readonly BoardPost[]): BoardPost | undefined {
  if (typeof event === "number") return posts.find((post) => post.seq === event);
  const trimmed = event.trim().replace(/^#/, "");
  return /^\d+$/.test(trimmed)
    ? posts.find((post) => post.seq === Number(trimmed))
    : posts.find((post) => post.id === event.trim());
}

/**
 * Fold acknowledgements into handled state: the contiguous `handledSeq`
 * cursor stops before the first relevant post the recipient has not
 * acknowledged, and out-of-order acknowledgements wait in `handled`.
 */
function handledAfter(posts: readonly BoardPost[], prior: RecipientState | undefined, recipient: string, acked: readonly number[], now: Date): RecipientState {
  const kinds = subscriptionFor(recipient);
  const done = new Set([...(prior?.handled ?? []), ...acked]);
  let cursor = prior?.handledSeq ?? 0;
  for (const post of [...posts].sort((a, b) => a.seq - b.seq)) {
    if (!ackRelevant(post, recipient, kinds)) continue;
    if (!done.has(post.seq) && post.seq > cursor) break;
    cursor = Math.max(cursor, post.seq);
  }
  const handled = [...done].filter((seq) => seq > cursor).sort((a, b) => a - b);
  const next: RecipientState = { ...(prior ?? { lastSeq: 0 }), handled, handledSeq: cursor, at: now.toISOString() };
  if (handled.length === 0) delete next.handled;
  return next;
}

export interface AckResult {
  /** The posts the acknowledgement covers, oldest first (already-acknowledged ones included: it is idempotent). */
  acknowledged: BoardPost[];
  /** Events that name nothing on this board; nothing was recorded for them. */
  unknown: string[];
  /** Events outside the recipient's scope, as `#seq`; nothing was recorded at all. */
  refused: string[];
  state: RecipientState;
}

/**
 * Record that `recipient` incorporated the given board events (sequences or
 * stable ids). Idempotent, atomic, and scope-checked: an event that is
 * neither in the recipient's subscription nor addressed to it refuses the
 * whole call, and the handled cursor never skips a relevant post waiting for
 * its own acknowledgement.
 */
export function markHandled(boardPath: string, recipient: string, events: readonly (string | number)[], now = new Date()): AckResult {
  const path = deliveryPath(boardPath);
  const board = readBoard(boardPath);
  const kinds = subscriptionFor(recipient);
  const found = events.map((event) => ({ event, post: resolveEvent(event, board) }));
  const unknown = found.filter((entry) => !entry.post).map((entry) => String(entry.event));
  const acknowledged = found.filter((entry) => entry.post).map((entry) => entry.post!);
  const refused = acknowledged.filter((post) => !ackRelevant(post, recipient, kinds)).map((post) => `#${post.seq}`);
  const prior = readDelivery(path).recipients[recipient] ?? { lastSeq: 0, at: now.toISOString() };
  if (refused.length > 0) return { acknowledged: [], unknown, refused, state: prior };
  const state = update(path, recipient, handledAfter(board, prior, recipient, acknowledged.map((post) => post.seq), now));
  return { acknowledged, unknown, refused: [], state };
}

/** The posts that route to this recipient's scope and that it has not been shown yet, oldest first. */
export function undeliveredFor(posts: readonly BoardPost[], state: RecipientState | undefined, scope: RecipientScope): BoardPost[] {
  const seen = new Set(state?.seen ?? []);
  return posts
    .filter((post) => routedTo(post, scope) && post.seq > (state?.lastSeq ?? 0) && !seen.has(post.seq))
    .sort((a, b) => a.seq - b.seq);
}

/** One bounded catch-up: the oldest undelivered posts, and the sequence the cursor may safely move to. */
export function replayFor(posts: readonly BoardPost[], state: RecipientState | undefined, scope: RecipientScope, limit = REPLAY_LIMIT): { posts: BoardPost[]; through: number; waiting: number } {
  const pending = undeliveredFor(posts, state, scope);
  const batch = pending.slice(0, limit);
  return { posts: batch, through: batch.at(-1)?.seq ?? (state?.lastSeq ?? 0), waiting: pending.length - batch.length };
}

/**
 * The newest sequence one shown window proves delivered: the cursor grows
 * over the relevant posts the window showed, oldest first, and stops at the
 * first relevant one the window omitted — nothing unshown is ever claimed.
 */
export function provenThrough(posts: readonly BoardPost[], shown: ReadonlySet<number>, relevant: (post: BoardPost) => boolean, start = 0): number {
  let through = start;
  for (const post of [...posts].sort((a, b) => a.seq - b.seq)) {
    if (post.seq <= through || !relevant(post)) continue;
    if (!shown.has(post.seq)) break;
    through = post.seq;
  }
  return through;
}

/**
 * The sequence a start context (the board lines in a prompt) lets a
 * recipient assume seen: the cursor grows over the relevant posts the
 * context showed — its kinds, and anything addressed to it — and stops at
 * the first one it did not. A truncated context proves nothing above its
 * oldest shown post; posts routed only by files wait for the desk that
 * knows the claims.
 */
export function deliveredThrough(posts: readonly BoardPost[], recipient: string, limit: number): number {
  const kinds = subscriptionFor(recipient);
  const shown = new Set(posts.filter((post) => kinds.includes(post.kind)).sort((a, b) => a.seq - b.seq).slice(-limit).map((post) => post.seq));
  return provenThrough(posts, shown, (post) => ackRelevant(post, recipient, kinds));
}

/**
 * Seed a recipient's cursor from the board lines its start prompt showed,
 * before any push can race the read. Never lowers the cursor; posts the
 * context showed beyond the stop are recorded seen so they are not
 * re-delivered later.
 */
export function seedDelivery(boardPath: string, recipient: string, limit = 30, now = new Date()): void {
  const posts = readBoard(boardPath);
  const kinds = subscriptionFor(recipient);
  const window = posts.filter((post) => kinds.includes(post.kind)).sort((a, b) => a.seq - b.seq).slice(-limit);
  const through = provenThrough(posts, new Set(window.map((post) => post.seq)), (post) => ackRelevant(post, recipient, kinds));
  const state = deliveryPath(boardPath);
  if (through > 0) markDelivered(state, recipient, through, now);
  for (const post of window) if (post.seq > through) markSeen(state, recipient, post.seq, now);
}
