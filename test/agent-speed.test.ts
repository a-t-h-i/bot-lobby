import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { purposeOf, symbolsOf, type FileHinter, type IndexedFile } from "../src/classifier/files.ts";
import { rankForMap, renderRepoMap, repoMap, withRepoMap } from "../src/knowledge/repo-map.ts";
import { readFileNotes, recordFileNotes } from "../src/knowledge/file-notes.ts";
import { runScouts, type ScoutRequest } from "../src/master/master.ts";
import { summarizeOutcomes } from "../src/master/synthesis.ts";
import { parseFileBullet } from "../src/roles/markdown.ts";
import { treeState } from "../src/execution/git.ts";
import { MAX_REFUSALS, registerToolBudget, TOOL_BUDGET_ENV, toolBudgetEnv } from "../src/pi/tool-budget.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "bl-speed-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

const FILES = {
  "src/auth/session.ts": "/** Session cookies: issue, validate and expire them. */\nimport { sign } from './sign';\nexport function validateSession(cookie: string) {}\nexport const SESSION_TTL = 3600;\nfunction helper() {}\n",
  "src/router.ts": "/** Hash routing. */\nexport function route() {}\n",
  "tools/seed.py": '"""Seed the demo database."""\nimport os\n\ndef seed_users():\n    pass\n\ndef _private():\n    pass\n\nclass Seeder:\n    def method(self):\n        pass\n',
  "docs/guide.md": "# Operator guide\n\n## Install\n\n## Sessions\n",
};

