/**
 * Durable board delivery: who was actually shown which post, so a push that
 * lands while its reader is away still reaches it, and a restart, a busy
 * board or a retried post never re-delivers, skips or duplicates one.
 * Receipt (lastSeq) is never treated as incorporation: only explicit
 * acknowledgements move handledSeq, and the routed scopes decide who a post
 * is even delivered to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendPost, assignmentId, boardPath, posterName, readBoard, roleOf, subscriptionFor, type BoardPost } from "../src/desk/board.ts";
import { deliveredThrough, deliveryPath, markDelivered, markHandled, markSeen, readDelivery, replayFor, routedTo, seedDelivery, undeliveredFor, REPLAY_LIMIT, type RecipientScope } from "../src/desk/delivery.ts";
import { LOCK_BUSY, tempName, withFileLock } from "../src/desk/lock.ts";

function tempDir(prefix = "bl-delivery-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function board(): { path: string; posts: BoardPost[] } {
  const path = boardPath(tempDir());
  appendPost(path, { from: "backend", kind: "contract", text: "GET /api/items" });
  appendPost(path, { from: "designer", kind: "note", text: "using Card" });
  appendPost(path, { from: "backend", kind: "blocker", text: "need the token" });
  appendPost(path, { from: "backend", kind: "done", text: "route ready" });
  return { path, posts: readBoard(path) };
}

function scope(recipient: string, kinds: readonly string[] = subscriptionFor(recipient), files?: readonly string[]): RecipientScope {
  return { recipient, kinds: kinds as RecipientScope["kinds"], ...(files ? { files } : {}) };
}

/** The scope a worker run carries: its own assignment id, plus the role it answers to. */
function assignment(recipient: string, role = recipient.split(":", 1)[0]!): RecipientScope {
  return { recipient, role, kinds: subscriptionFor(role) };
}

test("the delivered cursor never moves backwards, absorbs seen posts and survives a restart", () => {
  const { path } = board();
  const state = deliveryPath(path);
  markDelivered(state, "designer", 3);
  const told = markDelivered(state, "designer", 1);
  assert.equal(told.lastSeq, 3, "an older delivery does not lower the cursor");
  markSeen(state, "designer", 4);
  assert.deepEqual(markDelivered(state, "designer", 4).seen, [], "the cursor growing past a seen post absorbs it");
  assert.deepEqual(markSeen(state, "designer", 4).seen, [], "recording a seen post twice changes nothing");
  const afterRestart = readDelivery(state).recipients["designer"]!;
  assert.equal(afterRestart.lastSeq, 4, "the state is read back as it was written");
  assert.equal(afterRestart.handledSeq, undefined, "reading and being steered never count as acknowledgement");
});

test("receipt is not acknowledgement: only ack_board moves the handled cursor, and never past a gap", () => {
  // A board whose posts are all the designer's kinds (contract, decision, blocker), so acknowledgement gaps are real.
  const path = boardPath(tempDir());
  appendPost(path, { from: "backend", kind: "contract", text: "shape" });
  appendPost(path, { from: "oracle", kind: "decision", text: "cursor keys" });
  appendPost(path, { from: "backend", kind: "blocker", text: "need the token" });
  const first = markHandled(path, "designer", [1]);
  assert.equal(first.state.handledSeq, 1, "an explicit acknowledgement is recorded");
  const again = markHandled(path, "designer", [1]);
  assert.equal(again.state.handledSeq, 1, "acknowledging twice records nothing new");
  const read = markDelivered(deliveryPath(path), "designer", 3);
  assert.equal(read.handledSeq, 1, "a delivery reaching the reader still proves nothing about handling");
  const byId = markHandled(path, "designer", [readBoard(path).find((post) => post.seq === 1)!.id!]);
  assert.deepEqual(byId.acknowledged.map((post) => post.seq), [1], "a stable post id acknowledges like its number");
  const skipped = markHandled(path, "designer", [3]);
  assert.equal(skipped.state.handledSeq, 1, "the cursor stops before the first relevant post not acknowledged");
  assert.deepEqual(skipped.state.handled, [3], "the out-of-order acknowledgement waits instead");
  const closed = markHandled(path, "designer", ["#2", 3]);
  assert.equal(closed.state.handledSeq, 3, "closing the gap lets the cursor reach the newest contiguous acknowledgement");
  assert.deepEqual(closed.state.handled ?? [], [], "nothing waits above the cursor any more");
});

