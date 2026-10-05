import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PLAN_STEPS, explicitStepIndex, planChecklist, planDetails, planSteps } from "../src/pi/plan-checklist.ts";
import { createTask, type Task } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: "r1",
    taskId: "TASK-1",
    domain: "backend",
    role: "scout",
    status: "running",
    output: "",
    attempts: 1,
    startedAt: "2026-01-01T00:09:50.000Z",
    ...overrides,
  };
}

function plan(...steps: string[]): string {
  return ["Objective: ship it", ...steps.map((step, index) => `${index + 1}. ${step}`)].join("\n");
}

function worker(runId: string, instruction: string, minute: number, status: AgentRun["status"] = "success"): AgentRun {
  const at = (second: number) => `2026-01-01T00:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;
  return run({ runId, role: "worker", status, instruction, startedAt: at(0), ...(status === "running" ? {} : { finishedAt: at(30) }) });
}

const statuses = (steps: ReturnType<typeof planChecklist>) => steps.map((step) => step.status);

test("planSteps keeps numbered steps and ignores everything else", () => {
  const steps = planSteps(
    [
      "Objective: ship it",
      "1. `src/a.ts`: add the thing",
      "   - a sub bullet",
      "2. `src/b.ts`: wire it up",
      "Notes:",
      "3. `src/c.ts`: test it",
    ].join("\n"),
  );
  assert.deepEqual(steps, ["`src/a.ts`: add the thing", "`src/b.ts`: wire it up", "`src/c.ts`: test it"]);
});

test("planSteps accepts both `1.` and `1)` numbering", () => {
  const steps = planSteps(["1) `src/a.ts`: first", "  2. `src/b.ts`: second", "3) `src/c.ts`: third"].join("\n"));
  assert.deepEqual(steps, ["`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third"]);
});

test("planSteps caps the number of parsed steps", () => {
  const many = Array.from({ length: MAX_PLAN_STEPS + 20 }, (_value, index) => `${index + 1}. \`src/f${index}.ts\`: step`).join("\n");
  const steps = planSteps(many);
  assert.equal(steps.length, MAX_PLAN_STEPS);
  assert.equal(steps.at(-1), `\`src/f${MAX_PLAN_STEPS - 1}.ts\`: step`);
});

test("planSteps parses a top-level bullet plan when no numbered steps exist", () => {
  const steps = planSteps(["- `src/x.ts`: one", "- `src/y.ts`: two"].join("\n"));
  assert.deepEqual(steps, ["`src/x.ts`: one", "`src/y.ts`: two"]);
});

test("planSteps reads only the sequence section and skips unrelated bullets", () => {
  const text = [
    "# Objective",
    "- ship the feature quickly",
    "- keep the change small",
    "",
    "## Files",
    "- `src/ignored.ts`",
    "",
    "## Sequence",
    "1. `src/a.ts`: first",
    "- `src/b.ts`: second",
    "",
    "## Notes",
    "- not a step",
  ].join("\n");
  assert.deepEqual(planSteps(text), ["`src/a.ts`: first", "`src/b.ts`: second"]);
});

test("planChecklist marks earlier steps done and the matched step current", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third");
  const checklist = planChecklist(steps, [run({ role: "worker", instruction: "Please implement `src/b.ts` now" })]);
  assert.deepEqual(checklist.map((step) => step.status), ["done", "current", "pending"]);
  assert.deepEqual(checklist.map((step) => step.text), ["`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third"]);
});

test("planChecklist matches a step by its text prefix", () => {
  const steps = plan("Fix the parser bug", "Add a regression test");
  const checklist = planChecklist(steps, [run({ role: "worker", instruction: "Fix the parser bug in the tokenizer" })]);
  assert.deepEqual(checklist.map((step) => step.status), ["current", "pending"]);
});

test("planChecklist falls back to the first step as current when nothing matches", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second");
  const unmatched = planChecklist(steps, [run({ role: "worker", instruction: "do something unrelated" })]);
  assert.deepEqual(unmatched.map((step) => step.status), ["current", "pending"]);
});

test("planChecklist advances by successful worker runs when a later call matches nothing", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third");
  const workers = [
    run({ runId: "w1", role: "worker", status: "success", instruction: "apply the approved plan change", startedAt: "2026-01-01T00:09:20.000Z", finishedAt: "2026-01-01T00:09:30.000Z" }),
    run({ runId: "w2", role: "worker", status: "success", instruction: "and keep going", startedAt: "2026-01-01T00:09:35.000Z", finishedAt: "2026-01-01T00:09:40.000Z" }),
  ];
  const qa = run({ runId: "q1", domain: "qa", role: "reviewer", instruction: "verify the change", startedAt: "2026-01-01T00:09:50.000Z" });
  assert.deepEqual(planChecklist(steps, [workers[0]!]).map((step) => step.status), ["done", "current", "pending"]);
  assert.deepEqual(planChecklist(steps, workers).map((step) => step.status), ["done", "done", "current"]);
  assert.deepEqual(planChecklist(steps, [...workers, qa]).map((step) => step.status), ["done", "done", "current"]);
});

