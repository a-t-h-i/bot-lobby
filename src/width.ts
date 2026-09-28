/**
 * Terminal width of styled text, fast. pi-tui's `visibleWidth` segments every
 * string into grapheme clusters, which is exact but slow, and its cache only
 * helps strings seen before: the lobby's rows are new strings every frame
 * (boxes side by side, a clock, a spinner). This scans them instead: ASCII
 * counts one column, escape sequences none, and every other character in the
 * ranges below is measured once with pi-tui (on its own, as the cluster it
 * always is there) and remembered. Anything else — combining marks, variation
 * selectors, joiners, emoji or CJK outside those ranges — goes to pi-tui for
 * the whole string, so the answer is always pi-tui's.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Characters that always stand alone as a cluster: Latin, punctuation, arrows, symbols, box drawing, shapes, braille. */
function standsAlone(code: number): boolean {
  return (code >= 0xa0 && code < 0x300 && code !== 0xad)
    || (code >= 0x2010 && code <= 0x2027)
    || (code >= 0x2030 && code <= 0x205e)
    || (code >= 0x2190 && code <= 0x23ff)
    || (code >= 0x2500 && code <= 0x27bf)
    || (code >= 0x2800 && code <= 0x29ff);
}

/**
 * The length of the escape sequence at `index` that takes no columns, exactly
 * as pi-tui reads them — CSI ending in m, G, K, H or J (parameters only
 * before it), OSC and APC ending in BEL or ST — or 0 for any other.
 */
function escapeLength(text: string, index: number): number {
  const kind = text.charCodeAt(index + 1);
  if (kind === 0x5b) {
    for (let at = index + 2; at < text.length; at += 1) {
      const code = text.charCodeAt(at);
      // m G K H J end it; digits, ; : ? are its parameters; anything else is read differently by pi-tui.
      if (code === 0x6d || code === 0x47 || code === 0x4b || code === 0x48 || code === 0x4a) return at + 1 - index;
      if (!((code >= 0x30 && code <= 0x3b) || code === 0x3f)) return 0;
    }
    return 0;
  }
  if (kind === 0x5d || kind === 0x5f) {
    for (let at = index + 2; at < text.length; at += 1) {
      const code = text.charCodeAt(at);
      if (code === 0x07) return at + 1 - index;
      if (code === 0x1b) return text.charCodeAt(at + 1) === 0x5c ? at + 2 - index : 0;
    }
  }
  return 0;
}

const charWidths = new Map<number, number>();

function scan(text: string): number {
  let width = 0;
  for (let index = 0; index < text.length; ) {
    const code = text.charCodeAt(index);
    if (code >= 0x20 && code < 0x7f) {
      width += 1;
      index += 1;
    } else if (code === 0x1b) {
      const length = escapeLength(text, index);
      if (length === 0) return visibleWidth(text);
      index += length;
    } else {
      if (!standsAlone(code)) return visibleWidth(text);
      let columns = charWidths.get(code);
      if (columns === undefined) {
        columns = visibleWidth(String.fromCharCode(code));
        charWidths.set(code, columns);
      }
      width += columns;
      index += 1;
    }
  }
  return width;
}

/** Widths of recent strings: a frame mostly repeats the last one's lines (a few hundred of them). */
const recent = new Map<string, number>();
const RECENT_LIMIT = 1024;

/** Columns `text` takes in a terminal; the same as pi-tui's `visibleWidth`. */
export function textWidth(text: string): number {
  if (text.length < 16) return scan(text);
  const known = recent.get(text);
  if (known !== undefined) return known;
  const width = scan(text);
  if (recent.size >= RECENT_LIMIT) recent.delete(recent.keys().next().value!);
  recent.set(text, width);
  return width;
}

/**
 * `text` cut to `width` columns (ending in `ellipsis`), padded to it when
 * `pad`: pi-tui's `truncateToWidth`, which walks every character even when
 * the text already fits — checked first here, since most lines do.
 */
export function clip(text: string, width: number, ellipsis = "...", pad = false): string {
  if (width <= 0) return "";
  const columns = textWidth(text);
  if (columns <= width) return pad && columns < width ? `${text}${" ".repeat(width - columns)}` : text;
  return truncateToWidth(text, width, ellipsis, pad);
}
