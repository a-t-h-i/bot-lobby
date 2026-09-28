import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { MAX_CHAT } from "../src/lobby/feed.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundSession, extensionArgs, MAX_ENDED, SessionRegistry, sessionArgs } from "../src/lobby/sessions.ts";
import { chatFromFile, currentBranch, SessionChats, SessionLog } from "../src/lobby/session-files.ts";
import { parseCommand } from "../src/pi/commands.ts";
import { FakeSessionProcess } from "./fake-session.ts";

test("a background session runs pi headless, named after its task, with this pi's extensions", () => {
  const argv = ["node", "pi", "-e", "/ext/bot-lobby", "--extension=/ext/other", "--model", "x/y", "--extension", "/ext/third"];
  assert.deepEqual(extensionArgs(argv), ["-e", "/ext/bot-lobby", "--extension=/ext/other", "--extension", "/ext/third"]);
  assert.deepEqual(sessionArgs("Add login", "p/model", ["node", "pi", "-e", "/ext/bot-lobby"]), ["--mode", "rpc", "--name", "Add login", "--model", "p/model", "-e", "/ext/bot-lobby"]);
  assert.deepEqual(sessionArgs("Add login", undefined, ["node", "pi"]), ["--mode", "rpc", "--name", "Add login"]);
});

test("a new session asks for its state, then starts the task, or the planned task with auto mode", () => {
  const plain = new FakeSessionProcess();
  new BackgroundSession(plain, { name: "Add login", request: "add a login page" });
  assert.deepEqual(plain.written.map((command) => [command.type, command.message]), [["get_state", undefined], ["prompt", "/bot-lobby --task add a login page"]]);

  const planned = new FakeSessionProcess();
  const session = new BackgroundSession(planned, { name: "Dark mode", planId: "PLAN-dark", auto: true });
  assert.equal(planned.commands("prompt")[0]!.message, "/bot-lobby start-plan PLAN-dark auto");
  assert.equal(session.planId, "PLAN-dark");
  assert.ok(new Set(planned.written.map((command) => command.id)).size === planned.written.length, "every command has its own id");
});

test("the session's events fill its own feed; messages steer a running turn", () => {
  const proc = new FakeSessionProcess();
  let changes = 0;
  const session = new BackgroundSession(proc, { name: "Add login", request: "add a login page" }, () => void (changes += 1));
  assert.equal(session.status, "starting");
  proc.emit({ type: "response", command: "get_state", success: true, data: { sessionId: "child-1", sessionFile: "/s/child-1.jsonl" } });
  assert.deepEqual([session.sessionId, session.sessionFile, session.status], ["child-1", "/s/child-1.jsonl", "idle"]);

  proc.emit(
    { type: "agent_start" },
    { type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "src/app.ts" } },
    { type: "tool_execution_end", toolCallId: "t1" },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Looking at the app." }], stopReason: "stop" } },
  );
  assert.equal(session.busy, true);
  assert.ok(session.feed.activity.some((entry) => entry.text.includes("app.ts")));
  assert.deepEqual(session.feed.chat.map((entry) => [entry.role, entry.text]), [["oracle", "Looking at the app."]]);

  session.send("use port 8080");
  assert.deepEqual(proc.commands("prompt").at(-1), { id: proc.commands("prompt").at(-1)!.id, type: "prompt", message: "use port 8080", streamingBehavior: "steer" });
  session.abort();
  assert.equal(proc.commands("abort").length, 1);
  proc.emit({ type: "agent_end", messages: [] });
  assert.equal(session.status, "idle");
  session.send("and dark mode");
  assert.equal(proc.commands("prompt").at(-1)!.streamingBehavior, undefined, "an idle session gets a plain prompt");
  session.send("   ");
  assert.equal(proc.commands("prompt").length, 3, "blank messages are not sent");
  assert.ok(changes > 3);

  proc.emit({ type: "response", command: "prompt", success: false, error: "no model" });
  assert.ok(session.feed.activity.some((entry) => entry.text === "the session refused a request: no model"));
});

