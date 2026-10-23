/**
 * The code viewer's files (`src/webui/code.ts`) against a real git repository
 * in a temp folder: the changed-file list with line counts, one file with what
 * HEAD held, finding a file by its bare name, the project jail, and saving
 * with the on-disk change guard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeChanges, codeRead, codeSave, parseNumstat, parseStatus, projectPath } from "../src/webui/code.ts";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "bl-code-"));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  run("init", "-q");
  run("config", "user.email", "t@example.com");
  run("config", "user.name", "t");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "zen.ts"), "export const a = 1;\nexport const b = 2;\n");
  writeFileSync(join(root, "gone.md"), "bye\n");
  writeFileSync(join(root, "old.txt"), "same\n");
  run("add", ".");
  run("commit", "-qm", "start");
  writeFileSync(join(root, "src", "zen.ts"), "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
  writeFileSync(join(root, "new.ts"), "one\ntwo\n");
  execFileSync("rm", [join(root, "gone.md")]);
  return root;
}

test("parseStatus folds index and work tree codes, keeps renames' old paths", () => {
  const out = [" M a.ts", "A  b.ts", "R  c.ts", "old-c.ts", "?? d.ts", " D e.ts", ""].join("\0");
  assert.deepEqual(parseStatus(out), [
    { path: "a.ts", status: "modified" },
    { path: "b.ts", status: "added" },
    { path: "c.ts", status: "renamed", from: "old-c.ts" },
    { path: "d.ts", status: "untracked" },
    { path: "e.ts", status: "deleted" },
  ]);
});

test("parseNumstat reads counts, binary as zero, renames by their new path", () => {
  const out = ["3\t1\ta.ts", "-\t-\timg.png", "2\t0\t", "old.ts", "new.ts", ""].join("\0");
  const counts = parseNumstat(out);
  assert.deepEqual(counts.get("a.ts"), { additions: 3, deletions: 1 });
  assert.deepEqual(counts.get("img.png"), { additions: 0, deletions: 0 });
  assert.deepEqual(counts.get("new.ts"), { additions: 2, deletions: 0 });
});

test("codeChanges lists modified, deleted and untracked files with line counts", async () => {
  const root = repo();
  const { git, files } = await codeChanges(root);
  assert.equal(git, true);
  assert.deepEqual(files, [
    { path: "gone.md", status: "deleted", additions: 0, deletions: 1 },
    { path: "new.ts", status: "untracked", additions: 2, deletions: 0 },
    { path: "src/zen.ts", status: "modified", additions: 2, deletions: 1 },
  ]);
});

test("codeChanges says when the folder is no git repository", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-code-plain-"));
  assert.deepEqual(await codeChanges(root), { git: false, files: [], truncated: false });
});

test("codeRead sends the text and HEAD's text for a changed file", async () => {
  const root = repo();
  const file = await codeRead(root, "src/zen.ts");
  assert.equal(file.contents, "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
  assert.equal(file.original, "export const a = 1;\nexport const b = 2;\n");
  assert.equal(file.change?.status, "modified");
  const same = await codeRead(root, join(root, "old.txt"));
  assert.equal(same.path, "old.txt");
  assert.equal(same.original, undefined);
  assert.equal(same.change, undefined);
  const gone = await codeRead(root, "gone.md");
  assert.equal(gone.exists, false);
  assert.equal(gone.original, "bye\n");
});

test("codeRead finds a bare file name the activity log used", async () => {
  const root = repo();
  assert.equal((await codeRead(root, "zen.ts")).path, "src/zen.ts");
  await assert.rejects(codeRead(root, "nowhere.ts"), /not in the project/);
});

test("paths outside the project and in .git are refused", async () => {
  const root = repo();
  assert.throws(() => projectPath(root, "../etc/passwd"), /outside the project/);
  assert.throws(() => projectPath(root, "/etc/passwd"), /outside the project/);
  assert.throws(() => projectPath(root, ".git/config"), /\.git/);
  symlinkSync("/etc", join(root, "out"));
  await assert.rejects(codeRead(root, "out/hostname"), /outside the project/);
});

test("codeSave writes, and refuses a file changed on disk since it was read", async () => {
  const root = repo();
  const read = await codeRead(root, "new.ts");
  const saved = await codeSave(root, { path: "new.ts", contents: "one\n2\n", mtimeMs: read.mtimeMs });
  assert.equal(readFileSync(join(root, "new.ts"), "utf8"), "one\n2\n");
  assert.equal(saved.path, "new.ts");
  await assert.rejects(codeSave(root, { path: "new.ts", contents: "x", mtimeMs: read.mtimeMs - 10_000 }), /changed on disk/);
  await codeSave(root, { path: "new.ts", contents: "x", mtimeMs: read.mtimeMs - 10_000, force: true });
  assert.equal(readFileSync(join(root, "new.ts"), "utf8"), "x");
});

test("filePathOf picks out file paths an agent wrote, and leaves words, URLs and versions alone", async () => {
  const { filePathOf } = await import("../webui/src/app/code/codeStore.ts");
  assert.equal(filePathOf("src/pi/zen.ts"), "src/pi/zen.ts");
  assert.equal(filePathOf("./README.md"), "README.md");
  assert.equal(filePathOf("zen.ts:12"), "zen.ts");
  assert.equal(filePathOf(".env.local"), ".env.local");
  assert.equal(filePathOf("docker/Dockerfile"), "docker/Dockerfile");
  for (const text of ["narrateEvent", "feed.replyDelta", "Node.js is fast", "e.g", "https://x.dev/a.ts", "npm run build", "1.2.3", "v2.0", "../up.ts", "src/", "Dockerfile"]) {
    assert.equal(filePathOf(text), undefined, text);
  }
});
