import { test } from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth, type MarkdownTheme } from "@earendil-works/pi-tui";
import { bar, beside, box, detailWindow, highlight, markdownHanging, markdownLines, meter, notePane, pageCount, pageOf, pager, pagerButton, pageStep, position, scrollThumb, sparkline, stackedBar, type LobbyTheme } from "../src/lobby/layout.ts";
import { chatLines, chatTail, paneWindow, tailWindow } from "../src/lobby/tabs/home.ts";
import type { ChatEntry } from "../src/lobby/feed.ts";
import { createMarkdownRenderer, markdownBlocks, tidyHeading } from "../src/lobby/markdown.ts";
import { trimReply } from "../src/lobby/feed.ts";
import { actionFor, keyLabel, keyMap, LOBBY_ACTIONS } from "../src/lobby/keys.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";
import { LOBBY_SWITCHES, lobbySwitch, toggleLobbySwitch } from "../src/pi/settings-ui.ts";

const tag = (name: string) => (text: string) => `<${name}>${text}</${name}>`;

const plainMarkdown: MarkdownTheme = {
  heading: tag("h"),
  link: (text) => text,
  linkUrl: (text) => text,
  code: tag("code"),
  codeBlock: (text) => text,
  codeBlockBorder: (text) => text,
  quote: (text) => text,
  quoteBorder: (text) => text,
  hr: (text) => text,
  listBullet: (text) => text,
  bold: tag("b"),
  italic: tag("i"),
  strikethrough: (text) => text,
  underline: (text) => text,
};

test("boxes are exactly their size, with the title in the border and one column of padding", () => {
  const lines = box(20, 4, ["hello", "a line that is far too long to fit"], { title: "Title", right: "3" }).map((line) => stripTerminalSequences(line));
  assert.deepEqual(lines, [
    "╭ Title ──────── 3 ╮",
    "│ hello            │",
    "│ a line that is … │",
    "╰──────────────────╯",
  ]);
  assert.deepEqual(box(3, 2, ["abc"]), ["abc", "   "], "too narrow for a border: plain lines");
  assert.deepEqual(box(10, 0, ["x"]), []);
  assert.equal(visibleWidth(box(12, 3, [], { title: "A very long title indeed", right: "right side" })[0]!), 12);
  const side = beside([box(6, 3, ["a"]), box(5, 3, ["b"])]);
  assert.deepEqual(side.map((line) => visibleWidth(line)), [12, 12, 12]);
});

test("highlight marks every match in reverse video without disturbing escape sequences", () => {
  assert.equal(highlight("Router and router", "ROUTER"), "\x1b[7mRouter\x1b[27m and \x1b[7mrouter\x1b[27m");
  const styled = "\x1b[31mred rou\x1b[1mter\x1b[0m";
  const marked = highlight(styled, "router");
  assert.equal(marked, "\x1b[31mred \x1b[7mrou\x1b[1mter\x1b[27m\x1b[0m");
  assert.equal(visibleWidth(marked), visibleWidth(styled));
  assert.equal(highlight("nothing here", "zzz"), "nothing here");
  assert.equal(highlight("same", "  "), "same");
});

test("bars, meters, sparklines and stacked bars fill exactly their cells", () => {
  assert.equal(bar(50, 100, 10), "█████");
  assert.equal(bar(1, 1000, 10), "▏", "a small non-zero value still shows");
  assert.equal(bar(0, 100, 10), "");
  assert.equal(bar(15, 100, 10), "█▌");
  assert.equal(meter(0.5, 8, (text) => text, (text) => text), "━━━━────");
  assert.equal(meter(Number.NaN, 4, (text) => text, (text) => text), "────");
  assert.equal(sparkline([1, 2, 3, 4], 10), "▁▃▆█");
  assert.equal(sparkline([5, 5], 10), "▄▄");
  assert.equal(sparkline([1, 2, 3, 4, 5], 2), "▁█", "only the latest values fit");
  const stacked = stackedBar([{ value: 1, paint: (text) => text.replace(/█/g, "a") }, { value: 2, paint: (text) => text.replace(/█/g, "b") }], 9);
  assert.equal(stacked, "aaabbbbbb");
  assert.equal(stackedBar([{ value: 1, paint: (t) => t }, { value: 1, paint: (t) => t }, { value: 1, paint: (t) => t }], 10).length, 10, "rounding never leaves a gap");
});

