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
