import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserCss, withProjectStyles } from "../src/ask/project-styles.ts";
import { dressMockups } from "../src/ask/tool.ts";
import { MAX_PREVIEW_CSS } from "../src/ask/types.ts";

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "styles-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.css"), `@import "tailwindcss";\n@plugin "x";\n/* tokens */\n@theme inline {\n  --color-brand: #0f62fe;\n  --radius-card: 12px;\n}\n.btn { @apply px-3 py-1; background: var(--color-brand); border-radius: var(--radius-card); }\n.hero { background: url("/a.png"); }\n`);
  writeFileSync(join(root, "notes.txt"), "not css");
  return root;
}

test("a project stylesheet reaches a mockup as browser CSS: @theme tokens kept, build directives and urls dropped", () => {
  const css = browserCss(`@import "tailwindcss";\n@theme { --x: 1px; }\n.a { @apply p-2; color: red; background: url(x.png); }`);
  assert.match(css, /:root \{ --x: 1px; \}/);
  assert.doesNotMatch(css, /@import|@apply|url\(/);
  assert.match(css, /color: red/);
});

test("rules the preview would refuse (escapes, bindings) are dropped so the rest of the stylesheet still reaches it", async () => {
  const { staticCss } = await import("../webui/src/lib/staticPreview.ts");
  const css = browserCss(`.md\\:flex { display: flex; }\n.q::before { content: "\\201C"; }\n.ok { color: red; }\n@media (min-width: 1px) { .sm\\:p-2 { padding: 2px; } .fine { margin: 0; } }\n.x { background: image-set("a.png" 1x); }`);
  assert.doesNotMatch(css, /\\/);
  assert.match(css, /\.ok \{ color: red; \}/);
  assert.match(css, /\.fine \{ margin: 0; \}/);
  assert.notEqual(staticCss(css), "");
});

test("a mockup naming the project's stylesheets carries their rules in front of its own CSS", () => {
  const root = project();
  const dressed = withProjectStyles(root, { html: "<button class=\"btn\">Go</button>", css: ".extra{color:red}", stylesheets: ["src/index.css"] });
  assert.deepEqual(Object.keys(dressed).sort(), ["css", "html"]);
  assert.match(dressed.css!, /--color-brand: #0f62fe/);
  assert.match(dressed.css!, /\.btn \{/);
  assert.ok(dressed.css!.indexOf("--color-brand") < dressed.css!.indexOf(".extra"));
});

test("stylesheets outside the project, missing, not CSS or too large are refused with a reason", () => {
  const root = project();
  assert.throws(() => withProjectStyles(root, { html: "x", stylesheets: ["../etc/passwd.css"] }), /does not exist|outside/);
  assert.throws(() => withProjectStyles(root, { html: "x", stylesheets: ["notes.txt"] }), /not a \.css file/);
  assert.throws(() => withProjectStyles(root, { html: "x", stylesheets: ["src/missing.css"] }), /does not exist/);
  writeFileSync(join(root, "src", "big.css"), `.a{color:red}\n`.repeat(Math.ceil(MAX_PREVIEW_CSS / 10)));
  assert.throws(() => withProjectStyles(root, { html: "x", stylesheets: ["src/big.css"] }), /over the/);
});

test("the ask tool dresses only the mockups that name stylesheets, and says which option could not be dressed", () => {
  const root = project();
  const questions = [{ question: "Which?", header: "Look", options: [
    { label: "A", htmlPreview: { html: "<p>a</p>", stylesheets: ["src/index.css"] } as never },
    { label: "B", htmlPreview: { html: "<p>b</p>", css: "p{}" } },
  ] }];
  const [dressed] = dressMockups(questions, root);
  assert.match(dressed!.options[0]!.htmlPreview!.css!, /--color-brand/);
  assert.deepEqual(dressed!.options[1]!.htmlPreview, { html: "<p>b</p>", css: "p{}" });
  assert.throws(() => dressMockups([{ ...questions[0]!, options: [{ label: "A", htmlPreview: { html: "x", stylesheets: ["nope.css"] } as never }, questions[0]!.options[1]!] }], root), /question 1, "A": nope\.css does not exist/);
});
