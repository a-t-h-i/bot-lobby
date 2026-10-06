import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseTheme, readThemes, removeTheme, renameTheme, saveTheme, themesPath } from "../src/state/themes.ts";

test("saved themes are named, kept in the global config folder for every session, and only ever recolour the page", () => {
  const previous = process.env.BOT_LOBBY_CONFIG_DIR;
  process.env.BOT_LOBBY_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bl-themes-"));
  try {
    assert.deepEqual(readThemes(), { themes: [] });
    const dusk = saveTheme({ name: "  Dusk   at the   lake ", light: { primary: "oklch(0.5 0.2 260)", background: "url(evil)" }, dark: { "--card": "#111" } });
    assert.equal(dusk.name, "Dusk at the lake");
    assert.deepEqual(dusk.light, { primary: "oklch(0.5 0.2 260)" }, "a value that could load anything is dropped");
    assert.deepEqual(dusk.dark, { card: "#111" });
    assert.equal(readThemes().active, dusk.id, "saving a theme chooses it");
    assert.equal(themesPath(), join(process.env.BOT_LOBBY_CONFIG_DIR!, "themes.json"));

    assert.equal(renameTheme(dusk.id, "Lake").name, "Lake");
    assert.throws(() => renameTheme(dusk.id, "   "), /needs a name/);
    assert.throws(() => saveTheme({ name: "Empty", light: { "font-weight": "700" } }), /no colours/);

    chooseTheme("forest");
    assert.equal(readThemes().active, "forest", "a theme of the page's own can be chosen too");
    assert.throws(() => chooseTheme("nope"), /no such theme/);

    // Hand edits are read with the same filter.
    const store = JSON.parse(readFileSync(themesPath(), "utf8"));
    store.themes.push({ id: "../../etc", name: "Bad", light: { primary: "red" } }, { id: "saved-abcdef12", name: "Hand", light: { primary: "red;}body{x" } });
    writeFileSync(themesPath(), JSON.stringify(store));
    assert.deepEqual(readThemes().themes.map((theme) => theme.name), ["Lake"]);

    chooseTheme(dusk.id);
    assert.equal(removeTheme(dusk.id).active, undefined, "removing the chosen theme brings the default back");
    assert.deepEqual(readThemes().themes, []);
  } finally {
    if (previous === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
    else process.env.BOT_LOBBY_CONFIG_DIR = previous;
  }
});
