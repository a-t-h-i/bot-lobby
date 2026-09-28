import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { textWidth } from "../src/width.ts";

const PIECES = [
  "a", "Z", " ", "~", "é", "·", "…", "—", "│", "╭", "━", "┃", "◆", "●", "○", "◉", "▸", "↑", "↻", "⠋", "⧗", "✓", "✗", "¯\\_(ツ)_/¯",
  "\x1b[38;5;240m", "\x1b[39m", "\x1b[1m", "\x1b[22m", "\x1b[7m", "\x1b[0m", "\x1b[2K", "\x1b[38:2:1:2:3m",
  "\x1b]8;;https://x.y\x07", "\x1b]8;;\x1b\\", "\x1b_pi:c\x07", "\x1b[?25h", "\x1b[3~", "\x1b", "\t", "\r",
  "界", "😀", "👍🏽", "é", "❤️", "◽", "▶", "▶️", "⌛", "✅", "­", "‍", "ก", "ำ", " ",
];

test("text width is pi-tui's visible width, however the text is made up", () => {
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 3000; round += 1) {
    const parts = Array.from({ length: 1 + Math.floor(random() * 12) }, () => PIECES[Math.floor(random() * PIECES.length)]!);
    const text = parts.join("");
    assert.equal(textWidth(text), visibleWidth(text), JSON.stringify(text));
  }
  assert.equal(textWidth(""), 0);
  assert.equal(textWidth("\x1b[36m│ DEV\x1b[39m reading a.ts … ◆"), 22);
});

test("every character the fast path measures is measured as pi-tui does, alone and beside others", () => {
  const ranges: Array<[number, number]> = [[0xa0, 0x2ff], [0x2010, 0x2027], [0x2030, 0x205e], [0x2190, 0x23ff], [0x2500, 0x27bf], [0x2800, 0x29ff]];
  for (const [from, to] of ranges) {
    for (let code = from; code <= to; code += 1) {
      const ch = String.fromCharCode(code);
      for (const text of [ch, `a${ch}b`, `\x1b[1m${ch}${ch}\x1b[22m`, `${ch}\ufe0f`, `${ch}\u0301`]) assert.equal(textWidth(text), visibleWidth(text), `U+${code.toString(16)} in ${JSON.stringify(text)}`);
    }
  }
});
