/**
 * Preview images: the cookie is required, and only real image files under a
 * task's preview dir are served (the jail holds for `..`, encoded `..`,
 * wrong extensions and symlinks out). Prompt payloads carry them as
 * `/files/preview/<task>/<name>` URLs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { fakeWebService } from "./webui-fake.ts";
import { promptHub } from "../src/lobby/prompt-hub.ts";
import { previewDir } from "../src/ask/relay.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-files-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-files-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TASK = "t123";

function seedPreviews(): void {
  mkdirSync(previewDir(TASK), { recursive: true });
  writeFileSync(join(previewDir(TASK), "shot.png"), PNG);
  writeFileSync(join(previewDir(TASK), "note.txt"), "not an image");
  try {
    symlinkSync(join(tmpdir(), "bl-escape.txt"), join(previewDir(TASK), "link.png"));
  } catch {
    // A stale link from an earlier run; the jail test still holds.
  }
}
writeFileSync(join(tmpdir(), "bl-escape.txt"), "outside");
seedPreviews();

interface Answer {
  status: number;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

function get(port: number, path: string, cookie?: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method: "GET", path, headers: { host: `127.0.0.1:${port}`, ...(cookie ? { cookie } : {}) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers as Answer["headers"] }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function post(port: number, path: string, cookie: string | undefined, body: unknown): Promise<{ status: number; json: { ok: boolean; result?: unknown; code?: string } }> {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path,
        headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) as { ok: boolean; result?: unknown; code?: string } }));
      },
    );
    req.on("error", reject);
    req.write(text);
    req.end();
  });
}

async function signedIn() {
  const server = await startWebServer({ service: fakeWebService(new LobbyFeed()), port: 0, secret: randomBytes(32), dist: DIST });
  const token = new URL(server.link).hash.replace("#token=", "");
  const login = await post(server.port, "/api/auth.login", undefined, { token });
  assert.equal(login.status, 200);
  const loginRaw = await new Promise<string>((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: server.port, method: "POST", path: "/api/auth.login", headers: { host: `127.0.0.1:${server.port}`, "content-type": "application/json" } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(String(res.headers["set-cookie"]).split(";")[0]!));
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify({ token }));
    req.end();
  });
  return { server, cookie: loginRaw, close: () => server.close() };
}

test("a preview needs the cookie, then serves with its type and nosniff", async () => {
  const { server, cookie, close } = await signedIn();
  try {
    assert.equal((await get(server.port, `/files/preview/${TASK}/shot.png`)).status, 401);
    assert.equal((await get(server.port, `/files/preview/${TASK}/shot.png`, "bl_session=guess")).status, 401);
    const ok = await get(server.port, `/files/preview/${TASK}/shot.png`, cookie);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers["content-type"], "image/png");
    assert.equal(ok.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(ok.body, PNG);
  } finally {
    await close();
  }
});

test("the preview jail holds: .., encoded .., wrong extensions, missing files and escapes are 404", async () => {
  const { server, cookie, close } = await signedIn();
  try {
    for (const path of [
      `/files/preview/${TASK}/../other/shot.png`,
      `/files/preview/%2e%2e/%2e%2e/etc/passwd`,
      `/files/preview/${TASK}/note.txt`,
      `/files/preview/${TASK}/missing.png`,
      `/files/preview/${TASK}/link.png`,
      `/files/preview/../${TASK}/shot.png`,
      `/files/preview/${TASK}/`,
    ]) {
      const answer = await get(server.port, path, cookie);
      assert.equal(answer.status, 404, path);
    }
  } finally {
    await close();
  }
});

test("prompts.list carries preview URLs that load through the jail", async () => {
  const { server, cookie, close } = await signedIn();
  try {
    const abs = join(previewDir(TASK), "shot.png");
    const prompt = promptHub.open("questionnaire", "test", { questions: [{ options: [{ label: "A", image: abs }] }] });
    try {
      const list = await post(server.port, "/api/prompts.list", cookie, {});
      assert.equal(list.status, 200);
      const prompts = (list.json.result as { prompts: Array<{ id: string; payload: unknown }> }).prompts;
      const found = prompts.find((entry) => entry.id === prompt.id);
      assert.deepEqual(found?.payload, { questions: [{ options: [{ label: "A", image: `/files/preview/${TASK}/shot.png` }] }] });
      const image = await get(server.port, `/files/preview/${TASK}/shot.png`, cookie);
      assert.equal(image.status, 200);
      assert.deepEqual(image.body, PNG);
    } finally {
      promptHub.dismiss(prompt.id);
    }
  } finally {
    await close();
  }
});