test("Markdown renders through pi's renderer with headings tidied, and falls back to plain wrapping", () => {
  const render = createMarkdownRenderer(plainMarkdown);
  const lines = render("## Steps\n\n1. Add **the form**\n2. Wire `api.ts`\n\n", 40);
  assert.equal(lines[0], "<h><b>Steps</b></h>");
  assert.ok(lines.some((line) => line.includes("1. Add <b>the form</b>")));
  assert.ok(lines.some((line) => line.includes("<code>api.ts</code>")));
  assert.notEqual(lines.at(-1)!.trim(), "", "blank padding is trimmed");
  assert.equal(render("## Steps\n\n1. Add **the form**\n2. Wire `api.ts`\n\n", 40), lines, "renders are cached");
  assert.equal(tidyHeading("\x1b[1m### Title\x1b[0m", tag("b")), "<b>\x1b[1mTitle\x1b[0m</b>");
  const ansi = createMarkdownRenderer({ ...plainMarkdown, heading: (text) => `\x1b[36m${text}\x1b[39m`, bold: (text) => `\x1b[1m${text}\x1b[22m` });
  assert.deepEqual(ansi("### Deep heading", 40).map((line) => stripTerminalSequences(line)), ["Deep heading"], "pi keeps ### on deep headings; the lobby drops it");
  assert.equal(tidyHeading("plain", tag("b")), "plain");
  const theme: LobbyTheme = { fg: (_color, text) => text, bold: (text) => text, markdown: render };
  assert.deepEqual(markdownLines("**hi**", 20, theme), ["<b>hi</b>"]);
  assert.deepEqual(markdownHanging("oracle ▸ ", "**hi**\n\nthere", 30, theme), ["oracle ▸ <b>hi</b>", "", "         there"]);
});

test("the conversation draws only the messages its window reaches, each once, and estimates the rest", () => {
  let renders = 0;
  const theme: LobbyTheme = { fg: (_color, text) => text, bold: (text) => text, markdown: (text) => (renders += 1, text.split("\n")) };
  const chat: ChatEntry[] = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, at: index * 3_600_000, role: index % 2 === 0 ? "you" : "oracle", text: index % 2 === 0 ? `question ${index}` : `answer ${index}\nsecond line` }));
  const tail = chatTail(chat, 60, theme, 10);
  assert.ok(tail.lines.length >= 10 && tail.lines.length < 20, "a few messages past the window, not all fifty");
  assert.deepEqual(tail.lines.slice(-10), chatLines(chat, 60, theme).slice(-10), "the same lines the whole conversation ends with");
  const whole = chatLines(chat, 60, theme);
  assert.ok(Math.abs(tail.total - whole.length) <= whole.length * 0.1, `estimate ${tail.total} is near ${whole.length}`);
  const drawn = renders;
  chatTail(chat, 60, theme, 10);
  chatLines(chat, 60, theme);
  assert.equal(renders, drawn, "later frames reuse every drawn message");
  chatTail(chat, 50, theme, 10);
  assert.ok(renders > drawn, "a new width draws again");
  const older = chatTail(chat.slice(-2), 60, theme, 100, { older: "earlier messages load as you scroll up" });
  assert.equal(older.lines[0], "earlier messages load as you scroll up", "the note tops a conversation with earlier messages");
  assert.equal(older.total, older.lines.length);
});