test("the index names each file's purpose and top-level names, and the map lists the files a step matches", async () => {
  assert.equal(purposeOf("a.ts", FILES["src/auth/session.ts"]), "Session cookies: issue, validate and expire them.");
  assert.deepEqual(symbolsOf("a.ts", FILES["src/auth/session.ts"]), ["validateSession", "SESSION_TTL"], "exports, not file-local helpers");
  assert.deepEqual(symbolsOf("seed.py", FILES["tools/seed.py"]), ["seed_users", "Seeder"], "top-level only, private names left out");
  assert.equal(purposeOf("seed.py", FILES["tools/seed.py"]), "Seed the demo database.");
  assert.deepEqual(symbolsOf("guide.md", FILES["docs/guide.md"]), ["Install", "Sessions"]);
  assert.equal(purposeOf("x.ts", "// Copyright 2026 Acme. Licensed under MIT.\nexport const a = 1;\n"), "", "a licence header says nothing about the file");

  const files: IndexedFile[] = [
    { path: "src/auth/session.ts", excerpt: "Session cookies", symbols: ["validateSession"], purpose: "Session cookies." },
    { path: "src/router.ts", excerpt: "Hash routing.", symbols: ["route"], purpose: "Hash routing." },
  ];
  assert.deepEqual(rankForMap("validate the session cookie", files).map((file) => file.path), ["src/auth/session.ts"]);
  assert.deepEqual(rankForMap("work out the layout", files), [], "a short word inside another (out in router) is no match");
  assert.equal(rankForMap("change src/router.ts", files)[0]!.path, "src/router.ts", "a file the brief names comes first");
  assert.equal(renderRepoMap("src/ (2)", [], new Map()), "");
  const tight = renderRepoMap("src/ (2)", files, new Map(), 700);
  assert.ok(tight.length <= 700 && tight.includes("src/auth/session.ts"));

  const root = repo(FILES);
  const scope = { cwd: root, root, configDir: ".pi" };
  const map = await repoMap(scope, "Step 1: validate the session cookie on every request", { budgetMs: 10_000 });
  assert.match(map, /^## Repository map/);
  assert.match(map, /Layout: .*src\/ \(2\)/);
  assert.match(map, /- `src\/auth\/session\.ts` — Session cookies: issue, validate and expire them\. · validateSession, SESSION_TTL/);
  assert.doesNotMatch(map, /tools\/seed\.py/, "files the step does not match are left out");
  assert.equal(await repoMap(scope, "nothing matches zebra", { budgetMs: 10_000 }), "");
});

test("a scout's file notes show in the map only while the file is unchanged", async () => {
  const root = repo(FILES);
  const scope = { cwd: root, root, configDir: ".pi" };
  const dataDir = join(root, ".pi", "bot-lobby");
  const kept = await recordFileNotes(dataDir, root, "backend", [
    { path: "./src/auth/session.ts", lines: "3", reason: "validateSession checks the signature but not the expiry" },
    { path: "src/missing.ts", reason: "not there" },
    { path: "src/router.ts", reason: "" },
  ]);
  assert.equal(kept, 1, "missing files and notes without a reason are skipped");
  assert.equal(readFileNotes(dataDir)["src/auth/session.ts"]!.lines, "3");
  const query = "validate the session expiry";
  assert.match(await repoMap(scope, query, { budgetMs: 10_000 }), /scout \(backend, \d{4}-\d\d-\d\d, lines 3\): validateSession checks the signature but not the expiry/);
  writeFileSync(join(root, "src/auth/session.ts"), `${FILES["src/auth/session.ts"]}export function expire() {}\n`);
  assert.doesNotMatch(await repoMap(scope, query, { budgetMs: 10_000 }), /scout \(/, "a changed file's note may no longer hold");

  const likely: FileHinter = { block: async () => "## Likely files\n\n- `src/auth/session.ts` (0.9)", tools: () => ["find_relevant_files"] };
  let on = true;
  const hinter = withRepoMap(likely, scope, () => ({ on, exclude: [] }));
  const both = await hinter.block(query);
  assert.ok(both.startsWith("## Likely files") && both.includes("## Repository map"));
  on = false;
  assert.equal(await hinter.block(query), "## Likely files\n\n- `src/auth/session.ts` (0.9)", "workflow.repoMap off leaves the classifier's hints alone");
  assert.deepEqual(hinter.tools(), ["find_relevant_files"]);
});

test("scouts report line anchors, and the summary hands them on as path:lines with the reason", () => {
  assert.deepEqual(parseFileBullet("`src/a.ts:12-40` — the parser"), { path: "src/a.ts", lines: "12-40", reason: "the parser" });
  assert.deepEqual(parseFileBullet("src/a.ts#L3-L9 — on GitHub"), { path: "src/a.ts", lines: "3-9", reason: "on GitHub" });
  assert.deepEqual(parseFileBullet("`src/a.ts:12:5` — line and column"), { path: "src/a.ts", lines: "12", reason: "line and column" });
  assert.deepEqual(parseFileBullet("`src/a.ts` — whole file"), { path: "src/a.ts", reason: "whole file" });
});

function scoutReply(files: string[]): string {
  const text = ["## Scope", "The session code.", "## Findings", "- validateSession skips expiry", "## Relevant Files", ...files.map((file) => `- \`${file}\` — validates the cookie`), "## Confidence", "High"].join("\n");
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 1, output: 1 } } });
}

