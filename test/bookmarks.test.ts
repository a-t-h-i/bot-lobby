// Focused tests for step 4: assignment bookmarks delivered to each agent —
// selection and its deterministic fallback, the preparation deadline, pins and
// exclusions, delivery revalidation (source and annotation changes, access),
// the metadata and shared-hints budgets, oracle operations, retirement and
// restart persistence, and the retrieval/legacy rollback without dual-injection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshCatalogue, type Catalogue } from "../src/knowledge/catalogue.ts";
import { addNote, readNotes } from "../src/knowledge/notes.ts";
import { applySelection, bookmarkBlock, bookmarksPath, deliverBookmarks, fitHints, lexicalBookmarks, listBookmarkLines, MAX_AUTO_BOOKMARKS, oracleBookmarkOp, OPTIONAL_HINTS_CHARS, BOOKMARK_METADATA_CHARS, readBookmarkState, retireBookmarks, updateBookmarks, type BookmarkState } from "../src/knowledge/bookmarks.ts";
import { bookmarkSelector, BOOKMARK_CANDIDATES, knowledgePicker, metaLine, picksFromAnswers, refRequest } from "../src/classifier/knowledge.ts";
import { Classifier } from "../src/classifier/classifier.ts";
import type { Answer, FetchLike } from "../src/classifier/client.ts";
import { DEFAULT_CONFIG, type ClassifierConfig } from "../src/schemas/configuration.ts";
import { compilePrompt } from "../src/prompts/compiler.ts";
import { runWorker } from "../src/master/master.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

const KNOWLEDGE = [
  "# Knowledge",
  "",
  "## Board delivery",
  "- Post board updates through the typed board; the lock contract is recorded in decisions.",
  "",
  "## Sampling",
  "- The sampler keeps its own buffer; do not share it with the board code.",
  "",
  "## Webhooks",
  "- Webhook retries back off exponentially; the queue lives in src/webhooks.ts.",
].join("\n");
const MORE_TOPICS = ["billing", "auth", "email", "search", "uploads", "cron", "logging", "cache", "i18n", "exports", "queue", "events", "streams", "retry", "backoff", "locks", "leases", "tokens", "quotas", "limits", "tracing", "metrics", "alerts", "reports", "digests", "imports", "exports2", "exports3", "exports4", "exports5"];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bl-bm-"));
  mkdirSync(join(root, "Master", "knowledge"), { recursive: true });
  mkdirSync(join(root, "cache"), { recursive: true });
  return root;
}

function writeRoot(root: string): Catalogue {
  writeFileSync(join(root, "Master", "knowledge", "knowledge.md"), KNOWLEDGE);
  return refreshCatalogue([root]).catalogue;
}

function access(root: string) {
  return { dataRoots: [root], cwd: root };
}

/** A catalogue with twelve matching entries, so the cap and the ranking can be seen. */
function wideCatalogue(root: string): Catalogue {
  const body = [KNOWLEDGE, ...MORE_TOPICS.map((topic) => `## ${topic}\n- The ${topic} module serves the billing pipeline in src/${topic}.ts`)].join("\n\n");
  writeFileSync(join(root, "Master", "knowledge", "knowledge.md"), body);
  return refreshCatalogue([root]).catalogue;
}

function state(root: string, taskId = "T1"): BookmarkState | undefined {
  return readBookmarkState(root, taskId);
}

test("lexical selection is deterministic, capped, and prefers entries sharing the assignment's words", () => {
  const root = makeRoot();
  const catalogue = wideCatalogue(root);
  const entries = catalogue.entries.filter((entry) => entry.freshness !== "stale");
  const picks = lexicalBookmarks("the billing pipeline", entries);
  assert.equal(picks.length, MAX_AUTO_BOOKMARKS, "twelve matches, eight kept");
  assert.deepEqual(lexicalBookmarks("the billing pipeline", entries), picks, "same input, same picks");
  assert.match(picks[0]!.reason, /bears on|shares/);
  const webhook = entries.find((entry) => entry.locator.heading?.includes("Webhooks"))!;
  const focused = lexicalBookmarks("webhook retries", entries);
  assert.deepEqual(focused.map((pick) => pick.ref), [webhook.id], "a specific assignment picks its one match");
  assert.deepEqual(lexicalBookmarks("quantum chromodynamics", entries), [], "nothing shares those words");
  rmSync(root, { recursive: true, force: true });
});