test("an acknowledgement is scope-checked: someone else's event is refused whole, an unknown event names nothing", () => {
  const { path } = board();
  const refused = markHandled(path, "backend", [4, 3]);
  assert.deepEqual(refused.refused, ["#4"], "a done post is not a backend worker's to acknowledge");
  assert.equal(refused.state.handledSeq, undefined, "nothing was recorded for the refused call");
  const accepted = markHandled(path, "backend", [1, 3, 99, "not-on-this-board"]);
  assert.deepEqual(accepted.refused, [], "contract and blocker posts are a backend worker's business");
  assert.equal(accepted.state.handledSeq, 3, "the whole call applies: the in-scope events are recorded");
  assert.deepEqual(accepted.unknown, ["99", "not-on-this-board"], "events that match nothing are named, not guessed");
});

test("an addressed post routes to its targets alone, whoever else subscribes to its kind", () => {
  const { path } = board();
  const post = appendPost(path, { from: "backend", kind: "note", text: "yours", to: ["designer"] });
  assert.equal(routedTo(post, scope("designer")), true, "the target is routed to even though notes are not its kind");
  assert.equal(routedTo(post, scope("qa")), false, "a non-target subscriber is not routed to");
  assert.equal(routedTo(post, { recipient: "backend", kinds: subscriptionFor("backend") }), false, "the author itself is never pushed its own post");
  const addressed = appendPost(path, { from: "oracle", kind: "blocker", text: "for both", to: ["DEV", "qa"] });
  assert.equal(routedTo(addressed, scope("backend")), true, "targets are matched the way workers name each other (DEV means backend)");
  assert.equal(routedTo(addressed, scope("designer")), false);
  assert.equal(routedTo(addressed, scope("9b2f0c60-0000-4000-8000-000000000000")), false, "a child is not routed a post it is not named in");
  assert.equal(routedTo(addressed, assignment("backend:9f2c1e", "backend")), true, "a role post reaches every worker of that role, assignments included");
});

test("assignment identities: one mint per worker run, a role's kinds and name, and same-role runs are distinct recipients", () => {
  assert.match(assignmentId("DEV"), /^backend:[0-9a-f]{8}$/, "an assignment id is its role plus a short unique tail");
  assert.notEqual(assignmentId("backend"), assignmentId("backend"), "each mint is its own assignment");
  assert.deepEqual(subscriptionFor("backend:9f2c1e"), subscriptionFor("backend"), "an assignment follows its role's kinds");
  assert.equal(subscriptionFor("9b2f0c60-0000-4000-8000-000000000000").includes("question"), false, "an unrelated id keeps the default kinds");
  assert.equal(roleOf("backend:9f2c1e"), "backend");
  assert.equal(roleOf("9b2f0c60-0000-4000-8000-000000000000"), undefined);
  assert.equal(posterName("backend:9f2c1e"), "DEV(9f2c1e)", "a same-role worker is named by its role and tail");
  assert.equal(posterName("backend"), "DEV");
});

test("a role post reaches both same-role assignments; an assignment post reaches that one alone", () => {
  const path = boardPath(tempDir());
  const first = assignment("backend:9f2c1e", "backend");
  const second = assignment("backend:8ad0c2f4", "backend");
  const rolePost = appendPost(path, { from: "oracle", kind: "decision", text: "no kafka", to: ["backend"] });
  assert.equal(routedTo(rolePost, first), true, "a post addressed to the role reaches every assignment of it");
  assert.equal(routedTo(rolePost, second), true);
  assert.equal(routedTo(rolePost, scope("designer")), false, "and nobody else");
  assert.equal(routedTo(rolePost, { recipient: "backend", kinds: subscriptionFor("backend") }), true, "a legacy role-keyed recipient still matches its own role");
  const one = appendPost(path, { from: "oracle", kind: "note", text: "yours alone", to: ["backend:8ad0c2f4"] });
  assert.equal(routedTo(one, second), true, "an assignment post reaches exactly that assignment");
  assert.equal(routedTo(one, first), false, "not its same-role sibling");
  assert.equal(routedTo(one, { recipient: "backend", kinds: subscriptionFor("backend") }), false, "and not the role as a whole");
  const child = appendPost(path, { from: "oracle", kind: "note", text: "child", to: ["9b2f0c60-0000-4000-8000-000000000000"] });
  assert.equal(routedTo(child, { recipient: "9b2f0c60-0000-4000-8000-000000000000", kinds: subscriptionFor("9b2f0c60-0000-4000-8000-000000000000") }), true, "a bare child id still addresses the child alone");
  assert.equal(routedTo(child, first), false);
  assert.equal(routedTo(child, { ...first, recipient: "9b2f0c60-0000-4000-8000-000000000000" }), true, "the same child under its role-prefixed spelling is still that child");
  assert.equal(routedTo(appendPost(path, { from: "oracle", kind: "note", text: "prefixed", to: ["backend:9f2c1e"] }), { ...first, recipient: "9f2c1e", role: "backend" }), true, "and the bare spelling reaches the prefixed worker");
});

