import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSession } from "../src/excalidraw/check.ts";
import { newRoomLink } from "../src/excalidraw/room.ts";

/** Reaches Excalidraw's own collaboration server: set BOT_LOBBY_LIVE_EXCALIDRAW=1 (needs the network). */
const live = process.env.BOT_LOBBY_LIVE_EXCALIDRAW === "1";

test("a fresh room on Excalidraw's collaboration server can be joined, and is empty", { skip: !live }, async () => {
  const result = await checkSession(newRoomLink().url, "live check", { connectTimeoutMs: 15_000 });
  assert.equal(result.ok, true, result.text);
  assert.match(result.text, /reached the server; nobody has this session open yet/);
});
