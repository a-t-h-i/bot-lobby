import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Classifier } from "../src/classifier/classifier.ts";
import type { Answer, FetchLike, Question } from "../src/classifier/client.ts";
import { answerClarify, quickFixSize, repositoryLayout, suggestedPath, triageContext, triageLine, triageRequest, triageTask, triageWithContext } from "../src/classifier/triage.ts";
import { ASK_THE_USER } from "../src/classifier/answers.ts";
import { DEFAULT_CONFIG, type ClassifierConfig } from "../src/schemas/configuration.ts";
import { createTask, type TaskTriage } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { setAutoMode } from "../src/state/auto.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import { masterWorkflowContext } from "../src/pi/events.ts";
import { QuickFixQueue } from "../src/lobby/quickfix.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

const DOMAINS = [{ domain: "designer" as const, owns: "screens" }, { domain: "backend" as const, owns: "APIs" }, { domain: "qa" as const, owns: "tests" }];

interface Script {
  size?: [number, number];
  domains?: Record<string, number>;
  research?: number;
  ambiguous?: number;
  kind?: string;
  /** Choice picks by question text. */
  picks?: Record<string, [string, number]>;
  /** Relevance per file path, for file-ranking calls. */
  files?: Record<string, number>;
}

/** A fake Jev that answers whatever it is asked from a script. */
function scriptedJev(script: Script, calls: Array<Record<string, Question>> = []): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { state: Record<string, unknown>; questions: Record<string, Question> };
    calls.push(body.questions);
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(body.questions)) {
      if (key === "size") answers[key] = { type: "score", score: script.size?.[0] ?? 1, confidence: script.size?.[1] ?? 0.8 };
      else if (key.startsWith("domain_")) answers[key] = { type: "noul", noul: script.domains?.[key.slice(7)] ?? 0 };
      else if (key === "needs_research") answers[key] = { type: "noul", noul: script.research ?? 0.1 };
      else if (key === "ambiguous") answers[key] = { type: "noul", noul: script.ambiguous ?? 0.1 };
      else if (key === "kind") answers[key] = { type: "choice", choice: script.kind ?? "feature", probabilities: { [script.kind ?? "feature"]: 0.8 }, confidence: 0.8 };
      else if (key === "any_relevant") answers[key] = { type: "noul", noul: 0.9 };
      else if (/^c\d+$/.test(key)) {
        const path = String((body.state.candidates as Record<string, string>)[key]).split("\n")[0]!;
        answers[key] = { type: "noul", noul: script.files?.[path] ?? 0.1 };
      } else if (question.type === "choice") {
        const text = String(question.instructions);
        const match = Object.entries(script.picks ?? {}).find(([needle]) => text.includes(needle));
        const [label, probability] = match?.[1] ?? [ASK_THE_USER, 0.95];
        answers[key] = { type: "choice", choice: label, probabilities: { [label]: probability }, confidence: probability };
      }
    }
    return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
  };
}

function jev(fetch: FetchLike, overrides: Partial<ClassifierConfig> = {}): Classifier {
  return new Classifier({ config: () => ({ ...DEFAULT_CONFIG.classifier, enabled: true, ...overrides }), keys: async () => "ts_key", fetch, sleep: async () => {} });
}

test("triage asks size, domains, research, ambiguity and kind in one call and reads them back", async () => {
  const request = triageRequest({ request: "fix the login redirect", layout: ["src/ (80 files)"], domains: DOMAINS });
  assert.deepEqual(Object.keys(request.questions).sort(), ["ambiguous", "domain_backend", "domain_designer", "domain_qa", "kind", "needs_research", "size"]);
  assert.equal((request.questions.size as Extract<Question, { type: "score" }>).criteria.length, 4);
  assert.deepEqual((request.state as Record<string, unknown>).repository_layout, "src/ (80 files)");
  const calls: Array<Record<string, Question>> = [];
  const triage = await triageTask(jev(scriptedJev({ size: [0.8, 0.9], domains: { backend: 0.93, qa: 0.6, designer: 0.02 }, kind: "bugfix" }, calls)), { request: "fix the login redirect", domains: DOMAINS });
  assert.equal(calls.length, 1);
  assert.equal(triage!.size, "small", "0.8 rounds to level 1");
  assert.equal(triage!.sizeConfidence, 0.9);
  assert.deepEqual(triage!.domains, { designer: 0.02, backend: 0.93, qa: 0.6 });
  assert.equal(triage!.kind, "bugfix");
  assert.equal(await triageTask(jev(scriptedJev({}), { features: { ...DEFAULT_CONFIG.classifier.features, triage: false } }), { request: "x", domains: DOMAINS }), undefined);
});

