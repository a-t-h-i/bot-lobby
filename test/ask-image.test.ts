import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities, stripTerminalSequences, visibleWidth, type TerminalCapabilities } from "@earendil-works/pi-tui";
import { decodePng, type Pixels } from "../src/ask/png.ts";
import { halfBlocks, imageLines, loadImage, loadImages, MAX_IMAGE_BYTES, type LoadedImage } from "../src/ask/image.ts";
import { renderAsk } from "../src/ask/view.ts";
import { initialState } from "../src/ask/state.ts";
import { askUser, dialogAsker } from "../src/ask/dialog.ts";
import { invalidQuestions } from "../src/ask/tool.ts";
import type { AskQuestion, AskResult } from "../src/ask/types.ts";

const original: TerminalCapabilities = getCapabilities();
const terminal = (images: TerminalCapabilities["images"], trueColor = true) => setCapabilities({ images, trueColor, hyperlinks: false });
after(() => setCapabilities(original));

/* ------------------------------------------------------------ a PNG encoder for the tests */

interface Encode {
  type: 0 | 2 | 3 | 4 | 6;
  depth?: 1 | 2 | 4 | 8 | 16;
  interlace?: boolean;
  /** type 3: RGB triples; its alpha in `alphas` (tRNS). */
  palette?: number[][];
  alphas?: number[];
}

function chunk(name: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(name, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(name, "ascii"), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** Samples per pixel row as the PNG stores them, from one value list per pixel. */
function packRow(samples: number[][], depth: number): Uint8Array {
  const flat = samples.flat();
  if (depth === 8) return Uint8Array.from(flat);
  if (depth === 16) return Uint8Array.from(flat.flatMap((value) => [value >> 8, value & 255]));
  const bytes = new Uint8Array(Math.ceil((flat.length * depth) / 8));
  flat.forEach((value, index) => {
    const bit = index * depth;
    bytes[bit >> 3]! |= value << (8 - depth - (bit & 7));
  });
  return bytes;
}

/** Filter a row with filter type `filter` (0-4), as an encoder would. */
function filterRow(row: Uint8Array, previous: Uint8Array, filter: number, bpp: number): Uint8Array {
  const out = new Uint8Array(row.length + 1);
  out[0] = filter;
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bpp ? row[index - bpp]! : 0;
    const up = previous[index] ?? 0;
    const corner = index >= bpp ? previous[index - bpp] ?? 0 : 0;
    const p = left + up - corner;
    const predictor = [0, left, up, (left + up) >> 1, Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner][filter]!;
    out[index + 1] = (row[index]! - predictor) & 255;
  }
  return out;
}

/** A PNG of `grid` (one sample list per pixel), each row with the next filter type in turn. */
function encodePng(grid: number[][][], options: Encode): Buffer {
  const height = grid.length;
  const width = grid[0]!.length;
  const depth = options.depth ?? 8;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[options.type];
  const bpp = Math.max(1, (channels * depth) >> 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = options.type;
  header[12] = options.interlace ? 1 : 0;
  const passes = options.interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows: Uint8Array[] = [];
  let filter = 0;
  for (const [x0, y0, dx, dy] of passes as number[][]) {
    let previous: Uint8Array = new Uint8Array(0);
    for (let y = y0!; y < height; y += dy!) {
      const samples: number[][] = [];
      for (let x = x0!; x < width; x += dx!) samples.push(grid[y]![x]!);
      if (samples.length === 0) continue;
      const row: Uint8Array = packRow(samples, depth);
      rows.push(filterRow(row, previous, filter++ % 5, bpp));
      previous = row;
    }
  }
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header)];
  if (options.palette) parts.push(chunk("PLTE", Uint8Array.from(options.palette.flat())));
  if (options.alphas) parts.push(chunk("tRNS", Uint8Array.from(options.alphas)));
  parts.push(chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", new Uint8Array(0)));
  return Buffer.concat(parts);
}

const RGBA = (pixels: Pixels, x: number, y: number) => [...pixels.data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4)];

/** A 9×7 picture whose every pixel differs, so a misplaced one shows. */
const colourAt = (x: number, y: number) => [(x * 29 + y * 7) % 256, (x * 3 + y * 41) % 256, (x * y * 13 + 5) % 256];

test("PNG: RGB and RGBA, 8 and 16 bits, every filter, plain and interlaced, decode to the same pixels", () => {
  for (const interlace of [false, true]) {
    const rgb = Array.from({ length: 7 }, (_, y) => Array.from({ length: 9 }, (_, x) => colourAt(x, y)));
    const plain = decodePng(encodePng(rgb, { type: 2, interlace }));
    assert.deepEqual([plain.width, plain.height], [9, 7]);
    for (let y = 0; y < 7; y += 1) for (let x = 0; x < 9; x += 1) assert.deepEqual(RGBA(plain, x, y), [...colourAt(x, y), 255], `rgb ${x},${y} interlace=${interlace}`);
    const rgba = rgb.map((row, y) => row.map((pixel, x) => [...pixel, (x * 31 + y) % 256]));
    const alpha = decodePng(encodePng(rgba, { type: 6, interlace }));
    assert.deepEqual(RGBA(alpha, 8, 6), rgba[6]![8]);
    const wide = rgb.map((row) => row.map((pixel) => pixel.map((value) => value * 257 + 1)));
    assert.deepEqual(RGBA(decodePng(encodePng(wide, { type: 2, depth: 16, interlace })), 4, 3), [...colourAt(4, 3), 255], "16 bits: the high byte");
  }
});

