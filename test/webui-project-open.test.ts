import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { ProjectRegistry, projectInfo } from "../src/webui/projects.ts";
import { ProjectOpener } from "../src/webui/project-open.ts";
import { servesPage } from "../src/lobby/runtime.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

async function host(dir: string, root: string) {
  let registry: ProjectRegistry;
  const server = createServer((_req, res) => res.end(JSON.stringify({ ok: true, result: { project: projectInfo(registry.record) } })));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  registry = new ProjectRegistry(dir, root, (server.address() as AddressInfo).port);
  return { registry, close: () => { registry.close(); server.closeAllConnections(); server.close(); } };
}

function child() {
  let finish!: () => void;
  const exited = new Promise<void>((resolve) => { finish = resolve; });
  return { alive: true, stopped: false, whenExited: () => exited, stop() { this.alive = false; this.stopped = true; finish(); } };
}

function temp() {
  const root = mkdtempSync(join(tmpdir(), "bl-open-"));
  mkdirSync(join(root, ".git"));
  return root;
}

test("only explicit managed RPC projects serve their own page", (t) => {
  const previous = process.env.BOT_LOBBY_WEB_PROJECT;
  t.after(() => { if (previous === undefined) delete process.env.BOT_LOBBY_WEB_PROJECT; else process.env.BOT_LOBBY_WEB_PROJECT = previous; });
  const context = (mode: string) => ({ mode }) as ExtensionContext;
  delete process.env.BOT_LOBBY_WEB_PROJECT;
  assert.equal(servesPage(context("tui")), true);
  assert.equal(servesPage(context("rpc")), false);
  process.env.BOT_LOBBY_WEB_PROJECT = "1";
  assert.equal(servesPage(context("rpc")), true);
  assert.equal(servesPage(context("print")), false);
});

test("opening a running canonical project reuses it without launching", async (t) => {
  const dir = temp(); const root = temp();
  const current = await host(dir, root);
  t.after(() => { current.close(); rmSync(dir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });
  const opener = new ProjectOpener(current.registry, () => { throw new Error("must reuse"); });
  assert.equal((await opener.open(root)).id, current.registry.record.id);
});

test("concurrent opens share one startup, wait for health and stop owned children on close", async (t) => {
  const dir = temp(); const root = temp(); const other = temp();
  const current = await host(dir, root);
  const proc = child(); let launched = 0;
  let started: ReturnType<typeof host>;
  const opener = new ProjectOpener(current.registry, () => { launched++; started = host(dir, other); return proc; });
  t.after(async () => { opener.close(); (await started)?.close(); current.close(); for (const path of [dir, root, other]) rmSync(path, { recursive: true, force: true }); });
  const [first, second] = await Promise.all([opener.open(other), opener.open(other)]);
  assert.equal(first.id, second.id);
  assert.equal(first.cwd, other);
  assert.equal(launched, 1);
  opener.close();
  assert.equal(proc.stopped, true);
  await assert.rejects(opener.open(other), /closing/);
});

test("startup timeout stops the new process and a retry can launch again", async (t) => {
  const dir = temp(); const root = temp(); const other = temp();
  const current = await host(dir, root);
  const children: ReturnType<typeof child>[] = [];
  const opener = new ProjectOpener(current.registry, () => { const proc = child(); children.push(proc); return proc; }, 1);
  t.after(() => { opener.close(); current.close(); for (const path of [dir, root, other]) rmSync(path, { recursive: true, force: true }); });
  await assert.rejects(opener.open(other), /did not start/);
  assert.equal(children[0]?.stopped, true);
  await assert.rejects(opener.open(other), /did not start/);
  assert.equal(children.length, 2);
});