test("two same-role assignments receive and replay independently: each cursor records only its own runs", () => {
  const path = boardPath(tempDir());
  appendPost(path, { from: "designer", kind: "contract", text: "shape" });
  appendPost(path, { from: "oracle", kind: "decision", text: "no kafka", to: ["backend"] });
  appendPost(path, { from: "qa", kind: "blocker", text: "tests need a fixture" });
  const state = deliveryPath(path);
  markDelivered(state, "backend:9f2c1e", 1);
  const first = readDelivery(state).recipients["backend:9f2c1e"];
  const second = readDelivery(state).recipients["backend:8ad0c2f4"];
  assert.equal(second, undefined, "nothing was assumed delivered for the sibling that has not run");
  const firstQueue = undeliveredFor(readBoard(path), first, assignment("backend:9f2c1e", "backend")).map((post) => post.seq);
  const secondQueue = undeliveredFor(readBoard(path), second, assignment("backend:8ad0c2f4", "backend")).map((post) => post.seq);
  assert.deepEqual(firstQueue, [2, 3], "the first assignment owes what landed above its own cursor");
  assert.deepEqual(secondQueue, [1, 2, 3], "the sibling owes the same events from its own fresh cursor");
});

test("acknowledgement is identity-scoped: another assignment's event is refused whole, the role's is not", () => {
  const path = boardPath(tempDir());
  appendPost(path, { from: "oracle", kind: "note", text: "amend the sibling", to: ["backend:8ad0c2f4"] });
  appendPost(path, { from: "oracle", kind: "note", text: "amend the role", to: ["backend"] });
  appendPost(path, { from: "designer", kind: "contract", text: "shape" });
  const refused = markHandled(path, "backend:9f2c1e", [1]);
  assert.equal(refused.state.handledSeq, undefined, "another assignment's event is not this one's business; nothing was recorded");
  assert.equal(markHandled(path, "backend:9f2c1e", [2]).state.handledSeq, 2, "a post addressed to the role is");
  assert.equal(markHandled(path, "backend:9f2c1e", [3]).state.handledSeq, 3, "and so is every subscribed kind");
});

test("an addressed amendment reaches its assignment regardless of kind, and a bounded replay never skips it", () => {
  const path = boardPath(tempDir());
  for (let i = 0; i < REPLAY_LIMIT + 1; i++) appendPost(path, { from: "designer", kind: "contract", text: `contract ${i}` });
  appendPost(path, { from: "oracle", kind: "note", text: "amendment: the cache stays", to: ["backend:9f2c1e"] });
  const worker = assignment("backend:9f2c1e", "backend");
  const first = replayFor(readBoard(path), undefined, worker);
  assert.deepEqual(first.posts.map((post) => post.seq), [1, 2, 3, 4, 5, 6, 7, 8], "the first bounded catch-up is oldest-first");
  assert.equal(first.waiting, 2, "the amendment behind the backlog is still owed");
  markDelivered(deliveryPath(path), worker.recipient, first.through);
  const second = replayFor(readBoard(path), readDelivery(deliveryPath(path)).recipients[worker.recipient], worker);
  assert.deepEqual(second.posts.map((post) => post.seq), [9, 10], "the next catch-up delivers the amendment — never skipped");
});

