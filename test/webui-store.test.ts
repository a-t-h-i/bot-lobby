/**
 * The page's data layer under `node:test`: the topic store's hello resync,
 * change handling and stream deltas; a 401 marking the page signed out; the
 * event stream's connection states; and the formatters' bad-input guards. No
 * browser and no DOM globals.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, call } from "../webui/src/lib/api.ts";
import { openEvents, type EventSourceLike } from "../webui/src/lib/events.ts";
import { createLobbyStore, lobbyStore } from "../webui/src/lib/store.ts";
import { formatClock, formatElapsed } from "../webui/src/lib/format.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("hello resync rereads only the topics the current screen uses", async () => {
  const store = createLobbyStore();
  const seen: string[] = [];
  const reader = async (topic: string) => {
    seen.push(topic);
    return { topic };
  };

  store.markUsed(["lobby", "status"], reader);
  await tick();
  assert.deepEqual([...new Set(seen)].sort(), ["lobby", "status"]);

  seen.length = 0;
  store.onHello({ lobby: 2, status: 1, tasks: 9 });
  await tick();
  assert.deepEqual([...new Set(seen)].sort(), ["lobby", "status"]);
  assert.equal(seen.includes("tasks"), false);
});

test("a change rereads only a used topic, else marks it stale", async () => {
  const store = createLobbyStore();
  const seen: string[] = [];
  store.markUsed(["lobby"], async (topic) => {
    seen.push(topic);
    return undefined;
  });
  await tick();
  seen.length = 0;

  store.onChanged("tasks", 3);
  await tick();
  assert.deepEqual(seen, []);
  assert.equal(store.get("tasks").stale, true);

  store.onChanged("lobby", 4);
  await tick();
  assert.deepEqual(seen, ["lobby"]);
  assert.equal(store.get("lobby").version, 4);
});

test("feed and reply deltas patch the lobby snapshot", async () => {
  const store = createLobbyStore();
  const snapshot = {
    chat: [{ id: 1, at: 0, role: "you", text: "hi" }],
    activity: [{ id: 1, at: 0, source: "DEV", text: "a", kind: "info", pending: false }],
    thoughts: [{ id: 1, at: 0, source: "DEV", text: "t", live: false }],
    runs: [],
    hasOlderChat: false,
  };
  store.markUsed(["lobby"], async () => snapshot as unknown);
  await tick();

  store.onFeedDelta({
    chat: [{ id: 2, at: 1, role: "oracle", text: "yo" }],
    activity: [{ id: 2, at: 1, source: "QA", text: "b", kind: "success", pending: false }],
    thoughts: [{ id: 2, at: 1, source: "QA", text: "u", live: true }],
  });
  const patched = store.get("lobby").data as { chat: unknown[]; activity: unknown[] } | undefined;
  assert.equal(patched?.chat.length, 2);
  assert.equal(patched?.activity.length, 2);

  store.onReplyDelta("streaming");
  assert.equal((store.get("lobby").data as { reply?: string }).reply, "streaming");
});

test("a 401 marks the page signed out", async () => {
  const original = globalThis.fetch;
  lobbyStore.onStatus({ signedOut: false });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, error: "sign in", code: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(call("status.get", {}), (error: unknown) => error instanceof ApiError && error.code === "unauthorized");
    assert.equal(lobbyStore.status().signedOut, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("a dropped connection goes connecting then live again", () => {
  const states: string[] = [];
  let readyState = 1;
  const fake: EventSourceLike = {
    onopen: null,
    onerror: null,
    onmessage: null,
    get readyState() {
      return readyState;
    },
    close() {},
  };

  const close = openEvents({ onConnection: (state) => states.push(state) }, () => fake);
  assert.deepEqual(states, ["connecting"]);

  fake.onopen?.({});
  fake.onerror?.({});
  fake.onopen?.({});
  assert.deepEqual(states, ["connecting", "live", "connecting", "live"]);

  readyState = 2;
  fake.onerror?.({});
  assert.deepEqual(states, ["connecting", "live", "connecting", "live", "offline"]);

  close();
});

test("formatters guard non-finite input and never render NaN", () => {
  assert.equal(formatClock(Number.NaN), "0");
  assert.equal(formatElapsed(Number.NaN), "0s");
  assert.equal(formatElapsed(-1), "0s");
  assert.equal(formatElapsed(1_500), "1s");
});