test("the conversation measures what arrived below its newest message, however little of it is drawn", () => {
  const theme: LobbyTheme = { fg: (_color, text) => text, bold: (text) => text, markdown: (text) => text.split("\n") };
  const chat: ChatEntry[] = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, at: index * 3_600_000, role: index % 2 === 0 ? "you" : "oracle", text: index % 5 === 0 ? `answer ${index}\n${"more\n".repeat(20)}` : `question ${index}` }));
  const first = chatTail(chat, 60, theme, 5);
  assert.equal(first.mark?.entry, chat.at(-1));
  assert.equal(first.grew, undefined, "nothing to measure against yet");
  const still = chatTail(chat, 60, theme, 40, { anchor: first.mark! });
  assert.equal(still.grew, 0, "drawing further back is not growth, though the estimate moves");
  assert.notEqual(still.total, first.total);
  const more = [...chat, { id: 99, at: 0, role: "note" as const, text: "task started" }, { id: 100, at: 0, role: "oracle" as const, text: "one\ntwo\nthree" }];
  const after = chatTail(more, 60, theme, 1, { anchor: first.mark! });
  assert.equal(after.grew, 1 + 1 + 1 + 4, "the note and the reply (speaker line and three lines), each after a blank line");
  const streaming = chatTail(more, 60, theme, 1, { anchor: after.mark!, live: "a\n\nb\n\nc" });
  assert.equal(streaming.grew, 1 + 1 + 5, "a streaming reply counts whole, even past what the pane needs");
  assert.equal(chatTail(chat.slice(0, 10), 60, theme, 5, { anchor: first.mark! }).grew, undefined, "an anchor that is gone measures nothing");
});

test("a pane drawn only near its newest lines still scrolls and places its thumb over the whole", () => {
  const content = { lines: ["f", "g", "h", "i", "j"], total: 10 };
  assert.deepEqual(paneWindow(content, 3, 0), { shown: ["h", "i", "j"], start: 7, offset: 0 });
  assert.deepEqual(paneWindow(content, 3, 2), { shown: ["f", "g", "h"], start: 5, offset: 2 });
  assert.deepEqual(paneWindow(content, 3, 99), { shown: [], start: 0, offset: 7 }, "past what was drawn: the next frame draws further back");
  assert.deepEqual(paneWindow({ lines: ["a"], total: 0 }, 3, 5), { shown: ["a"], start: 0, offset: 0 });
});

test("a reply renders the same block by block as whole, at every point while it streams", () => {
  const render = createMarkdownRenderer(plainMarkdown);
  const pieces = [
    "Para with **bold** and `code` text that is long enough to wrap around the pane width for sure.", "## Heading", "1. one\n2. two", "- a\n- b\n  - nested",
    "```ts\nconst x = 1;\n\nconst y = 2;\n```", "> quote line\n> more", "| a | b |\n|---|---|\n| 1 | 2 |", "---", "Plain.", "1. First\n\n2. Second",
    "- item\n\n  continued", "~~~\nx\n\ny\n~~~", "Text\n===", "* star\n* list", "    indented code\n\n    more code", "> quote\n\n> second quote",
  ];
  let seed = 11;
  for (let sample = 0; sample < 40; sample += 1) {
    const text = Array.from({ length: 7 }, () => pieces[(seed = (seed * 48271) % 0x7fffffff) % pieces.length]!).join("\n\n");
    for (let end = 1; end <= text.length; end += 5) {
      const shown = text.slice(0, end).trim();
      const parts = markdownBlocks(shown).map((block) => render(block, 50, false)).filter((lines) => lines.length > 0);
      const joined = parts.flatMap((lines, index) => (index === 0 ? lines : ["", ...lines]));
      assert.deepEqual(joined, render(shown, 50, false), JSON.stringify(shown));
    }
  }
  assert.deepEqual(markdownBlocks("a\n\n```\nx\n\ny\n```\n\n- l\n\n- m\n\nb"), ["a", "```\nx\n\ny\n```\n\n- l\n\n- m", "b"], "a list item never starts a block of its own");
});

