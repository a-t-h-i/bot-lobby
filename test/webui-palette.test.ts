import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, paletteCss, parseTheme, safeValue, swatch } from "../webui/src/app/palette-core.ts";

const TWEAKCN = `
:root {
  --background: oklch(0.9824 0.0013 286.3757);
  --foreground: oklch(0.3211 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.3211 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.3211 0 0);
  --primary: oklch(0.6397 0.172 36.4421);
  --primary-foreground: oklch(1 0 0);
  --muted: oklch(0.9702 0 0);
  --muted-foreground: oklch(0.5486 0 0);
  --border: oklch(0.9219 0 0);
  --font-sans: Inter, sans-serif;
  --radius: 0.5rem;
  --shadow-sm: 0px 2px 0px 0px hsl(0 0% 0% / 0.05);
}
.dark {
  --background: oklch(0.2166 0.0215 292.8474);
  --foreground: oklch(0.9053 0 0);
  --card: oklch(0.2435 0.0212 291.8);
  --card-foreground: oklch(0.9053 0 0);
  --primary: oklch(0.7058 0.1946 47.6043);
  --primary-foreground: oklch(1 0 0)
}
@theme inline { --color-background: var(--background); }
`;

test("a tweakcn export becomes a light and a dark theme, keeping colours and fonts and dropping the rest", () => {
  const parsed = parseTheme(TWEAKCN);
  assert.ok(!("error" in parsed));
  assert.equal(parsed.light?.primary, "oklch(0.6397 0.172 36.4421)");
  assert.equal(parsed.dark?.primary, "oklch(0.7058 0.1946 47.6043)", "the last declaration needs no semicolon");
  assert.equal(parsed.light?.["font-sans"], "Inter, sans-serif");
  assert.equal(parsed.light?.radius, undefined, "corners stay the page's own");
  assert.equal(parsed.light?.["shadow-sm"], undefined, "shadows are not taken");
  assert.equal(parsed.light?.["color-background"], undefined, "@theme inline is the page's business");
});

test("the registry JSON form works too, with shared vars under `theme`", () => {
  const json = JSON.stringify({
    title: "Sunset",
    cssVars: {
      theme: { "font-sans": "Poppins, sans-serif" },
      light: { background: "#fff", foreground: "#111", card: "#fff", primary: "#e66", "primary-foreground": "#fff" },
      dark: { background: "#000", foreground: "#eee", card: "#111", primary: "#f88", "primary-foreground": "#000" },
    },
  });
  const parsed = parseTheme(json);
  assert.ok(!("error" in parsed));
  assert.equal(parsed.name, "Sunset");
  assert.equal(parsed.dark?.["font-sans"], "Poppins, sans-serif");
});

test("nothing that could load or escape survives", () => {
  for (const bad of ["url(https://evil.example/x.png)", "red; } body { display: none", "#fff /* x */ \\", "expression(alert(1))", "oklch(1 0 0)</style>", "@import 'x'"]) {
    assert.equal(safeValue(bad), undefined, bad);
  }
  assert.equal(safeValue("oklch(0.5 0.1 200 / 0.5)"), "oklch(0.5 0.1 200 / 0.5)");
  assert.equal(safeValue(`"Open Sans", sans-serif`), `"Open Sans", sans-serif`);
  const hostile = TWEAKCN.replace("oklch(0.6397 0.172 36.4421)", "url(https://evil.example/x.png)");
  const parsed = parseTheme(hostile);
  assert.ok(!("error" in parsed));
  assert.equal(parsed.light?.primary, undefined, "the bad value is dropped, not applied");
});

test("text that is not a theme says so", () => {
  for (const text of ["", "hello", "{}", "{not json", ":root { --primary: red; }"]) {
    assert.ok("error" in parseTheme(text), text);
  }
});

test("the style sheet carries the theme, fills in the page's own variables, and puts fonts after the page's stack", () => {
  const parsed = parseTheme(TWEAKCN);
  assert.ok(!("error" in parsed));
  const css = paletteCss({ id: "custom", name: "x", ...parsed });
  assert.match(css, /^:root\{/);
  assert.match(css, /\.dark\{/);
  assert.match(css, /--primary:oklch\(0\.6397 0\.172 36\.4421\);/);
  assert.match(css, /--tab-active:color-mix/, "derived page colours follow the theme's primary");
  assert.match(css, /--app-font-sans:Inter, sans-serif,"Inter Variable"/);
  assert.doesNotMatch(css, /url\(/);
});

test("the built-in themes: Mist sets nothing, the others set both modes, and each has a preview", () => {
  assert.equal(paletteCss(PRESETS[0]!), "");
  assert.ok(PRESETS.length >= 5);
  for (const preset of PRESETS.slice(1)) {
    assert.ok(preset.light && preset.dark, preset.id);
    assert.match(paletteCss(preset), /--primary:oklch\(/);
    for (const mode of [false, true]) assert.ok(swatch(preset, mode).primary, `${preset.id} ${mode}`);
  }
});

test("minified CSS with the blocks touching each other still gives both modes", () => {
  const css = ":root{--background:#fff;--foreground:#111;--card:#fff;--primary:#e11;--primary-foreground:#fff}.dark{--background:#000;--foreground:#eee;--card:#111;--primary:#f80;--primary-foreground:#000}";
  const parsed = parseTheme(css);
  assert.ok(!("error" in parsed));
  assert.equal(parsed.light?.primary, "#e11");
  assert.equal(parsed.dark?.primary, "#f80");
});
