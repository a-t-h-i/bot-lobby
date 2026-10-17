/**
 * The web lobby's terminals: a real shell on a pseudo-terminal in the
 * project's folder, its output streamed (scrollback first, then live, then
 * the exit code), resized on request, and the `terminal.*` calls refusing
 * what they should. Skipped where the machine cannot make a pseudo-terminal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellCommand, terminalBackend, TerminalHost } from "../src/webui/terminal.ts";
import { routeApiCall, type ApiContext } from "../src/webui/api/index.ts";
import type { TerminalStreamEvent } from "../src/webui/protocol.ts";

const usable = (await terminalBackend()).kind !== "none";

/** A stand-in for the stream's response: the events it was sent. */
function watcher() {
  const events: TerminalStreamEvent[] = [];
  let rest = "";
  const res = {
    writeHead() {},
    write(text: string) {
      rest += text;
      for (;;) {
        const end = rest.indexOf("\n\n");
        if (end < 0) break;
        const line = rest.slice(0, end).split("\n").find((part) => part.startsWith("data: "));
        rest = rest.slice(end + 2);
        if (line) events.push(JSON.parse(line.slice(6)) as TerminalStreamEvent);
      }
      return true;
    },
    end() {},
  };
  const output = () => events.map((event) => ("data" in event ? event.data : "")).join("");
  return { req: new EventEmitter(), res, events, output };
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("a login shell where the shell knows the flag; the user's shell, or bash", () => {
  assert.deepEqual(shellCommand({ SHELL: "/bin/zsh" }, "darwin"), ["/bin/zsh", "-l"]);
  assert.deepEqual(shellCommand({ SHELL: "/usr/bin/dash" }, "linux"), ["/usr/bin/dash"]);
  assert.deepEqual(shellCommand({}, "linux"), ["/bin/bash", "-l"]);
});

test("a terminal runs a shell in the folder, streams what it prints, resizes, replays its scrollback and reports the exit", { skip: !usable && "no pseudo-terminal here" }, async () => {
  const host = new TerminalHost();
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "bl-term-")));
  const info = await host.open(folder, 80, 24);
  try {
    assert.equal(info.alive, true);
    const first = watcher();
    assert.equal(host.stream(first.req as never, first.res as never, info.id), true);
    assert.equal(first.events[0]?.type, "reset");
    host.input(info.id, "echo sum=$((40+2)); pwd; tput cols\n");
    await until(() => /sum=42/.test(first.output()) && first.output().includes(folder) && /[\r\n]80\r\n/.test(first.output()), "the first answers");
    host.resize(info.id, 132, 30);
    host.input(info.id, "tput cols\n");
    await until(() => /[\r\n]132\r\n/.test(first.output()), "the new width");

    const later = watcher();
    host.stream(later.req as never, later.res as never, info.id);
    const reset = later.events[0];
    assert.ok(reset?.type === "reset" && reset.data.includes("sum=42"), "a page that attaches later sees what was printed");

    host.input(info.id, "exit 3\n");
    await until(() => first.events.some((event) => event.type === "exit"), "the exit");
    assert.deepEqual(first.events.at(-1), { type: "exit", code: 3 });
    assert.deepEqual(host.list().map((entry) => [entry.alive, entry.exitCode]), [[false, 3]]);
  } finally {
    host.closeAll();
  }
  assert.deepEqual(host.list(), []);
});

test("the terminal calls check what they are sent and say when a terminal is gone", async () => {
  const ctx = { service: { projectRoot: () => process.cwd() }, port: 0 } as unknown as ApiContext;
  const list = (await routeApiCall("terminal.list", {}, ctx)) as { available: boolean; terminals: unknown[] };
  assert.equal(list.available, usable);
  await assert.rejects(routeApiCall("terminal.input", { id: "t999", data: "ls\n" }, ctx), { code: "not_found" });
  await assert.rejects(routeApiCall("terminal.input", { id: "t1", data: "" }, ctx), { code: "bad_request" });
  await assert.rejects(routeApiCall("terminal.open", { cols: 1, rows: 24 }, ctx), { code: "bad_request" });
  await assert.rejects(routeApiCall("terminal.resize", { id: "t1", cols: 80, rows: 24, extra: true }, ctx), { code: "bad_request" });
});