test("PNG: grey, grey with alpha, low bit depths, palettes with transparency", () => {
  const grey = decodePng(encodePng([[[0], [1], [2], [3], [0]], [[3], [2], [1], [0], [3]]], { type: 0, depth: 2 }));
  assert.deepEqual([RGBA(grey, 1, 0), RGBA(grey, 3, 1)], [[85, 85, 85, 255], [0, 0, 0, 255]]);
  assert.deepEqual(RGBA(decodePng(encodePng([[[200, 100]]], { type: 4 })), 0, 0), [200, 200, 200, 100]);
  const palette = [[255, 0, 0], [0, 0, 255]];
  const bits = decodePng(encodePng([[[0], [1], [1], [0], [1], [0], [0], [1], [1]]], { type: 3, depth: 1, palette, alphas: [128] }));
  assert.deepEqual([RGBA(bits, 0, 0), RGBA(bits, 1, 0), RGBA(bits, 8, 0)], [[255, 0, 0, 128], [0, 0, 255, 255], [0, 0, 255, 255]]);
  assert.throws(() => decodePng(Buffer.from("GIF89a")), /not a PNG/);
});

test("half-blocks: each cell's top half is one pixel row, its bottom the next; see-through pixels sit on the dark box", () => {
  const pixels: Pixels = { width: 2, height: 4, data: Uint8Array.from([
    255, 0, 0, 255, 255, 0, 0, 255,
    0, 255, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 0, 0, 255, 255,
    255, 255, 255, 0, 255, 255, 255, 0,
  ]) };
  const cell = (top: string, bottom: string) => `\x1b[38;2;${top}m\x1b[48;2;${bottom}m▀`;
  assert.deepEqual(halfBlocks(pixels, 2, 2), [
    `${cell("255;0;0", "0;255;0").repeat(2)}\x1b[0m`,
    `${cell("0;0;255", "24;24;24").repeat(2)}\x1b[0m`,
  ]);
  assert.match(halfBlocks(pixels, 2, 2, false)[0]!, /^\x1b\[38;5;196m\x1b\[48;5;46m▀/, "256 colours where there is no true colour");
  const wide = halfBlocks({ width: 400, height: 100, data: new Uint8Array(400 * 100 * 4) }, 40, 30);
  assert.deepEqual([wide.length, visibleWidth(wide[0]!)], [5, 40], "the aspect is kept: 4:1 in 40 columns is 10 pixel rows, 5 cells");
  const tall = halfBlocks({ width: 100, height: 400, data: new Uint8Array(100 * 400 * 4) }, 40, 10);
  assert.deepEqual([tall.length, visibleWidth(tall[0]!)], [10, 5], "and a tall one narrows to fit the rows");
});

const dir = mkdtempSync(join(tmpdir(), "dh-ask-image-"));
const shot = join(dir, "sidebar.png");
writeFileSync(shot, encodePng(Array.from({ length: 30 }, (_, y) => Array.from({ length: 40 }, (_, x) => (x < 10 ? [30, 58, 95] : y < 8 ? [245, 158, 11] : [244, 244, 245]))), { type: 2 }));
const jpeg = join(dir, "photo.jpg");
writeFileSync(jpeg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 60, 0, 80, 1, 1, 0x11, 0, 0xff, 0xd9]));

test("an image file is read once, checked for what it is, and refused with a reason", async () => {
  const loaded = (await loadImage(shot)) as LoadedImage;
  assert.deepEqual([loaded.mime, loaded.dimensions], ["image/png", { widthPx: 40, heightPx: 30 }]);
  assert.equal(((await loadImage(jpeg)) as LoadedImage).mime, "image/jpeg");
  assert.deepEqual(await loadImage(join(dir, "nope.png")), { path: join(dir, "nope.png"), error: "no such file" });
  const text = join(dir, "notes.png");
  writeFileSync(text, "hello");
  assert.match(((await loadImage(text)) as { error: string }).error, /not a PNG, JPEG, GIF or WebP/);
  const big = join(dir, "big.png");
  writeFileSync(big, Buffer.alloc(MAX_IMAGE_BYTES + 1));
  assert.match(((await loadImage(big)) as { error: string }).error, /too large/);
  assert.deepEqual([...(await loadImages([shot, shot, ""])).keys()], [shot], "each file once");
});