test("a post naming files routes to the holders of those files among its subscribers", () => {
  const dir = tempDir();
  const path = boardPath(dir);
  const post = appendPost(path, { from: "backend", kind: "contract", text: "shape", files: ["src/api/items.ts"] });
  const holder = scope("designer", subscriptionFor("designer"), ["src/api/items.ts"]);
  const queued = scope("qa", subscriptionFor("qa"), ["src/other.ts", "src/api/items.ts"]);
  const other = scope("qa", subscriptionFor("qa"), ["src/other.ts"]);
  const unknown = scope("backend", subscriptionFor("backend"));
  assert.equal(routedTo(post, holder), true, "a holder is routed the post about its file, kinds permitting");
  assert.equal(routedTo(post, queued), true, "a queued worker is routed it too");
  assert.equal(routedTo(post, other), false, "a subscriber holding none of the files is not");
  assert.equal(routedTo(post, unknown), true, "when no claims are known, a file-named post falls back to subscribers");
  const note = appendPost(path, { from: "qa", kind: "note", text: "checked", files: ["src/api/items.ts"] });
  assert.equal(routedTo(note, holder), false, "a note never routes to a default subscriber, file or no file");
  const addressed = appendPost(path, { from: "qa", kind: "note", text: "for you", files: ["src/api/items.ts"], to: ["backend"] });
  assert.equal(routedTo(addressed, unknown), true, "an address wins over both kinds and files");
});

test("two same-role recipients keep independent cursors, and each undelivered queue follows its own scope", () => {
  const { path, posts } = board();
  const state = deliveryPath(path);
  const child = "9b2f0c60-0000-4000-8000-000000000000";
  markDelivered(state, "qa", 1);
  markSeen(state, child, 4);
  assert.deepEqual(
    undeliveredFor(posts, readDelivery(state).recipients["qa"], scope("qa")).map((post) => post.seq),
    [3, 4],
    "the first qa owes exactly its subscribed kinds above its cursor",
  );
  assert.deepEqual(
    undeliveredFor(posts, readDelivery(state).recipients[child], scope(child)).map((post) => post.seq),
    [1, 3],
    "the same-role child still owes its contract and blocker: nothing was assumed seen for it",
  );
  const catchUp = replayFor(posts, readDelivery(state).recipients[child], scope(child));
  assert.equal(catchUp.through, 3, "the child's catch-up claims only what it was shown");
});

test("relevance follows the subscription, the queue is oldest-first and a catch-up is bounded", () => {
  const { path, posts } = board();
  const state = deliveryPath(path);
  assert.deepEqual(undeliveredFor(posts, undefined, scope("designer", ["contract"])).map((post) => post.seq), [1], "notes, blockers and done posts are not the designer's kinds");
  const qa = scope("qa", ["contract", "done"]);
  const synthetic = (seq: number): BoardPost => ({ seq, id: `synthetic-${seq}`, from: "backend", kind: "contract", text: "shape", at: "" });
  const many = [...posts, ...Array.from({ length: 11 }, (_, index) => synthetic(5 + index))];
  const catchUp = replayFor(many, readDelivery(state).recipients["qa"], qa);
  assert.deepEqual(catchUp.posts.map((post) => post.seq), [1, 4, 5, 6, 7, 8, 9, 10], "the oldest undelivered posts fill the batch");
  assert.equal(catchUp.through, 10, "the cursor only claims what the batch showed");
  assert.equal(catchUp.waiting, 5, "the rest stay waiting, never skipped");
  assert.equal(replayFor(posts, { lastSeq: 4, at: "" }, qa).posts.length, 0, "a caught-up reader gets nothing");
});

test("a truncated start context proves nothing: seeding claims only what it wholly showed", () => {
  const { path, posts } = board();
  const state = deliveryPath(path);
  assert.equal(deliveredThrough(posts, "qa", 2), 0, "the oldest matching post was cut off, so nothing is assumed seen");
  seedDelivery(path, "qa", 2);
  assert.equal(readDelivery(state).recipients["qa"]?.lastSeq, 0, "a truncated seed records no delivered cursor");
  seedDelivery(path, "qa", 3);
  assert.equal(readDelivery(state).recipients["qa"]!.lastSeq, 4);
  seedDelivery(path, "qa", 2);
  assert.equal(readDelivery(state).recipients["qa"]!.lastSeq, 4, "seeding never lowers a cursor");
});

