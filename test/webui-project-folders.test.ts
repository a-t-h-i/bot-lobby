import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browseFolders, folderPath } from "../src/webui/project-folders.ts";

const temp = () => mkdtempSync(join(tmpdir(), "bl-folders-"));

test("folder browsing lists directories, follows directory aliases and never reads files", async (t) => {
  const root = temp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "project"));
  symlinkSync(join(root, "project"), join(root, "alias"));
  symlinkSync(join(root, "missing"), join(root, "broken"));
  writeFileSync(join(root, "secret.txt"), "do not return this");
  const result = await browseFolders(root);
  assert.equal(result.path, root);
  assert.deepEqual(result.folders.map((folder) => folder.name), ["alias", "project"]);
  assert.equal(result.truncated, false);
});

test("folder request validation rejects unexpected fields, relative and invalid paths", () => {
  for (const body of [null, [], {}, { path: "" }, { path: "../root" }, { path: "/a\0b" }, { path: "/tmp", command: "sh" }]) {
    assert.throws(() => folderPath(body));
  }
  assert.equal(folderPath({ path: "/tmp" }), "/tmp");
});

test("browsing missing paths and regular files fails with actionable errors", async (t) => {
  const root = temp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "file"), "text");
  await assert.rejects(browseFolders(join(root, "missing")), /does not exist/);
  await assert.rejects(browseFolders(join(root, "file")), /not a folder/);
});