test("questions the session asks wait for this window; answers go back by id", () => {
  const proc = new FakeSessionProcess();
  const session = new BackgroundSession(proc, { name: "Add login", request: "x" });
  proc.emit(
    { type: "extension_ui_request", id: "q1", method: "select", title: "Approve the proposal?\n- Add a form", options: ["Approve", "Decline"] },
    { type: "extension_ui_request", id: "q2", method: "confirm", title: "Cancel?", message: "Really?" },
    { type: "extension_ui_request", id: "n1", method: "notify", message: "bot-lobby TASK-1 started", notifyType: "info" },
    { type: "extension_ui_request", id: "s1", method: "setStatus", statusKey: "bot-lobby", statusText: "TASK-1 · clarifying" },
  );
  assert.deepEqual(session.dialogs.map((dialog) => [dialog.id, dialog.method, dialog.options]), [["q1", "select", ["Approve", "Decline"]], ["q2", "confirm", undefined]]);
  assert.equal(session.statusText, "TASK-1 · clarifying");
  assert.ok(session.feed.activity.some((entry) => entry.text === "waiting for you: Approve the proposal?"));
  assert.ok(session.feed.activity.some((entry) => entry.text === "TASK-1 started"));

  session.answer("q1", { value: "Approve" });
  session.answer("q2", { confirmed: false });
  session.answer("missing", { cancelled: true });
  assert.deepEqual(proc.commands("extension_ui_response"), [{ type: "extension_ui_response", id: "q1", value: "Approve" }, { type: "extension_ui_response", id: "q2", confirmed: false }]);
  assert.equal(session.dialogs.length, 0);
});

test("a session that exits or cannot start says why; stop ends it", () => {
  const failing = new FakeSessionProcess();
  const broken = new BackgroundSession(failing, { name: "Broken", request: "x" });
  failing.stderrText("Error: No API key for provider\n\x07\x1b]9;Broken needs approval\x07");
  failing.exit(1);
  assert.deepEqual([broken.status, broken.alive, broken.exitCode], ["exited", false, 1]);
  assert.equal(broken.feed.chat.at(-1)!.text, "the session exited (1): Error: No API key for provider");
  const before = failing.written.length;
  broken.send("hello?");
  assert.equal(failing.written.length, before, "nothing is written to an ended session");

  const missing = new FakeSessionProcess();
  const unstarted = new BackgroundSession(missing, { name: "Missing", request: "x" });
  missing.fail(new Error("spawn pi ENOENT"));
  missing.exit(-2);
  assert.equal(unstarted.exitCode, 1);
  assert.equal(unstarted.feed.chat.filter((entry) => entry.role === "note").length, 1, "said once");
  assert.match(unstarted.lastError(), /ENOENT/);

  const running = new FakeSessionProcess();
  const stopped = new BackgroundSession(running, { name: "Running", request: "x" });
  running.emit({ type: "extension_ui_request", id: "q1", method: "input", title: "Name?" });
  stopped.stop();
  assert.deepEqual([running.ended, running.signals, stopped.status, stopped.dialogs.length], [true, ["SIGTERM"], "exited", 0]);
  assert.equal(stopped.feed.chat.at(-1)!.text, "the session ended");
});

test("the registry launches sessions in the project and finds them by pi session id", () => {
  const launched: Array<{ args: string[]; cwd: string; proc: FakeSessionProcess }> = [];
  let changes = 0;
  const registry = new SessionRegistry((args, cwd) => {
    const proc = new FakeSessionProcess();
    launched.push({ args, cwd, proc });
    return proc;
  }, () => void (changes += 1));
  const first = registry.start("/repo", { name: "Add login", request: "add a login page" }, "p/model");
  const second = registry.start("/repo", { name: "Dark mode", planId: "PLAN-dark" });
  assert.deepEqual(launched.map((entry) => [entry.cwd, entry.args.slice(0, 4)]), [["/repo", ["--mode", "rpc", "--name", "Add login"]], ["/repo", ["--mode", "rpc", "--name", "Dark mode"]]]);
  assert.ok(launched[0]!.args.includes("p/model"));
  launched[1]!.proc.emit({ type: "response", command: "get_state", success: true, data: { sessionId: "child-2" } });
  assert.equal(registry.bySessionId("child-2"), second);
  assert.equal(registry.bySessionId(undefined), undefined);
  assert.equal(registry.get(first.key), first);
  registry.stopAll();
  assert.ok(launched.every((entry) => entry.proc.signals.length === 1));
  assert.ok(changes >= 2);
});

