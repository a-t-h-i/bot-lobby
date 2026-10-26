import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftAssignments, draftAssignmentsNote, stepDomain, stepFiles } from "../src/workflow/draft-assignments.ts";
import { prefetchDomains, startScoutPrefetch, stopScoutPrefetch, takeScoutPrefetch } from "../src/master/scout-prefetch.ts";
import { readOnlyAssignment, runWorker, type ScoutOutcome, type WorkerRequest } from "../src/master/master.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";
import { createTask, type TaskTriage } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask } from "../src/state/persistence.ts";
import { assignmentChecks, prefetchScouts, runWorkflowAction, type WorkflowDeps } from "../src/workflow/workflow.ts";
import type { WorkerAssignment } from "../src/execution/assignment.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "speed-ups-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "src", "b.ts"), "export const b = 1;\n");
  writeFileSync(join(root, "src", "c.ts"), "export const c = 1;\n");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("drafts name the files a step names, mark new ones create, and drop what is not in the project", () => {
  const { root, cleanup } = repo();
  try {
    assert.deepEqual(stepFiles("Change `src/a.ts:12` and see https://x.dev/a.html and ../outside.ts", root).map((file) => `${file.path}:${file.access}`), ["src/a.ts:edit"]);
    assert.deepEqual(stepFiles("Create a new module `src/new.ts` beside src/a.ts", root).map((file) => `${file.path}:${file.access}`), ["src/new.ts:create", "src/a.ts:edit"]);
    assert.deepEqual(stepFiles("Mention src/missing.ts without creating it", root), []);
    assert.equal(stepDomain("(backend) wire it"), "backend");
    assert.equal(stepDomain("[DESIGN] restyle the picker"), "designer");
    assert.equal(stepDomain("Do the thing"), undefined);
  } finally { cleanup(); }
});

test("small consecutive steps of one domain fold into one draft; bigger or mixed ones stay apart", () => {
  const { root, cleanup } = repo();
  try {
    const plan = [
      "## Steps",
      "1. (backend) Rename the export in `src/a.ts`.",
      "2. (backend) Update the caller in `src/b.ts`.",
      "3. (backend) Rework `src/b.ts` and `src/c.ts` together.",
      "4. (designer) Restyle `src/c.ts`.",
      "5. (backend) Tidy `src/a.ts`.",
    ].join("\n");
    const drafts = draftAssignments(plan, root);
    assert.deepEqual(drafts.map((draft) => draft.steps), [[1, 2], [3], [4], [5]]);
    assert.equal(drafts[0]!.id, "steps-1-2");
    assert.deepEqual(drafts[0]!.actions.map((action) => action.step), [1, 2]);
    assert.deepEqual(drafts[0]!.files.map((file) => file.path), ["src/a.ts", "src/b.ts"]);
    assert.match(draftAssignmentsNote(drafts), /Steps 1-2 → id "steps-1-2", domain backend.*folded/);
  } finally { cleanup(); }
});

const triage = (domains: TaskTriage["domains"]): TaskTriage => ({ size: "medium", sizeConfidence: 0.8, domains, research: 0, ambiguous: 0, at: "now" });

test("the opening scout covers the triage's likely domains, QA only when clear", () => {
  assert.deepEqual(prefetchDomains(undefined), []);
  assert.deepEqual(prefetchDomains(triage({ backend: 0.9, designer: 0.2, qa: 0.4 })), ["backend"]);
  assert.deepEqual(prefetchDomains(triage({ backend: 0.5, designer: 0.6, qa: 0.7 })), ["backend", "designer", "qa"]);
});

function outcome(domain: "backend" | "designer" | "qa", run: AgentRun, usable = true): ScoutOutcome {
  return { result: { domain, role: "scout", scope: "", findings: [], relevantFiles: [], risks: [], confidence: "High", raw: "" } as never, run, issues: [], usable };
}
const run = (id: string, status: AgentRun["status"] = "success") => ({ runId: id, status, taskId: "T", domain: "backend", role: "scout", instruction: "", output: "", attempts: 1, startedAt: "now" }) as AgentRun;

test("a prefetch is taken whole when it covers the ask, and stopped (its runs still handed over) when it does not", async () => {
  startScoutPrefetch("T1", ["backend", "qa"], async (_signal, onRun) => { onRun(run("r1")); return [outcome("backend", run("r1")), outcome("qa", run("r1"))]; });
  const taken = await takeScoutPrefetch("T1", ["backend"]);
  assert.deepEqual(taken?.outcomes?.map((entry) => entry.result.domain), ["backend"]);
  assert.deepEqual(taken?.runs.map((entry) => entry.runId), ["r1"]);
  assert.equal(await takeScoutPrefetch("T1", ["backend"]), undefined, "taken once");

  let stopped = false;
  startScoutPrefetch("T2", ["backend"], (signal, onRun) => new Promise((resolve) => signal.addEventListener("abort", () => { stopped = true; onRun(run("r2", "cancelled")); resolve([]); })));
  const missed = await takeScoutPrefetch("T2", ["designer"]);
  assert.equal(stopped, true);
  assert.equal(missed?.outcomes, undefined);
  assert.deepEqual(missed?.runs.map((entry) => entry.status), ["cancelled"]);
  assert.equal(await stopScoutPrefetch("none"), undefined);
});