function triage(overrides: Partial<TaskTriage> = {}): TaskTriage {
  return { size: "small", sizeConfidence: 0.85, domains: { backend: 0.9, qa: 0.3, designer: 0.05 }, research: 0.05, ambiguous: 0.1, kind: "bugfix", kindProbability: 0.8, at: "2026-01-01T00:00:00Z", ...overrides };
}

test("the suggested path: a small one-domain task takes the shortcut; ambiguity clarifies first; research is named", () => {
  assert.match(suggestedPath(triage()), /^single-domain shortcut \(backend\): skip the scout round and the proposal ceremony/);
  assert.equal(suggestedPath(triage({ size: "medium", domains: { backend: 0.9, designer: 0.7 } })), "scout only backend, designer.");
  assert.match(suggestedPath(triage({ ambiguous: 0.7 })), /^clarify first/);
  assert.match(suggestedPath(triage({ size: "large", research: 0.8 })), /scout only backend; summon the researcher/);
  assert.equal(suggestedPath(triage({ domains: {}, size: "medium" })), "no strong signal; decide from the request.");
  const block = triageContext(triage({ likelyFiles: ["src/auth.ts"] }));
  assert.match(block, /^Classifier triage \(hints from a fast model; you decide\):\n- Size: small \(confidence 0\.85\)\n- Domains touched: backend 0\.90 · qa 0\.30 · designer 0\.05\n- Outside research: not needed \(0\.05\)\n- Clear as written \(0\.10\)\n- Kind: bugfix \(0\.80\)\n- Likely files: src\/auth\.ts\n- Suggested path: single-domain shortcut/);
  assert.equal(triageContext(undefined), "");
  assert.equal(triageLine(triage()), "triage: small (0.85) · backend · bugfix");
});

test("a new task's triage carries the repository layout and its likely files, and reaches the Master only while it is being shaped", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-triage-"));
  for (const [path, text] of [["src/auth/login.ts", "export function login() {}\n"], ["src/ui/App.tsx", "export function App() {}\n"], ["README.md", "# App\n"]] as const) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  assert.deepEqual(repositoryLayout([{ path: "src/a.ts", excerpt: "" }, { path: "src/b.ts", excerpt: "" }, { path: "test/a.ts", excerpt: "" }, { path: "README.md", excerpt: "" }]), ["src/ (2 files)", "test/ (1 files)", "README.md"]);
  const calls: Array<Record<string, Question>> = [];
  const read = await triageWithContext(jev(scriptedJev({ domains: { backend: 0.9 }, files: { "src/auth/login.ts": 0.92 } }, calls)), { cwd: root, root, configDir: ".pi" }, "fix the login redirect");
  assert.deepEqual(read!.likelyFiles, ["src/auth/login.ts"]);
  assert.equal(calls.length, 2, "triage and file ranking run side by side");

  const task = createTask("TASK-1", "fix login", "2026-01-01T00:00:00Z", "fix the login redirect");
  task.triage = read!;
  transition(task, "clarifying");
  assert.match(masterWorkflowContext(task), /TASK-1 — state: clarifying[\s\S]*Classifier triage[\s\S]*Likely files: src\/auth\/login\.ts/);
  for (const state of ["scouting", "synthesizing", "awaiting_approval", "planning"] as const) transition(task, state);
  assert.doesNotMatch(masterWorkflowContext(task), /Classifier triage/, "once planned, the hints are noise");

  ensureProjectStructure(root, ".pi");
  createTaskDir(root, ".pi", task);
  saveTask(root, ".pi", task);
  assert.deepEqual(loadTask(root, ".pi", "TASK-1")!.triage, read, "the triage survives a reload");
});

function makeDeps(overrides: Partial<WorkflowDeps> = {}): WorkflowDeps {
  const root = mkdtempSync(join(tmpdir(), "bl-triage-wf-"));
  return { root, configDir: ".pi", cwd: root, config: DEFAULT_CONFIG, ask: async () => undefined, choose: async () => undefined, notify: () => {}, ...overrides };
}

function withTask(deps: WorkflowDeps, states: Array<Parameters<typeof transition>[1]> = []) {
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "Add export", "2026-01-01T00:00:00Z", "add a CSV export to the reports page");
  task.triage = triage();
  createTaskDir(deps.root, deps.configDir, task);
  for (const state of states) transition(task, state);
  saveTask(deps.root, deps.configDir, task);
}

function act(deps: WorkflowDeps, params: Partial<OrchestrateParams>) {
  return runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);
}

