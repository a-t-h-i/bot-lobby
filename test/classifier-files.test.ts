import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Classifier } from "../src/classifier/classifier.ts";
import type { Answer, FetchLike, Question } from "../src/classifier/client.ts";
import { ANY_RELEVANT_FLOOR, BATCH_SIZE, FIND_FILES_TOOL, excerptOf, excludedBy, fileCachePath, fileHinter, indexFiles, likelyFiles, likelyFilesBlock, prefilter, rankRequests, SECRET_EXCLUDES, terms, type FileHinter, type IndexedFile } from "../src/classifier/files.ts";
import { findRelevantFiles, formatLikely, registerClassifierTools } from "../src/classifier/tools.ts";
import { DEFAULT_CONFIG, type ClassifierConfig } from "../src/schemas/configuration.ts";
import { runScouts, runWorker } from "../src/master/master.ts";
import { QuickFixQueue } from "../src/lobby/quickfix.ts";
import { PlanningSession } from "../src/lobby/planner.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

function tempDir(prefix = "bl-files-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function write(root: string, path: string, text: string | Buffer): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
}

test("path globs: ** spans directories, * stays in one, a bare name matches the file name; secrets are always out", () => {
  const out = excludedBy(["docs/**", "*.snap", "fixtures/*.json"]);
  assert.ok(out("docs/a/b.md"));
  assert.ok(out("src/x/__snapshots__/a.snap"));
  assert.ok(out("fixtures/one.json"));
  assert.equal(out("fixtures/deep/one.json"), false);
  assert.equal(out("src/docs.ts"), false);
  const secret = excludedBy(SECRET_EXCLUDES);
  for (const path of [".env", "app/.env.local", "certs/server.pem", "deploy/id_ed25519", "config/secrets/prod.yml", "home/.ssh/config", "k8s/app-secrets.yaml", ".npmrc"]) assert.ok(secret(path), path);
  for (const path of ["src/secretManager.ts", "src/env.ts", "README.md"]) assert.equal(secret(path), false, path);
});

test("an excerpt keeps the leading comment, signatures (headings for Markdown) and imports, never the whole file", () => {
  const ts = [
    "/**",
    " * Session cookies: signing and validation.",
    " */",
    "import { createHmac } from \"node:crypto\";",
    "import { config } from \"./config.ts\";",
    "",
    "export function signCookie(value: string): string {",
    "  return createHmac(\"sha256\", config.secret).update(value).digest(\"hex\");",
    "}",
    "",
    "export async function validateCookie(raw: string) {",
    "  const body = raw.split('.');",
    "}",
  ].join("\n");
  const excerpt = excerptOf("src/auth/cookies.ts", ts);
  assert.match(excerpt, /^Session cookies: signing and validation\.\nexport function signCookie\(value: string\): string\nexport async function validateCookie\(raw: string\)\nimport \{ createHmac \}/);
  assert.doesNotMatch(excerpt, /digest/, "function bodies stay out");
  assert.match(excerptOf("tools/run.py", "#!/usr/bin/env python\n# Runs the nightly export.\nimport os\n\ndef main():\n    pass\nclass Exporter:\n    pass\n"), /^Runs the nightly export\.\ndef main\(\):\nclass Exporter:\nimport os$/);
  assert.equal(excerptOf("docs/guide.md", "# Guide\n\nSome text.\n\n## Install\n\nMore.\n"), "# Guide\n## Install");
  assert.equal(excerptOf("data.csv", "a,b\n1,2\n"), "a,b\n1,2", "the first lines when nothing else fits");
  assert.ok(excerptOf("big.ts", Array.from({ length: 200 }, (_, i) => `export const value${i} = function () {};`).join("\n")).length <= 400);
});

