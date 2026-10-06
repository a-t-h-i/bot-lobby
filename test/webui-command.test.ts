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
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LobbyFeed, lobbyFeed } from "../src/lobby/feed.ts";
import { loadConfig, saveConfig } from "../src/state/project.ts";
import { currentWebServer } from "../src/webui/server.ts";
import { registerWebServer, webAction, webCommand, webLink, webSessionStarted } from "../src/webui/command.ts";
import { fakeWebService } from "./webui-fake.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-webcmd-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-webcmd-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

const service = fakeWebService(new LobbyFeed());
const opened: string[] = [];
const deps = { service, open: (url: string) => { opened.push(url); return true; } };

function fakeCtx(): { ctx: ExtensionCommandContext; notices: Array<{ message: string; level?: string }>; statuses: Array<string | undefined> } {
  const notices: Array<{ message: string; level?: string }> = [];
  const statuses: Array<string | undefined> = [];
  const ctx = { ui: { notify: (message: string, level?: string) => void notices.push({ message, level }), setStatus: (_key: string, text?: string) => void statuses.push(text) } } as unknown as ExtensionCommandContext;
  return { ctx, notices, statuses };
}

function useConfig(web: { port: number; openBrowser: boolean }): void {
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
  assert.match(notices.at(-1)!.message, /needs an interactive pi session/);
});

test("web starts once and shows its address; a second `web` opens the page again, and link prints the link", async () => {
  useConfig({ port: 0, openBrowser: true });
  const { ctx, notices, statuses } = fakeCtx();
  opened.length = 0;
  await webCommand(ctx, undefined, deps);
  const started = notices.at(-1)!.message;
  assert.match(started, /http:\/\/127\.0\.0\.1:\d+\/#token=/);
  assert.deepEqual(opened, [currentWebServer()!.link]);
  assert.match(statuses.at(-1) ?? "", /^bot-lobby web ui: http:\/\/127\.0\.0\.1:\d+$/, "pi's status line names the address, never the secret");
  await webCommand(ctx, undefined, deps);
  assert.equal(opened.length, 2, "asking again opens the page again");
  assert.match(notices.at(-1)!.message, /http:\/\/127\.0\.0\.1:\d+\/#token=/);
  await webCommand(ctx, "link", deps);
  assert.match(notices.at(-1)!.message, new RegExp(currentWebServer()!.link.replace(/[./:#]/g, (c) => `\\${c}`)));
  await currentWebServer()!.close();
  assert.equal(currentWebServer(), undefined);
});

test("web reset changes the link and signs out the old cookie", async () => {
  useConfig({ port: 0, openBrowser: false });
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

test("a session starting brings the page up on its own, opens the browser once and follows later sessions", async () => {
  useConfig({ port: 0, openBrowser: true });
  const notices: string[] = [];
  const statuses: Array<string | undefined> = [];
  const interactive = { mode: "tui", ui: { notify: (message: string) => void notices.push(message), setStatus: (_key: string, text?: string) => void statuses.push(text) } } as unknown as ExtensionContext;
  const printed = { mode: "print", ui: interactive.ui } as unknown as ExtensionContext;
  opened.length = 0;
  webSessionStarted(printed, deps);
  assert.equal(currentWebServer(), undefined, "a one-shot run serves nothing");
  webSessionStarted(interactive, deps);
  for (let i = 0; i < 50 && !currentWebServer(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const server = currentWebServer();
  assert.ok(server, "the server is up without any command");
  assert.deepEqual(opened, [server!.link], "the browser opens on it");
  assert.match(notices.at(-1)!, /http:\/\/127\.0\.0\.1:\d+\/#token=/);
  assert.match(statuses.at(-1) ?? "", /^bot-lobby web ui: http:\/\/127\.0\.0\.1:\d+$/);
  webSessionStarted(interactive, deps);
  assert.equal(currentWebServer(), server, "a later session reuses the server");
  assert.equal(opened.length, 1, "and does not open another window");
  await server!.close();
});

test("switching sessions: a call the replaced session cannot answer is a quiet 503; a session with bot-lobby off stops the page; a reload brings it back on the same port", async () => {
  useConfig({ port: 0, openBrowser: true });
  const notices: string[] = [];
  const interactive = { mode: "tui", ui: { notify: (message: string) => void notices.push(message), setStatus: () => {} } } as unknown as ExtensionContext;
  // The lobby service of a session pi has replaced: every use of its context throws pi's refusal.
  const stale = { ...fakeWebService(new LobbyFeed()), planner: () => { throw new Error("This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession()."); } };
  opened.length = 0;
  webSessionStarted(interactive, { ...deps, service: stale });
  for (let i = 0; i < 50 && !currentWebServer(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const server = currentWebServer()!;
  const login = await send(server.port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token: tokenOf(server.link) }) });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const reply = await send(server.port, { method: "POST", path: "/api/planner.get", headers: { ...json, cookie }, body: "{}" });
  assert.equal(reply.status, 503);
  assert.match(JSON.parse(reply.body).error, /switching sessions/);
  assert.equal(lobbyFeed.activity.some((entry) => /could not do that/.test(entry.text)), false, "and no error in the activity log");

  // pi reloads the extension: this copy's server closes and leaves its port for the next copy.
  const handlers = new Map<string, (event: unknown) => unknown>();
  registerWebServer({ on: (name: string, handler: (event: unknown) => unknown) => void handlers.set(name, handler) } as unknown as ExtensionAPI);
  const port = server.port;
  await handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "reload" });
  assert.equal(currentWebServer(), undefined, "the reloaded copy's server is closed");
  webSessionStarted(interactive, deps);
  for (let i = 0; i < 50 && !currentWebServer(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(currentWebServer()?.port, port, "the new copy serves the same port, so the open page reconnects");
  assert.equal(opened.length, 1, "without opening another window");

  // A session where bot-lobby is off has no lobby to serve: the page's server stops.
  webSessionStarted(interactive, { open: deps.open });
  for (let i = 0; i < 50 && currentWebServer(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(currentWebServer(), undefined);
});