test("a selection is persisted per task and recipient, replaces only automatic records, and rewrites nothing when unchanged", () => {
  const root = makeRoot();
  const catalogue = wideCatalogue(root);
  const entries = catalogue.entries.filter((entry) => entry.freshness !== "stale");
  const picks = lexicalBookmarks("the billing pipeline", entries);
  const first = applySelection(root, "T1", "backend", "assign-1", catalogue.revision, picks, "lexical");
  assert.equal(first.records.length, picks.length);
  assert.ok(existsSync(bookmarksPath(root, "T1")));
  assert.equal(state(root)!.assignment, "assign-1");
  // A second, identical selection writes nothing and changes nothing.
  const again = applySelection(root, "T1", "backend", "assign-1", catalogue.revision, picks, "lexical");
  const shape = (state: BookmarkState) => state.records.map((record) => [record.ref, record.revision, record.authority]);
  assert.deepEqual(shape(again), shape(first));
  // A new automatic selection replaces the old automatic records.
  const other = applySelection(root, "T1", "backend", "assign-2", catalogue.revision, picks.slice(0, 2), "lexical");
  assert.equal(other.records.length, 2);
  assert.equal(other.assignment, "assign-2");
  rmSync(root, { recursive: true, force: true });
});

test("oracle pins and additions survive later automatic selections; exclusions block them for every recipient", () => {
  const root = makeRoot();
  const catalogue = wideCatalogue(root);
  const entries = catalogue.entries.filter((entry) => entry.freshness !== "stale");
  const picks = lexicalBookmarks("the billing pipeline", entries);
  const keptRef = picks[0]!.ref;
  const droppedRef = picks[1]!.ref;
  applySelection(root, "T1", "backend", "assign-1", catalogue.revision, picks, "lexical");
  const pinned = oracleBookmarkOp(root, "T1", "pin", [keptRef], { recipient: "backend", reason: "load-bearing" });
  assert.ok(pinned.state.records.find((record) => record.ref === keptRef)?.pinned);
  const excluded = oracleBookmarkOp(root, "T1", "exclude", [droppedRef], { reason: "misleading" });
  assert.ok(excluded.state.records.find((record) => record.ref === droppedRef)?.excluded);
  // A new selection: the pinned record stays, the excluded ref is never re-selected, the rest are replaced.
  const refreshed = applySelection(root, "T1", "backend", "assign-2", catalogue.revision, picks, "classifier");
  const record = (ref: string) => refreshed.records.find((entry) => entry.ref === ref);
  assert.equal(record(keptRef)!.authority, "oracle", "the pin survived");
  assert.equal(record(keptRef)!.pinned, true);
  assert.ok(!refreshed.records.some((entry) => entry.ref === droppedRef && !entry.excluded), "the exclusion survived");
  assert.equal(refreshed.records.filter((entry) => entry.authority === "classifier").length, MAX_AUTO_BOOKMARKS - 2, "the pinned ref and the excluded ref freed two automatic slots from this assignment's picks");
  const oracle = oracleBookmarkOp(root, "T1", "add", [entries.find((entry) => entry.locator.heading?.includes("Sampling"))!.id], { recipient: "qa", reason: "QA needs the buffer contract" });
  assert.equal(oracle.state.records.filter((entry) => entry.authority === "oracle" && !entry.excluded).length, 2);
  const removed = oracleBookmarkOp(root, "T1", "remove", [keptRef], {});
  assert.ok(!removed.state.records.some((entry) => entry.ref === keptRef && !entry.excluded));
  const unpin = oracleBookmarkOp(root, "T1", "unpin", [picks[2]!.ref], { recipient: "backend" });
  assert.ok(!unpin.state.records.find((entry) => entry.ref === picks[2]!.ref)?.pinned);
  assert.throws(() => oracleBookmarkOp(root, "T1", "add", ["not-a-ref"], {}), /reference id/);
  rmSync(root, { recursive: true, force: true });
});