test("a long streaming reply loses whole blocks from its start, never half a code block", () => {
  const code = "```\n" + "line\n".repeat(30) + "```";
  const reply = [code, "tail paragraph"].join("\n\n");
  assert.equal(trimReply(reply, 1000), reply, "short enough: untouched");
  assert.equal(trimReply(reply, 50), "tail paragraph", "the code block goes whole");
  assert.equal(trimReply("x".repeat(80), 50), "x".repeat(37), "one long block: cut to three quarters, so its start holds still a while");
  const long = `\`\`\`ts\n${Array.from({ length: 40 }, (_, index) => `const v${index} = ${index};`).join("\n")}`;
  const kept = trimReply(long, 120);
  assert.ok(kept.startsWith("```ts\nconst v"), "a code block too long on its own keeps its opening fence");
  assert.ok(kept.endsWith("const v39 = 39;") && kept.length <= 120);
});

test("the key map has a default for every action, takes overrides and matches keys", () => {
  const defaults = keyMap();
  assert.deepEqual(Object.keys(defaults), Object.keys(LOBBY_ACTIONS));
  assert.equal(defaults.toggleActivity, "alt+a");
  assert.equal(defaults.toggleThinking, "alt+k");
  const custom = keyMap({ toggleThinking: " Alt+T ", nonsense: "x", hide: "  " });
  assert.equal(custom.toggleThinking, "alt+t");
  assert.equal(custom.hide, "alt+l", "blank overrides keep the default");
  assert.equal(actionFor("\x1bt", custom), "toggleThinking");
  assert.equal(actionFor("\x1bk", custom), undefined);
  assert.equal(actionFor("\x06", defaults), "search");
  assert.equal(actionFor("a", defaults), undefined, "plain letters are never shortcuts by default");
  assert.equal(keyLabel("alt+k"), "Alt+K");
  assert.equal(keyLabel("shift+tab"), "Shift+Tab");
});

test("the lobby config reads panes, keys, the Issues tab, questionnaires and the mouse", () => {
  assert.deepEqual(DEFAULT_CONFIG.lobby.panels, { conversation: true, activity: true, thinking: true });
  assert.equal(DEFAULT_CONFIG.lobby.issues, false, "Issues is off by default");
  assert.equal(DEFAULT_CONFIG.lobby.autoAsk, true);
  assert.equal(DEFAULT_CONFIG.lobby.mouse, true);
  const config = resolveConfig({ lobby: { panels: { thinking: false, activity: "no", bogus: false }, keys: { toggleThinking: "alt+t", help: 3, search: " " }, issues: true, autoAsk: false, mouse: false } });
  assert.deepEqual(config.lobby.panels, { conversation: true, activity: true, thinking: false });
  assert.deepEqual(config.lobby.keys, { toggleThinking: "alt+t" });
  assert.deepEqual([config.lobby.issues, config.lobby.autoAsk, config.lobby.mouse], [true, false, false]);
});

test("the settings menu flips each lobby switch", () => {
  assert.deepEqual(LOBBY_SWITCHES.map((entry) => entry.id), ["autoOpen", "autoAsk", "mouse", "miniLine", "issues", "panel:conversation", "panel:activity", "panel:thinking"]);
  const off = toggleLobbySwitch(DEFAULT_CONFIG, "panel:activity");
  assert.equal(lobbySwitch(off, "panel:activity"), false);
  assert.equal(off.lobby.panels.thinking, true);
  assert.equal(DEFAULT_CONFIG.lobby.panels.activity, true, "the input config is left alone");
  const issues = toggleLobbySwitch(DEFAULT_CONFIG, "issues");
  assert.equal(issues.lobby.issues, true);
  assert.equal(lobbySwitch(toggleLobbySwitch(issues, "issues"), "issues"), false);
});

