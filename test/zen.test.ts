import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PANEL_LINES,
  MAX_PLAN_STEPS,
  formatDuration,
  mascotFrame,
  panelLines,
  planChecklist,
  planSteps,
} from "../src/pi/zen.ts";
import { createTask, type Task } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

const NOW = Date.parse("2026-01-01T00:10:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return { ...createTask("TASK-1", "Add pagination", "2026-01-01T00:00:00.000Z"), ...overrides };
}

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

test("no task means no panel lines", () => {
  assert.deepEqual(panelLines(undefined, [], NOW, true), []);
});

test("panel header shows state, elapsed time, and the quiet indicator", () => {
  const hidden = panelLines(task({ state: "scouting" }), [], NOW, true);
  assert.equal(hidden[0], "dev-house TASK-1 · scouting   ⏱ 10m 00s · tools hidden (alt+t)");
  const shown = panelLines(task({ state: "scouting" }), [], NOW, false);
  assert.equal(shown[0], "dev-house TASK-1 · scouting   ⏱ 10m 00s · tools shown");
});

test("panel header marks a paused task", () => {
  const lines = panelLines(task({ state: "implementing", paused: true }), [], NOW, true);
  assert.match(lines[0]!, /implementing \(paused\)/);
});

test("an idle panel waits for the first agent and keeps the mascot", () => {
  const lines = panelLines(task({ state: "scouting" }), [], NOW, true);
  assert.equal(lines[1], "  ○ waiting for the first agent…");
  assert.equal(lines.at(-1), mascotFrame(0).join(" "));
});

test("panel activity shows the latest run's badge, duration, and retries", () => {
  const runs = [
    run({ status: "success", finishedAt: "2026-01-01T00:09:58.000Z" }),
    run({ runId: "r2", domain: "qa", role: "worker", status: "running", attempts: 2 }),
  ];
  const lines = panelLines(task({ state: "implementing" }), runs, NOW, true);
  assert.match(lines[1]!, /◐ qa\/worker\s+running\s+10s ×2/);
});

test("panel activity marks a finished run with a check", () => {
  const runs = [run({ status: "success", finishedAt: "2026-01-01T00:09:55.000Z" })];
  const lines = panelLines(task({ state: "reviewing" }), runs, NOW, true);
  assert.match(lines[1]!, /✓ backend\/scout\s+success\s+5s/);
});

test("panel surfaces pending approvals before blockers", () => {
  const withBoth = task({
    approvals: [
      { id: "APR-1", kind: "dependency", domain: "backend", detail: "install zod", status: "pending", createdAt: "now" },
      { id: "APR-2", kind: "dependency", domain: "backend", detail: "already handled", status: "approved", createdAt: "now" },
    ],
    blockers: [{ domain: "backend", reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }],
  });
  const lines = panelLines(withBoth, [], NOW, true);
  assert.equal(lines[1], "approvals pending: APR-1");
  assert.ok(!lines.some((line) => line.startsWith("blocked:")), "approvals win when both exist");
});

test("panel surfaces a blocker when no approval is pending", () => {
  const blocked = task({
    blockers: [{ domain: "backend", reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }],
  });
  assert.equal(panelLines(blocked, [], NOW, true)[1], "blocked: schema owner must confirm");
});

test("panel shows a checklist window around the current step", () => {
  const steps = ["a", "b", "c", "d", "e", "f", "g", "h"].map((letter) => `\`src/${letter}.ts\`: step ${letter}`);
  const runs = [run({ role: "worker", instruction: "implement `src/e.ts` now" })];
  const lines = panelLines(task({ state: "implementing", plan: plan(...steps) }), runs, NOW, true);
  assert.equal(lines[1], "steps 4/8");
  assert.equal(lines[2], "  ✓ 4. `src/d.ts`: step d");
  assert.equal(lines[3], "  ◐ 5. `src/e.ts`: step e");
  assert.equal(lines[4], "  ○ 6. `src/f.ts`: step f");
  assert.ok(lines.length <= MAX_PANEL_LINES, `panel has ${lines.length} lines`);
});

test("panel never exceeds the 10-line clamp", () => {
  const steps = Array.from({ length: 12 }, (_value, index) => `\`src/f${index}.ts\`: step ${index}`);
  const full = task({ state: "implementing", plan: plan(...steps), paused: true });
  const lines = panelLines(full, [], NOW, true);
  assert.equal(MAX_PANEL_LINES, 10);
  assert.ok(lines.length <= MAX_PANEL_LINES, `panel has ${lines.length} lines`);
  assert.equal(lines.at(-1), mascotFrame(0).join(" "));
});

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

test("planSteps caps the number of parsed steps", () => {
  const many = Array.from({ length: MAX_PLAN_STEPS + 20 }, (_value, index) => `${index + 1}. \`src/f${index}.ts\`: step`).join("\n");
  const steps = planSteps(many);
  assert.equal(steps.length, MAX_PLAN_STEPS);
  assert.equal(steps.at(-1), `\`src/f${MAX_PLAN_STEPS - 1}.ts\`: step`);
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

test("formatDuration switches to minutes past 60s and clamps negatives", () => {
  assert.equal(formatDuration(9_000), "9s");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(-5), "0s");
});

test("mascot frames cycle", () => {
  assert.deepEqual(mascotFrame(0), mascotFrame(4));
  assert.notDeepEqual(mascotFrame(0), mascotFrame(1));
});
