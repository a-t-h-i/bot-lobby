/**
 * `/bot-lobby web`: start once, print the link, stop, reset (old cookies die).
 * The command drives the real server with the shared fake service; the opener
 * is a spy and the config points at port 0, so the test binds anywhere free.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { loadConfig, saveConfig } from "../src/state/project.ts";
import { currentWebServer } from "../src/webui/server.ts";
import { webAction, webCommand, webLink } from "../src/webui/command.ts";
import { fakeWebService } from "./webui-fake.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-webcmd-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-webcmd-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

const service = fakeWebService(new LobbyFeed());
const opened: string[] = [];
const deps = { service, open: (url: string) => { opened.push(url); return true; } };

function fakeCtx(): { ctx: ExtensionCommandContext; notices: Array<{ message: string; level?: string }> } {
  const notices: Array<{ message: string; level?: string }> = [];
  const ctx = { ui: { notify: (message: string, level?: string) => void notices.push({ message, level }) } } as unknown as ExtensionCommandContext;
  return { ctx, notices };
}

function useConfig(web: { enabled: boolean; port: number; openBrowser: boolean; questions: "both" | "terminal" }): void {
  const config = loadConfig();
  saveConfig({ ...config, lobby: { ...config.lobby, web } });
}

function tokenOf(link: string): string {
  return new URL(link).hash.replace("#token=", "");
}

function send(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: { host: `127.0.0.1:${port}`, ...options.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string | string[] | undefined>, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const json = { "content-type": "application/json" };

/** Log in with the link's token and return the session cookie. */
async function login(port: number, link: string): Promise<string> {
  const answer = await send(port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token: tokenOf(link) }) });
  assert.equal(answer.status, 200);
  const cookie = answer.headers["set-cookie"];
  const first = Array.isArray(cookie) ? cookie[0] : cookie;
  assert.ok(first);
  return first!.split(";")[0]!;
}

test("webAction names the subcommands", () => {
  assert.equal(webAction(undefined), "start");
  assert.equal(webAction("stop"), "stop");
  assert.equal(webAction("link"), "link");
  assert.equal(webAction("reset"), "reset");
  assert.equal(webAction("bogus"), undefined);
});

test("web without the lobby service is a notice, not a throw", async () => {
  const { ctx, notices } = fakeCtx();
  await webCommand(ctx, undefined, { open: () => true });
  assert.match(notices.at(-1)!.message, /needs the lobby service/);
});

test("web starts once: a second start is a notice, and link prints the link", async () => {
  useConfig({ enabled: false, port: 0, openBrowser: true, questions: "both" });
  const { ctx, notices } = fakeCtx();
  await webCommand(ctx, undefined, deps);
  const started = notices.at(-1)!.message;
  assert.match(started, /http:\/\/127\.0\.0\.1:\d+\/#token=/);
  assert.deepEqual(opened, [currentWebServer()!.link]);
  await webCommand(ctx, undefined, deps);
  assert.match(notices.at(-1)!.message, /already running/);
  assert.equal(opened.length, 1, "the browser opens once");
  await webCommand(ctx, "link", deps);
  assert.match(notices.at(-1)!.message, new RegExp(currentWebServer()!.link.replace(/[./:#]/g, (c) => `\\${c}`)));
  await currentWebServer()!.close();
  assert.equal(currentWebServer(), undefined);
});

test("web reset changes the link and signs out the old cookie", async () => {
  useConfig({ enabled: false, port: 0, openBrowser: false, questions: "both" });
  const { ctx, notices } = fakeCtx();
  await webCommand(ctx, undefined, deps);
  const before = webLink()!;
  const port = currentWebServer()!.port;
  const cookie = await login(port, before);
  await webCommand(ctx, "reset", deps);
  const after = webLink()!;
  assert.notEqual(after, before);
  assert.match(notices.at(-1)!.message, /changed/);
  await webCommand(ctx, "link", deps);
  assert.ok(notices.at(-1)!.message.includes(after), "link prints the new link");
  const stale = await send(port, { method: "POST", path: "/api/status.get", headers: { ...json, cookie }, body: "{}" });
  assert.equal(stale.status, 401, "the old cookie no longer signs in");
  const fresh = await login(port, after);
  const signed = await send(port, { method: "POST", path: "/api/status.get", headers: { ...json, cookie: fresh }, body: "{}" });
  assert.equal(signed.status, 200);
  await webCommand(ctx, "stop", deps);
  assert.equal(currentWebServer(), undefined);
  assert.match(notices.at(-1)!.message, /stopped/);
});

test("web stop and reset with nothing running are notices", async () => {
  const { ctx, notices } = fakeCtx();
  await webCommand(ctx, "stop", deps);
  assert.match(notices.at(-1)!.message, /not running/);
  await webCommand(ctx, "reset", deps);
  assert.match(notices.at(-1)!.message, /not running/);
  await webCommand(ctx, "link", deps);
  assert.match(notices.at(-1)!.message, /not running/);
});
