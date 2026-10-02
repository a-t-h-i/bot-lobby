/**
 * Markdown from models and people, made safe to show: parsed with marked,
 * then sanitized with DOMPurify. Raw HTML in the text never runs, links open
 * in a new tab without a referrer, and images load only from this server (the
 * page's CSP blocks the rest anyway), so a reply cannot phone home.
 */
import DOMPurify from "dompurify";
import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: false, async: false });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src") ?? "";
    if (!src.startsWith("/") || src.startsWith("//")) node.removeAttribute("src");
  }
  // Wide tables scroll inside their own box instead of the page.
  if (node.tagName === "TABLE") node.setAttribute("data-wide", "");
  // A code block's language, shown after its opening fence as the terminal does (```css); a plain word only.
  if (node.tagName === "PRE") {
    const lang = /(?:^|\s)language-([\w+#.-]{1,20})(?:\s|$)/.exec(node.firstElementChild?.getAttribute("class") ?? "")?.[1];
    if (lang) node.setAttribute("data-lang", lang);
  }
});

export function renderMarkdown(text: string): string {
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
}
