import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { CLEARED_NOTE, CONTEXT_MARK, contextMarks, fromBoundary, previousTaskNote, registerFreshContext } from "../src/pi/fresh-context.ts";
import { chatFromEntries, LobbyFeed, lobbyFeed } from "../src/lobby/feed.ts";

let ambientConfig: string | undefined;
let configDir = "";

before(() => {
  ambientConfig = process.env.BOT_LOBBY_CONFIG_DIR;
  configDir = mkdtempSync(join(tmpdir(), "bl-fresh-cfg-"));
  process.env.BOT_LOBBY_CONFIG_DIR = configDir;
});

after(() => {
  if (ambientConfig === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
  else process.env.BOT_LOBBY_CONFIG_DIR = ambientConfig;
});

type Message = { role: string; timestamp: number; text?: string };

test("the model is sent the conversation from the first request at or after the boundary", () => {
  const messages: Message[] = [
    { role: "user", timestamp: 1, text: "old task" },
    { role: "assistant", timestamp: 2 },
    { role: "toolResult", timestamp: 3 },
    { role: "assistant", timestamp: 10 },
    { role: "toolResult", timestamp: 11 },
    { role: "user", timestamp: 12, text: "new task" },
    { role: "assistant", timestamp: 13 },
  ];
  assert.equal(fromBoundary(messages, undefined), messages, "no boundary: everything");
  assert.deepEqual(fromBoundary(messages, 10).map((message) => message.timestamp), [12, 13], "never opens on a reply or a tool result");
  assert.equal(fromBoundary(messages, 99), messages, "nothing since the boundary yet: the closing turn keeps its context");
  assert.equal(fromBoundary(messages, 0), messages);
  const compacted: Message[] = [{ role: "compactionSummary", timestamp: 20 }, { role: "user", timestamp: 21 }];
  assert.deepEqual(fromBoundary(compacted, 15).map((message) => message.role), ["compactionSummary", "user"], "a summary of the task so far is kept");
  assert.deepEqual(fromBoundary([...messages, ...compacted], 15).map((message) => message.role), ["compactionSummary", "user"]);
});

test("boundaries are read from the session's custom entries, ignoring anything malformed", () => {
  const entries = [
    { type: "message", id: "a" },
    { type: "custom", customType: CONTEXT_MARK, data: { kind: "start", taskId: "TASK-1", at: 5 } },
    { type: "custom", customType: "other", data: { kind: "end", taskId: "TASK-1", at: 6 } },
    { type: "custom", customType: CONTEXT_MARK, data: { kind: "later", taskId: "TASK-1", at: 7 } },
    { type: "custom", customType: CONTEXT_MARK, data: { kind: "end", taskId: "TASK-1", at: 8 } },
  ];
  assert.deepEqual(contextMarks(entries), [{ kind: "start", taskId: "TASK-1", at: 5 }, { kind: "end", taskId: "TASK-1", at: 8 }]);
  assert.deepEqual(chatFromEntries(entries).map((line) => [line.role, line.text]), [["note", CLEARED_NOTE]], "the conversation shows where a task's end cleared it");
});

function session(root: string) {
  const branch: Array<Record<string, unknown>> = [];
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => void handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    appendEntry: (customType: string, data: unknown) => void branch.push({ type: "custom", customType, data, id: `c${branch.length}`, timestamp: new Date().toISOString() }),
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: root,
    sessionManager: { getSessionId: () => "s-1", getBranch: () => branch },
  } as unknown as ExtensionContext;
  const fire = (event: string, payload: unknown = {}) => (handlers.get(event) ?? []).map((handler) => handler(payload, ctx));
  return { pi, ctx, branch, fire };
}

test("a task's end clears the oracle's context once, and the next request starts fresh", () => {
  const root = mkdtempSync(join(tmpdir(), "bl-fresh-"));
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-1", "add login", "2026-09-27T10:00:00.000Z", "x", "s-1");
  createTaskDir(root, ".pi", task);
  transition(task, "clarifying");
  saveTask(root, ".pi", task);
  const { pi, ctx, branch, fire } = session(root);
  registerFreshContext(pi, ".pi");
  const feed = lobbyFeed as LobbyFeed;
  feed.clear();

  fire("agent_end");
  assert.equal(contextMarks(branch).length, 0, "a task under way is not closed");
  assert.equal(previousTaskNote(ctx, ".pi"), undefined);

  transition(task, "abandoned");
  saveTask(root, ".pi", task);
  const before = Date.now();
  fire("agent_end");
  fire("before_agent_start");
  const marks = contextMarks(branch);
  assert.deepEqual(marks.map((mark) => [mark.kind, mark.taskId]), [["end", "TASK-1"]], "closed once");
  assert.ok(marks[0]!.at >= before);
  assert.deepEqual(feed.chat.map((line) => [line.role, line.text]), [["note", CLEARED_NOTE]]);
  assert.match(previousTaskNote(ctx, ".pi") ?? "", /TASK-1 "add login", ended \(abandoned\)[\s\S]*\.pi\/bot-lobby\/tasks\/TASK-1\//);

  const at = marks[0]!.at;
  const messages = [{ role: "user", timestamp: at - 100 }, { role: "assistant", timestamp: at - 50 }, { role: "user", timestamp: at + 10 }];
  const [trimmed] = fire("context", { messages }) as Array<{ messages: unknown[] } | undefined>;
  assert.deepEqual(trimmed?.messages, [messages[2]]);
  const [untouched] = fire("context", { messages: messages.slice(0, 2) });
  assert.equal(untouched, undefined, "nothing to drop: pi's list stands");

  const [cancelled] = fire("session_before_compact", { reason: "threshold", branchEntries: [{ type: "message", timestamp: new Date(at - 50).toISOString() }, ...branch] });
  assert.deepEqual(cancelled, { cancel: true }, "the conversation about to be dropped is not compacted");
  const [manual] = fire("session_before_compact", { reason: "manual", branchEntries: branch });
  assert.equal(manual, undefined, "an asked-for /compact always runs");
  const [later] = fire("session_before_compact", { reason: "threshold", branchEntries: [...branch, { type: "message", timestamp: new Date(at + 10).toISOString() }] });
  assert.equal(later, undefined, "once the new work has begun, compaction is pi's call again");

  writeFileSync(join(configDir, "config.json"), JSON.stringify({ workflow: { freshContext: false } }));
  const [off] = fire("context", { messages });
  assert.equal(off, undefined, "switched off: the model is sent everything");
  assert.equal(previousTaskNote(ctx, ".pi"), undefined);
  writeFileSync(join(configDir, "config.json"), "{}");
});