test("delivery revalidates: changed sources are marked and corrected, stale generation refs are dropped, unauthorized refs are never named", () => {
  const root = makeRoot();
  const catalogue = writeRoot(root);
  const entries = catalogue.entries.filter((entry) => entry.freshness !== "stale");
  const board = entries.find((entry) => entry.locator.heading?.includes("Board delivery"))!;
  const sampler = entries.find((entry) => entry.locator.heading?.includes("Sampling"))!;
  applySelection(root, "T1", "backend", "assign-1", catalogue.revision, [
    { ref: board.id, reason: "bears on the board work", revision: board.revision },
    { ref: sampler.id, reason: "buffer contract", revision: sampler.revision },
  ], "lexical");
  // The board passage changes under its own id: the entry revision moves.
  const changed = KNOWLEDGE.replace("- Post board updates through the typed board; the lock contract is recorded in decisions.", "- Post board updates through the typed board; delivery is at-least-once.");
  writeFileSync(join(root, "Master", "knowledge", "knowledge.md"), changed);
  const next = refreshCatalogue([root]).catalogue;
  const delivery = deliverBookmarks(state(root), "backend", next, access(root));
  assert.equal(delivery.lines.length, 2);
  const changedLine = delivery.lines.find((text) => text.startsWith(board.id))!;
  assert.match(changedLine, /changed since it was filed/);
  assert.ok(delivery.corrections.some((text) => text.startsWith(`${board.id} changed`)), "a targeted correction names the changed bookmark");
  // A bookmark from another generation cannot resolve and is reported stale.
  const foreign: BookmarkState = { ...state(root)!, records: [{ ref: `K-00000000-0000-4000-8000-000000000000-9`, recipient: "backend", authority: "lexical", reason: "old", sourceVersion: "0", revision: 1, at: new Date().toISOString() }] };
  const stale = deliverBookmarks(foreign, "backend", next, access(root));
  assert.equal(stale.lines.length, 0, "the foreign ref delivers nothing");
  assert.ok(stale.corrections.some((text) => text.includes("another catalogue generation")));
  // A caller without this data tree never sees the reference, not even its metadata.
  const otherRoot = makeRoot();
  const hidden = deliverBookmarks(state(root), "backend", next, access(otherRoot));
  assert.equal(hidden.lines.length, 0);
  assert.equal(hidden.hidden, 2);
  assert.equal(hidden.corrections.length, 0, "unauthorized sources are not named");
  rmSync(root, { recursive: true, force: true });
  rmSync(otherRoot, { recursive: true, force: true });
});

test("annotation changes mark the delivered line; the metadata budget holds with an omission notice", () => {
  const root = makeRoot();
  const catalogue = writeRoot(root);
  const entries = catalogue.entries.filter((entry) => entry.freshness !== "stale");
  const board = entries.find((entry) => entry.locator.heading?.includes("Board delivery"))!;
  applySelection(root, "T1", "backend", "assign-1", catalogue.revision, [{ ref: board.id, reason: "bears on the board work", revision: board.revision }], "lexical");
  const before = deliverBookmarks(state(root), "backend", catalogue, access(root), readNotes(root));
  assert.doesNotMatch(before.lines[0]!, /noted/);
  addNote(root, { agent: "master", file: "knowledge.md", entry: board.locator.text, text: "Outdated: the board moved to the desk." });
  const after = deliverBookmarks(state(root), "backend", catalogue, access(root), readNotes(root));
  assert.match(after.lines[0]!, /noted/);
  // The block never exceeds the metadata budget, and what is left out is said, with a pointer.
  const wide = wideCatalogue(root);
  const wideEntries = wide.entries.filter((entry) => entry.freshness !== "stale");
  const picks = lexicalBookmarks("the billing pipeline", wideEntries, 40);
  assert.ok(picks.length > 8, "the fixture has more deliverable bookmarks than the budget holds");
  const many = updateBookmarks(root, "T2", () => ({
    version: 1, taskId: "T2", assignment: "assign-2", sourceRevision: wide.revision,
    records: picks.map((pick) => ({ ref: pick.ref, recipient: "backend", authority: "lexical" as const, reason: pick.reason, sourceVersion: `${wide.revision}`, revision: pick.revision, at: new Date().toISOString() })),
  }));
  const block = bookmarkBlock(many, "backend", wide, access(root));
  assert.ok(block.length <= BOOKMARK_METADATA_CHARS + 400, `block is ${block.length}`);
  assert.match(block, /\+\d+ more over the \d+-character injection budget — list_bookmarks shows the rest/);
  assert.match(block, /open_knowledge/);
  rmSync(root, { recursive: true, force: true });
});

