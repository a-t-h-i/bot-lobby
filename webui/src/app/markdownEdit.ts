/**
 * Markdown helpers for the message box: wrap the selection in `**`, `_` or a
 * code mark, make a link, and carry a list on when Shift+Enter ends a list
 * line. Pure: each takes the text and the selection and returns the new text
 * and selection.
 */

export interface Edit {
  value: string
  start: number
  end: number
}

/** Wrap the selection in `mark` (or take the mark off when it is already wrapped); an empty selection leaves the cursor between two marks. */
export function wrap(value: string, start: number, end: number, mark: string): Edit {
  const before = value.slice(0, start)
  const picked = value.slice(start, end)
  const after = value.slice(end)
  if (picked.length >= mark.length * 2 && picked.startsWith(mark) && picked.endsWith(mark)) {
    const inner = picked.slice(mark.length, picked.length - mark.length)
    return { value: before + inner + after, start, end: start + inner.length }
  }
  if (before.endsWith(mark) && after.startsWith(mark)) {
    return { value: before.slice(0, before.length - mark.length) + picked + after.slice(mark.length), start: start - mark.length, end: end - mark.length }
  }
  return { value: before + mark + picked + mark + after, start: start + mark.length, end: end + mark.length }
}

/** `[selection](url)` with `url` selected for typing over. */
export function link(value: string, start: number, end: number): Edit {
  const picked = value.slice(start, end) || "text"
  const text = `[${picked}](url)`
  const urlStart = start + picked.length + 3
  return { value: value.slice(0, start) + text + value.slice(end), start: urlStart, end: urlStart + 3 }
}

const LIST = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/

/**
 * Shift+Enter at `at` on a list line: a new line with the next marker, or (on a
 * marker with nothing after it) the marker removed to end the list. `undefined`
 * when the line is not a list line, so a plain new line is used.
 */
export function continueList(value: string, at: number): Edit | undefined {
  const lineStart = value.lastIndexOf("\n", at - 1) + 1
  const lineEnd = value.indexOf("\n", at)
  const line = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd)
  const match = LIST.exec(line)
  if (!match || at - lineStart < match[0].length) return undefined
  const [whole, indent = "", bullet, digits, delimiter = ".", task] = match
  if (line.slice(whole.length).trim() === "") {
    const next = value.slice(0, lineStart) + value.slice(lineEnd < 0 ? value.length : lineEnd)
    return { value: next, start: lineStart, end: lineStart }
  }
  const marker = bullet ?? `${Number(digits) + 1}${delimiter}`
  const insert = `\n${indent}${marker} ${task ? "[ ] " : ""}`
  return { value: value.slice(0, at) + insert + value.slice(at), start: at + insert.length, end: at + insert.length }
}
