import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeShared, parseDigest, shareDigest } from "../src/knowledge/oracle-digest.ts";
import { knowledgeFilePath } from "../src/knowledge/store.ts";
import { resolveConfig, agentProfile } from "../src/schemas/configuration.ts";

test("the digest takes only tagged lines under its heading, for known agents and kinds", () => {
  const summary = "## Requirements\n- [designer:standard] not here\n\n## Knowledge to share\n- [qa:knowledge] Playwright runs light, dark and 320px.\n* [MASTER:decision] Keep the sidebar (user, 2026-10-14).\n- [designer:completed] skipped kind\n- loose line\n- none\n\n## After\n- [qa:knowledge] past the section";
  assert.deepEqual(parseDigest(summary), [
    { agent: "qa", kind: "knowledge", text: "Playwright runs light, dark and 320px." },
    { agent: "master", kind: "decision", text: "Keep the sidebar (user, 2026-10-14)." },
  ]);
  assert.deepEqual(parseDigest("no section"), []);
});

test("shared knowledge lands in each agent's files once", () => {
  const root = mkdtempSync(join(tmpdir(), "digest-"));
  try {
    const items = parseDigest("## Knowledge to share\n- [designer:standard] Buttons are 32px tall.\n- [master:knowledge] The user reviews GIFs of animations.");
    const now = new Date("2026-10-15T09:00:00Z");
    assert.deepEqual(shareDigest(root, items, now), { designer: 1, master: 1 });
    assert.deepEqual(shareDigest(root, items, now), {}, "a second share adds nothing");
    assert.match(readFileSync(knowledgeFilePath(root, "designer", "standard"), "utf8"), /- Buttons are 32px tall\./);
    assert.match(readFileSync(knowledgeFilePath(root, "master", "knowledge"), "utf8"), /GIFs of animations/);
    assert.equal(describeShared({ designer: 2, qa: 1 }), "2 for the designer, 1 for QA");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("auto-compaction is on unless an agent's settings turn it off, and reaches its run profile", () => {
  const config = resolveConfig({ master: { autoCompact: false }, agents: { designer: { autoCompact: false }, qa: { autoCompact: "no" } }, scout: { autoCompact: false } });
  assert.equal(config.master.autoCompact, false);
  assert.equal(config.agents.designer.autoCompact, false);
  assert.equal(config.agents.qa.autoCompact, undefined, "only false switches it off");
  assert.equal(agentProfile(config, "designer", "worker").autoCompact, false);
  assert.equal(agentProfile(config, "backend", "worker").autoCompact, undefined);
  assert.equal(agentProfile(config, "backend", "scout").autoCompact, false);
});
