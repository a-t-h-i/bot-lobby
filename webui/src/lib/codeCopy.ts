export interface SourcePosition { start?: { offset?: number }; end?: { offset?: number } }

/** Preserve the literal source inside delimiters, including escapes and final newlines. */
export function codeSource(source: string, position?: SourcePosition, fenced = false): string | undefined {
  const start = position?.start?.offset, end = position?.end?.offset
  if (start === undefined || end === undefined) return undefined
  const raw = source.slice(start, end)
  if (!fenced) {
    const delimiter = raw.match(/^`+/)?.[0]
    return delimiter && raw.endsWith(delimiter) ? raw.slice(delimiter.length, -delimiter.length) : raw
  }
  const opening = raw.match(/^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r\n|\n|\r)/)
  if (!opening) return raw
  const body = raw.slice(opening[0].length)
  const closing = new RegExp(`^ {0,3}${opening[1]![0]}{${opening[1]!.length},}[ \\t]*$`, "m")
  const match = closing.exec(body)
  return match ? body.slice(0, match.index) : body
}

export function shouldCopy(selection: string, moved: boolean): boolean { return !selection && !moved }

export async function writeCode(text: string, clipboard?: { writeText(text: string): Promise<void> }): Promise<void> {
  if (!clipboard) throw new Error("Clipboard is unavailable. Select the code and copy it manually.")
  await clipboard.writeText(text)
}
