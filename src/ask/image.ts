/**
 * Images in the questionnaire: a screenshot or rendered mockup an option
 * carries, drawn in its preview. Terminals that speak the Kitty graphics
 * protocol (Kitty, Ghostty, WezTerm) get the image itself; everywhere else a
 * PNG is drawn with coloured half-blocks, which any colour terminal shows and
 * which sit in a box like text. Other formats there get a line saying what
 * and where the file is. `BOT_LOBBY_IMAGES=blocks` always draws blocks;
 * `off` never draws images.
 */
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { getCapabilities, getImageDimensions, renderImage, type ImageDimensions } from "@earendil-works/pi-tui";
import { paint, type LobbyTheme } from "../lobby/layout.ts";
import { decodePng, type Pixels } from "./png.ts";

/** Larger files are not read. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface LoadedImage {
  path: string;
  mime: ImageMime;
  base64: string;
  dimensions: ImageDimensions;
  /** Decoded on first use, for the half-block drawing (PNG only). */
  pixels?: Pixels | string;
  /** Kitty reuses one id per image so a redraw replaces it. */
  kittyId?: number;
  /** Half-block drawings already made, by size: every key press redraws the questionnaire. */
  blocks?: Map<string, string[]>;
}

/** An image option whose file could not be read, and why. */
export interface MissingImage {
  path: string;
  error: string;
}

export type ImagePreview = LoadedImage | MissingImage;

const EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;

export function isImagePath(path: string): boolean {
  return EXTENSIONS.test(path.trim());
}

function sniff(bytes: Uint8Array): ImageMime | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return undefined;
}

/** Read an option's image file: a PNG, JPEG, GIF or WebP of at most 10 MB. */
export async function loadImage(path: string): Promise<ImagePreview> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return { path, error: "not a file" };
    if (info.size > MAX_IMAGE_BYTES) return { path, error: `too large to show (${Math.round(info.size / 1024 / 1024)} MB)` };
    const bytes = new Uint8Array(await readFile(path));
    const mime = sniff(bytes);
    if (!mime) return { path, error: "not a PNG, JPEG, GIF or WebP image" };
    const base64 = Buffer.from(bytes).toString("base64");
    const dimensions = getImageDimensions(base64, mime) ?? { widthPx: 800, heightPx: 600 };
    return { path, mime, base64, dimensions };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { path, error: code === "ENOENT" ? "no such file" : error instanceof Error ? error.message : String(error) };
  }
}

/** Every option image the questions carry, read once before the questionnaire opens. */
export async function loadImages(paths: readonly string[]): Promise<Map<string, ImagePreview>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const loaded = await Promise.all(unique.map((path) => loadImage(path)));
  return new Map(unique.map((path, index) => [path, loaded[index]!]));
}

type Mode = "native" | "blocks" | "off";

function mode(): Mode {
  const chosen = (process.env.BOT_LOBBY_IMAGES ?? "").trim().toLowerCase();
  if (chosen === "off" || chosen === "blocks") return chosen;
  return getCapabilities().images === "kitty" ? "native" : "blocks";
}

function pixelsOf(image: LoadedImage): Pixels | string {
  if (image.pixels === undefined) {
    if (image.mime !== "image/png") image.pixels = "only PNG images can be drawn in this terminal";
    else {
      try {
        image.pixels = decodePng(Buffer.from(image.base64, "base64"));
      } catch (error) {
        image.pixels = error instanceof Error ? error.message : String(error);
      }
    }
  }
  return image.pixels;
}

/** The cell grid an image fits in: at most `columns` × `rows`, its aspect kept (a cell is about twice as tall as wide). */
function fitCells(dimensions: ImageDimensions, columns: number, rows: number): { columns: number; rows: number } {
  const aspect = dimensions.heightPx / Math.max(1, dimensions.widthPx);
  let width = Math.max(1, columns);
  let height = Math.max(1, Math.round((width * aspect) / 2));
  if (height > rows) {
    height = Math.max(1, rows);
    width = Math.max(1, Math.min(columns, Math.round((height * 2) / aspect)));
  }
  return { columns: width, rows: height };
}