test("the index lists what git would track, skips secrets, binaries, lockfiles and bot-lobby's own state, and caches excerpts", async () => {
  const root = tempDir();
  write(root, "src/auth/cookies.ts", "// Cookie signing.\nexport function sign() {}\n");
  write(root, "src/ui/Login.tsx", "export function Login() {}\n");
  write(root, ".env", "TOKEN=abc\n");
  write(root, "package-lock.json", "{}\n");
  write(root, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  write(root, "blob.dat", Buffer.from([1, 0, 2, 3]));
  write(root, ".pi/bot-lobby/metrics.jsonl", "{}\n");
  write(root, "ignored/out.txt", "x\n");
  write(root, ".gitignore", "ignored/\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  const scope = { cwd: root, root, configDir: ".pi" };
  const first = await indexFiles(scope, ["src/ui/**"]);
  assert.deepEqual(first.map((file) => file.path).sort(), [".gitignore", "src/auth/cookies.ts"], "untracked files count; ignored, excluded, secret, binary and lock files do not");
  assert.equal(first.find((file) => file.path === "src/auth/cookies.ts")!.excerpt, "Cookie signing.\nexport function sign()");
  const cache = JSON.parse(readFileSync(fileCachePath(scope), "utf8")) as { files: Record<string, { excerpt: string }> };
  assert.deepEqual(Object.keys(cache.files).sort(), [".gitignore", "src/auth/cookies.ts"]);

  // An unchanged file comes from the cache; a changed one is read again.
  cache.files["src/auth/cookies.ts"]!.excerpt = "from the cache";
  writeFileSync(fileCachePath(scope), JSON.stringify(cache));
  assert.equal((await indexFiles(scope, ["src/ui/**"])).find((file) => file.path === "src/auth/cookies.ts")!.excerpt, "from the cache");
  write(root, "src/auth/cookies.ts", "// Cookie signing and validation.\nexport function sign() {}\nexport function validate() {}\n");
  utimesSync(join(root, "src/auth/cookies.ts"), new Date(), new Date(Date.now() + 5000));
  assert.match((await indexFiles(scope, ["src/ui/**"])).find((file) => file.path === "src/auth/cookies.ts")!.excerpt, /validate/);

  // Outside git, the tree is walked, skipping dependency and build directories.
  const plain = tempDir();
  write(plain, "lib/a.js", "export const a = 1;\n");
  write(plain, "node_modules/x/index.js", "module.exports = 1;\n");
  write(plain, "dist/a.js", "x\n");
  assert.deepEqual((await indexFiles({ cwd: plain, root: plain, configDir: ".pi" })).map((file) => file.path), ["lib/a.js"]);
});

function files(n: number, match?: (i: number) => string): IndexedFile[] {
  return Array.from({ length: n }, (_, i) => ({ path: match?.(i) ?? `src/deep/dir/file${i}.ts`, excerpt: `export const x${i} = 1;` }));
}

test("the prefilter keeps a small repository whole and ranks a large one by shared words, path first", () => {
  assert.deepEqual(terms("validateSessionCookie in the auth_module"), ["validate", "session", "cookie", "auth", "module"]);
  const small = files(5);
  assert.equal(prefilter("anything", small, 10).length, 5);
  const many = [...files(30), { path: "src/auth/session.ts", excerpt: "export function check()" }, { path: "src/misc.ts", excerpt: "// session helpers" }, { path: "README.md", excerpt: "# Project" }];
  const kept = prefilter("validate the session", many, 3).map((file) => file.path);
  assert.deepEqual(kept, ["src/auth/session.ts", "src/misc.ts", "README.md"], "path match, excerpt match, then the shallowest file");
});

test("ranking requests split into batches, each with one yes/no per file and an any-relevant check", () => {
  const batches = rankRequests("where cookies are validated", files(BATCH_SIZE * 2 + 20), "the task");
  assert.deepEqual(batches.map((batch) => batch.keys.size), [BATCH_SIZE, BATCH_SIZE, 20]);
  const first = batches[0]!;
  assert.equal(Object.keys(first.request.questions).length, BATCH_SIZE + 1);
  assert.ok(first.request.questions.any_relevant);
  assert.match(String(first.request.questions.c1!.instructions), /Would an agent doing `query` need to read or change `candidates\.c1`/);
  const state = first.request.state as { query: string; context: string; candidates: Record<string, string> };
  assert.equal(state.context, "the task");
  assert.equal(state.candidates.c1, "src/deep/dir/file0.ts\nexport const x0 = 1;");
  assert.equal(batches[1]!.keys.get("c151"), "src/deep/dir/file150.ts", "keys keep counting across batches");
});

/** A fake Jev: each candidate's relevance from `relevance(path)`, any-relevant from `any`. */
function rankingJev(relevance: (path: string) => number, any = 0.9, calls: number[] = [], delayMs = 0): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { state: { candidates: Record<string, string> }; questions: Record<string, Question> };
    calls.push(Object.keys(body.questions).length);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    init.signal?.throwIfAborted();
    const answers: Record<string, Answer> = {};
    for (const key of Object.keys(body.questions)) {
      const text = body.state.candidates[key];
      answers[key] = { type: "noul", noul: key === "any_relevant" ? any : relevance(text!.split("\n")[0]!) };
    }
    return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
  };
}