test("planChecklist with no worker run marks the first step current", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second");
  assert.deepEqual(planChecklist(steps, []).map((step) => step.status), ["current", "pending"]);
  const scoutOnly = [run({ role: "scout", instruction: "inspect `src/b.ts`" })];
  assert.deepEqual(planChecklist(steps, scoutOnly).map((step) => step.status), ["current", "pending"]);
});

test("planChecklist ignores non-worker runs and uses the latest worker run", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third");
  const runs = [
    run({ runId: "r-old", role: "worker", instruction: "implement `src/a.ts`", startedAt: "2026-01-01T00:09:00.000Z" }),
    run({ runId: "r-review", role: "reviewer", instruction: "review `src/b.ts`", startedAt: "2026-01-01T00:09:50.000Z" }),
    run({ runId: "r-new", role: "worker", instruction: "implement `src/c.ts`", startedAt: "2026-01-01T00:09:55.000Z" }),
  ];
  assert.deepEqual(planChecklist(steps, runs).map((step) => step.status), ["done", "done", "current"]);
});

test("planChecklist marks a succeeded step done and opens the next one", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third");
  const runs = [run({ role: "worker", status: "success", instruction: "implement `src/b.ts`", finishedAt: "2026-01-01T00:09:55.000Z" })];
  assert.deepEqual(planChecklist(steps, runs).map((step) => step.status), ["done", "done", "current"]);
});

test("planChecklist marks the final step done once its worker succeeded", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second");
  const runs = [run({ role: "worker", status: "success", instruction: "implement `src/b.ts`", finishedAt: "2026-01-01T00:09:55.000Z" })];
  assert.deepEqual(planChecklist(steps, runs).map((step) => step.status), ["done", "done"]);
});

test("planChecklist keeps a failed step current", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second");
  const runs = [run({ role: "worker", status: "failed", instruction: "implement `src/b.ts`" })];
  assert.deepEqual(planChecklist(steps, runs).map((step) => step.status), ["done", "current"]);
});

test("planChecklist never reverts when a later run names an earlier step", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third");
  const finished = run({ runId: "w1", role: "worker", status: "success", instruction: "implement `src/b.ts`", startedAt: "2026-01-01T00:09:20.000Z", finishedAt: "2026-01-01T00:09:30.000Z" });
  const later = run({ runId: "w2", role: "worker", status: "running", instruction: "revisit `src/a.ts`", startedAt: "2026-01-01T00:09:50.000Z" });
  assert.deepEqual(planChecklist(steps, [finished]).map((step) => step.status), ["done", "done", "current"]);
  assert.deepEqual(planChecklist(steps, [finished, later]).map((step) => step.status), ["done", "done", "current"]);
});

test("planChecklist keeps completed steps through a later QA reviewer call", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third");
  const finished = run({ runId: "w1", role: "worker", status: "success", instruction: "apply the approved plan change", startedAt: "2026-01-01T00:09:20.000Z", finishedAt: "2026-01-01T00:09:30.000Z" });
  const qa = run({ runId: "q1", domain: "qa", role: "reviewer", instruction: "verify `src/a.ts`", startedAt: "2026-01-01T00:09:50.000Z" });
  assert.deepEqual(planChecklist(steps, [finished]).map((step) => step.status), ["done", "current", "pending"]);
  assert.deepEqual(planChecklist(steps, [finished, qa]).map((step) => step.status), ["done", "current", "pending"]);
});

test("planChecklist does not tick a step for a failed or unmatched run", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third");
  const failed = run({ role: "worker", status: "failed", instruction: "do something unrelated" });
  assert.deepEqual(planChecklist(steps, [failed]).map((step) => step.status), ["current", "pending", "pending"]);
  const finished = run({ runId: "w1", role: "worker", status: "success", instruction: "implement `src/a.ts`", startedAt: "2026-01-01T00:09:20.000Z", finishedAt: "2026-01-01T00:09:30.000Z" });
  assert.deepEqual(planChecklist(steps, [finished, failed]).map((step) => step.status), ["done", "current", "pending"]);
});

test("planChecklist advances when later steps reuse an earlier step's file path", () => {
  const steps = plan(
    "Add the `status` field to `src/schema.ts`",
    "Read the new `src/schema.ts` status field in `src/api.ts`",
    "Render the status from `src/api.ts` in `src/ui.ts`",
  );
  const runs = [
    worker("w1", "Add a `status` field to the Task type in `src/schema.ts`.", 1),
    worker("w2", "In `src/api.ts`, read the status field added to `src/schema.ts` and return it.", 2),
  ];
  assert.deepEqual(statuses(planChecklist(steps, runs.slice(0, 1))), ["done", "current", "pending"]);
  assert.deepEqual(statuses(planChecklist(steps, runs)), ["done", "done", "current"]);
  const third = worker("w3", "Render the status returned by `src/api.ts` in `src/ui.ts`.", 3, "running");
  assert.deepEqual(statuses(planChecklist(steps, [...runs, third])), ["done", "done", "current"]);
  assert.deepEqual(statuses(planChecklist(steps, [...runs, { ...third, status: "success" }])), ["done", "done", "done"]);
});

