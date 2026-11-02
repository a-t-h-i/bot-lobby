import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssignmentValidationError, validateAssignment, type WorkerAssignment } from "../src/execution/assignment.ts";
import { assignmentPrompt, parseWorkerResult, validateWorkerResult } from "../src/roles/worker.ts";
import { applyStartupBudget } from "../src/classifier/knowledge.ts";

function brief(): WorkerAssignment {
  return {
    id: "backend-1", revision: 1, objective: "Inspect the contract",
    actions: [{ step: 1, instruction: "Read the assigned file and report evidence" }],
    files: [{ path: "source.ts", access: "reference", purpose: "Contract definition" }],
    contracts: [], constraints: [], exclusions: [], tools: [{ name: "read", purpose: "Read assigned source" }],
    verification: ["Report the exported contract"], evidence: [], completedWork: [], needs: [],
  };
}

async function fixture(t: { after(fn: () => Promise<void>): void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "assignment-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "source.ts"), "export const marker = 'never preload file bodies';");
  return root;
}

test("validated assignments preserve identity and purposes, default discovery, and omit file bodies", async (t) => {
  const root = await fixture(t);
  const input = brief();
  const result = await validateAssignment(input, root);
  assert.equal(result.discoveryLimit, 2);
  assert.equal(result.id, input.id);
  assert.notEqual(result, input);
  const prompt = assignmentPrompt(result);
  assert.match(prompt, /source\.ts/);
  assert.match(prompt, /Contract definition/);
  assert.doesNotMatch(prompt, /never preload file bodies/);
  assert.match(prompt, /expansion request/);
  assert.match(prompt, /retries and revisions do not reset/);
  assert.deepEqual((await validateAssignment({ ...input, tools: [], discoveryLimit: 0 }, root)).tools, []);
});

function contextPack() {
  return { version: 1 as const, files: [{ path: "source.ts", ranges: [[1, 1] as [number, number]], snippet: "UNIQUE_PACK_SNIPPET" }], verification: ["Read source.ts"] };
}

test("context packs validate field errors and render once without breaking legacy assignments", async (t) => {
  const root = await fixture(t);
  const pack = contextPack();
  const cases = [
    [{ ...pack, files: [{ path: "../outside.ts" }] }, /contextPack.files\[0\].path.*outside project scope/],
    [{ ...pack, files: [{ path: "source.ts", ranges: [[2, 1]] }] }, /contextPack.files\[0\].ranges\[0\].*1 <= start <= end/],
    [{ ...pack, files: [{ path: "source.ts", snippet: "x".repeat(2001) }] }, /contextPack.files\[0\].snippet.*2000/],
    [{ ...pack, priorWork: ["x".repeat(24001)] }, /contextPack.*24000.*trim/],
    [{ ...pack, unknown: true }, /contextPack.unknown is unknown; remove it/],
  ] as const;
  for (const [contextPack, error] of cases) await assert.rejects(validateAssignment({ ...brief(), contextPack }, root), error);
  assert.equal((await validateAssignment(brief(), root)).contextPack, undefined);
  const valid = await validateAssignment({ ...brief(), contextPack: pack }, root);
  assert.equal(assignmentPrompt(valid).split("UNIQUE_PACK_SNIPPET").length - 1, 1);
});

test("all four roles omit duplicate history and retain protected startup content whole", () => {
  for (const role of ["master", "backend", "designer", "qa"]) {
    const protectedContent = `## Pinned\n${role}: ${"rule ".repeat(1800)}`;
    const result = applyStartupBudget([
      { name: `${role} history`, content: "completed historical task" },
      { name: `${role} repeated history`, content: "completed historical task" },
      { name: `${role} rules`, content: protectedContent, path: `${role}/knowledge.md` },
    ]);
    assert.equal(result.sections[1]!.content, "");
    assert.ok(result.sections[2]!.content.endsWith(protectedContent));
    assert.ok(result.diagnostics.some((line) => line.includes("duplicate")));
    assert.ok(result.diagnostics.some((line) => line.includes(`${role}/knowledge.md`) && line.includes("kept whole")));
  }
});

test("malformed assignment fields fail actionably rather than defaulting", async (t) => {
  const root = await fixture(t);
  const invalid = [
    { ...brief(), revision: 0 }, { ...brief(), objective: " " }, { ...brief(), unknown: true },
    { ...brief(), actions: [{ step: 2, instruction: "Read" }] }, { ...brief(), tools: ["read"] },
    { ...brief(), verification: [] }, { ...brief(), discoveryLimit: -1 },
    { ...brief(), needs: [{ kind: "tools", reason: "Need lookup", requested: [] }] },
    { ...brief(), files: [{ path: "*.ts", access: "reference", purpose: "Pattern" }] },
    { ...brief(), files: [{ path: "source.ts", access: "unknown", purpose: "Unknown access" }] },
  ];
  for (const input of invalid) await assert.rejects(validateAssignment(input, root), AssignmentValidationError);
});

test("reference and edit paths must exist; create paths can have absent parent directories", async (t) => {
  const root = await fixture(t);
  for (const access of ["reference", "edit"] as const) {
    await assert.rejects(validateAssignment({ ...brief(), files: [{ path: "missing.ts", access, purpose: "Missing" }] }, root), /missing.ts.*correct the path/);
  }
  const files = [{ path: "new/nested/output.ts", access: "create" as const, purpose: "New module" }];
  assert.deepEqual((await validateAssignment({ ...brief(), files }, root)).files, files);
  await assert.rejects(validateAssignment({ ...brief(), files: [{ ...files[0], path: "source.ts/child.ts" }] }, root), AssignmentValidationError);
});

test("scope checks reject traversal, symlink escapes, dangling links, directories and aliases", async (t) => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "assignment-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "external.ts"), "outside");
  await symlink(outside, join(root, "escape"));
  await symlink(join(outside, "absent.ts"), join(root, "dangling"));
  await symlink(join(root, "source.ts"), join(root, "alias.ts"));
  await mkdir(join(root, "directory"));
  for (const path of ["../external.ts", "escape/external.ts", "escape/new/nested.ts", "dangling", "directory"]) {
    await assert.rejects(validateAssignment({ ...brief(), files: [{ path, access: "create", purpose: "Unsafe" }] }, root), AssignmentValidationError);
  }
  await assert.rejects(validateAssignment({ ...brief(), files: [...brief().files, { path: "alias.ts", access: "edit", purpose: "Duplicate" }] }, root), /duplicates/);
});

test("reference-only completion needs no artificial edit, but changes require verification and permission", () => {
  const report = parseWorkerResult("backend", "## Completed\nInspected the exported contract.\n## Files Changed\n\n## Verification\nRead source.ts and confirmed exports.");
  assert.deepEqual(validateWorkerResult(report, brief()), []);
  assert.deepEqual(validateWorkerResult(report), ["no files changed and no blocker reported"]);
  const changed = { ...report, verification: "", filesChanged: [{ path: "source.ts", change: "Changed contract" }] };
  assert.deepEqual(validateWorkerResult(changed, brief()), ["changed files without verification", "changed file outside assignment edit/create paths: source.ts"]);
  assert.deepEqual(validateWorkerResult({ ...changed, verification: "Typecheck passed" }, { ...brief(), files: [{ path: "source.ts", access: "edit", purpose: "Update contract" }] }), []);
});
