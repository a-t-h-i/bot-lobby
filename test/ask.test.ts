import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type MarkdownTheme } from "@earendil-works/pi-tui";
import { initialState, step, type AskKey, type AskState } from "../src/ask/state.ts";
import { renderAsk, SIDE_BY_SIDE_MIN } from "../src/ask/view.ts";
import { askUser, readKey } from "../src/ask/dialog.ts";
import { answerSummary, ASK_TOOL, invalidQuestions, registerAskTool } from "../src/ask/tool.ts";
import type { AskQuestion, AskResult } from "../src/ask/types.ts";
import { createMarkdownRenderer } from "../src/lobby/markdown.ts";
import type { LobbyTheme } from "../src/lobby/layout.ts";

const auth: AskQuestion = {
  question: "Which **auth** provider?",
  header: "Auth",
  options: [
    { label: "Clerk (Recommended)", description: "Hosted, with prebuilt `<SignIn/>`", preview: "```tsx\n<SignIn />\n```" },
    { label: "Auth.js", description: "Self-hosted" },
  ],
};
const features: AskQuestion = { question: "Which features?", header: "Features", options: [{ label: "Dark mode" }, { label: "Search" }, { label: "Export" }], multiSelect: true };
const layout: AskQuestion = { question: "Which layout?", header: "Layout", options: [{ label: "Sidebar", preview: "┌──┬──────┐\n│  │      │\n└──┴──────┘" }, { label: "Top bar", preview: "┌─────────┐\n├─────────┤\n└─────────┘" }] };

const keys = (state: AskState, ...pressed: Array<AskKey["type"] | AskKey>): AskState => pressed.reduce((current, key) => step(current, typeof key === "string" ? ({ type: key } as AskKey) : key), state);

test("a single choice is picked with enter and moves on; the last answer submits", () => {
  const state = keys(initialState([auth, layout]), "down", "enter");
  assert.equal(state.tab, 1, "on to the next question");
  const done = keys(state, "enter");
  assert.deepEqual(done.result, {
    cancelled: false,
    answers: [
      { questionIndex: 0, question: auth.question, kind: "option", answer: "Auth.js" },
      { questionIndex: 1, question: layout.question, kind: "option", answer: "Sidebar" },
    ],
  });
  assert.deepEqual(keys(initialState([auth]), { type: "digit", value: 2 }).result?.answers[0]?.answer, "Auth.js", "a number picks at once");
});

test("several options are toggled with space; enter moves on with what is picked", () => {
  const state = keys(initialState([features]), "space", "down", "down", "space", "space");
  assert.deepEqual(state.picked[0], [0], "toggled twice is unpicked");
  const done = keys(keys(initialState([features]), "space", { type: "digit", value: 3 }), "enter");
  assert.deepEqual(done.result?.answers, [{ questionIndex: 0, question: features.question, kind: "multi", answer: "Dark mode, Export", selected: ["Dark mode", "Export"] }]);
  assert.deepEqual(keys(initialState([features]), "down", "enter").result?.answers[0]?.selected, ["Search"], "enter with nothing picked picks the focused option");
});

test("an answer in your own words: typed on the last row, kept with enter, escaped with esc", () => {
  const typing = keys(initialState([auth]), "up", "enter");
  assert.equal(typing.editing, true);
  const written = keys(typing, { type: "text", value: "Supabase" }, "space", { type: "text", value: "auth" }, { type: "digit", value: 2 }, "backspace");
  assert.equal(written.draft, "Supabase auth");
  assert.deepEqual(keys(written, "enter").result?.answers, [{ questionIndex: 0, question: auth.question, kind: "custom", answer: "Supabase auth" }]);
  const backed = keys(written, "escape");
  assert.deepEqual([backed.editing, backed.result], [false, undefined], "esc leaves the typing, not the questions");
  const empty = keys(typing, "enter");
  assert.equal(empty.result, undefined, "an empty answer keeps you on the question");
  const mixed = keys(initialState([features]), "space", "up", "enter", { type: "text", value: "Offline" }, "enter");
  assert.deepEqual(mixed.result?.answers[0]?.selected, ["Dark mode", "Offline"], "your words join what you picked");
});

