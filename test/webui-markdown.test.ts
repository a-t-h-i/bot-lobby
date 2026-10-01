/**
 * The model-text fence (D-10): raw HTML is never enabled where the page
 * renders model text. `rehype-raw` must not appear anywhere in `webui/src`,
 * and `dangerouslySetInnerHTML` is fenced to the one Markdown component.
 * `safeHref` is checked directly, since the component itself cannot run under
 * `node:test` without a JSX transform.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { safeHref } from "../webui/src/lib/markdown.ts";

const WEBUI = join(fileURLToPath(new URL(".", import.meta.url)), "..", "webui", "src");
const MARKDOWN_COMPONENT = "ui/Markdown.tsx";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

test("raw HTML is never enabled for model text: no rehype-raw, dangerouslySetInnerHTML fenced to Markdown", () => {
  const files = sources(WEBUI);
  assert.ok(files.length > 0, "the webui sources are found");
  for (const file of files) {
    const name = relative(WEBUI, file).split("\\").join("/");
    const text = readFileSync(file, "utf8");
    assert.equal(/rehype-raw/.test(text), false, `rehype-raw must not appear in ${name}`);
    if (text.includes("dangerouslySetInnerHTML")) {
      assert.equal(name, MARKDOWN_COMPONENT, `dangerouslySetInnerHTML is fenced to ${MARKDOWN_COMPONENT}, seen in ${name}`);
    }
  }
});

test("the one Markdown component uses react-markdown + remark-gfm and opens links in a new tab", () => {
  const text = readFileSync(join(WEBUI, MARKDOWN_COMPONENT), "utf8");
  assert.match(text, /from "react-markdown"/);
  assert.match(text, /from "remark-gfm"/);
  assert.match(text, /rel="noopener noreferrer nofollow"/);
  assert.equal(/rehype-raw/.test(text), false);
});

test("safeHref drops dangerous schemes and keeps ordinary links", () => {
  assert.equal(safeHref("javascript:alert(1)"), "");
  assert.equal(safeHref("data:text/html,<script>"), "");
  assert.equal(safeHref("vbscript:msgbox(1)"), "");
  assert.equal(safeHref("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeHref("http://example.com"), "http://example.com");
  assert.equal(safeHref("mailto:dev@example.com"), "mailto:dev@example.com");
  assert.equal(safeHref("/files/preview/task/one.png"), "/files/preview/task/one.png");
  assert.equal(safeHref("#section"), "#section");
  assert.equal(safeHref(""), "");
});
