import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { answerMessage, askPanel, MAX_QUESTIONS, questionnaires, settledQuestions, toAskQuestion, type AskQuestion, type AskResult } from "../src/lobby/ask.ts";
import { carryMockups, MAX_MOCKUP_CHARS, parseMemberReply, type PanelQuestion } from "../src/lobby/planner.ts";

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

test("what the reply settled is kept per question, answered or left, so none is asked twice", () => {
  const questions = [question("DEV", "REST or RPC?"), question("QA", "  Which\n browsers? "), question("DESIGN", "Modal or page?")];
  const results: AskResult[] = [{
    cancelled: false,
    answers: [
      { questionIndex: 0, question: "REST or RPC?", kind: "option", answer: "REST" },
      { questionIndex: 2, question: "Modal or page?", kind: "multi", answer: null, selected: ["Modal", "Page"] },
    ],
  }];
  assert.deepEqual(settledQuestions(questions, results), [
    { from: "DEV", question: "REST or RPC?", answer: "REST" },
    { from: "QA", question: "Which browsers?" },
    { from: "DESIGN", question: "Modal or page?", answer: "Modal, Page" },
  ]);
  assert.deepEqual(settledQuestions(questions, []), [], "nothing was asked of the user yet");
});

test("an answer written over several lines keeps its lines under the arrow", () => {
  const questions = [question("DEV", "How should errors look?")];
  const results: AskResult[] = [{ cancelled: false, answers: [{ questionIndex: 0, question: "How should errors look?", kind: "custom", answer: "one line\nsecond line", notes: "a\nb" }] }];
  assert.equal(answerMessage(questions, results), [
    "Answers to the panel's questions:",
    "1. [DEV] How should errors look?\n   → one line\n     second line (in my words)",
    "   note: a\n     b",
  ].join("\n"));
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

test("a seat's mockups ride under its options, survive the oracle's relay by label, and reach the questionnaire", () => {
  const seat = parseMemberReply([
    "## Status",
    "OPEN",
    "",
    "## Questions",
    "1. Which layout for the dashboard?",
    "   - Sidebar — nav down the left",
    "     ```mockup",
    "     <style>.side{width:200px}</style>",
    "     <div class=\"side\">Overview</div>",
    "     ```",
    "   - Top bar — nav across the top",
    "     ~~~html",
    "     <div class=\"top\">Overview</div>",
    "     ~~~",
    "   - Tabs — no nav at all",
  ].join("\n"));
  const options = seat.questions[0]!.options;
  assert.deepEqual(options.map((option) => [option.label, option.description, option.mockup?.html]), [
    ["Sidebar", "nav down the left", "<style>.side{width:200px}</style>\n<div class=\"side\">Overview</div>"],
    ["Top bar", "nav across the top", "<div class=\"top\">Overview</div>"],
    ["Tabs", "no nav at all", undefined],
  ], "the fences are mockups, not question text");
  assert.equal(seat.questions[0]!.text, "Which layout for the dashboard?");
  const fromSeat: PanelQuestion[] = seat.questions.map((question) => ({ ...question, from: "DESIGN" }));
  // The oracle relays it in its own words, keeping two of the labels.
  const relayed = carryMockups([{ from: "DESIGN", text: "Dashboard layout?", options: [{ label: "Sidebar (Recommended)", description: "most room" }, { label: "Top bar", description: "full width" }] }], fromSeat);
  assert.deepEqual(relayed[0]!.options.map((option) => Boolean(option.mockup)), [true, true]);
  const asked = toAskQuestion(relayed[0]!);
  assert.equal(asked.options[0]!.htmlPreview?.html, options[0]!.mockup!.html, "the user sees it in the questionnaire, where it expands");
  assert.equal(asked.options[1]!.htmlPreview?.html, "<div class=\"top\">Overview</div>");
  const plain = parseMemberReply("## Status\nOPEN\n\n## Questions\n1. Too big?\n   - Yes\n     ```mockup\n" + "x".repeat(MAX_MOCKUP_CHARS + 1) + "\n     ```\n   - No");
  assert.equal(plain.questions[0]!.options[0]!.mockup, undefined, "a mockup past the limit is dropped, not cut mid-tag");
  assert.equal(plain.questions[0]!.options.length, 2);
});