test("←→ move between questions, unanswered ones are left out, and esc puts the questions away with what was answered", () => {
  const moved = keys(initialState([auth, features, layout]), "right", "right", "right", "left");
  assert.equal(moved.tab, 1);
  const done = keys(initialState([auth, features, layout]), "enter", "right", "enter");
  assert.deepEqual(done.result?.answers.map((answer) => answer.questionIndex), [0, 2]);
  const asked = keys(initialState([auth, layout]), "enter", "escape");
  assert.equal(asked.result, undefined, "esc only asks: an accidental press does not leave the questions");
  assert.equal(asked.leaving, true);
  const away = keys(initialState([auth, layout]), "enter", "escape", "enter");
  assert.deepEqual([away.result?.cancelled, away.result?.answers.length], [true, 1]);
  const kept = keys(initialState([auth, layout]), "enter", "escape", "escape");
  assert.deepEqual([kept.result, kept.leaving], [undefined, false], "esc twice, or any other key, keeps answering");
  assert.equal(keys(initialState([auth, layout]), "escape", "down").leaving, false);
  assert.equal(keys(initialState([auth, layout]), "escape", { type: "text", value: "y" }).result?.cancelled, true);
});

test("keys from the terminal: arrows, enter, esc, digits, space, and typed or pasted text", () => {
  assert.deepEqual(readKey("\x1b[A"), { type: "up" });
  assert.deepEqual(readKey("\r"), { type: "enter" });
  assert.deepEqual(readKey("\x1b"), { type: "escape" });
  assert.deepEqual(readKey("3"), { type: "digit", value: 3 });
  assert.deepEqual(readKey(" "), { type: "space" });
  assert.deepEqual(readKey("hello there"), { type: "text", value: "hello there" });
  assert.equal(readKey("\x1b[15~"), undefined, "other control sequences are ignored");
});

test("shift+enter starts a new line in your own answer; enter keeps the whole answer", () => {
  for (const data of ["\x1b[13;2u", "\x1b[27;2;13~", "\n", "\x1b\r", "\x1b[13;2~"]) {
    assert.deepEqual(readKey(data), { type: "newline" }, `${JSON.stringify(data)} is a new line, not an enter`);
  }
  assert.deepEqual(readKey("\r"), { type: "enter" }, "plain enter still keeps the answer");
  const typing = keys(initialState([auth]), "up", "enter");
  const written = keys(typing, { type: "text", value: "first" }, "newline", { type: "text", value: "second" }, "newline", { type: "text", value: "third" });
  assert.equal(written.draft, "first\nsecond\nthird");
  assert.equal(written.editing, true, "a new line does not keep the answer");
  assert.deepEqual(keys(written, "enter").result?.answers, [{ questionIndex: 0, question: auth.question, kind: "custom", answer: "first\nsecond\nthird" }]);
  assert.equal(keys(initialState([auth]), "newline").draft, "", "outside the own-answer row a new line does nothing");
});

test("pasted text keeps its lines in your own answer; other terminal sequences stay ignored", () => {
  assert.deepEqual(readKey("\x1b[200~line one\r\nline two\ttabbed\x1b[201~"), { type: "text", value: "line one\r\nline two\ttabbed" });
  assert.equal(readKey("\x1b[200~\x1b[201~"), undefined, "an empty paste is nothing");
  assert.deepEqual(readKey("\x1b[200~a\x1b[31mb\x1b[201~"), { type: "text", value: "a[31mb" }, "escape bytes inside a paste are dropped");
  const typing = keys(initialState([auth]), "up", "enter");
  assert.equal(keys(typing, { type: "text", value: "a\r\nb\rc\td" }).draft, "a\nb\nc  d");
});