const evidence = (domain: string) => `## Scope\n${domain} code\n## Findings\n- ${domain} contract verified\n## Relevant Files\n- \`src/a.ts:1\` — implementation\n## Risks\n- none\n## Confidence\nHigh`;
const reply = (text: string) => ({ exitCode: 0, killed: false, stderr: "", stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 5, output: 2, cost: { total: 0.1 } } } }) });

test("the oracle's first scout call returns the scout that started with the task, without a second run", async () => {
  const { root, cleanup } = repo();
  try {
    ensureProjectStructure(root, ".pi");
    const task = createTask("TASK-prefetch", "Change a", "now", "Change the contract in src/a.ts");
    task.triage = triage({ backend: 0.9 });
    task.track = { path: "full", roster: ["backend"] } as never;
    createTaskDir(root, ".pi", task);
    let processes = 0;
    const deps: WorkflowDeps = {
      root, cwd: root, configDir: ".pi", config: resolveConfig({ workflow: { reuseScouts: false, maxAgentRetries: 0 } }),
      ask: async () => undefined, choose: async () => undefined, notify: () => {},
      runProcess: async () => { processes++; return reply(evidence("backend")); },
    };
    assert.deepEqual(prefetchScouts(task, deps.config, () => deps), ["backend"]);
    assert.deepEqual(prefetchScouts({ ...task, id: "TASK-fast", track: { path: "fast", roster: ["backend"] } as never }, deps.config, () => { throw new Error("not built for the fast track"); }), []);
    const result = await runWorkflowAction({ action: "scout", taskId: task.id, domains: ["backend"] }, deps);
    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /started with the task/);
    assert.equal(processes, 1);
    assert.equal(result.runs?.filter((entry) => entry.role === "scout").length, 1, "its run is accounted once");
    assert.equal(loadTask(root, ".pi", task.id)?.state, "synthesizing");
  } finally { cleanup(); }
});

function brief(files: WorkerAssignment["files"], tools: string[] = ["read"]): WorkerAssignment {
  return { id: "look", revision: 1, objective: "Look", actions: [{ step: 1, instruction: "Read" }], files, contracts: [], constraints: [], exclusions: [], tools: tools.map((name) => ({ name, purpose: "x" })), verification: ["Report"], evidence: [], completedWork: [], needs: [] };
}

test("a read-only assignment runs on the scout's model and thinking; an editing one keeps the worker's", async () => {
  const { root, cleanup } = repo();
  try {
    assert.equal(readOnlyAssignment(brief([{ path: "src/a.ts", access: "reference", purpose: "x" }])), true);
    assert.equal(readOnlyAssignment(brief([{ path: "src/a.ts", access: "reference", purpose: "x" }], ["read", "edit"])), false);
    assert.equal(readOnlyAssignment(brief([{ path: "src/a.ts", access: "edit", purpose: "x" }])), false);
    const config = resolveConfig({ scout: { model: "cheap/scout" }, agents: { backend: { model: "big/worker", thinking: "high" } }, workflow: { maxAgentRetries: 0 } });
    const models: string[] = [];
    const request = (assignment: WorkerAssignment): WorkerRequest => ({ taskId: "T", domain: "backend", instruction: "Look", taskText: "Look", scoutOutcomes: [], cwd: root, dataRoots: [join(root, "data")], config, assignment });
    const runner = async (args: string[]) => { models.push(`${args[args.indexOf("--model") + 1]} ${args[args.indexOf("--thinking") + 1]}`); return { exitCode: 1, killed: false, stderr: "stop", stdout: "" }; };
    await runWorker(request(brief([{ path: "src/a.ts", access: "reference", purpose: "x" }])), runner);
    await runWorker(request({ ...brief([{ path: "src/a.ts", access: "edit", purpose: "x" }], ["read", "edit"]), id: "edit" }), runner);
    assert.deepEqual(models, ["cheap/scout low", "big/worker high"]);
    const off = resolveConfig({ ...config, workflow: { ...config.workflow, readOnlyOnScoutModel: false } });
    models.length = 0;
    await runWorker({ ...request({ ...brief([{ path: "src/a.ts", access: "reference", purpose: "x" }]), id: "off" }), config: off }, runner);
    assert.deepEqual(models, ["big/worker high"]);
  } finally { cleanup(); }
});

test("QA starts from the assignments' files and verification; a clean review leaves out the worker's account", () => {
  const task = createTask("TASK-qa", "QA", "now", "x");
  assert.equal(assignmentChecks(task), "");
  task.workerAssignments = [{
    domain: "backend", brief: { ...brief([{ path: "src/a.ts", access: "edit", purpose: "x" }, { path: "src/b.ts", access: "reference", purpose: "y" }]), verification: ["npm test -- a"] }, revisions: [],
    outcomes: [{ revision: 1, runId: "r", status: "success", completedWork: [], needs: [], issues: [], verification: "- npm test -- a — pass" }],
  }];
  const checks = assignmentChecks(task);
  assert.match(checks, /look r1 \(backend\): may change src\/a\.ts; verify with "npm test -- a"; the worker reported: - npm test -- a — pass/);
  assert.doesNotMatch(assignmentChecks(task, true), /worker reported/);
  task.workerAssignments[0]!.outcomes[0]!.status = "failed";
  assert.equal(assignmentChecks(task), "");
  assert.ok(DEFAULT_CONFIG.workflow.prefetchScout && DEFAULT_CONFIG.workflow.readOnlyOnScoutModel);
});
