import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";

test("lobby.web defaults to port 7347, opening the browser", () => {
  assert.deepEqual(DEFAULT_CONFIG.lobby.web, { port: 7347, openBrowser: true });
  assert.deepEqual(resolveConfig({}).lobby.web, { port: 7347, openBrowser: true });
  assert.deepEqual(resolveConfig({ lobby: {} }).lobby.web, { port: 7347, openBrowser: true });
});

test("lobby.web keeps good values, including port 0", () => {
  assert.deepEqual(resolveConfig({ lobby: { web: { port: 0, openBrowser: false } } }).lobby.web, { port: 0, openBrowser: false });
  assert.equal(resolveConfig({ lobby: { web: { port: 8080 } } }).lobby.web.port, 8080);
});

test("lobby.web refuses a bad port", () => {
  for (const port of [-1, 1.5, Number.NaN, 70000, "7347", undefined]) {
    const web = resolveConfig({ lobby: { web: { port } } }).lobby.web;
    assert.equal(web.port, 7347, `port ${String(port)}`);
  }
  assert.equal(resolveConfig({ lobby: { web: { openBrowser: 1 } } }).lobby.web.openBrowser, true);
});

test("lobby.web stays last in the effective config, and the retired terminal settings are gone", () => {
  assert.equal(Object.keys(resolveConfig({}).lobby).at(-1), "web");
  const lobby = resolveConfig({ lobby: { autoOpen: false, web: { enabled: true, questions: "terminal" } } }).lobby as unknown as Record<string, unknown>;
  assert.equal("autoOpen" in lobby, false);
  assert.deepEqual(lobby.web, { port: 7347, openBrowser: true });
});
