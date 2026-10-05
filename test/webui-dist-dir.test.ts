import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { distDir } from "../src/webui/static.ts";

test("the built page is found in the package, whatever folder pi runs in", () => {
  const elsewhere = mkdtempSync(join(tmpdir(), "bot-lobby-cwd-"));
  const before = process.cwd();
  const saved = process.env.BOT_LOBBY_WEBUI_DIST;
  delete process.env.BOT_LOBBY_WEBUI_DIST;
  try {
    process.chdir(elsewhere);
    const dir = distDir();
    assert.ok(!dir.startsWith(elsewhere), "not under the user's project");
    assert.ok(existsSync(join(dir, "index.html")), `index.html is at ${dir}`);
  } finally {
    process.chdir(before);
    if (saved !== undefined) process.env.BOT_LOBBY_WEBUI_DIST = saved;
    rmSync(elsewhere, { recursive: true, force: true });
  }
});
