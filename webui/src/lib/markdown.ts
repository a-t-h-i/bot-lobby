/**
 * Pure helpers for rendering model text. Kept free of React and of
 * `react-markdown` so the root `node:test` suite can import it directly; the
 * page's `ui/Markdown.tsx` is the only place model text becomes elements.
 */

/** The URL schemes a link may use; everything else (javascript:, data:, …) is dropped. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"])

/** A URL safe to put in an `href`: relative links and a small protocol allow-list; otherwise an empty string. */
export function safeHref(href: string): string {
  const value = (href ?? "").trim()
  if (value === "") return ""
  if (/^[#/.]/.test(value)) return value
  try {
    const url = new URL(value, "https://example.invalid")
    return SAFE_PROTOCOLS.has(url.protocol) ? value : ""
  } catch {
    return ""
  }
}

/** Past this many characters a text renders in sections, so React can pause between them instead of building it in one frame. */
const LONG = 4000
const FENCE = /^\s*(?:```|~~~)/
const HEADING = /^#{1,6}\s/
/** Reference links and footnotes resolve across the whole text, so a text that has them stays whole. */
const CROSS_REFERENCE = /^\s{0,3}\[[^\]]+\]:\s*\S|\[\^[^\]]+\]/m

/** A long text cut before each heading outside a code fence; a short one, or one with reference links, whole. */
export function markdownSections(text: string): string[] {
  if (text.length <= LONG || CROSS_REFERENCE.test(text)) return [text]
  const sections: string[] = []
  let current: string[] = []
  let fenced = false
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced
    else if (!fenced && HEADING.test(line) && current.some((entry) => entry.trim())) {
      sections.push(current.join("\n"))
      current = []
    }
    current.push(line)
  }
  sections.push(current.join("\n"))
  return sections
}