test("the registry keeps every running session and only the newest few that ended", () => {
  const procs: FakeSessionProcess[] = [];
  const registry = new SessionRegistry(() => {
    const proc = new FakeSessionProcess();
    procs.push(proc);
    return proc;
  });
  const first = registry.start("/repo", { name: "keeps running", request: "x" });
  for (let index = 0; index < MAX_ENDED + 3; index += 1) {
    registry.start("/repo", { name: `ended ${index}`, request: "x" });
    procs.at(-1)!.exit(0);
  }
  registry.start("/repo", { name: "latest", request: "x" });
  assert.equal(registry.sessions.length, 1 + MAX_ENDED + 1);
  assert.equal(registry.sessions[0], first, "a running session is never let go");
  assert.deepEqual(registry.sessions.slice(1, -1).map((session) => session.name), Array.from({ length: MAX_ENDED }, (_, index) => `ended ${index + 3}`));
});

function entry(id: string, parentId: string | null, role: "user" | "assistant", text: string): Record<string, unknown> {
  return { type: "message", id, parentId, timestamp: "2026-09-27T10:00:00.000Z", message: { role, content: [{ type: "text", text }] } };
}

test("another session's conversation is its file's current branch", () => {
  const entries = [
    { type: "session", id: "h" },
    entry("a", null, "user", "add a login page"),
    entry("b", "a", "assistant", "An older answer."),
    entry("c", "a", "assistant", "The answer on the branch."),
    entry("d", "c", "user", "thanks"),
  ];
  assert.deepEqual(currentBranch(entries).map((item) => (item as { id: string }).id), ["a", "c", "d"]);
  const text = `${entries.map((item) => JSON.stringify(item)).join("\n")}\n{"type":"mess`;
  assert.deepEqual(chatFromFile(text).map((line) => [line.role, line.text]), [["you", "add a login page"], ["oracle", "The answer on the branch."], ["you", "thanks"]]);
});

test("session chats are found through pi's list once, and reread only when the file changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bl-chats-"));
  const file = join(dir, "other.jsonl");
  writeFileSync(file, `${JSON.stringify(entry("a", null, "user", "hello"))}\n`);
  let lists = 0;
  let changes = 0;
  let now = 0;
  const chats = new SessionChats(async () => {
    lists += 1;
    return [{ id: "other", path: file }];
  }, () => void (changes += 1), () => now);
  assert.deepEqual(chats.chat("other"), [], "unknown until pi lists it");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(changes, 1, "the lobby redraws once the file is known");
  assert.deepEqual(chats.chat("other").map((line) => line.text), ["hello"]);
  const cached = chats.chat("other");
  assert.equal(chats.chat("other"), cached, "unchanged file: same entries");
  appendFileSync(file, `${JSON.stringify(entry("b", "a", "assistant", "hi there"))}\n`);
  assert.deepEqual(chats.chat("other").map((line) => line.text), ["hello", "hi there"]);

  assert.deepEqual(chats.chat("nobody"), []);
  assert.deepEqual(chats.chat("nobody"), [], "not listed again right away");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lists, 1);
  now = 10_000;
  chats.chat("nobody");
  assert.equal(lists, 2, "a few seconds later it looks again");
  chats.remember("mine", file);
  assert.equal(chats.chat("mine").length, 2);
});

