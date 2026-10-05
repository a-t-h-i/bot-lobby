/**
 * A thought as steps instead of one block of text. A model's thinking comes
 * as headed sections (`**Checking the router**` on a line of its own, or a
 * Markdown heading), as paragraphs, or as one long run of sentences; each
 * becomes a step, a long paragraph split every couple of sentences. Lists and
 * code stay whole inside their step, and nothing is reworded.
 */

export interface ThoughtStep {
  /** The section's own heading, when the thought gave one. */
  title?: string
  /** Markdown. */
  text: string
}

/** A line that is only a heading: `## Title`, `**Title**` or `__Title__` (a trailing colon allowed). */
const HEADING = /^\s*(?:#{1,6}\s+(.+?)\s*#*|\*\*([^*\n]{2,90}?):?\*\*:?|__([^_\n]{2,90}?):?__:?)\s*$/

/** A paragraph long enough to read as a wall, and how much one step holds. */
const LONG = 260
const STEP = 200

const LIST_OR_CODE = /^\s*(?:[-*+]\s|\d+[.)]\s|>|```|~~~|\|)/m

/** The blank-line paragraphs of a section, a fenced block kept whole even across blank lines. */
function paragraphs(lines: string[]): string[] {
  const out: string[] = []
  let current: string[] = []
  let fenced = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (!fenced && !line.trim()) {
      if (current.length) out.push(current.join("\n").trim())
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length) out.push(current.join("\n").trim())
  return out.filter(Boolean)
}

/** Sentences end at `.`, `!`, `?` or `…` before a space and a capital, a quote or a bracket; `e.g. this` and `index.ts` stay put. */
function sentences(paragraph: string): string[] {
  const parts = paragraph.split(/(?<=[.!?…])\s+(?=[A-Z"'“‘`(\[])/)
  // A split inside inline code is undone.
  const out: string[] = []
  for (const part of parts) {
    const previous = out.at(-1)
    if (previous !== undefined && (previous.split("`").length - 1) % 2 === 1) out[out.length - 1] = `${previous} ${part}`
    else out.push(part)
  }
  return out
}

/** A long run of prose as steps of a sentence or two each. */
function split(paragraph: string): string[] {
  if (paragraph.length <= LONG || LIST_OR_CODE.test(paragraph)) return [paragraph]
  const steps: string[] = []
  let current = ""
  for (const sentence of sentences(paragraph.replace(/\s*\n\s*/g, " "))) {
    if (current && current.length + sentence.length + 1 > STEP) {
      steps.push(current)
      current = sentence
    } else current = current ? `${current} ${sentence}` : sentence
  }
  if (current) steps.push(current)
  return steps
}

export function thoughtSteps(text: string): ThoughtStep[] {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n")
  const sections: Array<{ title?: string; lines: string[] }> = [{ lines: [] }]
  let fenced = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = fenced ? null : HEADING.exec(line)
    const title = heading ? (heading[1] ?? heading[2] ?? heading[3])?.trim() : undefined
    if (title) sections.push({ title, lines: [] })
    else sections.at(-1)!.lines.push(line)
  }
  const steps: ThoughtStep[] = []
  for (const section of sections) {
    const body = paragraphs(section.lines)
    if (section.title) steps.push({ title: section.title, text: body.join("\n\n") })
    else for (const paragraph of body) for (const step of split(paragraph)) steps.push({ text: step })
  }
  return steps
}