test("planChecklist honours an explicit step label in the instruction", () => {
  const steps = plan("Scaffold the module", "Wire the module into the app", "Write the tests", "Document it");
  const labelled = [worker("w1", "Step 1: scaffold it", 1), worker("w2", "Step 3: write the unit tests (step 2 is done)", 2)];
  assert.deepEqual(statuses(planChecklist(steps, labelled)), ["done", "done", "done", "current"]);
  const ranged = [worker("w1", "Implement steps 1-2 of the plan together", 1)];
  assert.deepEqual(statuses(planChecklist(steps, ranged)), ["done", "done", "current", "pending"]);
  const building = [worker("w1", "Building on step 1, wire everything up", 1, "running")];
  assert.deepEqual(statuses(planChecklist(steps, building)), ["current", "pending", "pending", "pending"]);
});

test("planChecklist advances through a whole plan of reworded, path-sharing instructions", () => {
  const steps = plan(
    "`src/pi/zen.ts`: parse step headings",
    "`src/pi/zen.ts`: score instructions against steps",
    "`src/pi/ui.ts`: replay persisted worker runs",
    "`test/zen.test.ts`: cover the tracker",
  );
  const instructions = [
    "Teach `src/pi/zen.ts` to parse `Step N` headings.",
    "Now in `src/pi/zen.ts` score each worker instruction against every plan step.",
    "Make `src/pi/ui.ts` replay the persisted worker runs from `src/pi/zen.ts`.",
    "Cover the tracker in `test/zen.test.ts`, exercising `src/pi/zen.ts` and `src/pi/ui.ts`.",
  ];
  const runs: AgentRun[] = [];
  instructions.forEach((instruction, index) => {
    runs.push(worker(`w${index}`, instruction, index + 1));
    const done = statuses(planChecklist(steps, [...runs])).filter((status) => status === "done").length;
    assert.equal(done, index + 1, `after worker ${index + 1}`);
  });
});

test("planSteps reads Step headings and ignores the sub-points under each step", () => {
  const text = [
    "## Implementation steps",
    "### Step 1: Add the schema",
    "1. add the field",
    "2. migrate",
    "### Step 2 — Wire the API",
    "- read it",
    "**Step 3:** Render it",
  ].join("\n");
  assert.deepEqual(planSteps(text), ["Add the schema", "Wire the API", "Render it"]);
  const nested = ["1. First", "   1. sub one", "   2. sub two", "   - a bullet", "2. Second", "3. Third"].join("\n");
  assert.deepEqual(planSteps(nested), ["First", "Second", "Third"]);
  const sectioned = ["## Steps", "- First", "  - detail", "- Second"].join("\n");
  assert.deepEqual(planSteps(sectioned), ["First", "Second"]);
});

test("explicitStepIndex reads leading labels and single references only", () => {
  assert.equal(explicitStepIndex("Step 2: wire it", 5), 1);
  assert.equal(explicitStepIndex("steps 2 to 4 together", 5), 3);
  assert.equal(explicitStepIndex("do the thing from step #3", 5), 2);
  assert.equal(explicitStepIndex("after step 1 and before step 4, fix it", 5), -1);
  assert.equal(explicitStepIndex("Step 9: out of range", 5), -1);
  assert.equal(explicitStepIndex("no reference here", 5), -1);
});

test("planChecklist returns the same array for the same plan and runs", () => {
  const steps = plan("`src/a.ts`: first", "`src/b.ts`: second");
  const runs = [worker("w1", "implement `src/a.ts`", 1)];
  assert.equal(planChecklist(steps, runs), planChecklist(steps, runs));
  assert.notEqual(planChecklist(steps, runs), planChecklist(steps, [...runs]));
});

test("a plan that opens with a short steps list keeps it as the checklist, and its Step N detail below stays detail", () => {
  const plan = [
    "## Steps",
    "1. Add the work timer",
    "2. Show it on the task",
    "",
    "## Details",
    "### Step 1: Add the work timer",
    "Files: `src/state/budget.ts`. Done when the clock saves.",
    "### Step 2: Show it on the task",
    "Files: `webui/src/tabs/tasks/TaskDetail.tsx`.",
    "",
    "## Risks",
    "None.",
  ].join("\n");
  assert.deepEqual(planSteps(plan), ["Add the work timer", "Show it on the task"]);
  assert.equal(planDetails(plan), ["## Details", "### Step 1: Add the work timer", "Files: `src/state/budget.ts`. Done when the clock saves.", "### Step 2: Show it on the task", "Files: `webui/src/tabs/tasks/TaskDetail.tsx`.", "", "## Risks", "None."].join("\n"));
  // Step headings that come first still win, and such a plan is read whole.
  const headed = ["### Step 1: Model", "the model", "### Step 2: API", "the api", "## Steps", "1. a summary line"].join("\n");
  assert.deepEqual(planSteps(headed), ["Model", "API"]);
  assert.equal(planDetails(headed), undefined);
  assert.equal(planDetails("## Steps\n1. Only steps"), undefined, "nothing beyond the list");
});
