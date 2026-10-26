/**
 * The managed `.gitignore` block behind the "Retain lobby data in git" switch:
 * what `retentionEnabled` reads back, what `withRetention` rewrites around the
 * lines it does not own, and the API handlers that read and write the repo's
 * own file in a temporary project root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retentionEnabled, withRetention } from "../src/state/gitignore.ts";
import { lobbyRetention, lobbySetRetention } from "../src/webui/api/retention.ts";
import type { ApiContext } from "../src/webui/api/index.ts";

const OFF_BLOCK = "# bot-lobby local task state, knowledge and config\n.pi/";
const ON_BLOCK = "# bot-lobby local task state and config (bot-lobby retained in git)\n.pi/*\n!.pi/bot-lobby/";

/** This repo's `.gitignore` as it ships with retention off, verbatim. */
const REPO_GITIGNORE = `# Dependencies
node_modules/
node_modules
node_modules.old/

# bot-lobby local task state, knowledge and config
.pi/

# Build output
dist/
build/
out/
*.tsbuildinfo

# Committed web UI build
!webui/dist/

# Test and coverage output
coverage/
.nyc_output/
test-results/
playwright-report/

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Local environment and secrets
.env
.env.local
.env.*.local
*.local

# Caches and temporary files
.cache/
.npm/
.tmp/
tmp/
*.tmp
*.swp
*~

# Editors and OS
.idea/
.vscode/
.DS_Store
Thumbs.db
`;

test("retentionEnabled reads the negation, with or without its trailing slash", () => {
  assert.equal(retentionEnabled(REPO_GITIGNORE), false, "today's shipped block keeps retention off");
  assert.equal(retentionEnabled(`${OFF_BLOCK}\n`), false);
  assert.equal(retentionEnabled(".pi/*\n"), false, "the glob alone negates nothing");
  assert.equal(retentionEnabled(""), false);
  assert.equal(retentionEnabled(`node_modules/\n${ON_BLOCK}\n`), true);
  assert.equal(retentionEnabled("!.pi/bot-lobby\n"), true, "the negation without its trailing slash still reads as on");
});

test("turning retention on and off again restores today's .gitignore byte for byte", () => {
  const on = withRetention(REPO_GITIGNORE, true);
  assert.equal(retentionEnabled(on), true);
  assert.ok(on.includes(ON_BLOCK), "the on-block is in the file");
  assert.equal(withRetention(on, false), REPO_GITIGNORE, "the round trip restores the original exactly");
});

test("withRetention is idempotent in both directions", () => {
  for (const enabled of [true, false]) {
    const once = withRetention(REPO_GITIGNORE, enabled);
    assert.equal(withRetention(once, enabled), once);
  }
});

test("a file with no managed lines gains the block at the end, behind one blank line", () => {
  const foreign = "# Dependencies\nnode_modules/\ndist/";
  assert.equal(withRetention(foreign, false), `${foreign}\n\n${OFF_BLOCK}\n`);
  assert.equal(withRetention(foreign, true), `${foreign}\n\n${ON_BLOCK}\n`);
});

test("an empty file gets just the block", () => {
  assert.equal(withRetention("", false), `${OFF_BLOCK}\n`);
  assert.equal(withRetention("", true), `${ON_BLOCK}\n`);
});

test("managed lines in the middle are replaced in place, neighbours untouched and in order", () => {
  const middle = `node_modules/\n\n${OFF_BLOCK}\n\n# Build output\ndist/\n`;
  const on = withRetention(middle, true);
  assert.equal(on, `node_modules/\n\n${ON_BLOCK}\n\n# Build output\ndist/\n`);
  assert.equal(withRetention(on, false), middle);
  // However far apart the managed lines sit, they collapse into one block at the first one's place.
  const scattered = `${OFF_BLOCK}\nnode_modules/\n.pi/*\n!.pi/bot-lobby\ndist/\n`;
  assert.equal(withRetention(scattered, false), `${OFF_BLOCK}\nnode_modules/\ndist/\n`);
});

test("the retention handlers write and read back the repo's own .gitignore", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-gitignore-"));
  const file = join(root, ".gitignore");
  const ctx = { service: { projectRoot: () => root }, port: 0 } as unknown as ApiContext;
  try {
    assert.deepEqual(lobbyRetention(ctx), { enabled: false }, "no .gitignore yet reads as off");
    assert.deepEqual(lobbySetRetention({ enabled: true }, ctx), { enabled: true });
    const created = readFileSync(file, "utf8");
    assert.equal(created, `${ON_BLOCK}\n`, "the file is created holding just the on-block");
    assert.deepEqual(lobbyRetention(ctx), { enabled: true }, "state is read back from the file");
    // A line someone else added keeps its place through every later rewrite.
    writeFileSync(file, `node_modules/\n${created}`, "utf8");
    assert.deepEqual(lobbySetRetention({ enabled: false }, ctx), { enabled: false });
    assert.equal(readFileSync(file, "utf8"), `node_modules/\n${OFF_BLOCK}\n`);
    assert.deepEqual(lobbyRetention(ctx), { enabled: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