function jev(fetch: FetchLike, overrides: Partial<ClassifierConfig> = {}): Classifier {
  return new Classifier({ config: () => ({ ...DEFAULT_CONFIG.classifier, enabled: true, ...overrides }), keys: async () => "ts_key", fetch, sleep: async () => {} });
}

function repo(): { scope: { cwd: string; root: string; configDir: string } } {
  const root = tempDir();
  write(root, "src/auth/cookies.ts", "// Cookie signing and validation.\nexport function validate() {}\n");
  write(root, "src/auth/cookies.test.ts", "describe(\"cookies\", () => {});\n");
  write(root, "src/ui/Button.tsx", "export function Button() {}\n");
  write(root, "README.md", "# App\n");
  return { scope: { cwd: root, root, configDir: ".pi" } };
}

test("likely files: the classifier judges every candidate, the list keeps the relevant ones, and a weak signal shows nothing", async () => {
  const { scope } = repo();
  const scores: Record<string, number> = { "src/auth/cookies.ts": 0.95, "src/auth/cookies.test.ts": 0.7, "src/ui/Button.tsx": 0.1, "README.md": 0.3 };
  const calls: number[] = [];
  const result = await likelyFiles(jev(rankingJev((path) => scores[path] ?? 0, 0.9, calls)), scope, "validate session cookies");
  assert.deepEqual(result!.files, [{ path: "src/auth/cookies.ts", relevance: 0.95 }, { path: "src/auth/cookies.test.ts", relevance: 0.7 }]);
  assert.equal(result!.judged, 4);
  assert.deepEqual(calls, [5], "four files and the any-relevant check, in one call");
  const block = likelyFilesBlock(result);
  assert.match(block, /^## Likely files\n\nThe classifier ranked these[\s\S]*\n- `src\/auth\/cookies\.ts` \(0\.95\)\n- `src\/auth\/cookies\.test\.ts` \(0\.70\)$/);
  assert.equal(likelyFilesBlock({ ...result!, anyRelevant: ANY_RELEVANT_FLOOR - 0.01 }), "", "nothing stands out: no list");
  assert.equal((await likelyFiles(jev(rankingJev(() => 0.9)), scope, "x", { topK: 1 }))!.files.length, 1);
  assert.equal(await likelyFiles(jev(rankingJev(() => 0.9), { enabled: false }), scope, "x"), undefined);
  assert.equal(await likelyFiles(jev(rankingJev(() => 0.9), { features: { ...DEFAULT_CONFIG.classifier.features, files: false } }), scope, "x"), undefined);
  assert.equal(await likelyFiles(jev(rankingJev(() => 0.9, 0.9, [], 200)), scope, "x", { budgetMs: 20 }), undefined, "out of time: the agent starts without hints");
});

test("the hinter gives agents a block and the lookup tool only while file hints are on", async () => {
  const { scope } = repo();
  const logged: string[] = [];
  const on = fileHinter(jev(rankingJev((path) => (path.includes("cookies.ts") ? 0.9 : 0.1))), scope, (text) => logged.push(text));
  assert.deepEqual(on.tools(), [FIND_FILES_TOOL]);
  assert.match(await on.block("validate cookies"), /`src\/auth\/cookies\.ts` \(0\.90\)/);
  assert.match(logged[0]!, /^likely files: src\/auth\/cookies\.ts \(0\.90\) · \d+ ms$/);
  const off = fileHinter(jev(rankingJev(() => 0.9), { enabled: false }), scope);
  assert.deepEqual(off.tools(), []);
  assert.equal(await off.block("x"), "");
});

test("find_relevant_files ranks by description inside a subagent, and says so when it cannot", async () => {
  const { scope } = repo();
  const answer = await findRelevantFiles(jev(rankingJev((path) => (path === "src/auth/cookies.ts" ? 0.93 : 0.2))), scope, "where cookies are validated", 3);
  assert.match(answer, /^Files most likely needed for "where cookies are validated" \(any file relevant: 0\.90; 4 judged\):\n1\. src\/auth\/cookies\.ts — 0\.93\nRead the top ones first/);
  assert.match(await findRelevantFiles(jev(rankingJev(() => 0.9), { enabled: false }), scope, "x", 3), /file hints are off; search with grep and find/);
  assert.match(await findRelevantFiles(jev(rankingJev(() => 0.9)), undefined, "x", 3), /No session scope yet/);
  assert.match(formatLikely("q", { files: [], anyRelevant: 0.1, judged: 9, ms: 1 }), /No file stands out for "q" \(any file relevant: 0\.10, 9 judged\)/);
  const registered: Array<{ name: string }> = [];
  registerClassifierTools({ registerTool: (tool: { name: string }) => registered.push(tool) } as never);
  assert.deepEqual(registered.map((tool) => tool.name), [FIND_FILES_TOOL]);
});

const HINTS: FileHinter = { block: async (query) => `## Likely files\n\n- \`src/api.ts\` (0.91) for ${query.split("\n")[0]}`, tools: () => [FIND_FILES_TOOL] };

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/served", stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } });
}

