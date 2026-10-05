import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executionMs, executionWords } from "../webui/src/lib/phaseTiming.ts";
import { codeSource, shouldCopy, writeCode } from "../webui/src/lib/codeCopy.ts";
import { PromptSeen, promptIdentity, dialogIdentity, deliveryIdentity } from "../webui/src/lib/promptSeen.ts";
import { previewPayload, staticCss, staticPreviewDocument, PREVIEW_CSP, type PreviewParser } from "../webui/src/lib/staticPreview.ts";
import { parsePrompt } from "../webui/src/prompts/payload.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

const source = (path: string) => readFileSync(new URL(`../webui/src/${path}`, import.meta.url), "utf8");

test("phase timing uses server anchors plus monotonic deltas, pauses waits and stops terminals", () => {
  const timing = { phase: "implementing", elapsedMs: 2000, runningSince: "2026-10-04T10:00:00Z", serverNow: "2026-10-04T10:00:03Z", waiting: false };
  assert.equal(executionMs(timing, 500), 5500);
  assert.equal(executionMs({ ...timing, waiting: true }, 9000), 2000);
  assert.equal(executionMs(timing, 9000, true), 2000);
  assert.equal(executionMs({ ...timing, runningSince: undefined }, 9000), 2000);
  assert.equal(executionMs({ ...timing, serverNow: "invalid" }, 500), 2500);
  assert.equal(executionWords(65000), "1m 5s");
  assert.match(source("tabs/tasks/PhaseTiming.tsx"), /performance\.now\(\)/);
  assert.match(source("tabs/tasks/PhaseTiming.tsx"), /Timing unavailable/);
});

test("literal inline and fence copy preserves escapes, whitespace and trailing newlines", async () => {
  for (const [markdown, expected, fenced] of [["` a\\b `", " a\\b ", false], ["``a`b``", "a`b", false], ["```ts\nconst x = 1\n\n```", "const x = 1\n\n", true], ["~~~\r\na\r\n~~~", "a\r\n", true], ["```\na\n", "a\n", true]] as const) {
    assert.equal(codeSource(markdown, { start: { offset: 0 }, end: { offset: markdown.length } }, fenced), expected);
  }
  assert.equal(codeSource("x"), undefined);
  assert.equal(shouldCopy("selected", false), false);
  assert.equal(shouldCopy("", true), false);
  assert.equal(shouldCopy("", false), true);
  let copied = "";
  await writeCode("a\n", { writeText: async (text) => { copied = text; } });
  assert.equal(copied, "a\n");
  await assert.rejects(writeCode("x"), /Clipboard is unavailable/);
  await assert.rejects(writeCode("x", { writeText: async () => { throw Error("denied"); } }), /denied/);
  assert.match(source("ui/Markdown.tsx"), /toast\.error/);
});

test("react-markdown original AST offsets recover source rather than normalized display text", () => {
  const markdown = "` a\\\\b `\n\n```ts\nconst x = 1\n\n```";
  const copies: string[] = [];
  renderToStaticMarkup(createElement(ReactMarkdown, { components: {
    pre: ({ node, children }) => { copies.push(codeSource(markdown, node?.position, true)!); return createElement("pre", null, children); },
    code: ({ node, children }) => { if (!node?.properties.className) copies.push(codeSource(markdown, node?.position)!); return createElement("code", null, children); },
  }, children: markdown }));
  assert.deepEqual(copies, [" a\\\\b ", "const x = 1\n\n"]);
});

