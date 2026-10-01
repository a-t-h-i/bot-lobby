import { test } from "node:test";
import assert from "node:assert/strict";
import type { spawn as spawnType } from "node:child_process";
import { openBrowser } from "../src/webui/open.ts";

const URL = "http://127.0.0.1:7347/#token=abc";

interface Call {
  command: string;
  args: string[];
}

function spy(throwOnSpawn = false): { calls: Call[]; spawn: typeof spawnType } {
  const calls: Call[] = [];
  const spawn = ((command: string, args: string[]) => {
    if (throwOnSpawn) throw new Error("nope");
    calls.push({ command, args });
    return { on: () => {}, unref: () => {} };
  }) as unknown as typeof spawnType;
  return { calls, spawn };
}

test("Termux opens with termux-open-url", () => {
  const { calls, spawn } = spy();
  assert.equal(openBrowser(URL, { spawn, env: { TERMUX_VERSION: "123" } as NodeJS.ProcessEnv, platform: "linux" }), true);
  assert.deepEqual(calls, [{ command: "termux-open-url", args: [URL] }]);
});

test("macOS opens with open", () => {
  const { calls, spawn } = spy();
  assert.equal(openBrowser(URL, { spawn, env: {} as NodeJS.ProcessEnv, platform: "darwin" }), true);
  assert.deepEqual(calls, [{ command: "open", args: [URL] }]);
});

test("Windows opens with cmd start", () => {
  const { calls, spawn } = spy();
  assert.equal(openBrowser(URL, { spawn, env: {} as NodeJS.ProcessEnv, platform: "win32" }), true);
  assert.deepEqual(calls, [{ command: "cmd", args: ["/c", "start", '""', URL] }]);
});

test("Linux opens with xdg-open", () => {
  const { calls, spawn } = spy();
  assert.equal(openBrowser(URL, { spawn, env: {} as NodeJS.ProcessEnv, platform: "linux" }), true);
  assert.deepEqual(calls, [{ command: "xdg-open", args: [URL] }]);
});

test("an SSH session attempts nothing", () => {
  for (const env of [{ SSH_CONNECTION: "1 2 3 4" }, { SSH_TTY: "/dev/pts/0" }]) {
    const { calls, spawn } = spy();
    assert.equal(openBrowser(URL, { spawn, env: env as NodeJS.ProcessEnv, platform: "linux" }), false);
    assert.equal(calls.length, 0);
  }
});

test("a spawn failure is not an error", () => {
  const { calls, spawn } = spy(true);
  assert.equal(openBrowser(URL, { spawn, env: {} as NodeJS.ProcessEnv, platform: "linux" }), false);
  assert.equal(calls.length, 0);
});