test("a session log reads only what was appended, waits for torn lines and follows the branch", () => {
  const dir = mkdtempSync(join(tmpdir(), "bl-log-"));
  const file = join(dir, "s.jsonl");
  const line = (item: Record<string, unknown>) => `${JSON.stringify(item)}\n`;
  const log = new SessionLog(file);
  assert.equal(log.update(), false, "no file yet");
  writeFileSync(file, `${line({ type: "session", id: "h" })}${line(entry("a", null, "user", "add a login page"))}`);
  assert.equal(log.update(), true);
  assert.deepEqual(log.recent().entries.map((chat) => chat.text), ["add a login page"]);
  const first = log.recent();
  assert.equal(log.update(), false, "nothing new");
  assert.equal(log.recent(), first, "kept until the file changes");

  const torn = line(entry("b", "a", "assistant", "An older answer."));
  appendFileSync(file, torn.slice(0, 20));
  assert.equal(log.update(), false, "half a line waits");
  appendFileSync(file, `${torn.slice(20)}${line(entry("c", "a", "assistant", "The answer on the branch."))}${line({ type: "message", id: "t", parentId: "c", message: { role: "toolResult", content: "x".repeat(500) } })}`);
  assert.equal(log.update(), true);
  assert.deepEqual(log.recent().entries.map((chat) => [chat.role, chat.text]), [["you", "add a login page"], ["oracle", "The answer on the branch."]], "the newest branch, without tool output");

  writeFileSync(file, line(entry("z", null, "user", "a new file")));
  log.update();
  assert.deepEqual(log.recent().entries.map((chat) => chat.text), ["a new file"], "a file that shrank is read again from the start");
});

test("a session log keeps its newest messages ready and walks the whole history only when asked", () => {
  const dir = mkdtempSync(join(tmpdir(), "bl-log-"));
  const file = join(dir, "long.jsonl");
  const count = MAX_CHAT + 30;
  const lines = Array.from({ length: count }, (_, index) => JSON.stringify(entry(`m${index}`, index === 0 ? null : `m${index - 1}`, index % 2 === 0 ? "user" : "assistant", `message ${index}`)));
  writeFileSync(file, `${lines.join("\n")}\n`);
  const log = new SessionLog(file);
  log.update();
  const recent = log.recent();
  assert.equal(recent.entries.length, MAX_CHAT);
  assert.equal(recent.older, true);
  assert.equal(recent.entries.at(-1)?.text, `message ${count - 1}`);
  assert.deepEqual(log.recent(3).entries.map((chat) => chat.text), [`message ${count - 3}`, `message ${count - 2}`, `message ${count - 1}`]);
  const history = log.history();
  assert.equal(history.length, count);
  assert.equal(history[0]?.text, "message 0");

  const chats = new SessionChats(async () => []);
  chats.remember("long", file);
  assert.equal(chats.hasOlder("long"), true);
  assert.equal(chats.chat("long").length, MAX_CHAT);
  assert.equal(chats.history("long").length, count);
  assert.equal(chats.hasOlder("nobody"), false);
  assert.deepEqual(chats.history("nobody"), []);
});

test("--task always starts a task, even when the request begins with a subcommand word", () => {
  assert.deepEqual(parseCommand("--task amend the login flow"), { sub: undefined, rest: [], restText: "amend the login flow", task: true });
  assert.deepEqual(parseCommand("--task --auto status page\nwith charts"), { sub: undefined, rest: [], restText: "status page\nwith charts", auto: true, task: true });
  assert.equal(parseCommand("amend the login flow").sub, "amend");
  assert.deepEqual(parseCommand("start-plan PLAN-dark auto"), { sub: "start-plan", rest: ["PLAN-dark", "auto"], restText: "PLAN-dark auto" });
  assert.equal(parseCommand("start-plan the rollout").sub, undefined, "free text is a request");
  assert.deepEqual(parseCommand("auto off"), { sub: "auto", rest: ["off"], restText: "off" });
  assert.equal(parseCommand("auto deploy on merge").sub, undefined);
});

test("switch takes a session file, so free text starting with the word still starts a task", () => {
  assert.deepEqual(parseCommand("switch /home/me/.pi/sessions/a b.jsonl"), { sub: "switch", rest: ["/home/me/.pi/sessions/a", "b.jsonl"], restText: "/home/me/.pi/sessions/a b.jsonl" });
  assert.equal(parseCommand("switch the header to a sticky one").sub, undefined);
});
