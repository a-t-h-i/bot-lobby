import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUTPUT_PAGE_BYTES, OUTPUT_PREVIEW_CHARS, openOutputArtifact, preserveOutputArtifact, type OutputArtifactAccess } from "../src/execution/output-artifacts.ts";

function fixture(t: TestContext): OutputArtifactAccess {
  const repository = mkdtempSync(join(tmpdir(), "bl-output-"));
  const taskDir = join(repository, ".pi", "bot-lobby", "tasks", "task-1");
  mkdirSync(taskDir, { recursive: true });
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  return { repository, worktree: repository, taskDir, taskId: "task-1", callerKey: "DEV:run-1", authorize: () => true };
}

const report = { status: "failed", error: "Validation failed: invalid output contract", exitCode: 7, output: "report line\n".repeat(1000) };

function preserve(access: OutputArtifactAccess): string {
  const result = preserveOutputArtifact(access, report);
  assert.ok(result.artifact);
  return result.artifact;
}

test("oversized reports retain complete output, original failure and bounded preview", (t) => {
  const access = fixture(t);
  const result = preserveOutputArtifact(access, report);
  assert.ok(result.artifact);
  assert.equal(result.status, report.status);
  assert.equal(result.error, report.error);
  assert.equal(result.exitCode, 7);
  assert.ok(result.output.length <= OUTPUT_PREVIEW_CHARS + 100);
  assert.match(result.output, /Output preview; full report: O-/);
  assert.equal(readFileSync(join(access.taskDir, "outputs", `${result.artifact}.txt`), "utf8"), report.output);
  assert.deepEqual(readdirSync(join(access.taskDir, "outputs")).sort(), [`${result.artifact}.json`, `${result.artifact}.txt`].sort());
});

test("small reports are unchanged and do not create artifacts", (t) => {
  const access = fixture(t);
  const small = { status: "success", output: "short report" };
  assert.equal(preserveOutputArtifact(access, small), small);
  assert.deepEqual(readdirSync(access.taskDir), []);
});

test("bounded byte continuations preserve Unicode and work from reconstructed access after restart", (t) => {
  const access = fixture(t);
  const output = "a😀é中\n".repeat(2000);
  const saved = preserveOutputArtifact(access, { status: "timeout", error: "stalled", output });
  assert.ok(saved.artifact);
  let text = "";
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const page = openOutputArtifact({ ...access }, saved.artifact, offset);
    assert.ok(Buffer.byteLength(page.text) <= OUTPUT_PAGE_BYTES);
    assert.equal(page.status, "timeout");
    assert.equal(page.error, "stalled");
    text += page.text;
    offset = page.nextOffset;
  }
  assert.equal(text, output);
});

test("every continuation checks current permissions and never treats its offset as authority", (t) => {
  const access = fixture(t);
  let allowed = true;
  let checks = 0;
  access.authorize = () => { checks += 1; return allowed; };
  const ref = preserve(access);
  const first = openOutputArtifact(access, ref);
  assert.equal(checks, 2);
  allowed = false;
  assert.throws(() => openOutputArtifact(access, ref, first.nextOffset), /unauthorized/);
  assert.throws(() => preserveOutputArtifact(access, report), /unauthorized/);
  assert.equal(checks, 4);
});

test("references cannot cross repository, worktree, task, directory or caller scopes", (t) => {
  const access = fixture(t);
  const other = fixture(t);
  const ref = preserve(access);
  mkdirSync(join(access.repository, "sibling"));
  for (const change of [{ repository: other.repository }, { worktree: join(access.repository, "sibling") }, { taskId: "task-2" }, { taskDir: other.taskDir }, { callerKey: "QA:run-2" }]) {
    assert.throws(() => openOutputArtifact({ ...access, ...change }, ref), /unauthorized/);
  }
});

test("symlinked artifact directories and task ancestors are rejected for reads and writes", (t) => {
  const access = fixture(t);
  const other = fixture(t);
  const ref = preserve(access);
  const dir = join(access.taskDir, "outputs");
  rmSync(dir, { recursive: true });
  symlinkSync(other.taskDir, dir, "dir");
  assert.throws(() => openOutputArtifact(access, ref), /unauthorized/);
  assert.throws(() => preserveOutputArtifact(access, report), /unauthorized/);
  const alias = join(access.repository, "alias");
  symlinkSync(other.taskDir, alias, "dir");
  assert.throws(() => preserveOutputArtifact({ ...access, taskDir: alias }, report), /unauthorized/);
  assert.deepEqual(readdirSync(other.taskDir), []);
});

test("symlinked or hard-linked report and manifest files cannot disclose their targets", (t) => {
  const access = fixture(t);
  const secret = join(access.repository, "secret");
  writeFileSync(secret, "not report content");
  for (const extension of ["txt", "json"]) {
    const ref = preserve(access);
    const path = join(access.taskDir, "outputs", `${ref}.${extension}`);
    unlinkSync(path);
    symlinkSync(secret, path);
    assert.throws(() => openOutputArtifact(access, ref));
    unlinkSync(path);
    linkSync(secret, path);
    assert.throws(() => openOutputArtifact(access, ref), /unauthorized/);
  }
});

test("references, byte offsets, changed files and forged scope manifests fail closed", (t) => {
  const access = fixture(t);
  const ref = preserve(access);
  for (const offset of [-1, 0.5, Infinity, report.output.length + 1]) {
    assert.throws(() => openOutputArtifact(access, ref, offset), /unauthorized/);
  }
  assert.throws(() => openOutputArtifact(access, "../../secret"), /unauthorized/);
  const manifest = join(access.taskDir, "outputs", `${ref}.json`);
  const metadata = JSON.parse(readFileSync(manifest, "utf8"));
  writeFileSync(manifest, JSON.stringify({ ...metadata, scope: { ...metadata.scope, taskId: "other" } }));
  assert.throws(() => openOutputArtifact(access, ref), /unauthorized/);
  writeFileSync(manifest, JSON.stringify(metadata));
  writeFileSync(join(access.taskDir, "outputs", `${ref}.txt`), "replaced");
  assert.throws(() => openOutputArtifact(access, ref), /unauthorized/);
});
