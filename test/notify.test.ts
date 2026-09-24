import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTask } from "../src/schemas/task.ts";
import { formatNotice, ping } from "../src/pi/notify.ts";
import { onTransition, transition } from "../src/state/task-state.ts";

// The suite can run inside a subagent process (DEV_LOBBY_SUBAGENT=1); park the
// ambient flag so the master path is observable, and restore it afterwards.
let ambientSubagent: string | undefined;
before(() => {
  ambientSubagent = process.env.DEV_LOBBY_SUBAGENT;
  delete process.env.DEV_LOBBY_SUBAGENT;
});
after(() => {
  if (ambientSubagent === undefined) delete process.env.DEV_LOBBY_SUBAGENT;
  else process.env.DEV_LOBBY_SUBAGENT = ambientSubagent;
  onTransition(() => {});
});

function setSubagent(value: string | undefined): () => void {
  const previous = process.env.DEV_LOBBY_SUBAGENT;
  if (value === undefined) delete process.env.DEV_LOBBY_SUBAGENT;
  else process.env.DEV_LOBBY_SUBAGENT = value;
  return () => {
    if (previous === undefined) delete process.env.DEV_LOBBY_SUBAGENT;
    else process.env.DEV_LOBBY_SUBAGENT = previous;
  };
}

function captureStderr(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return { writes, restore: () => (process.stderr.write = original) };
}

test("formatNotice pings exactly completed, blocked and awaiting_approval", () => {
  for (const state of ["completed", "blocked", "awaiting_approval"] as const) {
    const notice = formatNotice(state, "create landing page");
    assert.match(notice ?? "", /^\x07\x1b\]9;create landing page /);
    assert.ok((notice ?? "").endsWith("\x07"));
  }
  for (const state of ["created", "clarifying", "implementing", "reviewing", "abandoned"] as const) {
    assert.equal(formatNotice(state, "x"), undefined);
  }
});

test("formatNotice falls back to a generic title when none is set", () => {
  assert.match(formatNotice("blocked", "") ?? "", /\x07\x1b\]9;task blocked\x07/);
});

test("ping writes one notice when not in a subagent process", () => {
  const capture = captureStderr();
  try {
    ping("completed", "merge settings");
  } finally {
    capture.restore();
  }
  assert.deepEqual(capture.writes, ["\x07\x1b]9;merge settings done\x07"]);
});

test("ping is silent in a subagent process and for non-ping states", () => {
  const capture = captureStderr();
  const restore = setSubagent("1");
  try {
    ping("completed", "merge settings");
    restore();
    ping("implementing", "merge settings");
  } finally {
    restore();
    capture.restore();
  }
  assert.deepEqual(capture.writes, []);
});

test("transition notifies the registered listener once with the new state", () => {
  const seen: string[] = [];
  onTransition((task, to) => seen.push(`${task.id}:${to}`));
  const task = createTask("TASK-1", "x");
  transition(task, "clarifying");
  transition(task, "clarifying");
  assert.deepEqual(seen, ["TASK-1:clarifying", "TASK-1:clarifying"]);
});