test("an addressed post a start context did not show holds the seeded cursor back", () => {
  const path = boardPath(tempDir());
  appendPost(path, { from: "backend", kind: "contract", text: "GET /api/items" });
  appendPost(path, { from: "oracle", kind: "note", text: "for qa only", to: ["qa"] });
  appendPost(path, { from: "backend", kind: "done", text: "route ready" });
  const state = deliveryPath(path);
  assert.equal(deliveredThrough(readBoard(path), "qa", 30), 1, "the kinds lines showed #1 and #3, never the note addressed to qa");
  seedDelivery(path, "qa");
  assert.equal(readDelivery(state).recipients["qa"]!.lastSeq, 1, "the seed claims only what the context proved");
  assert.deepEqual(undeliveredFor(readBoard(path), readDelivery(state).recipients["qa"], scope("qa")).map((post) => post.seq), [2], "the addressed note still reaches qa");
});

test("a corrupt or missing delivery file is an empty state, never a throw", () => {
  const state = join(tempDir(), "board.jsonl.delivery.json");
  assert.deepEqual(readDelivery(state), { version: 1, recipients: {} });
  writeFileSync(state, "{torn");
  assert.deepEqual(readDelivery(state), { version: 1, recipients: {} });
});

test("the lock fails closed beside a live holder, breaks a stale one, and temp names cannot collide", () => {
  const path = join(tempDir(), "board.jsonl");
  mkdirSync(`${path}.lock`);
  // A fresh lock belongs to a live writer: waiting it out must end in LOCK_BUSY, never a write beside it.
  assert.throws(() => withFileLock(path, () => 1), new RegExp(LOCK_BUSY));
  rmSync(`${path}.lock`, { recursive: true });
  assert.equal(withFileLock(path, () => "wrote"), "wrote", "a free lock is taken at once");
  mkdirSync(`${path}.lock`);
  utimesSync(`${path}.lock`, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  assert.equal(withFileLock(path, () => "broke the stale one"), "broke the stale one", "a lock left behind by a crashed writer is broken");
  assert.notEqual(tempName(path), tempName(path), "every temp name is unique");
});

test("a holder whose lock is broken mid-write does not remove its breaker's lock on release", () => {
  const path = join(tempDir(), "board.jsonl");
  const result = withFileLock(path, () => {
    // Simulate the lock being broken (a slow, not dead, holder) and re-taken by its breaker while the write is in flight.
    rmSync(`${path}.lock`, { recursive: true, force: true });
    mkdirSync(`${path}.lock`);
    return "written";
  });
  assert.equal(result, "written");
  // The breaker's fresh lock must survive the old holder's release, and be honoured: nobody writes beside it.
  assert.throws(() => withFileLock(path, () => "beside"), new RegExp(LOCK_BUSY));
  rmSync(`${path}.lock`, { recursive: true, force: true });
});

test("an amendment is owed until its addressee acknowledges it: delivery proves nothing and no sibling can ack it", () => {
  const path = boardPath(tempDir());
  appendPost(path, { from: "designer", kind: "contract", text: "GET /api/items" });
  appendPost(path, { from: "oracle", kind: "note", text: "amendment: the cache stays", to: ["backend:9f2c1e"] });
  appendPost(path, { from: "designer", kind: "contract", text: "POST /api/items" });
  const worker = assignment("backend:9f2c1e", "backend");
  const replay = replayFor(readBoard(path), undefined, worker);
  assert.deepEqual(replay.posts.map((post) => post.seq), [1, 2, 3], "the amendment reaches its addressee on its first catch-up");
  const state = deliveryPath(path);
  markDelivered(state, worker.recipient, replay.through);
  const delivered = readDelivery(state).recipients["backend:9f2c1e"]!;
  assert.equal(delivered.lastSeq, 3);
  assert.equal(delivered.handledSeq, undefined, "delivery is not incorporation: the amendment stays owed until acknowledged");
  const sibling = markHandled(path, "backend:8ad0c2f4", [1, 2, 3]);
  assert.deepEqual(sibling.refused, ["#2"], "a sibling cannot acknowledge the amendment on the addressee's behalf");
  assert.equal(sibling.state.handledSeq, undefined, "the refused call records nothing for the sibling either");
  assert.equal(readDelivery(state).recipients["backend:9f2c1e"]!.handledSeq, undefined, "and it moved nothing for the addressee");
  const settled = markHandled(path, "backend:9f2c1e", [1, 2, 3]);
  assert.equal(settled.state.handledSeq, 3, "only the addressee's own acknowledgement settles it");
});