/** Average the pixels of one block of the image, over the box's dark background where they are see-through. */
function averageColor(pixels: Pixels, x0: number, y0: number, x1: number, y1: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const backdrop = 24;
  for (let y = y0; y < Math.max(y1, y0 + 1); y += 1) {
    for (let x = x0; x < Math.max(x1, x0 + 1); x += 1) {
      const at = (Math.min(y, pixels.height - 1) * pixels.width + Math.min(x, pixels.width - 1)) * 4;
      const alpha = pixels.data[at + 3]! / 255;
      r += pixels.data[at]! * alpha + backdrop * (1 - alpha);
      g += pixels.data[at + 1]! * alpha + backdrop * (1 - alpha);
      b += pixels.data[at + 2]! * alpha + backdrop * (1 - alpha);
      count += 1;
    }
  }
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

/** Colour escape for a cell's foreground or background: 24-bit where the terminal has it, else the nearest of the 256. */
function colour(rgb: [number, number, number], background: boolean, trueColor: boolean): string {
  const [r, g, b] = rgb;
  if (trueColor) return `\x1b[${background ? 48 : 38};2;${r};${g};${b}m`;
  const level = (value: number) => (value < 48 ? 0 : value < 115 ? 1 : Math.min(5, Math.floor((value - 35) / 40)));
  return `\x1b[${background ? 48 : 38};5;${16 + 36 * level(r) + 6 * level(g) + level(b)}m`;
}

/** An image as rows of half-blocks: each cell's upper half is the foreground colour, its lower half the background. */
export function halfBlocks(pixels: Pixels, columns: number, rows: number, trueColor = true): string[] {
  const cells = fitCells({ widthPx: pixels.width, heightPx: pixels.height }, columns, rows);
  const lines: string[] = [];
  const stepX = pixels.width / cells.columns;
  const stepY = pixels.height / (cells.rows * 2);
  for (let row = 0; row < cells.rows; row += 1) {
    let line = "";
    for (let column = 0; column < cells.columns; column += 1) {
      const x0 = Math.floor(column * stepX);
      const x1 = Math.floor((column + 1) * stepX);
      const top = averageColor(pixels, x0, Math.floor(row * 2 * stepY), x1, Math.floor((row * 2 + 1) * stepY));
      const bottom = averageColor(pixels, x0, Math.floor((row * 2 + 1) * stepY), x1, Math.floor((row * 2 + 2) * stepY));
      line += `${colour(top, false, trueColor)}${colour(bottom, true, trueColor)}▀`;
    }
    lines.push(`${line}\x1b[0m`);
  }
  return lines;
}

function describe(preview: ImagePreview): string {
  if ("error" in preview) return `${basename(preview.path)}: ${preview.error}`;
  return `${basename(preview.path)} · ${preview.dimensions.widthPx}×${preview.dimensions.heightPx} ${preview.mime.slice(6).toUpperCase()}`;
}

/**
 * An option's image drawn in at most `columns` × `rows` cells, with a caption
 * line under it naming the file; or, where it cannot be drawn, lines saying
 * what and where it is.
 */
export function imageLines(preview: ImagePreview, columns: number, rows: number, theme?: LobbyTheme): string[] {
  const caption = paint(theme, "dim", describe(preview));
  if ("error" in preview) return [paint(theme, "warning", `Image not shown: ${describe(preview)}`)];
  const room = Math.max(1, rows - 1);
  const how = mode();
  if (how === "native") {
    const size = fitCells(preview.dimensions, columns, room);
    const drawn = renderImage(preview.base64, preview.dimensions, { maxWidthCells: size.columns, maxHeightCells: size.rows, moveCursor: false, ...(preview.kittyId ? { imageId: preview.kittyId } : {}) });
    if (drawn) {
      if (drawn.imageId) preview.kittyId = drawn.imageId;
      return [drawn.sequence, ...Array.from({ length: Math.max(0, drawn.rows - 1) }, () => ""), caption];
    }
  }
  if (how !== "off") {
    const pixels = pixelsOf(preview);
    if (typeof pixels !== "string") {
      const trueColor = getCapabilities().trueColor !== false;
      const key = `${columns}x${room}:${trueColor}`;
      preview.blocks ??= new Map();
      let drawn = preview.blocks.get(key);
      if (!drawn) {
        drawn = halfBlocks(pixels, columns, room, trueColor);
        preview.blocks.set(key, drawn);
      }
      return [...drawn, caption];
    }
    return [paint(theme, "muted", `${describe(preview)}: ${pixels}; open ${preview.path} to see it`)];
  }
  return [paint(theme, "muted", `${describe(preview)}: open ${preview.path} to see it`)];
}