test("prompt identities catch same-count replacement and persist seen IDs even when quiet", () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  const seen = new PromptSeen(storage), a = promptIdentity("project", "a"), b = promptIdentity("project", "b");
  assert.deepEqual(seen.observe("prompts", [a]), []);
  assert.deepEqual(seen.observe("prompts", [b]), [b]);
  assert.deepEqual(seen.observe("prompts", [b]), []);
  assert.deepEqual(seen.observe("prompts", [a, promptIdentity("project", "reconnect")], true), []);
  assert.deepEqual(seen.observe("prompts", [a, promptIdentity("project", "reconnect")]), []);
  const reload = new PromptSeen(storage);
  assert.deepEqual(reload.observe("prompts", [b]), []);
  assert.deepEqual(reload.observe("prompts", [a, b]), []);
  assert.notEqual(promptIdentity("other", "a"), a);
  const dialog = dialogIdentity("project", "session", "dialog");
  seen.observe("sessions", []);
  assert.deepEqual(seen.observe("prompts", [dialog]), [dialog]);
  assert.deepEqual(seen.observe("sessions", [dialog]), [], "same dialog across surfaces does not replay");
  assert.notEqual(deliveryIdentity("project", "task", "review1"), deliveryIdentity("project", "task", "review2"));
  const blocked = new PromptSeen({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  assert.deepEqual(blocked.observe("prompts", []), []);
  assert.deepEqual(blocked.observe("prompts", [a]), [a]);
  assert.deepEqual(blocked.observe("prompts", [a]), []);
});

test("explicit mockup payload validates sizes without trimming and retains Markdown preview", () => {
  assert.deepEqual(previewPayload({ html: " <p>demo</p> ", css: " p { color: red } " }), { html: " <p>demo</p> ", css: " p { color: red } " });
  for (const value of ["<p>chat</p>", { html: 1 }, { html: "a".repeat(100001) }, { html: "ok", css: "a".repeat(50001) }, { html: "ok", css: 1 }]) assert.equal(previewPayload(value), undefined);
  const view = parsePrompt({ id: "a", kind: "questionnaire", from: "ask", createdAt: 1, payload: { questions: [{ question: "Choose", options: [{ label: "A", preview: "**Markdown**", htmlPreview: { html: "<p>A</p>" } }] }] } });
  assert.equal(view?.kind, "questionnaire");
  if (view?.kind === "questionnaire") { assert.equal(view.questions[0]?.options[0]?.preview, "**Markdown**"); assert.equal(view.questions[0]?.options[0]?.htmlPreview?.html, "<p>A</p>"); }
});

test("static CSS rejects imports, resources, comment/escape tricks and executable declarations", () => {
  assert.equal(staticCss("p { color: red; padding: 8px }"), "p { color: red; padding: 8px }");
  for (const css of ["@import 'https://bad';", "p{background:url(https://bad)}", "p{background:u/**/rl(https://bad)}", "@im/**/port 'bad';", "p{background:u\\72l(bad)}", "p{background:image-set('bad' 1x)}", "p{behavior:bad}", "p{width:expression(alert(1))}"]) assert.equal(staticCss(css), "");
  for (const directive of ["default-src 'none'", "script-src 'none'", "style-src 'unsafe-inline'", "img-src 'none'", "font-src 'none'", "connect-src 'none'", "media-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(PREVIEW_CSP.includes(directive));
  assert.match(source("prompts/StaticPreview.tsx"), /sandbox="" referrerPolicy="no-referrer"/);
  assert.doesNotMatch(source("prompts/StaticPreview.tsx"), /allow-scripts|allow-same-origin/);
});

class ElementStub {
  namespaceURI = "http://www.w3.org/1999/xhtml";
  children: ElementStub[] = [];
  removed = false;
  textContent = "";
  localName: string;
  attributes: { name: string; value: string }[];
  constructor(localName: string, attributes: { name: string; value: string }[] = []) { this.localName = localName; this.attributes = attributes; }
  remove() { this.removed = true; }
  setAttribute(name: string, value: string) { this.attributes = this.attributes.filter((a) => a.name !== name); this.attributes.push({ name, value }); }
  removeAttribute(name: string) { this.attributes = this.attributes.filter((a) => a.name !== name); }
  get innerHTML(): string { return this.children.filter((c) => !c.removed).map((c) => c.outerHTML).join(""); }
  get outerHTML(): string { return `<${this.localName}${this.attributes.map((a) => ` ${a.name}="${a.value}"`).join("")}>${this.textContent}${this.innerHTML}</${this.localName}>`; }
  querySelectorAll(name: string) { return this.children.filter((c) => !c.removed && c.localName === name); }
}

test("DOM allowlist removes hostile elements, handlers and resource/navigation attributes", () => {
  const body = new ElementStub("body"), head = new ElementStub("head");
  const paragraph = new ElementStub("p", [{ name: "class", value: "local" }, { name: "onclick", value: "bad" }, { name: "src", value: "https://bad" }, { name: "style", value: "color:red" }]);
  const svg = new ElementStub("div"); svg.namespaceURI = "http://www.w3.org/2000/svg";
  body.children = [paragraph, svg, ..."script img form a base meta iframe object embed svg math input audio video link".split(" ").map((name) => new ElementStub(name))];
  const style = new ElementStub("style"); style.textContent = "@import 'https://bad'"; head.children = [style, new ElementStub("link")];
  const parser: PreviewParser = { parseFromString: () => ({ head, body }) };
  const html = staticPreviewDocument({ html: "unused by injected DOM", css: "p{color:blue}" }, parser);
  assert.ok(html.includes('class="local" style="color:red"'));
  assert.ok(html.includes("p{color:blue}"));
  assert.doesNotMatch(html, /https:\/\/bad|onclick|<script|<img|<form|<a>|<base|<iframe|<object|<embed|<svg|<math|<input|<audio|<video|<link/);
});

test("static preview fails closed when native parsing is unavailable or sanitization fails", () => {
  const preview = { html: '<script>alert(1)</script><p>unsanitized source</p>', css: "body{color:red}" };
  const failed: PreviewParser = { parseFromString() { throw Error("parse failed"); } };
  const broken: PreviewParser = { parseFromString() {
    return { get head(): never { throw Error("sanitize failed"); }, body: new ElementStub("body") };
  } };
  for (const parser of [undefined, failed, broken]) {
    const html = staticPreviewDocument(preview, parser);
    assert.ok(html.includes(PREVIEW_CSP));
    assert.match(html, /role="status">Static mockup unavailable/);
    assert.doesNotMatch(html, /<script|unsanitized source|body\{color:red\}/);
  }
  assert.match(source("prompts/StaticPreview.tsx"), /title=\{`Static mockup: \$\{label\}`\}/);
});

test("delivery actions use authoritative blocks, explicit APIs and confirmed direct merge only", () => {
  const panel = source("tabs/tasks/DeliveryReview.tsx");
  for (const api of ["tasks.deliveryReview", "tasks.deliveryDefer", "tasks.deliver"]) assert.ok(panel.includes(`"${api}"`));
  assert.match(panel, /confirmMain: true/);
  assert.match(panel, /delivery\.blocked\[action\]/);
  assert.match(panel, /This directly merges the reviewed commit into main and pushes main\. It does not create a pull request\./);
  assert.match(panel, /setConfirm\(true\)/);
  assert.match(panel, /project === selectedProject\(\)/);
  const detail = source("tabs/tasks/TaskDetail.tsx");
  assert.match(detail, /call\("tasks.open", \{ taskId \}\)/);
  assert.doesNotMatch(detail, /sessions\.(switch|start|stop)/, "opening the conversation never moves a session");
  const move = source("tabs/tasks/OpenInSession.tsx");
  assert.doesNotMatch(move, /sessions\.(start|stop)/, "opening a task in its session never starts or stops one");
  assert.match(move, /label=\{here \? "Open in its session: this window" : "Open in its session"\}/, "moving one is its own, named action");
  assert.match(detail, /detail\.data\?\.delivery/);
  assert.match(source("ui/SplitPane.tsx"), /forceMount=\{open && mounted\.current/);
  assert.match(source("components/ui/sheet.tsx"), /hidden \? null : <SheetOverlay/);
});