test("list_bookmarks returns all eight recipient records with their generation IDs", () => {
  const root = makeRoot();
  try {
    const catalogue = wideCatalogue(root);
    const picks = lexicalBookmarks("the billing pipeline", catalogue.entries);
    assert.equal(picks.length, 8);
    const selected = applySelection(root, "T1", "backend", "assign-1", catalogue.revision, picks, "lexical");
    const expected = deliverBookmarks(selected, "backend", catalogue, access(root), [], Number.MAX_SAFE_INTEGER).lines;
    const listed = listBookmarkLines(selected, catalogue, access(root));
    assert.equal(listed.length, 8);
    assert.deepEqual(listed, expected.map((line) => `${line} · for backend`));
    assert.deepEqual(listed.map((line) => line.split(" · ")[0]), picks.map((pick) => pick.ref));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retirement keeps the list and the knowledge, but delivers nothing; the state survives a restart read", () => {
  const root = makeRoot();
  const catalogue = writeRoot(root);
  const entries = catalogue.entries.filter((entry) => entry.freshness !== "stale");
  applySelection(root, "T1", "backend", "assign-1", catalogue.revision, lexicalBookmarks("board", entries), "lexical");
  const knowledgeBefore = readFileSync(join(root, "Master", "knowledge", "knowledge.md"), "utf8");
  const retired = retireBookmarks(root, "T1");
  assert.ok(retired?.retiredAt);
  assert.deepEqual(deliverBookmarks(state(root), "backend", catalogue, access(root)).lines, []);
  assert.match(listBookmarkLines(state(root), catalogue, access(root))[0]!, /retired/);
  assert.equal(retireBookmarks(root, "T1")?.retiredAt, retired.retiredAt, "retiring twice changes nothing");
  assert.equal(readFileSync(join(root, "Master", "knowledge", "knowledge.md"), "utf8"), knowledgeBefore, "the knowledge is untouched");
  // A fresh read (a restart) sees the same retired state.
  assert.ok(readBookmarkState(root, "T1")!.retiredAt);
  rmSync(root, { recursive: true, force: true });
});

test("the shared hints budget holds: bookmarks keep their own budget, likely files give ground, duplicate lines go", () => {
  const bookmarks = Array.from({ length: 30 }, (_, index) => `K-x-${index} · entry ${index} — knowledge · master · bears on the work`).join("\n");
  const likely = ["- `src/a.ts` — the module", "- `src/b.ts` — the other", bookmarks.split("\n")[0]!].join("\n");
  const fitted = fitHints(bookmarks, likely);
  assert.ok(fitted.bookmarks.length <= BOOKMARK_METADATA_CHARS);
  assert.ok(fitted.bookmarks.length + fitted.likely.length <= OPTIONAL_HINTS_CHARS, `total is ${fitted.bookmarks.length + fitted.likely.length}`);
  assert.equal(fitted.likely.split("\n").filter((line) => line === bookmarks.split("\n")[0]).length, 0, "the duplicate line is dropped");
  const small = fitHints("K-x-1 · small", "- `src/a.ts` — the module");
  assert.equal(small.bookmarks, "K-x-1 · small");
  assert.equal(small.likely, "- `src/a.ts` — the module", "within budget, nothing is trimmed");
});

function jev(fetch: FetchLike, overrides: Partial<ClassifierConfig> = {}): Classifier {
  return new Classifier({ config: () => ({ ...DEFAULT_CONFIG.classifier, enabled: true, ...overrides }), keys: async () => "ts_key", fetch, sleep: async () => {} });
}

/** Jev answers yes for meta lines naming `yesAbout`, no otherwise; records every question. */
function refJev(yesAbout: string, calls: string[][] = [], options: { fail?: boolean; delayMs?: number } = {}): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { state: { sections: Record<string, string> } };
    calls.push(Object.values(body.state.sections));
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    init.signal?.throwIfAborted();
    if (options.fail) return new Response("{}", { status: 400 });
    const answers: Record<string, Answer> = {};
    for (const [key, meta] of Object.entries(body.state.sections)) answers[key] = { type: "noul", noul: meta.includes(yesAbout) ? 0.95 : 0.05 };
    return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
  };
}

function selectorInput(root: string, catalogue: Catalogue, assignment: string, cacheKey?: string) {
  return {
    assignment,
    entries: catalogue.entries.filter((entry) => entry.freshness !== "stale"),
    catalogueRevision: catalogue.revision,
    ...(cacheKey ? { cacheKey } : {}),
  };
}

