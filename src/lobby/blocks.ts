/**
 * Plain Markdown helpers the lobby shares: model text with escaped line
 * breaks made real, and a reply split into blocks that can be rendered one by
 * one (the page renders them, not the terminal).
 */

/**
 * Line breaks a model wrote out as `\n` (text escaped twice on its way here,
 * so a whole plan arrives as one line): made real when the text has no real
 * line break at all, outside inline code, where `\n` is usually meant.
 */
export function unescapeBreaks(text: string): string {
  if (text.includes("\n") || !text.includes("\\n")) return text;
  return text
    .split(/(`[^`\n]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/(?:\\r)?\\n/g, "\n")))
    .join("");
}

/** A fenced code block's opening or closing line. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A list item's first line: after a blank line it continues the list above, so blocks never split there. */
const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

/**
 * Markdown split into blocks that render, one by one, into the same output as
 * the whole (each block's lines, a blank line between blocks, blocks that
 * render to nothing left out). A split falls on a blank line outside code
 * fences that is followed by an unindented line that does not start a list
 * item — the only places where one block can never run into the next. A
 * streaming reply can then keep its finished blocks rendered and render only
 * the one still being written.
 */
export function markdownBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let fence: string | undefined;
  let start = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence || line.trim() || index === 0) continue;
    const next = lines[index + 1];
    if (next === undefined || !/^\S/.test(next) || LIST_ITEM.test(next)) continue;
    const block = lines.slice(start, index).join("\n");
    if (block.trim()) blocks.push(block);
    start = index + 1;
  }
  const last = lines.slice(start).join("\n");
  if (last.trim()) blocks.push(last);
  return blocks;
}
