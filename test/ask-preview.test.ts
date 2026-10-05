import { test } from "node:test";
import assert from "node:assert/strict";
import { validHtmlPreview, MAX_PREVIEW_HTML, MAX_PREVIEW_CSS } from "../src/ask/types.ts";
import { readRelayRequest, RELAY_TITLE } from "../src/ask/relay.ts";

const relay = (htmlPreview: unknown) => readRelayRequest(RELAY_TITLE, JSON.stringify({ questions: [{ question: "Which layout?", header: "Layout", options: [{ label: "A", preview: "**Markdown**", image: "a.png", htmlPreview }, { label: "B" }] }] }));

test("explicit HTML/CSS preview retains exact source alongside Markdown and image", () => {
  const htmlPreview = { html: " <div>Static\ncontent</div> ", css: "div { color: red; }\n" };
  assert.deepEqual(relay(htmlPreview)![0]!.options[0], { label: "A", preview: "**Markdown**", image: "a.png", htmlPreview });
  assert.equal(validHtmlPreview({ html: "x".repeat(MAX_PREVIEW_HTML), css: "x".repeat(MAX_PREVIEW_CSS) }), true);
});

test("relay rejects oversized, malformed or extra-field explicit previews", () => {
  for (const preview of [{ html: 1 }, { html: "x", css: [] }, { html: "x", scripts: true }, { html: "x".repeat(MAX_PREVIEW_HTML + 1) }, { html: "x", css: "x".repeat(MAX_PREVIEW_CSS + 1) }, null]) {
    assert.equal(validHtmlPreview(preview), false);
    assert.equal(relay(preview), undefined);
  }
});
