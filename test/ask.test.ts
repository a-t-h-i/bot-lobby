import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { askUser, setCanAsk } from "../src/ask/web.ts";
import { answerSummary, ASK_TOOL, invalidQuestions, registerAskTool } from "../src/ask/tool.ts";
import type { AskQuestion, AskResult } from "../src/ask/types.ts";
import { promptHub } from "../src/lobby/prompt-hub.ts";

const auth: AskQuestion = {
  question: "Which **auth** provider?",
  header: "Auth",
  options: [
    { label: "Clerk (Recommended)", description: "Hosted, with prebuilt `<SignIn/>`", preview: "```tsx\n<SignIn />\n```" },
    { label: "Auth.js", description: "Self-hosted" },
  ],
};
const features: AskQuestion = { question: "Which features?", header: "Features", options: [{ label: "Dark mode" }, { label: "Search" }, { label: "Export" }], multiSelect: true };

const ctx = { cwd: "/work/app" } as unknown as ExtensionContext;

test("a questionnaire goes to the page and resolves with the answer given there", async () => {
  setCanAsk(() => true);
  try {
    const asked = askUser([auth], ctx, undefined, "designer");
    const [prompt] = promptHub.pending();
    assert.equal(prompt?.kind, "questionnaire");
    assert.equal(prompt?.from, "designer");
    const answer: AskResult = { cancelled: false, answers: [{ questionIndex: 0, question: auth.question, kind: "option", answer: "Auth.js" }] };
    assert.equal(promptHub.answer(prompt!.id, answer), true);
    assert.deepEqual(await asked, answer);
    assert.equal(promptHub.answer(prompt!.id, answer), false, "a late answer is refused");
  } finally {
    setCanAsk(undefined);
  }
});

test("option images are made absolute for the page's preview route", async () => {
  setCanAsk(() => true);
  try {
    const asked = askUser([{ ...auth, options: [{ label: "A", image: "mock/a.png" }, { label: "B", image: "/tmp/b.png" }] }], ctx);
    const [prompt] = promptHub.pending();
    const options = (prompt!.payload as { questions: AskQuestion[] }).questions[0]!.options;
    assert.deepEqual(options.map((option) => option.image), ["/work/app/mock/a.png", "/tmp/b.png"]);
    promptHub.dismiss(prompt!.id);
    await asked;
  } finally {
    setCanAsk(undefined);
  }
});

test("a question put away, aborted or answered with nonsense is cancelled, never invented", async () => {
  setCanAsk(() => true);
  try {
    const dismissed = askUser([auth], ctx);
    promptHub.dismiss(promptHub.pending()[0]!.id);
    assert.deepEqual(await dismissed, { answers: [], cancelled: true });

    const controller = new AbortController();
    const aborted = askUser([auth], ctx, controller.signal);
    assert.equal(promptHub.pending().length, 1);
    controller.abort();
    assert.deepEqual(await aborted, { answers: [], cancelled: true });
    assert.equal(promptHub.pending().length, 0, "an aborted question leaves the queue");
    assert.deepEqual(await askUser([auth], ctx, controller.signal), { answers: [], cancelled: true }, "already aborted: never queued");

    const garbled = askUser([auth], ctx);
    promptHub.answer(promptHub.pending()[0]!.id, "yes please");
    assert.deepEqual(await garbled, { answers: [], cancelled: true });
  } finally {
    setCanAsk(undefined);
  }
});

test("with no page to answer, nobody is asked and nothing waits", async () => {
  setCanAsk(() => false);
  try {
    assert.deepEqual(await askUser([auth], ctx), { answers: [], cancelled: true });
    assert.equal(promptHub.pending().length, 0);
  } finally {
    setCanAsk(undefined);
  }
});

test("ask_user_question: registered outside subagents, refuses malformed questions, and tells the model what was answered", async () => {
  const tools: Array<{ name: string; execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }>; details: AskResult }> }> = [];
  const pi = { registerTool: (tool: never) => tools.push(tool) } as unknown as ExtensionAPI;
  const result: AskResult = { cancelled: false, answers: [{ questionIndex: 0, question: auth.question, kind: "custom", answer: "Supabase" }] };
  registerAskTool(pi, async () => result);
  assert.deepEqual(tools.map((tool) => tool.name), [ASK_TOOL]);
  const out = await tools[0]!.execute("id", { questions: [auth, features] }, undefined, undefined, {});
  assert.equal(out.content[0]!.text, "The user answered:\n1. [Auth] Which **auth** provider?\n   → Supabase (in the user's own words)\n2. [Features] Which features?\n   → (not answered)");
  assert.deepEqual(out.details, result);
  assert.match(invalidQuestions([{ ...auth, options: [{ label: "Other" }, { label: "Yes" }] }])!, /"Other" is kept for the user's own answer/);
  assert.match(invalidQuestions([{ ...auth, options: [{ label: "Yes" }, { label: "yes" }] }])!, /two options labelled/);
  assert.match(invalidQuestions([auth, auth])!, /repeats an earlier question/);
  assert.equal(invalidQuestions([auth, features]), undefined);
  const left = answerSummary([auth], { answers: [], cancelled: true });
  assert.match(left, /left the questions without answering/);
  assert.match(left, /Do not assume answers, do not pick the recommended options/, "the oracle waits instead of guessing");
  assert.match(left, /end your turn/);
  const partly = answerSummary([auth, features], { answers: [{ questionIndex: 0, question: auth.question, kind: "option", answer: "Clerk" }], cancelled: true });
  assert.match(partly, /\(not answered\)/);
  assert.match(partly, /still open. Do not assume answers/);
  const previous = process.env.BOT_LOBBY_SUBAGENT;
  process.env.BOT_LOBBY_SUBAGENT = "1";
  const sub: unknown[] = [];
  registerAskTool({ registerTool: (tool: unknown) => sub.push(tool) } as unknown as ExtensionAPI);
  if (previous === undefined) delete process.env.BOT_LOBBY_SUBAGENT;
  else process.env.BOT_LOBBY_SUBAGENT = previous;
  assert.equal(sub.length, 0, "a subagent cannot reach the user");
});
