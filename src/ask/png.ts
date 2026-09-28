/**
 * A small PNG decoder: every colour type and bit depth, interlaced or not,
 * into 8-bit RGBA. Enough to draw a screenshot as coloured blocks in any
 * terminal; no dependency (zlib is Node's).
 */
import { inflateSync } from "node:zlib";

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row by row. */
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Larger images are not decoded (a screenshot is far smaller). */
const MAX_PIXELS = 50_000_000;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Adam7: each pass's first column and row, and the steps between them. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((value, index) => bytes[index] === value);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Undo the per-row filters of one (sub)image in place, returning its raw rows. */
function unfilter(source: Uint8Array, offset: number, rowBytes: number, rows: number, bpp: number): { rows: Uint8Array[]; next: number } {
  const out: Uint8Array[] = [];
  let previous = new Uint8Array(rowBytes);
  let at = offset;
  for (let row = 0; row < rows; row += 1) {
    if (at + 1 + rowBytes > source.length) throw new Error("the PNG image data is cut short");
    const filter = source[at]!;
    const line = source.slice(at + 1, at + 1 + rowBytes);
    at += 1 + rowBytes;
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= bpp ? line[index - bpp]! : 0;
      const up = previous[index]!;
      const corner = index >= bpp ? previous[index - bpp]! : 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          line[index] = (line[index]! + left) & 255;
          break;
        case 2:
          line[index] = (line[index]! + up) & 255;
          break;
        case 3:
          line[index] = (line[index]! + ((left + up) >> 1)) & 255;
          break;
        case 4:
          line[index] = (line[index]! + paeth(left, up, corner)) & 255;
          break;
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
    }
    out.push(line);
    previous = line;
  }
  return { rows: out, next: at };
}

/** Decode a PNG into RGBA pixels; throws with a reason when it cannot. */
export function decodePng(bytes: Uint8Array): Pixels {
  if (!isPng(bytes)) throw new Error("not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let depth = 8;
  let type = 6;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let alphas: Uint8Array | undefined;
  let transparent: number[] | undefined;
  const data: Uint8Array[] = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (name === "IHDR") {
      const header = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = header.getUint32(0);
      height = header.getUint32(4);
      depth = body[8]!;
      type = body[9]!;
      interlace = body[12]!;
    } else if (name === "PLTE") palette = body;
    else if (name === "tRNS") {
      if (type === 3) alphas = body;
      else if (type === 0 && body.length >= 2) transparent = [(body[0]! << 8) | body[1]!];
      else if (type === 2 && body.length >= 6) transparent = [(body[0]! << 8) | body[1]!, (body[2]! << 8) | body[3]!, (body[4]! << 8) | body[5]!];
    } else if (name === "IDAT") data.push(body);
    else if (name === "IEND") break;
  }
  const channels = CHANNELS[type];
  if (!width || !height || channels === undefined) throw new Error("the PNG header is missing or unsupported");
  if (width * height > MAX_PIXELS) throw new Error(`the PNG is too large to draw (${width}×${height})`);
  if (type === 3 && !palette) throw new Error("the PNG palette is missing");
  const joined = new Uint8Array(data.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of data) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const raw = inflateSync(joined);
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const out = new Uint8Array(width * height * 4);
  const max = (1 << depth) - 1;

  const sample = (row: Uint8Array, index: number): number => {
    if (depth === 8) return row[index]!;
    if (depth === 16) return (row[index * 2]! << 8) | row[index * 2 + 1]!;
    const bit = index * depth;
    return (row[bit >> 3]! >> (8 - depth - (bit & 7))) & max;
  };
  const to8 = (value: number) => (depth === 16 ? value >> 8 : depth === 8 ? value : Math.round((value * 255) / max));

  const put = (rowData: Uint8Array, column: number, x: number, y: number) => {
    const target = (y * width + x) * 4;
    const base = column * channels;
    if (type === 3) {
      const index = sample(rowData, column);
      out[target] = palette![index * 3] ?? 0;
      out[target + 1] = palette![index * 3 + 1] ?? 0;
      out[target + 2] = palette![index * 3 + 2] ?? 0;
      out[target + 3] = alphas?.[index] ?? 255;
      return;
    }
    const values = Array.from({ length: channels }, (_, channel) => sample(rowData, base + channel));
    const gray = type === 0 || type === 4;
    const [r, g, b] = gray ? [values[0]!, values[0]!, values[0]!] : [values[0]!, values[1]!, values[2]!];
    const alpha = type === 4 ? to8(values[1]!) : type === 6 ? to8(values[3]!) : 255;
    const clear = transparent && (gray ? values[0] === transparent[0] : values[0] === transparent[0] && values[1] === transparent[1] && values[2] === transparent[2]);
    out[target] = to8(r);
    out[target + 1] = to8(g);
    out[target + 2] = to8(b);
    out[target + 3] = clear ? 0 : alpha;
  };

  if (interlace === 0) {
    const { rows } = unfilter(raw, 0, Math.ceil((width * bitsPerPixel) / 8), height, bpp);
    rows.forEach((row, y) => {
      for (let x = 0; x < width; x += 1) put(row, x, x, y);
    });
  } else {
    let at = 0;
    for (const [x0, y0, dx, dy] of ADAM7) {
      const passWidth = Math.ceil((width - x0) / dx);
      const passHeight = Math.ceil((height - y0) / dy);
      if (passWidth <= 0 || passHeight <= 0) continue;
      const pass = unfilter(raw, at, Math.ceil((passWidth * bitsPerPixel) / 8), passHeight, bpp);
      at = pass.next;
      pass.rows.forEach((row, py) => {
        for (let px = 0; px < passWidth; px += 1) put(row, px, x0 + px * dx, y0 + py * dy);
      });
    }
  }
  return { width, height, data: out };
}