test("a clarify question the request already settles is answered by the classifier, with the recommended option only", async () => {
  const asked: string[] = [];
  const classifier = jev(scriptedJev({ picks: { "Which format": ["CSV", 0.96], "Who may export": ["Admins", 0.97] } }));
  const deps = makeDeps({ classifier, choose: async (title) => (asked.push(title), "Everyone") });
  withTask(deps);
  const settled = await act(deps, { action: "clarify", question: "Which format should the export use?", options: ["CSV (Recommended)", "Excel", "JSON"] });
  assert.match(settled.message, /^Answered by the classifier with your recommended option \(0\.96\): CSV\./);
  assert.deepEqual(asked, [], "the user was not asked");
  assert.match(loadTask(deps.root, deps.configDir, "TASK-1")!.decisions.at(-1)!.text, /Answered by the classifier \(0\.96\): Which format should the export use\? → CSV/);

  const disagree = await act(deps, { action: "clarify", question: "Who may export?", options: ["Everyone", "Admins"] });
  assert.match(disagree.message, /User answered: Everyone/, "the classifier's pick is not the recommendation (the first option): the user decides");
  const unsure = await act(deps, { action: "clarify", question: "Should it include archived rows?", options: ["No (Recommended)", "Yes"] });
  assert.match(unsure.message, /User answered/);
  assert.equal(asked.length, 2);

  // In auto mode nobody is asked; an obvious answer still beats "decide it yourself".
  const auto = makeDeps({ classifier });
  withTask(auto);
  setAutoMode(auto.root, auto.configDir, "TASK-1", true);
  assert.match((await act(auto, { action: "clarify", question: "Which format should the export use?", options: ["CSV (Recommended)", "Excel"] })).message, /^Answered by the classifier/);
  assert.match((await act(auto, { action: "clarify", question: "Who may export?", options: ["Everyone", "Admins"] })).message, /Auto mode is on/);
  assert.match(await answerClarify(jev(scriptedJev({})), "q", ["only one"], { request: "r", notes: "" }).then((value) => String(value)), /undefined/, "one option is not a choice");
});

test("an amendment re-reads the request, so the Master's hints follow it", async () => {
  const requests: string[] = [];
  const deps = makeDeps({ choose: async () => "Amend", ask: async () => "Also export to PDF", triage: async (request) => (requests.push(request), triage({ size: "medium", kind: "feature" })) });
  withTask(deps, ["clarifying", "scouting", "synthesizing"]);
  await act(deps, { action: "propose", proposal: "- Add a CSV export button." });
  assert.deepEqual(requests, ["add a CSV export to the reports page\n\nAmendment: Also export to PDF"]);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.triage!.size, "medium");
});

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/served", stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } });
}

async function drain(queue: QuickFixQueue): Promise<void> {
  for (let i = 0; i < 50 && queue.jobs.some((job) => job.status === "queued" || job.status === "running"); i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

test("a quick fix the classifier judges a task is held, not run; r runs it anyway, t moves it to a task", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-qf-"));
  const runs: string[] = [];
  const runner: ProcessRunner = async (_args, options) => (runs.push(options.prompt ?? ""), { exitCode: 0, stdout: reply("## Done\nx"), stderr: "", killed: false, timedOut: false });
  const sizes: Array<[number, number]> = [[3, 0.9], [0.2, 0.9], [3, 0.6], [3, 0.95]];
  const fetch: FetchLike = async (url, init) => scriptedJev({ size: sizes.shift() })(url, init);
  const logged: string[] = [];
  const queue = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "low", timeoutMs: 60_000 }), runProcess: runner, classifier: jev(fetch), feed: { log: (_source: string, text: string) => logged.push(text), step: () => {}, end: () => {}, thought: () => {} } as never });
  const big = queue.submit("rewrite the auth system to use OAuth");
  await drain(queue);
  assert.equal(big.status, "held");
  assert.equal(big.note, "looks like a task (large, 0.90)");
  assert.deepEqual(runs, [], "nothing ran");
  assert.ok(logged.some((line) => /^held: rewrite the auth system to use OAuth — looks like a task \(large, 0\.90\); r runs it anyway, t makes it a task$/.test(line)));

  const small = queue.submit("fix the typo in README");
  await drain(queue);
  assert.equal(small.status, "success");
  const unsure = queue.submit("migrate the settings screen");
  await drain(queue);
  assert.equal(unsure.status, "success", "large but not confident enough: it runs");

  assert.equal(queue.runAnyway(big.id), true);
  await drain(queue);
  assert.equal(big.status, "success", "run anyway: not sized again");
  assert.equal(runs.length, 3);

  const other = queue.submit("replace the database with Postgres");
  await drain(queue);
  assert.equal(other.status, "held");
  assert.equal(queue.movedToTask(other.id), true);
  assert.equal(other.status, "cancelled");
  assert.equal(other.note, "started as a task in a new session");
  assert.equal(queue.runAnyway(small.id), false, "only a held job runs anyway");
  assert.deepEqual(await quickFixSize(jev(scriptedJev({}), { enabled: false }), "x"), undefined);
});
