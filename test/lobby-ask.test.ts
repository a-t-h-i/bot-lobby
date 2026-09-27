import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { answerMessage, askPanel, dialogAsker, loadAskTool, MAX_QUESTIONS, questionnaires, toAskQuestion, toolAsker, type AskQuestion, type AskResult } from "../src/lobby/ask.ts";
import type { PanelQuestion } from "../src/lobby/planner.ts";

const question = (from: string, text: string, labels: string[] = []): PanelQuestion => ({ from, text, options: labels.map((label) => ({ label, description: `${label} it is` })) });

test("a panel question becomes a questionnaire tab: seat as the chip, 2-4 unique options, no reserved labels", () => {
  const asked = toAskQuestion(question("RESEARCH-AND-MORE-SEATS", "  Which store? ", ["Redis (Recommended)", "Other", "redis (recommended)", "Postgres", "SQLite", "Memory"]));
  assert.equal(asked.question, "Which store?");
  assert.equal(asked.header.length, 16, "headers are clipped to the library's limit");
  assert.deepEqual(asked.options.map((option) => option.label), ["Redis (Recommended)", "redis (recommended) (2)", "Postgres", "SQLite"]);
  assert.equal(asked.options[0]!.description, "Redis (Recommended) it is");
  const bare = toAskQuestion(question("QA", "Anything else?"));
  assert.deepEqual(bare.options.map((option) => option.label), ["Go with the recommendation", "Leave it open"], "a question without options still offers two");
  assert.equal(toAskQuestion({ from: "DEV", text: "x", options: [{ label: "Only one", description: "" }] }).options.length, 2);
});

test("the round's questions split into questionnaires of at most four, with unique texts", () => {
  const questions = [question("DEV", "Where?"), question("QA", "Where?"), question("DESIGN", "How?"), question("ORACLE", "When?"), question("RESEARCH", "Why?")];
  const chunks = questionnaires(questions);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [MAX_QUESTIONS, 1]);
  assert.deepEqual(chunks[0]!.map((entry) => entry.question), ["Where?", "Where? (QA)", "How?", "When?"]);
  assert.deepEqual(questionnaires([]), []);
});

test("answers go back to the panel attributed, with notes and what was skipped", () => {
  const questions = [question("DEV", "REST or RPC?"), question("QA", "Which browsers?"), question("DESIGN", "Modal or page?"), question("ORACLE", "Flag?"), question("RESEARCH", "Library?")];
  const results: AskResult[] = [
    {
      cancelled: false,
      globalNote: "keep it small",
      answers: [
        { questionIndex: 0, question: "REST or RPC?", kind: "option", answer: "REST", notes: "we already have REST" },
        { questionIndex: 1, question: "Which browsers?", kind: "custom", answer: "evergreen plus Safari 16" },
        { questionIndex: 2, question: "Modal or page?", kind: "multi", answer: null, selected: ["Modal", "Page"] },
      ],
    },
    { cancelled: false, answers: [] },
  ];
  assert.equal(answerMessage(questions, results), [
    "Answers to the panel's questions:",
    "1. [DEV] REST or RPC?\n   → REST",
    "   note: we already have REST",
    "2. [QA] Which browsers?\n   → evergreen plus Safari 16 (in my words)",
    "3. [DESIGN] Modal or page?\n   → Modal, Page",
    "",
    "Note: keep it small",
    "",
    "Not answered this round:",
    "4. [ORACLE] Flag?",
    "5. [RESEARCH] Library?",
  ].join("\n"));
  assert.equal(answerMessage(questions, [{ cancelled: false, answers: [] }]), undefined, "nothing answered sends nothing");
});

const ctx = {} as ExtensionContext;

test("askPanel runs the questionnaires in order and stops at the first one the user puts away", async () => {
  const asked: AskQuestion[][] = [];
  const questions = Array.from({ length: 9 }, (_, index) => question("DEV", `Q${index}?`));
  const answers = [{ answers: [], cancelled: false }, { answers: [], cancelled: true }];
  const outcome = await askPanel(questions, async (chunk) => {
    asked.push([...chunk]);
    return answers[asked.length - 1]!;
  }, ctx);
  assert.equal(asked.length, 2);
  assert.equal(outcome.stopped, true);
  assert.equal(outcome.results.length, 1, "what was answered before stopping is kept");
});

test("the library's tool is captured through its extension entry without registering anything", async () => {
  const registered: string[] = [];
  const handlers: string[] = [];
  const pi = { registerTool: () => registered.push("real"), on: (event: string) => void handlers.push(event), exec: () => "passes through" } as unknown as ExtensionAPI;
  let seenExec: unknown;
  const tool = await loadAskTool(pi, async () => ({
    default: (captured: ExtensionAPI & { exec: () => string }) => {
      captured.on("session_start", () => {});
      seenExec = captured.exec();
      captured.registerTool({ name: "other_tool" } as never);
      captured.registerTool({ name: "ask_user_question", execute: async () => ({ details: { answers: [], cancelled: false } }) } as never);
    },
  }));
  assert.ok(tool, "the ask_user_question definition is kept");
  assert.deepEqual(registered, [], "nothing reaches the real registerTool");
  assert.deepEqual(handlers, [], "the library's own hooks are ignored");
  assert.equal(seenExec, "passes through");
  assert.equal(await loadAskTool(pi, async () => ({})), undefined, "a module without an entry yields nothing");
  assert.equal(await loadAskTool(pi, async () => {
    throw new Error("not installed");
  }), undefined, "a missing library falls back quietly");
});

test("the captured tool runs one questionnaire and reads its details", async () => {
  const calls: unknown[] = [];
  const asker = toolAsker({
    execute: async (_id, params) => {
      calls.push(params);
      return { details: { answers: [{ questionIndex: 0, question: "A?", kind: "option", answer: "Yes" }], cancelled: false, globalNote: "n" } };
    },
  });
  const chunk: AskQuestion[] = [{ question: "A?", header: "DEV", options: [{ label: "Yes", description: "y" }, { label: "No", description: "n" }] }];
  const result = await asker(chunk, ctx);
  assert.deepEqual(calls, [{ questions: chunk }]);
  assert.deepEqual(result, { answers: [{ questionIndex: 0, question: "A?", kind: "option", answer: "Yes" }], cancelled: false, globalNote: "n" });
  const broken = toolAsker({ execute: async () => ({}) });
  assert.equal((await broken(chunk, ctx)).cancelled, true, "no details reads as put away");
});

test("without the library, pi's dialogs ask the same questions: pick, type, skip, or esc", async () => {
  const picks = ["Yes", "Type an answer…", "Skip", undefined];
  const typed = ["my own words"];
  const titles: string[] = [];
  const dialogCtx = {
    ui: {
      select: async (title: string) => {
        titles.push(title);
        return picks.shift();
      },
      input: async () => typed.shift(),
    },
  } as unknown as ExtensionContext;
  const chunk: AskQuestion[] = ["A?", "B?", "C?", "D?"].map((text) => ({ question: text, header: "DEV", options: [{ label: "Yes", description: "" }, { label: "No", description: "" }] }));
  const result = await dialogAsker()(chunk, dialogCtx);
  assert.equal(titles[0], "DEV · 1/4\n\nA?");
  assert.deepEqual(result, {
    cancelled: true,
    answers: [
      { questionIndex: 0, question: "A?", kind: "option", answer: "Yes" },
      { questionIndex: 1, question: "B?", kind: "custom", answer: "my own words" },
    ],
  });
});
