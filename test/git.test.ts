import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRepositoryDiff } from "../src/execution/git.ts";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "dh-git-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  return root;
}

test("readRepositoryDiff reports an empty repository as clean", async () => {
  const root = repo();
  writeFileSync(join(root, "tracked.txt"), "one\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  const diff = await readRepositoryDiff(root);
  assert.match(diff, /Status: clean working tree/);
  assert.match(diff, /Diff \(HEAD\): none/);
});

test("readRepositoryDiff shows tracked edits and untracked files", async () => {
  const root = repo();
  writeFileSync(join(root, "tracked.txt"), "one\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "one\ntwo\n");
  writeFileSync(join(root, "fresh.txt"), "new\n");

  const diff = await readRepositoryDiff(root);
  assert.match(diff, /M tracked\.txt/);
  assert.match(diff, /\?\? fresh\.txt/);
  assert.match(diff, /\+two/);
});

test("readRepositoryDiff still works in a repository with no commits yet", async () => {
  const root = repo();
  writeFileSync(join(root, "first.txt"), "brand new\n");
  const diff = await readRepositoryDiff(root);
  assert.doesNotMatch(diff, /Unable to read git state/);
  assert.match(diff, /\?\? first\.txt/);
});

test("readRepositoryDiff truncates large diffs and reports non-repositories", async () => {
  const root = repo();
  writeFileSync(join(root, "tracked.txt"), "one\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  writeFileSync(join(root, "tracked.txt"), `${"line\n".repeat(5000)}`);
  const diff = await readRepositoryDiff(root, 500);
  assert.ok(diff.length < 900, `expected a bounded diff, got ${diff.length}`);
  assert.match(diff, /characters omitted/);

  const notARepo = mkdtempSync(join(tmpdir(), "dh-nogit-"));
  mkdirSync(join(notARepo, "sub"));
  assert.match(await readRepositoryDiff(join(notARepo, "sub")), /Unable to read git state/);
});
