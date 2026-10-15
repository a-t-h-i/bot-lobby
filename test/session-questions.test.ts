import { test } from "node:test";
import assert from "node:assert/strict";
import { BackgroundSession } from "../src/lobby/sessions.ts";
import { PromptHub } from "../src/lobby/prompt-hub.ts";
import { askForSession } from "../src/lobby/session-questions.ts";
import { RELAY_TITLE } from "../src/ask/relay.ts";
import { isBackgroundSession } from "../src/ask/web.ts";
import { FakeSessionProcess } from "./fake-session.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function sessionWithHub() {
  const hub = new PromptHub();
  const proc = new FakeSessionProcess();
  const session = new BackgroundSession(proc, { name: "Enforce standards", request: "x", ask: (question) => askForSession(question, hub) });
  return { hub, proc, session };
}

test("a background session's questions go to this window's pop-up, named after the session, and the answers go back", async () => {
  const { hub, proc, session } = sessionWithHub();
  proc.emit(
    { type: "extension_ui_request", id: "q1", method: "select", title: "Who owns the docs?", options: ["Frontend", "Platform"] },
    { type: "extension_ui_request", id: "q2", method: "confirm", title: "Carry on?", message: "Two steps left" },
    { type: "extension_ui_request", id: "q3", method: "editor", title: "Anything else?", prefill: "" },
  );
  const pending = hub.pending();
  assert.deepEqual(pending.map((prompt) => [prompt.kind, prompt.from]), [["choose", "Enforce standards"], ["confirm", "Enforce standards"], ["text", "Enforce standards"]]);
  assert.deepEqual(pending[0]!.payload, { title: "Who owns the docs?", options: ["Frontend", "Platform"] });
  hub.answer(pending[0]!.id, "Platform");
  hub.answer(pending[1]!.id, false);
  hub.dismiss(pending[2]!.id);
  await tick();
  assert.deepEqual(proc.commands("extension_ui_response").map(({ id, value, confirmed, cancelled }) => ({ id, value, confirmed, cancelled })), [
    { id: "q1", value: "Platform", confirmed: undefined, cancelled: undefined },
    { id: "q2", value: undefined, confirmed: false, cancelled: undefined },
    { id: "q3", value: undefined, confirmed: undefined, cancelled: true },
  ]);
  assert.equal(session.dialogs.length, 0);
});

test("a relayed questionnaire shows as the questionnaire, and its answers go back as the relay reads them", async () => {
  const { hub, proc } = sessionWithHub();
  const questions = [{ question: "Which docs folder?", header: "Docs", options: [{ label: "docs/" }, { label: "wiki/" }] }];
  proc.emit({ type: "extension_ui_request", id: "r1", method: "editor", title: RELAY_TITLE, prefill: JSON.stringify({ questions }) });
  const [prompt] = hub.pending();
  assert.equal(prompt!.kind, "questionnaire");
  assert.equal((prompt!.payload as { questions: unknown[] }).questions.length, 1);
  const answers = { answers: [{ questionIndex: 0, question: "Which docs folder?", kind: "option", answer: "docs/" }], cancelled: false };
  hub.answer(prompt!.id, answers);
  await tick();
  const [response] = proc.commands("extension_ui_response");
  assert.deepEqual(JSON.parse(String(response!.value)), answers);
});

test("a dialog answered another way, or a session that ends, takes its question out of the pop-up", async () => {
  const { hub, proc, session } = sessionWithHub();
  proc.emit({ type: "extension_ui_request", id: "q1", method: "input", title: "Name?" }, { type: "extension_ui_request", id: "q2", method: "select", title: "Pick", options: ["a"] });
  assert.equal(hub.pending().length, 2);
  session.answer("q1", { value: "Ann" });
  await tick();
  assert.deepEqual(hub.pending().map((prompt) => prompt.kind), ["choose"]);
  proc.exit(0);
  await tick();
  assert.equal(hub.pending().length, 0);
  assert.equal(proc.commands("extension_ui_response").length, 1, "only the dialog answered directly was answered");
});

test("only the lobby's own headless sessions ask through the window; their subagents do not", () => {
  assert.equal(isBackgroundSession({ BOT_LOBBY_BACKGROUND: "1" }), true);
  assert.equal(isBackgroundSession({ BOT_LOBBY_BACKGROUND: "1", BOT_LOBBY_SUBAGENT: "1" }), false);
  assert.equal(isBackgroundSession({}), false);
});
