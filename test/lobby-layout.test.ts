import { test } from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth, type MarkdownTheme } from "@earendil-works/pi-tui";
import { bar, beside, box, detailWindow, highlight, markdownHanging, markdownLines, meter, notePane, position, scrollThumb, sparkline, stackedBar, type LobbyTheme } from "../src/lobby/layout.ts";
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
  const older = chatTail(chat.slice(-2), 60, theme, 100, undefined, false, 0, "earlier messages load as you scroll up");
  assert.equal(older.lines[0], "earlier messages load as you scroll up", "the note tops a conversation with earlier messages");
  assert.equal(older.total, older.lines.length);
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
  assert.deepEqual(DEFAULT_CONFIG.lobby.panels, { animations: false, conversation: true, activity: true, thinking: true }, "the lobby starts without the animations");
  assert.equal(DEFAULT_CONFIG.lobby.issues, false, "Issues is off by default");
  assert.equal(DEFAULT_CONFIG.lobby.autoAsk, true);
  assert.equal(DEFAULT_CONFIG.lobby.mouse, true);
  const config = resolveConfig({ lobby: { panels: { thinking: false, activity: "no", bogus: false }, keys: { toggleThinking: "alt+t", help: 3, search: " " }, issues: true, autoAsk: false, mouse: false } });
  assert.deepEqual(config.lobby.panels, { animations: false, conversation: true, activity: true, thinking: false });
  const legacy = resolveConfig({ lobby: { panels: { scene: true, conversation: true } } });
  assert.equal(legacy.lobby.panels.animations, false, "the old scene switch, saved on by default, no longer turns the animations on");
  assert.equal(resolveConfig({ lobby: { panels: { animations: true } } }).lobby.panels.animations, true, "turning them on is remembered");
  assert.deepEqual(config.lobby.keys, { toggleThinking: "alt+t" });
  assert.deepEqual([config.lobby.issues, config.lobby.autoAsk, config.lobby.mouse], [true, false, false]);
});

test("the settings menu flips each lobby switch", () => {
  assert.deepEqual(LOBBY_SWITCHES.map((entry) => entry.id), ["autoOpen", "autoAsk", "mouse", "issues", "panel:animations", "panel:conversation", "panel:activity", "panel:thinking"]);
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
