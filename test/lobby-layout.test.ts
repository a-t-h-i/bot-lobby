import { test } from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth, type MarkdownTheme } from "@earendil-works/pi-tui";
import { bar, beside, box, highlight, markdownHanging, markdownLines, meter, sparkline, stackedBar, type LobbyTheme } from "../src/lobby/layout.ts";
import { createMarkdownRenderer, tidyHeading } from "../src/lobby/markdown.ts";
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
  const render = createMarkdownRenderer(() => plainMarkdown);
  const lines = render("## Steps\n\n1. Add **the form**\n2. Wire `api.ts`\n\n", 40);
  assert.equal(lines[0], "<h><b>Steps</b></h>");
  assert.ok(lines.some((line) => line.includes("1. Add <b>the form</b>")));
  assert.ok(lines.some((line) => line.includes("<code>api.ts</code>")));
  assert.notEqual(lines.at(-1)!.trim(), "", "blank padding is trimmed");
  assert.equal(render("## Steps\n\n1. Add **the form**\n2. Wire `api.ts`\n\n", 40), lines, "renders are cached");
  assert.equal(tidyHeading("\x1b[1m### Title\x1b[0m", tag("b")), "<b>\x1b[1mTitle\x1b[0m</b>");
  const ansi = createMarkdownRenderer(() => ({ ...plainMarkdown, heading: (text) => `\x1b[36m${text}\x1b[39m`, bold: (text) => `\x1b[1m${text}\x1b[22m` }));
  assert.deepEqual(ansi("### Deep heading", 40).map((line) => stripTerminalSequences(line)), ["Deep heading"], "pi keeps ### on deep headings; the lobby drops it");
  assert.equal(tidyHeading("plain", tag("b")), "plain");
  const theme: LobbyTheme = { fg: (_color, text) => text, bold: (text) => text, markdown: render };
  assert.deepEqual(markdownLines("**hi**", 20, theme), ["<b>hi</b>"]);
  assert.deepEqual(markdownHanging("oracle ▸ ", "**hi**\n\nthere", 30, theme), ["oracle ▸ <b>hi</b>", "", "         there"]);
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
  assert.deepEqual(DEFAULT_CONFIG.lobby.panels, { scene: true, conversation: true, activity: true, thinking: true });
  assert.equal(DEFAULT_CONFIG.lobby.issues, false, "Issues is off by default");
  assert.equal(DEFAULT_CONFIG.lobby.autoAsk, true);
  assert.equal(DEFAULT_CONFIG.lobby.mouse, true);
  const config = resolveConfig({ lobby: { panels: { thinking: false, activity: "no", bogus: false }, keys: { toggleThinking: "alt+t", help: 3, search: " " }, issues: true, autoAsk: false, mouse: false } });
  assert.deepEqual(config.lobby.panels, { scene: true, conversation: true, activity: true, thinking: false });
  assert.deepEqual(config.lobby.keys, { toggleThinking: "alt+t" });
  assert.deepEqual([config.lobby.issues, config.lobby.autoAsk, config.lobby.mouse], [true, false, false]);
});

test("the settings menu flips each lobby switch", () => {
  assert.deepEqual(LOBBY_SWITCHES.map((entry) => entry.id), ["autoOpen", "autoAsk", "mouse", "issues", "panel:scene", "panel:conversation", "panel:activity", "panel:thinking"]);
  const off = toggleLobbySwitch(DEFAULT_CONFIG, "panel:activity");
  assert.equal(lobbySwitch(off, "panel:activity"), false);
  assert.equal(off.lobby.panels.thinking, true);
  assert.equal(DEFAULT_CONFIG.lobby.panels.activity, true, "the input config is left alone");
  const issues = toggleLobbySwitch(DEFAULT_CONFIG, "issues");
  assert.equal(issues.lobby.issues, true);
  assert.equal(lobbySwitch(toggleLobbySwitch(issues, "issues"), "issues"), false);
});