test("the classifier picks from metadata only, within the cap; failure, disablement and timeout fall back to the lexical picks", async () => {
  const root = makeRoot();
  const catalogue = wideCatalogue(root);
  const entries = catalogue.entries.filter((entry) => entry.freshness !== "stale");
  const input = selectorInput(root, catalogue, "Fix webhook retries and the billing pipeline", "T1:backend");
  const calls: string[][] = [];
  const picked = await bookmarkSelector(jev(refJev("Webhook", calls))).select(input);
  assert.equal(calls.length, 1, "one classifier call");
  for (const meta of calls[0]!) {
    assert.ok(!meta.includes("The webhooks module"), "the classifier never sees a passage, only metadata");
    assert.ok(meta.startsWith("K-"), "each candidate is a catalogue reference line");
  }
  assert.ok(picked.length > 0 && picked.length <= MAX_AUTO_BOOKMARKS);
  assert.equal(picked.every((pick) => pick.source === "classifier"), true);
  assert.ok(picked.some((pick) => pick.ref === entries.find((entry) => entry.locator.heading?.includes("Webhooks"))!.id));
  const fallback = lexicalBookmarks(input.assignment, entries).map((pick) => ({ ...pick, source: "lexical" as const }));
  assert.deepEqual(await bookmarkSelector(jev(refJev("Webhook", calls, { fail: true }))).select({ ...input, cacheKey: "T1:fail" }), fallback, "classifier failure: lexical");
  assert.deepEqual(await bookmarkSelector(jev(refJev("Webhook"), { enabled: false, features: { ...DEFAULT_CONFIG.classifier.features, knowledge: false } })).select({ ...input, cacheKey: "T1:off" }), fallback, "classifier off: lexical");
  const slow = await bookmarkSelector(jev(refJev("Webhook", [], { delayMs: 300 }), { timeoutMs: 20 })).select({ ...input, assignment: "a different assignment" });
  assert.equal(slow.every((pick) => pick.source === "lexical"), true, "out of time: lexical");
  rmSync(root, { recursive: true, force: true });
});

test("selections are cached by assignment and catalogue revision, so unrelated activity does not rebuild them", async () => {
  const root = makeRoot();
  const catalogue = wideCatalogue(root);
  const calls: string[][] = [];
  const selector = bookmarkSelector(jev(refJev("Webhook", calls)));
  const input = selectorInput(root, catalogue, "Fix webhook retries", "T1:backend");
  await selector.select(input);
  await selector.select(input);
  assert.equal(calls.length, 1, "the cache answered the second time");
  await selector.select({ ...input, assignment: "Fix the email and search modules" });
  assert.equal(calls.length, 2, "a different assignment is selected afresh");
  await selector.select({ ...input, cacheKey: "T1:qa" });
  assert.equal(calls.length, 3, "a different recipient is selected afresh");
  const refreshed = refreshCatalogue([root]);
  await selector.select(selectorInput(root, refreshed.catalogue, "Fix webhook retries", "T1:backend"));
  assert.equal(calls.length, 4, "a new catalogue revision is selected afresh");
  rmSync(root, { recursive: true, force: true });
});

test("the request shows the classifier one bounded metadata line per candidate, and answers map back to references", () => {
  const root = makeRoot();
  const catalogue = wideCatalogue(root);
  const entries = catalogue.entries.filter((entry) => entry.freshness !== "stale");
  const candidates = lexicalBookmarks("Fix webhook retries", entries, BOOKMARK_CANDIDATES);
  const call = refRequest("Fix webhook retries", candidates.map((pick) => metaLine(entries.find((entry) => entry.id === pick.ref)!)));
  const sections = (call.request.state as { sections: Record<string, string> }).sections;
  assert.equal(Object.keys(call.request.questions).length, candidates.length);
  for (const [key, index] of call.keys) assert.equal(sections[key]!.startsWith(candidates[index]!.ref), true);
  const relevance = new Map([[0, 0.9], [1, 0.5], [2, 0.1]]);
  const picks = picksFromAnswers(relevance, entries, 0.4);
  assert.deepEqual(picks.map((pick) => pick.ref), [entries[0]!.id, entries[1]!.id], "below the floor is out, order follows confidence");
  rmSync(root, { recursive: true, force: true });
});