test("scroll windows, thumbs and positions stay inside their panes", () => {
  assert.equal(scrollThumb(10, 20, 0), undefined, "everything fits: no thumb");
  assert.deepEqual(scrollThumb(100, 10, 0), { from: 0, to: 1 });
  assert.deepEqual(scrollThumb(100, 10, 90), { from: 9, to: 10 });
  assert.deepEqual(scrollThumb(20, 10, 5), { from: 3, to: 8 });
  assert.equal(detailWindow(50, 10, 100), 40, "a detail stops when its last line shows");
  assert.equal(detailWindow(5, 10, 3), 0);
  assert.equal(position(40, 10, 50), "41–50/50");
  assert.deepEqual(tailWindow(["a", "b", "c", "d", "e"], 2, 0), { shown: ["d", "e"], start: 3, offset: 0 });
  assert.deepEqual(tailWindow(["a", "b", "c", "d", "e"], 2, 99), { shown: ["a", "b"], start: 0, offset: 3 });
  const scrolled = box(10, 6, ["1", "2", "3", "4"], { scroll: { total: 8, start: 4 } });
  assert.deepEqual(scrolled.slice(1, 5).map((line) => line.at(-1)), ["│", "│", "┃", "┃"], "the thumb sits at the bottom of the track");
  const panes = new Map();
  notePane(panes, "detail", 1, 20, 30, 12, 99);
  assert.deepEqual(panes.get("detail"), { top: 1, left: 20, width: 30, height: 12, total: 99, rows: 10 });
});

test("pages: a page is the rows less one, counted from the top as 1 to the bottom as the last, whichever end a pane opens at", () => {
  assert.equal(pageStep(10), 9);
  assert.equal(pageStep(1), 1);
  assert.equal(pageCount(8, 10), 1, "everything fits: one page");
  assert.equal(pageCount(60, 20), 4);
  assert.deepEqual([0, 19, 38, 40].map((start) => pageOf(60, 20, start)), [1, 2, 3, 4], "reading down from the top");
  assert.deepEqual([40, 21, 2, 0].map((start) => pageOf(60, 20, start)), [4, 3, 2, 1], "reading up from the newest line");
  assert.equal(pageOf(60, 20, 999), 4, "past the end is the end");
  assert.equal(pageOf(60, 20, -5), 1);
  assert.equal(pageOf(5, 10, 0), 1);
});

test("the pager is words a newcomer reads, shortening as the pane narrows, and nothing where it cannot fit", () => {
  const words = (room: number, start = 40) => pager(120, 4, start, room)?.map((part) => part.text).join("");
  assert.equal(words(40), "▲ prev · page 14/40 · next ▼");
  assert.equal(words(28), "▲ prev · page 14/40 · next ▼");
  assert.equal(words(27), "▲ prev · 14/40 · next ▼");
  assert.equal(words(23), "▲ prev · 14/40 · next ▼");
  assert.equal(words(22), "▲ 14/40 ▼");
  assert.equal(words(9), "▲ 14/40 ▼");
  assert.equal(words(8), undefined, "no room: no pager");
  assert.equal(pager(120, 4, 0, 40)!.find((part) => part.role === "where")!.text, "page  1/40", "the page number is padded so the buttons never move");
  assert.deepEqual(pager(60, 20, 40, 40)!.map((part) => part.role), ["up", "between", "where", "between", "down"]);
  const edge = (width: number, start: number, total = 120, height = 6) => stripTerminalSequences(box(width, height, ["x"], { scroll: { total, start } }).at(-1)!);
  assert.equal(edge(40, 40), "╰──────── ▲ prev · page 14/40 · next ▼ ╯");
  assert.equal(edge(30, 40), "╰─── ▲ prev · 14/40 · next ▼ ╯");
  assert.equal(edge(16, 40), "╰─── ▲ 14/40 ▼ ╯");
  assert.equal(edge(14, 40), "╰────────────╯", "too narrow for the pager");
  assert.equal(edge(44, 0, 4, 6), `╰${"─".repeat(42)}╯`, "a pane that fits has none");
  for (const width of [14, 16, 22, 30, 44, 80]) assert.equal(visibleWidth(box(width, 6, ["x"], { scroll: { total: 120, start: 40 } }).at(-1)!), width);
});

