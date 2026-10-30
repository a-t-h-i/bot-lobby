/**
 * The composer's Markdown, styled as you type: the text split into runs, each with the kinds that style it
 * (`strong`, `em`, `code`, `heading`, the `mark` of a `**` or a `#`…). The runs are drawn in a layer behind the
 * message box, whose own text is clear, so every run must keep the text's exact widths: the styles are colour,
 * tints, lines and a stroke for bold, never a different size or face. Nothing is taken out: the `**` stays, faint.
 */

export interface MarkdownRun {
  text: string
  /** Space-separated kinds; empty for plain text. */
  kind: string
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const HEADING = /^(\s{0,3}#{1,6})(\s+)(.*)$/
const QUOTE = /^(\s{0,3}>[>\s]*)(.*)$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s)?(.*)$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

// Code first, so nothing inside backticks is read as emphasis; then links, bold, strike, italics, bare links, @names.
const INLINE =
  /(`+)([^`\n]+?)\1|\[([^\]\n]+)\]\(([^)\s]+)\)|(\*\*|__)(?=\S)([^\n]*?\S)\5|(~~)(?=\S)([^\n]*?\S)~~|(?<![\w*])(\*)(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)|(?<![\w_])(_)(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(?<![\w@])(@[a-z][\w-]*)/gi

function push(runs: MarkdownRun[], text: string, kind: string) {
  if (!text) return
  const last = runs.at(-1)
  if (last && last.kind === kind) last.text += text
  else runs.push({ text, kind })
}

const join = (...kinds: string[]) => kinds.filter(Boolean).join(" ")

function inline(runs: MarkdownRun[], text: string, base: string) {
  let at = 0
  for (const match of text.matchAll(INLINE)) {
    const start = match.index
    push(runs, text.slice(at, start), base)
    const [whole, ticks, code, label, url, bold, boldText, strike, strikeText, star, starText, under, underText, bare, mention] = match
    if (ticks) {
      push(runs, ticks, join(base, "code", "mark"))
      push(runs, code!, join(base, "code"))
      push(runs, ticks, join(base, "code", "mark"))
    } else if (label) {
      push(runs, "[", join(base, "mark"))
      push(runs, label, join(base, "link"))
      push(runs, `](${url})`, join(base, "mark"))
    } else if (bold) {
      push(runs, bold, join(base, "mark"))
      inline(runs, boldText!, join(base, "strong"))
      push(runs, bold, join(base, "mark"))
    } else if (strike) {
      push(runs, strike, join(base, "mark"))
      inline(runs, strikeText!, join(base, "strike"))
      push(runs, strike, join(base, "mark"))
    } else if (star || under) {
      const mark = star ?? under!
      push(runs, mark, join(base, "mark"))
      inline(runs, (starText ?? underText)!, join(base, "em"))
      push(runs, mark, join(base, "mark"))
    } else if (bare) {
      push(runs, bare, join(base, "link"))
    } else if (mention) {
      push(runs, mention, join(base, "mention"))
    } else {
      push(runs, whole, base)
    }
    at = start + whole.length
  }
  push(runs, text.slice(at), base)
}

/** The runs of `text`, which joined give back `text` exactly. */
export function markdownRuns(text: string): MarkdownRun[] {
  const runs: MarkdownRun[] = []
  let fence: string | undefined
  const lines = text.split("\n")
  lines.forEach((line, index) => {
    if (index > 0) push(runs, "\n", "")
    const opens = FENCE.exec(line)
    if (fence !== undefined) {
      if (opens && opens[1]!.startsWith(fence)) {
        fence = undefined
        push(runs, line, "codeblock mark")
      } else push(runs, line, "codeblock")
      return
    }
    if (opens) {
      fence = opens[1]![0]!.repeat(3)
      push(runs, line, "codeblock mark")
      return
    }
    if (index === 0 && /^\/[a-z][\w-]*/i.test(line)) {
      const command = /^\/[a-z][\w-]*/i.exec(line)![0]
      push(runs, command, "mention")
      inline(runs, line.slice(command.length), "")
      return
    }
    if (RULE.test(line)) return push(runs, line, "mark")
    const heading = HEADING.exec(line)
    if (heading) {
      push(runs, heading[1]! + heading[2]!, "heading mark")
      return inline(runs, heading[3]!, "heading")
    }
    const quote = QUOTE.exec(line)
    if (quote) {
      push(runs, quote[1]!, "quote mark")
      return inline(runs, quote[2]!, "quote")
    }
    const list = LIST.exec(line)
    if (list) {
      push(runs, list[1]!, "")
      push(runs, list[2]!, "list")
      push(runs, list[3]!, "")
      if (list[4]) push(runs, list[4], "list")
      return inline(runs, list[5]!, "")
    }
    inline(runs, line, "")
  })
  return runs
}
