import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";

test("lobby.web defaults to off on 7347, opening the browser, questions in both", () => {
  assert.deepEqual(DEFAULT_CONFIG.lobby.web, { enabled: false, port: 7347, openBrowser: true, questions: "both" });
  assert.deepEqual(resolveConfig({}).lobby.web, { enabled: false, port: 7347, openBrowser: true, questions: "both" });
  assert.deepEqual(resolveConfig({ lobby: {} }).lobby.web, { enabled: false, port: 7347, openBrowser: true, questions: "both" });
});

test("lobby.web keeps good values, including port 0 and terminal-only questions", () => {
  const web = resolveConfig({ lobby: { web: { enabled: true, port: 0, openBrowser: false, questions: "terminal" } } }).lobby.web;
  assert.deepEqual(web, { enabled: true, port: 0, openBrowser: false, questions: "terminal" });
  const other = resolveConfig({ lobby: { web: { port: 8080, questions: "both" } } }).lobby.web;
  assert.equal(other.port, 8080);
  assert.equal(other.questions, "both");
});

test("lobby.web refuses a bad port or questions value", () => {
  for (const port of [-1, 1.5, Number.NaN, 70000, "7347", undefined]) {
    const web = resolveConfig({ lobby: { web: { port } } }).lobby.web;
    assert.equal(web.port, 7347, `port ${String(port)}`);
  }
  for (const questions of ["everywhere", "browser", "", 0, null]) {
    const web = resolveConfig({ lobby: { web: { questions } } }).lobby.web;
    assert.equal(web.questions, "both", `questions ${String(questions)}`);
  }
  const flags = resolveConfig({ lobby: { web: { enabled: "yes", openBrowser: 1 } } }).lobby.web;
  assert.deepEqual([flags.enabled, flags.openBrowser], [false, true]);
});

test("lobby.web merges over other lobby fields and stays last in the effective config", () => {
  const lobby = resolveConfig({ lobby: { autoOpen: false, web: { enabled: true } } }).lobby;
  assert.equal(lobby.autoOpen, false);
  assert.equal(lobby.web.enabled, true);
  assert.equal(lobby.web.port, 7347);
  assert.equal(Object.keys(resolveConfig({}).lobby).at(-1), "web");
});