test("a button that cannot go further is dimmed, and the words between them are not buttons", () => {
  const theme: LobbyTheme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: (text) => `*${text}*` };
  const edge = (start: number, focused = true) => box(44, 6, ["x"], { scroll: { total: 120, start }, focused, theme }).at(-1)!;
  assert.match(edge(0), /<dim>▲ prev<\/dim><dim> · <\/dim><text>page  1\/40<\/text><dim> · <\/dim>\*<accent>next ▼<\/accent>\*/, "at the top: prev is dimmed, next is live");
  assert.match(edge(116), /\*<accent>▲ prev<\/accent>\*.*<dim>next ▼<\/dim>/, "at the end: next is dimmed");
  assert.match(edge(40), /\*<accent>▲ prev<\/accent>\*.*\*<accent>next ▼<\/accent>\*/, "in the middle both are live");
  assert.match(edge(40, false), /\*<text>▲ prev<\/text>\*.*<muted>page 14\/40<\/muted>/, "an unfocused pane is quieter");
});

test("clicks land on the buttons and the space beside them, not on the page count", () => {
  // `╰──────── ▲ prev · page 14/40 · next ▼ ╯` in 40 columns: ▲ prev at 10–15, page 14/40 at 19–28, next ▼ at 32–37.
  const width = 40;
  const at = (column: number) => pagerButton(width, column, 120, 4);
  assert.equal(at(8), undefined, "the border");
  assert.equal(at(9), -1, "the space before ▲ prev");
  assert.equal(at(10), -1);
  assert.equal(at(15), -1);
  assert.equal(at(16), undefined, "between the buttons");
  assert.equal(at(24), undefined, "the page count");
  assert.equal(at(32), 1);
  assert.equal(at(37), 1);
  assert.equal(at(38), 1, "the space after ▼");
  assert.equal(at(width - 1), undefined, "the corner");
  assert.equal(pagerButton(14, 10, 120, 4), undefined, "no pager, no buttons");
  // `╰─── ▲ 14/40 ▼ ╯` in 16 columns: ▲ at 5, ▼ at 13.
  assert.equal(pagerButton(16, 5, 120, 4), -1);
  assert.equal(pagerButton(16, 8, 120, 4), undefined);
  assert.equal(pagerButton(16, 13, 120, 4), 1);
});

test("line breaks a model wrote out as \\n are made real, but not inside code or where real ones exist", async () => {
  const { unescapeBreaks } = await import("../src/lobby/markdown.ts");
  assert.equal(unescapeBreaks("### Objective\\nFour fixes:\\n- one"), "### Objective\nFour fixes:\n- one");
  assert.equal(unescapeBreaks("split on `\\n` then\\njoin"), "split on `\\n` then\njoin");
  assert.equal(unescapeBreaks("a real\nbreak and a written \\n"), "a real\nbreak and a written \\n");
  const render = createMarkdownRenderer(plainMarkdown);
  assert.deepEqual(render("## Objective\\n- **one**\\n- two", 40), ["<h><b>Objective</b></h>", "", "- <b>one</b>", "- two"]);
});

/** A lobby theme on the plain renderer, each style's plain text tagged so a test can see it. */
function markdownTheme(): LobbyTheme {
  const render = createMarkdownRenderer(plainMarkdown, { you: { color: tag("you") }, thought: { color: tag("thought"), italic: true } });
  return { fg: (_color, text) => text, bold: (text) => text, italic: (text) => text, markdown: render };
}

const plainText = (lines: readonly string[]) => lines.map((line) => stripTerminalSequences(line)).join("\n");

