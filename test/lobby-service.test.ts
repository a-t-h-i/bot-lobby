import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureProjectStructure } from "../src/state/persistence.ts";
import { createLobbyService } from "../src/lobby/service.ts";
import { lobbyFeed } from "../src/lobby/feed.ts";
import type { Runtime } from "../src/lobby/runtime.ts";

let ambientConfig: string | undefined;
before(() => {
  ambientConfig = process.env.BOT_LOBBY_CONFIG_DIR;
  process.env.BOT_LOBBY_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bl-svc-cfg-"));
});
after(() => {
  if (ambientConfig === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
  else process.env.BOT_LOBBY_CONFIG_DIR = ambientConfig;
});

function fakeState(): Runtime {
  const root = mkdtempSync(join(tmpdir(), "bl-svc-"));
  ensureProjectStructure(root, ".pi");
  const ctx = {
    cwd: root,
    ui: { notify() {} },
    sessionManager: { getSessionId: () => "session-1", getBranch: () => [] },
    isIdle: () => true,
    abort() {},
  } as unknown as ExtensionContext;
  const pi = {
    sendUserMessage() {},
    getSessionName: () => "test window",
  } as unknown as ExtensionAPI;
  return { root, configDir: ".pi", ctx, pi } as unknown as Runtime;
}

test("the service exposes data and actions with no TUI", () => {
  const service = createLobbyService(fakeState());
  assert.equal(service.feed, lobbyFeed);
  assert.deepEqual(service.tasks(), []);
  assert.equal(typeof service.toOracle, "function");
  assert.equal(service.comment("TASK-nope", "hello"), "no task TASK-nope");
  assert.equal(typeof service.issuesEnabled(), "boolean");
});

test("the service carries no terminal-only members", () => {
  const service = createLobbyService(fakeState());
  for (const member of ["rows", "theme", "hide", "requestRender", "keys", "panels", "savePanels", "editText", "openSettings"]) {
    assert.ok(!(member in service), `${member} stays with the terminal`);
  }
});