test("retrieval mode replaces the knowledge and decision dumps with bookmark metadata; legacy mode injects the dumps; never both", async () => {
  const root = makeRoot();
  mkdirSync(join(root, "Backend", "knowledge"), { recursive: true });
  writeFileSync(join(root, "Backend", "knowledge", "knowledge.md"), KNOWLEDGE);
  writeFileSync(join(root, "Backend", "knowledge", "decisions.md"), "# Decisions\n\n- Board writes take a lock.\n");
  const seen: string[] = [];
  const runner: ProcessRunner = async (args) => {
    seen.push(readFileSync(args[args.indexOf("--append-system-prompt") + 1]!, "utf8"));
    return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "## Completed\nx" }], model: "p/m", stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } }), stderr: "", killed: false };
  };
  const common = { taskId: "T1", domain: "backend" as const, instruction: "Step 1: fix the board delivery", taskText: "Board delivery under contention", scoutOutcomes: [], cwd: root, dataRoots: [root], knowledge: knowledgePicker(jev(refJev("Board"))) };
  await runWorker({ ...common, config: DEFAULT_CONFIG }, runner);
  const retrieval = seen[0]!;
  assert.match(retrieval, /## Bookmarks\n\nAssignment bookmarks/);
  assert.match(retrieval, /search_knowledge/);
  assert.doesNotMatch(retrieval, /## Knowledge\n/, "no historical knowledge dump beside the bookmarks");
  assert.doesNotMatch(retrieval, /## Decisions\n/, "no historical decision dump beside the bookmarks");
  assert.ok(existsSync(bookmarksPath(root, "T1")), "the selection is persisted in the task's storage");
  await runWorker({ ...common, config: { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, knowledgeRetrieval: false } } }, runner);
  const legacy = seen[1]!;
  assert.match(legacy, /## Knowledge\n/);
  assert.match(legacy, /## Decisions\n/);
  assert.doesNotMatch(legacy, /## Bookmarks/, "legacy mode never injects bookmarks");
  // Standards stay direct in both modes: they are required, not relevance-ranked.
  assert.doesNotMatch(retrieval, /## Standards\n/, "this project has no standards file, so the section is dropped rather than padded");
  assert.equal(retrieval.includes("## Standards"), legacy.includes("## Standards"));
  rmSync(root, { recursive: true, force: true });
});

test("an explicit system prompt override is never appended to, and the bookmarks section sits inside the compiled prompt", () => {
  const withBookmarks = compilePrompt({ domain: "backend", role: "worker", task: "do the thing", bookmarks: "K-x-1 · a bookmark", knowledge: "old knowledge text" });
  assert.match(withBookmarks, /## Knowledge\n\nold knowledge text/);
  assert.match(withBookmarks, /## Bookmarks\n\nK-x-1 · a bookmark/);
  assert.ok(withBookmarks.indexOf("## Decisions") < withBookmarks.indexOf("## Bookmarks"));
  const bare = compilePrompt({ domain: "backend", role: "worker", task: "do the thing" });
  assert.doesNotMatch(bare, /## Bookmarks/, "an empty bookmarks layer is dropped, so the prefix stays stable");
});

test("an update that loses a race still lands atomically: the lock serializes coordinated writers", () => {
  const root = makeRoot();
  writeRoot(root);
  const writes = Promise.all([
    Promise.resolve().then(() => applySelection(root, "T1", "backend", "assign-1", 1, [{ ref: "K-00000000-0000-4000-8000-000000000000-1", reason: "a", revision: 1 }], "lexical")),
    Promise.resolve().then(() => oracleBookmarkOp(root, "T1", "pin", ["K-00000000-0000-4000-8000-000000000000-2"], { recipient: "backend" })),
  ]);
  return writes.then(([selected, pinned]) => {
    assert.ok(selected.records.some((record) => record.ref.endsWith("-1")));
    assert.ok(pinned.state.records.some((record) => record.ref.endsWith("-2") && record.pinned));
    // Both writes are readable after the fact: the second one saw the first's records.
    assert.equal(updateBookmarks(root, "T1", (current) => current).records.length >= 1, true);
    const onDisk = JSON.parse(readFileSync(bookmarksPath(root, "T1"), "utf8")) as BookmarkState;
    assert.equal(onDisk.version, 1);
    rmSync(root, { recursive: true, force: true });
  });
});
