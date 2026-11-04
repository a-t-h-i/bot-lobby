// bot-herdr mod client helpers, checked in Node: the cookie must match the
// server's, and the raw-socket SSE reader must read a real Node event stream.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { connect } from "node:net";
import { test } from "node:test";
import { sessionValue } from "../src/webui/auth.ts";
// @ts-ignore plain JS mod file
import { sessionCookie } from "../herdr/mods/bot-herdr/lib/hmac.js";
// @ts-ignore plain JS mod file
import { SseReader } from "../herdr/mods/bot-herdr/lib/sse.js";

test("mod cookie matches the server's session value", () => {
  for (let i = 0; i < 20; i++) {
    const secret = randomBytes(32);
    assert.equal(sessionCookie(createHash, secret.toString("base64")), sessionValue(secret));
  }
});

test("SSE reader decodes a chunked Node event stream", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
    res.write(`retry: 2000\ndata: ${JSON.stringify({ type: "hello", note: "é ✓" })}\n\n`);
    res.write(":ping\n\n");
    res.write(`data: ${JSON.stringify({ type: "changed", topic: "lobby" })}\n\ndata: {"type":"rep`);
    res.write(`ly","text":"hi"}\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const reader = new SseReader();
  const events: unknown[] = [];
  await new Promise<void>((resolve) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(`GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAccept: text/event-stream\r\n\r\n`));
    socket.on("data", (b) => { for (let i = 0; i < b.length; i += 7) events.push(...reader.push(new Uint8Array(b.subarray(i, i + 7)))); });
    socket.on("end", () => resolve());
  });
  server.close();
  assert.equal(reader.status, 200);
  assert.ok(reader.chunked);
  assert.deepEqual(events, [
    { event: undefined, data: '{"type":"hello","note":"é ✓"}' },
    { comment: "ping" },
    { event: undefined, data: '{"type":"changed","topic":"lobby"}' },
    { event: undefined, data: '{"type":"reply","text":"hi"}' },
  ]);
});
