/**
 * The event stream: `hello` with versions on connect, `changed` coalesced to
 * one per topic per 40 ms, feed/reply deltas, `:ping` heartbeats, and at most
 * 8 streams (the oldest closes when a ninth opens).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest, type IncomingMessage, type ClientRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { fakeWebService } from "./webui-fake.ts";
import { lobbyTopics } from "../src/lobby/topics.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-events-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-events-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

const json = { "content-type": "application/json" };

function fakeService(feed: LobbyFeed) {
  return fakeWebService(feed);
}

async function start(feed = new LobbyFeed(), heartbeatMs = 30) {
  const server = await startWebServer({ service: fakeService(feed), port: 0, secret: randomBytes(32), dist: DIST, heartbeatMs });
  const token = new URL(server.link).hash.replace("#token=", "");
  const login = await new Promise<{ cookie: string }>((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: server.port, method: "POST", path: "/api/auth.login", headers: { host: `127.0.0.1:${server.port}`, ...json } },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ cookie: String(res.headers["set-cookie"]).split(";")[0]! }));
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify({ token }));
    req.end();
  });
  return { server, feed, cookie: login.cookie };
}

interface Tap {
  req: ClientRequest;
  raw: string;
  events: Array<Record<string, unknown>>;
  closed: boolean;
  destroy(): void;
}

function tap(port: number, cookie: string, path = "/api/events"): Promise<Tap> {
  return new Promise((resolve, reject) => {
    const tapState: Tap = { req: undefined as unknown as ClientRequest, raw: "", events: [], closed: false, destroy() {} };
    const req = httpRequest(
      { host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}`, cookie } },
      (res: IncomingMessage) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`stream refused with ${res.statusCode}`));
          return;
        }
        res.on("data", (chunk: Buffer) => {
          tapState.raw += chunk.toString("utf8");
          for (const line of chunk.toString("utf8").split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                tapState.events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
              } catch {
                // Partial frame; the rest arrives with the next chunk.
              }
            }
          }
        });
        res.on("close", () => {
          tapState.closed = true;
        });
        tapState.destroy = () => req.destroy();
        resolve(tapState);
      },
    );
    tapState.req = req;
    tapState.destroy = () => req.destroy();
    req.on("error", () => {});
    req.end();
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the stream says hello with every topic's versions", async () => {
  const { server, cookie } = await start();
  try {
    const stream = await tap(server.port, cookie);
    try {
      await wait(50);
      assert.equal(stream.events[0]?.type, "hello");
      const versions = stream.events[0]?.versions as Record<string, number>;
      for (const topic of ["lobby", "tasks", "plans", "planner", "quickfix", "sessions", "metrics", "git", "issues", "knowledge", "excalidraw", "prompts", "notices", "status"]) {
        assert.ok(typeof versions[topic] === "number", `hello carries ${topic}`);
      }
    } finally {
      stream.destroy();
    }
  } finally {
    await server.close();
  }
});

test("a bump sends changed, and 100 bumps in 40 ms send one message", async () => {
  const { server, cookie } = await start();
  try {
    const stream = await tap(server.port, cookie);
    try {
      await wait(50);
      stream.events.length = 0;
      const before = lobbyTopics.version("metrics");
      for (let i = 0; i < 100; i++) lobbyTopics.bump("metrics");
      await wait(200);
      const changed = stream.events.filter((event) => event.type === "changed" && event.topic === "metrics");
      assert.equal(changed.length, 1, `100 bumps coalesce to one message, got ${changed.length}`);
      assert.equal(changed[0]?.version, before + 100);
    } finally {
      stream.destroy();
    }
  } finally {
    await server.close();
  }
});

test("feed entries and the streaming reply arrive as deltas, with a :ping heartbeat", async () => {
  const feed = new LobbyFeed();
  const { server, cookie } = await start(feed);
  try {
    const stream = await tap(server.port, cookie);
    try {
      await wait(50);
      stream.events.length = 0;
      feed.say("you", "hello oracle");
      feed.replyDelta("working on it");
      await wait(200);
      const kinds = stream.events.map((event) => event.type);
      assert.ok(kinds.includes("feed"), `feed deltas arrive, got ${kinds.join(",")}`);
      assert.ok(kinds.includes("reply"), `reply deltas arrive, got ${kinds.join(",")}`);
      assert.match(stream.raw, /:ping/, "idle streams hear :ping");
    } finally {
      stream.destroy();
    }
  } finally {
    await server.close();
  }
});

test("at most 8 streams stay open; the oldest closes when a ninth opens", async () => {
  const { server, cookie } = await start();
  try {
    const streams: Tap[] = [];
    for (let i = 0; i < 9; i++) streams.push(await tap(server.port, cookie));
    await wait(100);
    assert.equal(server.clients(), 8);
    assert.equal(streams[0]?.closed, true, "the oldest stream closed");
    assert.equal(streams[8]?.closed, false, "the newest stream stays open");
    for (const stream of streams) stream.destroy();
  } finally {
    await server.close();
  }
});

test("the stream refuses anyone without the cookie", async () => {
  const { server } = await start();
  try {
    await assert.rejects(tap(server.port, "bl_session=guess"), /refused with 401/);
  } finally {
    await server.close();
  }
});