test("your messages render as Markdown in your colour, list markers and escapes as you typed them", async () => {
  const { youLines } = await import("../src/lobby/tabs/home.ts");
  const text = plainText(youLines("Please **fix** `a.ts`:\n\n1) first\n2) second \\*not bold\\*", 70, markdownTheme()));
  assert.doesNotMatch(text, /\*\*fix/);
  assert.match(text, /<b>.*fix.*<\/b>/);
  assert.match(text, /<code>a\.ts<\/code>/);
  assert.match(text, /1\) .*first/, "ordered markers kept as typed");
  assert.match(text, /\\\*/, "backslash escapes kept as typed");
  assert.doesNotMatch(text, /<i>not/, "an escaped star is not emphasis");
  assert.match(text, /<you>/);
  assert.deepEqual(youLines("", 40, markdownTheme()).length, 1, "an empty message still has its bubble");
});

test("a thought reads bold where the model wrote it bold, compact, after who thought it", async () => {
  const { thoughtTail } = await import("../src/lobby/tabs/home.ts");
  const thought = { id: 1, at: 0, source: "ORACLE", text: "**Checking the plan**\n\nThe `QA` round\nasked for tests.", live: false };
  const lines = thoughtTail([thought], 60, markdownTheme(), 10).lines.map((line) => stripTerminalSequences(line));
  assert.match(lines[0]!, /^ORACLE +<b>.*Checking the plan.*<\/b>/);
  assert.ok(lines.every((line) => line.trim()), "no blank lines in the small pane");
  assert.ok(lines.slice(1).every((line) => line.startsWith(" ".repeat(10))), "hanging under who thought it");
  assert.match(lines.join("\n"), /<code>QA<\/code>/);
  assert.doesNotMatch(lines.join("\n"), /\*\*/);
});

test("the planning panel, issues and task details render their Markdown", async () => {
  const { conversationLines } = await import("../src/lobby/tabs/plan.ts");
  const view = { messages: [{ role: "planner", text: "Two things:\n\n- **auth** first\n- then `routes`", at: 0 }, { role: "planner", text: "", at: 0, questions: [{ from: "DEV", text: "Use **zod** for `input`?", options: [] }] }] } as unknown as Parameters<typeof conversationLines>[0];
  const panel = plainText(conversationLines(view, 60, markdownTheme()));
  assert.match(panel, /- <b>auth<\/b> first/);
  assert.match(panel, /<code>routes<\/code>/);
  assert.match(panel, /Use <b>zod<\/b> for <code>input<\/code>\?/);
  assert.doesNotMatch(panel, /\*\*/);
  const { issueDetailLines } = await import("../src/lobby/tabs/issues.ts");
  const issue = plainText(issueDetailLines({ number: 7, title: "Login fails", labels: [], body: "## Steps\n1. open `/login`\n2. submit", comments: [{ author: "sam", body: "Also **on mobile**." }] }, 60, 0, markdownTheme()));
  assert.match(issue, /<h><b>Steps<\/b><\/h>\n\n1\. open <code>\/login<\/code>\n2\. submit/);
  assert.match(issue, /Also <b>on mobile<\/b>\./);
  const { taskDetailLines } = await import("../src/lobby/tabs/tasks.ts");
  const { createTask } = await import("../src/schemas/task.ts");
  const task = createTask("TASK-1", "Four fixes", new Date(0).toISOString(), "### Objective\nFour fixes:\n- **Save** buttons keep their fill\n- quick view focus");
  task.amendments.push("keep the `Save` label");
  const detail = plainText(taskDetailLines(task, [{ id: "c", taskId: "TASK-1", text: "use **tokens**", createdAt: new Date(0).toISOString(), status: "addressed" }], undefined, 70, 0, markdownTheme()));
  assert.match(detail, /- <b>Save<\/b> buttons keep their fill/);
  assert.match(detail, /keep the <code>Save<\/code> label/);
  assert.match(detail, /✓ use <b>tokens<\/b> — plan amended/, "the comment's status stays on its line");
});
