import { test } from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { miniLine, stageBar, stepBar } from "../src/lobby/mini.ts";
import { createTask, type Task } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

const plain = (line: string) => stripTerminalSequences(line);
const PLAN = "## Steps\n1. Scene in `index.html`\n2. Glass in `index.html`\n3. Fills in `index.html`\n4. Controls in `index.html`";
const task = (overrides: Partial<Task> = {}): Task => ({ ...createTask("TASK-hourglass", "hourglass", "2026-09-29T10:00:00.000Z"), state: "implementing", plan: PLAN, ...overrides });
const worker = (id: string, instruction: string, status: AgentRun["status"] = "success", extra: Partial<AgentRun> = {}): AgentRun => ({ runId: id, taskId: "TASK-hourglass", domain: "designer", role: "worker", status, instruction, output: "", attempts: 1, startedAt: "2026-09-29T10:01:00.000Z", ...extra });

test("a running task shows its steps as a bar with the count, its state and who is working", () => {
  const runs = [worker("a", "Step 1: scene in `index.html`"), worker("b", "Step 2: glass in `index.html`", "running", { activity: "editing" })];
  const line = plain(miniLine({ task: task(), runs, key: "Alt+L" }, 120));
  assert.match(line, /◆ bot-lobby/);
  assert.match(line, /TASK-hourglass ■◐□□ 1\/4 implementing · DESIGN editing/);
  assert.match(line, /Alt\+L opens/);
});

test("before a plan the task shows its stage, and a step bar squeezes a long plan", () => {
  assert.equal(stageBar("clarifying"), "◐○○○○○○");
  assert.equal(stageBar("planning"), "●●●●◐○○");
  assert.equal(stageBar("completed"), "");
  assert.match(plain(miniLine({ task: task({ state: "scouting", plan: undefined }), runs: [], key: "Alt+L" }, 120)), /TASK-hourglass ●◐○○○○○ scouting/);
  assert.match(plain(miniLine({ task: task({ state: "awaiting_approval", plan: undefined }), runs: [], key: "Alt+L" }, 120)), /awaiting your approval/);
  assert.equal(stepBar(Array.from({ length: 30 }, (_, i) => (i < 15 ? "done" : i === 15 ? "current" : "pending"))).length, 12);
  assert.equal(stepBar(["done", "done", "pending"]), "■■□");
});

test("planning shows its round bar and what waits on you", () => {
  const base = { runs: [], key: "Alt+L" };
  assert.match(plain(miniLine({ ...base, planning: { busy: false, round: 2, limit: 5, questions: 3, ready: false, saved: false } }, 120)), /planning ■■□□□ 2\/5 ● 3 questions for you/);
  assert.match(plain(miniLine({ ...base, planning: { busy: true, round: 1, limit: 0, questions: 0, ready: false, saved: false } }, 120)), /planning round 1 the panel is thinking/);
  assert.match(plain(miniLine({ ...base, planning: { busy: false, round: 3, limit: 5, questions: 0, ready: true, saved: false } }, 120)), /plan ready to save/);
  assert.match(plain(miniLine({ ...base, planning: { busy: false, round: 3, limit: 5, questions: 0, ready: true, saved: true } }, 120)), /idle/, "a saved plan is done");
});

test("a quick fix shows beside a task, and with nothing running the line says idle", () => {
  const line = plain(miniLine({ task: task(), runs: [], quickfix: { title: "Rename Save to Apply", running: true, queued: 2 }, key: "Alt+L" }, 160));
  assert.match(line, /TASK-hourglass .*│ {2}quick fix ◐ Rename Save to Apply \+2 queued/);
  assert.match(plain(miniLine({ runs: [], key: "Alt+L" }, 80)), /◆ bot-lobby {2}idle {2}Alt\+L opens/);
  assert.match(plain(miniLine({ task: task({ state: "completed" }), runs: [], key: "Alt+L" }, 80)), /idle/, "a finished task is not shown");
});

test("the line never exceeds its width", () => {
  const input = { task: task(), runs: [worker("b", "Step 1: x", "running", { activity: "editing" })], quickfix: { title: "a very long quick fix request that goes on", running: true, queued: 1 }, key: "Alt+L" };
  for (const width of [12, 30, 60, 100, 200]) assert.ok(visibleWidth(miniLine(input, width)) <= width, `width ${width}`);
  assert.equal(miniLine(input, 5), "");
});