test("a several-line own answer draws as several rows while typing and on one row once kept", () => {
  const typing = keys(initialState([auth]), "up", "enter", { type: "text", value: "first line" }, "newline", { type: "text", value: "second" });
  const drawn = text(renderAsk(typing, 100, 30, theme));
  assert.match(drawn, /✎ +first line +│\n│ +second▏ +│/, "each line of the answer is a row of its own");
  assert.match(drawn, /shift\+enter new line/);
  const kept = text(renderAsk(keys(typing, "enter"), 100, 30, theme));
  assert.match(kept, /“first line ⏎ second”/);
  // The model reads every line under the arrow.
  const summary = answerSummary([auth], { cancelled: false, answers: [{ questionIndex: 0, question: auth.question, kind: "custom", answer: "first line\nsecond" }] });
  assert.match(summary, /→ first line\n {5}second \(in the user's own words\)/);
});

const tag = (name: string) => (text: string) => `<${name}>${text}</${name}>`;
const plain: MarkdownTheme = { heading: tag("h"), link: (t) => t, linkUrl: (t) => t, code: tag("code"), codeBlock: (t) => t, codeBlockBorder: (t) => t, quote: (t) => t, quoteBorder: (t) => t, hr: (t) => t, listBullet: (t) => t, bold: tag("b"), italic: tag("i"), strikethrough: (t) => t, underline: (t) => t };
const theme: LobbyTheme = { fg: (_color, text) => text, bold: (text) => text, markdown: createMarkdownRenderer(plain) };
const text = (lines: string[]) => lines.map((line) => stripTerminalSequences(line)).join("\n");

test("the questionnaire draws in Markdown: the question, each description, and the focused option's preview beside the list", () => {
  const wide = renderAsk(initialState([auth, layout]), 120, 40, theme);
  assert.ok(wide.every((line) => visibleWidth(line) === 120), "exactly its width");
  const drawn = text(wide);
  assert.match(drawn, /Question 1 of 2/);
  assert.match(drawn, /\[1 Auth\]/);
  assert.match(drawn, /Which <b>auth<\/b> provider\?/);
  assert.match(drawn, /› ○ 1\. Clerk \(Recommended\)/);
  assert.match(drawn, /│ {8}Hosted, with prebuilt +│[^\n]*\n│ {8}<code><SignIn\/><\/code>/, "descriptions wrap under their option");
  assert.match(drawn, /Preview · Clerk/);
  assert.match(drawn, /Type something\./);
  const row = wide.map((line) => stripTerminalSequences(line)).find((line) => line.includes("Clerk (Recommended)"))!;
  assert.ok(row.indexOf("Preview") < 0 || row.includes("│"), "list and preview share rows");
  assert.ok(wide.some((line) => /› ○ 1\. Clerk.*╭ Preview · Clerk/.test(stripTerminalSequences(line))), "the preview sits beside the options");
  const narrow = text(renderAsk(initialState([layout]), SIDE_BY_SIDE_MIN - 20, 40, theme));
  assert.match(narrow, /Top bar[\s\S]*Preview · Sidebar/, "narrow: the preview under the options");
  const focused = text(renderAsk(keys(initialState([layout]), "down"), 120, 40, theme));
  assert.match(focused, /Preview · Top bar/, "the preview follows the focus");
  assert.ok(renderAsk(initialState([auth]), 120, 12, theme).length <= 12, "never taller than it may be");
});

test("where the questionnaire cannot be drawn (RPC, or a host without custom UI) pi's dialogs ask instead; without any UI nobody is asked", async () => {
  const titles: string[] = [];
  const dialogs = { select: async (title: string, options: string[]) => (titles.push(title), options[0]), input: async () => "x" };
  const rpc = { hasUI: true, mode: "rpc", ui: { ...dialogs, custom: async () => { throw new Error("not in rpc"); } } } as unknown as ExtensionContext;
  assert.deepEqual((await askUser([auth], rpc)).answers, [{ questionIndex: 0, question: auth.question, kind: "option", answer: "Clerk (Recommended)" }]);
  assert.match(titles[0]!, /Auth · 1\/1\n\nWhich \*\*auth\*\* provider\?\n\nClerk \(Recommended\): Hosted[\s\S]*--- Clerk \(Recommended\) ---\n```tsx/, "descriptions and previews are folded into the dialog");
  const noCustom = { hasUI: true, ui: { ...dialogs, custom: async () => undefined } } as unknown as ExtensionContext;
  assert.equal((await askUser([auth], noCustom)).cancelled, false);
  assert.deepEqual(await askUser([auth], { hasUI: false } as unknown as ExtensionContext), { answers: [], cancelled: true });
});

test("the questionnaire opens as an overlay and gives back what was answered", async () => {
  let shown: { overlay?: boolean } | undefined;
  const ctx = {
    hasUI: true,
    ui: {
      custom: async (factory: (tui: unknown, theme: unknown, keys: unknown, done: (result: AskResult) => void) => { handleInput(data: string): void; render(width: number): string[] }, options: { overlay?: boolean }) => {
        shown = options;
        return await new Promise<AskResult>((resolve) => {
          const tui = { requestRender: () => {}, terminal: { rows: 40 } };
          const piTheme = { fg: (_c: string, t: string) => t, bold: (t: string) => t, italic: (t: string) => t, bg: (_c: string, t: string) => t, strikethrough: (t: string) => t };
          const dialog = factory(tui, piTheme, undefined, resolve);
          dialog.handleInput("\x1b[B");
          dialog.handleInput("\r");
        });
      },
    },
  } as unknown as ExtensionContext;
  const result = await askUser([auth], ctx);
  assert.equal(shown?.overlay, true);
  assert.deepEqual(result.answers[0]?.answer, "Auth.js");
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

test("questionnaires asked together open one at a time", async () => {
  let open = 0;
  let most = 0;
  const custom = async () => {
    open++;
    most = Math.max(most, open);
    await new Promise((resolve) => setTimeout(resolve, 5));
    open--;
    return { answers: [], cancelled: true } as AskResult;
  };
  const ctx = { hasUI: true, cwd: process.cwd(), ui: { custom } } as unknown as ExtensionContext;
  await Promise.all([askUser([auth], ctx), askUser([auth], ctx), askUser([auth], ctx)]);
  assert.equal(most, 1);
});