test("a scout asked the same thing on an unchanged tree reuses its findings; any change runs it again", async () => {
  const root = repo(FILES);
  const dataDir = join(root, ".pi", "bot-lobby");
  const envs: Array<Record<string, string> | undefined> = [];
  const runner: ProcessRunner = async (_args, options) => {
    envs.push(options.env as Record<string, string> | undefined);
    return { exitCode: 0, stdout: scoutReply(["src/auth/session.ts:3"]), stderr: "", killed: false, timedOut: false };
  };
  const request = (taskDir: string): ScoutRequest => ({ taskId: "TASK-1", taskText: "Expire sessions", instruction: "Where are sessions validated?", domains: ["backend"], cwd: root, dataRoots: [dataDir], taskDir, config: DEFAULT_CONFIG });

  const first = await runScouts(request(join(dataDir, "tasks", "one")), runner);
  assert.equal(envs.length, 1);
  assert.equal(envs[0]?.[TOOL_BUDGET_ENV], String(DEFAULT_CONFIG.scout.maxToolCalls), "scouts run with their tool budget");
  assert.equal(first[0]!.result.relevantFiles[0]!.lines, "3");
  assert.match(summarizeOutcomes(first), /- src\/auth\/session\.ts:3 — validates the cookie/);
  assert.equal(readFileNotes(dataDir)["src/auth/session.ts"]!.note, "validates the cookie", "what it found is kept for the map");

  const again = await runScouts(request(join(dataDir, "tasks", "two")), runner);
  assert.equal(envs.length, 1, "bot-lobby's own writes under .pi do not count as a change");
  assert.ok(again[0]!.reused);
  assert.match(summarizeOutcomes(again), /reused from .* UTC: same question, tree unchanged/);

  await runScouts({ ...request(join(dataDir, "tasks", "three")), instruction: "Where do sessions expire?" }, runner);
  assert.equal(envs.length, 2, "another question runs");
  writeFileSync(join(root, "src/router.ts"), "/** Hash routing. */\nexport function route(path: string) {}\n");
  await runScouts(request(join(dataDir, "tasks", "four")), runner);
  assert.equal(envs.length, 3, "an edit anywhere in the tree runs it again");
  await runScouts({ ...request(join(dataDir, "tasks", "five")), config: resolveConfig({ workflow: { reuseScouts: false } }) }, runner);
  assert.equal(envs.length, 4, "workflow.reuseScouts off always runs");

  const before = await treeState(root, [dataDir]);
  writeFileSync(join(root, "notes.txt"), "untracked\n");
  assert.notEqual(await treeState(root, [dataDir]), before, "a new untracked file changes the tree");
  assert.equal(await treeState(mkdtempSync(join(tmpdir(), "bl-plain-"))), undefined, "outside git there is no tree state, so nothing is reused");
});

test("a tool budget warns once at 60%, refuses past the limit, and stops a run that keeps calling", async () => {
  assert.deepEqual(toolBudgetEnv(0), {}, "0 is no limit");
  const handlers = new Map<string, (event: Record<string, unknown>) => unknown>();
  const pi = { on: (name: string, handler: (event: Record<string, unknown>) => unknown) => handlers.set(name, handler) } as unknown as ExtensionAPI;
  registerToolBudget(pi, { warnAt: 3, max: 5 });
  const call = (nested = false) => handlers.get("tool_call")!({ toolName: "read", toolCallId: "c", ...(nested ? { parentToolCallId: "p" } : {}) }) as { block?: boolean; reason?: string; terminate?: boolean } | undefined;
  const result = () => handlers.get("tool_result")!({ content: [{ type: "text", text: "file" }] }) as { content: Array<{ text: string }> } | undefined;

  assert.equal(call(), undefined);
  assert.equal(call(true), undefined, "calls a tool makes for the agent do not count");
  assert.equal(call(), undefined);
  assert.equal(result(), undefined, "no warning before 60%");
  assert.equal(call(), undefined);
  assert.match(result()!.content.at(-1)!.text, /3 of your 5 tool calls are used\. Stop exploring/);
  assert.equal(result(), undefined, "warned once");
  call();
  call();
  const refused = call();
  assert.equal(refused?.block, true);
  assert.match(refused!.reason!, /5 tool calls are spent.*Write your report now/);
  assert.equal(refused?.terminate, undefined);
  for (let index = 2; index < MAX_REFUSALS; index += 1) call();
  assert.equal(call()?.terminate, true, "an agent that ignores the refusals is stopped");
  assert.equal(resolveConfig({ scout: { maxToolCalls: -3 } }).scout.maxToolCalls, DEFAULT_CONFIG.scout.maxToolCalls);
  assert.equal(resolveConfig({ scout: { maxToolCalls: 0 } }).scout.maxToolCalls, 0);
});
