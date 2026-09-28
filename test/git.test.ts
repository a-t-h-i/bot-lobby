import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedFiles, readRepositoryDiff } from "../src/execution/git.ts";

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
  const diff = await readRepositoryDiff(root, { limitChars: 500 });
  assert.ok(diff.length < 900, `expected a bounded diff, got ${diff.length}`);
  assert.match(diff, /characters omitted/);

  const notARepo = mkdtempSync(join(tmpdir(), "dh-nogit-"));
  mkdirSync(join(notARepo, "sub"));
  assert.match(await readRepositoryDiff(join(notARepo, "sub")), /Unable to read git state/);
});

test("readRepositoryDiff from the task's start commit shows committed work and new files, without bot-lobby's records", async () => {
  const root = repo();
  writeFileSync(join(root, "tracked.txt"), "one\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  writeFileSync(join(root, "tracked.txt"), "one\ntwo\n");
  execFileSync("git", ["commit", "-qam", "the fix, committed"], { cwd: root });
  writeFileSync(join(root, "fresh.ts"), "export const fresh = 1;\n");
  mkdirSync(join(root, ".pi", "bot-lobby"), { recursive: true });
  writeFileSync(join(root, ".pi", "bot-lobby", "state.json"), "{}");

  assert.match(await readRepositoryDiff(root), /Diff \(HEAD\): none/, "against HEAD, committed work is invisible");
  const diff = await readRepositoryDiff(root, { base, exclude: [".pi/bot-lobby"] });
  assert.match(diff, new RegExp(`Changed files \\(since ${base.slice(0, 7)}, where the task started \\(committed work included\\)\\):\\ntracked\\.txt`));
  assert.match(diff, /\+two/);
  assert.match(diff, /New files \(untracked\):\n--- fresh\.ts\nexport const fresh = 1;/);
  assert.doesNotMatch(diff, /bot-lobby/);
  const tree = await changedFiles(root, base);
  assert.deepEqual(tree?.files.sort(), [".pi/bot-lobby/state.json", "fresh.ts", "tracked.txt"]);
  assert.deepEqual((await changedFiles(root))?.files.sort(), [".pi/bot-lobby/state.json", "fresh.ts"], "without a base, only what is uncommitted");
});