test("where an image is drawn: Kitty gets the image, other terminals PNG blocks, and otherwise a line saying where it is", async () => {
  const png = (await loadImage(shot)) as LoadedImage;
  terminal("kitty");
  const kitty = imageLines(png, 30, 12);
  assert.ok(kitty[0]!.startsWith("\x1b_G"), "the Kitty graphics sequence");
  assert.ok(kitty.length <= 12 && kitty.length >= 2);
  assert.equal(stripTerminalSequences(kitty.at(-1)!), "sidebar.png · 40×30 PNG");
  terminal("iterm2");
  const blocks = imageLines(png, 30, 12);
  assert.match(blocks[0]!, /▀/);
  assert.equal(visibleWidth(blocks[0]!), 30);
  imageLines(png, 30, 12);
  assert.equal(png.blocks?.size, 1, "drawn once for a size, then reused");
  terminal(null);
  assert.match(stripTerminalSequences(imageLines((await loadImage(jpeg)) as LoadedImage, 30, 12)[0]!), /photo\.jpg · 80×60 JPEG: only PNG images can be drawn in this terminal; open .*photo\.jpg to see it/);
  process.env.BOT_LOBBY_IMAGES = "off";
  try {
    assert.match(stripTerminalSequences(imageLines(png, 30, 12)[0]!), /^sidebar\.png · 40×30 PNG: open .* to see it$/);
  } finally {
    delete process.env.BOT_LOBBY_IMAGES;
  }
  assert.match(stripTerminalSequences(imageLines({ path: "/x/gone.png", error: "no such file" }, 30, 12)[0]!), /^Image not shown: gone\.png: no such file$/);
});

const layout: AskQuestion = {
  question: "Which layout?",
  header: "Layout",
  options: [
    { label: "Sidebar (Recommended)", preview: "Nav on the **left**.", image: shot },
    { label: "Top bar", preview: "┌────┐\n├────┤" },
  ],
};

test("the preview box draws the focused option's image above its Markdown, beside the options or under them, never wider than the box", async () => {
  const images = await loadImages([shot]);
  for (const images_ of ["kitty", null] as const) {
    terminal(images_);
    for (const width of [120, 70]) {
      const lines = renderAsk(initialState([layout]), width, 40, undefined, { images });
      assert.ok(lines.every((line) => visibleWidth(line) === width), `exactly ${width} wide (${images_})`);
      const text = lines.map((line) => stripTerminalSequences(line)).join("\n");
      assert.match(text, /Preview · Sidebar[\s\S]*sidebar\.png · 40×30 PNG[\s\S]*Nav on the \*\*left\*\*\./);
      if (images_ === "kitty") assert.ok(lines.some((line) => line.includes("\x1b_G")));
      else assert.ok(lines.some((line) => line.includes("▀")));
    }
  }
  terminal(null);
  const small = renderAsk(initialState([layout]), 120, 12, undefined, { images }).map((line) => stripTerminalSequences(line)).join("\n");
  assert.match(small, /Image: sidebar\.png \(the terminal is too small to draw it\)/);
  const unread = renderAsk(initialState([layout]), 120, 40).map((line) => stripTerminalSequences(line)).join("\n");
  assert.match(unread, new RegExp(`Image: ${shot.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`), "not read: its path");
});

test("askUser reads option images (relative to the project) before the questionnaire opens; the plain dialogs name the file", async () => {
  let drawn = "";
  const ctx = {
    hasUI: true,
    cwd: dir,
    ui: {
      custom: async (factory: (tui: unknown, theme: unknown, keys: unknown, done: (result: AskResult) => void) => { render(width: number): string[]; handleInput(data: string): void }) =>
        new Promise<AskResult>((resolve) => {
          const piTheme = { fg: (_c: string, t: string) => t, bold: (t: string) => t, italic: (t: string) => t, bg: (_c: string, t: string) => t, strikethrough: (t: string) => t };
          const dialog = factory({ requestRender: () => {}, terminal: { rows: 40 } }, piTheme, undefined, resolve);
          drawn = dialog.render(120).map((line) => stripTerminalSequences(line)).join("\n");
          dialog.handleInput("\r");
        }),
    },
  } as unknown as ExtensionContext;
  terminal(null);
  initTheme("dark", false);
  const relative = { ...layout, options: [{ ...layout.options[0]!, image: "sidebar.png" }, layout.options[1]!] };
  const result = await askUser([relative], ctx, undefined, "DESIGN");
  assert.equal(result.answers[0]!.answer, "Sidebar (Recommended)");
  assert.match(drawn, /DESIGN asks · Question[\s\S]*sidebar\.png · 40×30 PNG/);
  const titles: string[] = [];
  await dialogAsker([layout], { hasUI: true, ui: { select: async (title: string, options: string[]) => (titles.push(title), options[0]) } } as unknown as ExtensionContext);
  assert.match(titles[0]!, /\(Sidebar \(Recommended\): see the image .*sidebar\.png\)/);
});

test("an option's image must be an image file", () => {
  assert.match(invalidQuestions([{ ...layout, options: [{ label: "A", image: "mock.svg" }, { label: "B" }] }])!, /the image for "A" must be a \.png, \.jpg, \.gif or \.webp file/);
  assert.equal(invalidQuestions([layout]), undefined);
});