/** A fake pi that records its tools and system prompt, answering with `text`. */
function recorder(text: string, seen: Array<{ tools: string; system: string; task: string }>): ProcessRunner {
  return async (args, options) => {
    const file = args[args.indexOf("--append-system-prompt") + 1];
    seen.push({ tools: args[args.indexOf("--tools") + 1] ?? "", system: file ? readFileSync(file, "utf8") : "", task: options.prompt ?? "" });
    return { exitCode: 0, stdout: reply(text), stderr: "", killed: false, timedOut: false };
  };
}

test("scouts and workers start with their likely files and may look more up; the file desk's tools stay", async () => {
  const seen: Array<{ tools: string; system: string; task: string }> = [];
  const data = tempDir();
  await runScouts({ taskId: "T", taskText: "Add pagination", instruction: "Find the list endpoints.", domains: ["backend"], cwd: data, dataRoots: [data], taskDir: tempDir(), config: DEFAULT_CONFIG, hints: HINTS }, recorder("## Scope\nx", seen));
  assert.equal(seen[0]!.tools, `read,grep,find,ls,${FIND_FILES_TOOL}`);
  assert.match(seen[0]!.system, /## Workflow Context\n\nTask state: scouting[\s\S]*## Likely files\n\n- `src\/api\.ts` \(0\.91\) for Find the list endpoints\./);
  await runWorker({ taskId: "T", domain: "backend", instruction: "Step 2: add the cursor param", taskText: "Add pagination", scoutOutcomes: [], cwd: data, dataRoots: [data], config: DEFAULT_CONFIG, hints: HINTS, agent: { extraTools: ["claim_file", "handover_file"] } }, recorder("## Completed\nx", seen));
  assert.equal(seen[1]!.tools, `read,bash,edit,write,grep,find,ls,claim_file,handover_file,${FIND_FILES_TOOL}`);
  assert.match(seen[1]!.system, /## Likely files\n\n- `src\/api\.ts` \(0\.91\) for Step 2: add the cursor param/);
  await runWorker({ taskId: "T", domain: "backend", instruction: "x", taskText: "y", scoutOutcomes: [], cwd: data, dataRoots: [data], config: DEFAULT_CONFIG }, recorder("## Completed\nx", seen));
  assert.equal(seen[2]!.tools, "read,bash,edit,write,grep,find,ls", "no hints, no change");
  assert.doesNotMatch(seen[2]!.system, /## Likely files/);
});

test("a quick fix and a planning round get their likely files too", async () => {
  const root = tempDir();
  const seen: Array<{ tools: string; system: string; task: string }> = [];
  const queue = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "low", timeoutMs: 60_000 }), runProcess: recorder("## Done\nx", seen), hints: HINTS });
  queue.submit("rename getUser");
  for (let i = 0; i < 20 && queue.running; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(seen[0]!.task, /^Task: rename getUser\n\n## Likely files/);
  assert.ok(seen[0]!.tools.endsWith(`,${FIND_FILES_TOOL}`));

  const session = new PlanningSession({ cwd: root, root, configDir: ".pi", panel: ["qa"], profile: () => ({ thinking: "high", timeoutMs: 60_000 }), runProcess: recorder("## Status\nREADY\n## Plan\n1. x", seen), hints: HINTS });
  await session.send("dark mode");
  const round = seen.slice(1);
  assert.equal(round.length, 2, "QA, then the oracle");
  assert.ok(round.every((call) => /## Likely files\n\n- `src\/api\.ts` \(0\.91\) for dark mode/.test(call.task)), "ranked once for the round, read by every seat and the oracle");
  assert.ok(round.every((call) => call.tools.endsWith(`,${FIND_FILES_TOOL}`)));
});
