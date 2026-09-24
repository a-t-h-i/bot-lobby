import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  BLINK_MAX_MS,
  BLINK_MIN_MS,
  BLINK_MS,
  MASCOT_IDS,
  MAX_PANEL_LINES,
  MAX_PLAN_STEPS,
  advanceBlink,
  bannerLines,
  blobStatuses,
  dioramaLines,
  formatDuration,
  isBlinking,
  nextBlinkDelay,
  panelLines,
  planChecklist,
  planSteps,
  runStatus,
  workingLine,
  type BlinkState,
  type PanelTheme,
} from "../src/pi/zen.ts";
import {
  BANNER_NARROW,
  BANNER_TITLE,
  BLOB_LABELS,
  COMPACT_BLOB_ART,
  DIORAMA,
  STATUS_GLYPHS,
} from "../src/pi/mascot-art.ts";
import { TERMINAL_STATES, TASK_STATES, createTask, type Task } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

const NOW = Date.parse("2026-01-01T00:10:00.000Z");
const NON_TERMINAL = TASK_STATES.filter((state) => !TERMINAL_STATES.includes(state));

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

/** backend ran twice (latest wins), designer failed, qa finished successfully. */
function statusRuns(): AgentRun[] {
  return [
    run({ runId: "b-old", status: "success", startedAt: "2026-01-01T00:09:00.000Z", finishedAt: "2026-01-01T00:09:10.000Z" }),
    run({ runId: "b-new", startedAt: "2026-01-01T00:09:50.000Z" }),
    run({ runId: "d", domain: "designer", role: "worker", status: "failed", startedAt: "2026-01-01T00:09:30.000Z" }),
    run({ runId: "q", domain: "qa", role: "worker", status: "success", startedAt: "2026-01-01T00:09:20.000Z", finishedAt: "2026-01-01T00:09:25.000Z" }),
  ];
}

function plan(...steps: string[]): string {
  return ["Objective: ship it", ...steps.map((step, index) => `${index + 1}. ${step}`)].join("\n");
}

function headerOf(lines: string[]): string {
  return lines.find((line) => line.startsWith("dev-house ")) ?? "";
}

function checklistRows(lines: string[]): string[] {
  return lines.filter((line) => /^ {2}[✓◐○] \d+\./.test(line));
}

// --- blink scheduling (pure, injected rng) ---

test("nextBlinkDelay spans 30-70s inclusively", () => {
  assert.equal(nextBlinkDelay(() => 0), BLINK_MIN_MS);
  assert.equal(nextBlinkDelay(() => 1), BLINK_MAX_MS);
  assert.equal(nextBlinkDelay(() => 0.5), BLINK_MIN_MS + 20_000);
  for (const value of [0, 0.001, 0.25, 0.5, 0.75, 0.999999, 1]) {
    const delay = nextBlinkDelay(() => value);
    assert.ok(delay >= BLINK_MIN_MS && delay <= BLINK_MAX_MS, `rng ${value} gave ${delay}`);
  }
});

test("advanceBlink rests a blob until its scheduled blink", () => {
  const resting: BlinkState = { nextAt: NOW + 1_000, until: 0 };
  assert.equal(advanceBlink(resting, NOW, () => 0), resting);
  assert.equal(isBlinking(resting, NOW), false);
});

test("advanceBlink opens a 600ms blink window at the scheduled time", () => {
  const resting: BlinkState = { nextAt: NOW, until: 0 };
  const blinked = advanceBlink(resting, NOW, () => 0.5);
  assert.equal(blinked.until, NOW + BLINK_MS);
  assert.equal(isBlinking(blinked, NOW), true);
  assert.equal(isBlinking(blinked, blinked.until - 1), true);
  assert.equal(isBlinking(blinked, blinked.until), false);
  assert.equal(isBlinking(blinked, blinked.until + 1), false);
  const late = advanceBlink(resting, NOW + 5_000, () => 0);
  assert.equal(late.until, NOW + 5_000 + BLINK_MS);
  assert.equal(late.nextAt, NOW + 5_000 + BLINK_MIN_MS);
});

test("advanceBlink never schedules the next trait under 30s or over 70s", () => {
  let at = 0;
  for (const value of [0, 0.25, 0.5, 0.75, 0.999, 1]) {
    const next = advanceBlink({ nextAt: at, until: 0 }, at, () => value);
    const gap = next.nextAt - at;
    assert.ok(gap >= BLINK_MIN_MS && gap <= BLINK_MAX_MS, `rng ${value} gave a ${gap}ms gap`);
    at = next.nextAt;
  }
});

test("advanceBlink does not mutate the state it was given", () => {
  const state: BlinkState = { nextAt: NOW, until: 0 };
  const snapshot: BlinkState = { ...state };
  advanceBlink(state, NOW, () => 0.5);
  assert.deepEqual(state, snapshot);
});

// --- blob status ---

test("runStatus maps every AgentRun status onto the blob vocabulary", () => {
  assert.equal(runStatus("running"), "running");
  assert.equal(runStatus("success"), "done");
  assert.equal(runStatus("failed"), "failed");
  assert.equal(runStatus("cancelled"), "failed");
  assert.equal(runStatus("timeout"), "failed");
});

test("blobStatuses uses the latest run per domain and derives master from the task", () => {
  const runs = statusRuns();
  assert.deepEqual(blobStatuses(task(), runs), {
    master: "running",
    designer: "failed",
    backend: "running",
    qa: "done",
  });
  assert.deepEqual(blobStatuses(task(), []), { master: "running", designer: "idle", backend: "idle", qa: "idle" });
  assert.equal(blobStatuses(task({ paused: true }), runs).master, "idle");
  assert.equal(blobStatuses(task({ state: "completed" }), runs).master, "idle");
});

// --- banner ---

test("bannerLines boxes the title on wide terminals and never overflows", () => {
  const banner = bannerLines(100);
  assert.equal(BANNER_TITLE, "THE DEV HOUSE");
  assert.deepEqual(banner, [
    "┌────────────────────────────────────────────────────────┐",
    "│                     THE DEV HOUSE                      │",
    "└────────────────────────────────────────────────────────┘",
  ]);
  assert.equal(banner.length, 3);
  assert.deepEqual(bannerLines(60), banner);
});

test("bannerLines degrades to one narrow row below 60 columns", () => {
  assert.deepEqual(bannerLines(59), [BANNER_NARROW]);
  assert.deepEqual(bannerLines(40), [BANNER_NARROW]);
  for (const width of [1, 2, 10, 20, 40, 59, 60, 120]) {
    const rows = bannerLines(width);
    assert.ok(rows.length > 0, `width ${width} produced no banner`);
    for (const row of rows) assert.ok(visibleWidth(row) <= width, `width ${width} row ${JSON.stringify(row)}`);
  }
});

test("bannerLines has nothing to draw for a zero or negative width", () => {
  assert.deepEqual(bannerLines(0), []);
  assert.deepEqual(bannerLines(-5), []);
});

// --- scenes ---

test("every non-terminal state renders the banner, all four labels and a 6-row diorama", () => {
  for (const state of NON_TERMINAL) {
    const lines = panelLines(task({ state }), [], NOW, true, { width: 100 });
    assert.deepEqual(lines.slice(0, 3), bannerLines(100), state);
    const scene = dioramaLines(state, blobStatuses(task({ state }), []), {}, 100);
    assert.equal(scene.length, 6, state);
    for (const row of scene) assert.ok(lines.includes(row), `${state} lost diorama row ${JSON.stringify(row)}`);
    for (const mascot of MASCOT_IDS) {
      assert.ok(lines.some((line) => line.includes(BLOB_LABELS[mascot])), `${state} lost ${mascot}`);
    }
  }
});

test("narrow terminals render a 3-row compact strip with all four blobs", () => {
  for (const state of NON_TERMINAL) {
    const scene = dioramaLines(state, blobStatuses(task({ state }), []), {}, 40);
    const joined = scene.join("\n");
    assert.equal(scene.length, 3, state);
    for (const mascot of MASCOT_IDS) {
      assert.ok(joined.includes(COMPACT_BLOB_ART[mascot].rest[0]!), `${state} lost compact ${mascot}`);
    }
  }
  assert.equal(DIORAMA.full.rows.length, 6);
  assert.equal(DIORAMA.compact.rows.length, 3);
});

test("a blink swaps only the blinking blob's face row", () => {
  const statuses = blobStatuses(task({ state: "scouting" }), []);
  const rest = dioramaLines("scouting", statuses, {}, 100);
  const blink = dioramaLines("scouting", statuses, { master: true }, 100);
  const changed = rest.map((row, index) => (row === blink[index] ? -1 : index)).filter((index) => index >= 0);
  assert.deepEqual(changed, [2]);
  assert.ok(rest[2]!.includes("( o o )"));
  assert.ok(blink[2]!.includes("( - - )"));
  assert.ok(dioramaLines("scouting", statuses, { qa: true }, 40)[1]!.includes("(-.-)"));
});

test("run status glyphs line up under the blob columns", () => {
  const statuses = blobStatuses(task(), statusRuns());
  const row = dioramaLines("implementing", statuses, {}, 100)[4]!;
  assert.deepEqual(DIORAMA.full.blobColumns, [14, 25, 36, 47]);
  MASCOT_IDS.forEach((mascot, index) => {
    const column = DIORAMA.full.blobColumns[index]!;
    assert.equal(row[column], STATUS_GLYPHS[statuses[mascot]], `${mascot} glyph at column ${column}`);
  });
});

test("no state and width combination exceeds the panel cap or the terminal width", () => {
  const planText = plan(...Array.from({ length: 12 }, (_value, index) => `\`src/s${index}.ts\`: step ${index}`));
  const blockers = [{ domain: "backend" as const, reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }];
  const runs = statusRuns();
  assert.equal(MAX_PANEL_LINES, 14);
  for (const state of NON_TERMINAL) {
    for (const width of [40, 60, 80, 120]) {
      const lines = panelLines(task({ state, plan: planText, paused: true, blockers }), runs, NOW, false, { width });
      assert.ok(lines.length <= MAX_PANEL_LINES, `${state} @ ${width}: ${lines.length} lines`);
      assert.ok(lines.every((line) => visibleWidth(line) <= width), `${state} @ ${width} overflowed`);
      const banner = bannerLines(width);
      assert.deepEqual(lines.slice(0, banner.length), banner, `${state} @ ${width} lost the banner`);
      for (const row of dioramaLines(state, blobStatuses(task({ state, plan: planText, paused: true, blockers }), runs), {}, width)) {
        assert.ok(lines.includes(row), `${state} @ ${width} lost diorama row ${JSON.stringify(row)}`);
      }
    }
  }
});

test("an alert shrinks the checklist window but still appears", () => {
  const planText = plan(...Array.from({ length: 8 }, (_value, index) => `\`src/s${index}.ts\`: step ${index}`));
  const blockers = [{ domain: "backend" as const, reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }];
  const withAlert = panelLines(task({ state: "implementing", plan: planText, blockers }), [], NOW, true, { width: 100 });
  const without = panelLines(task({ state: "implementing", plan: planText }), [], NOW, true, { width: 100 });
  assert.ok(withAlert.some((line) => line.startsWith("blocked: schema owner must confirm")));
  assert.ok(checklistRows(withAlert).length > 0);
  assert.ok(checklistRows(withAlert).length < checklistRows(without).length);
});

// --- locked art contract and theme safety ---

test("plain renders stay byte-identical to the locked art", () => {
  const statuses = blobStatuses(task({ state: "implementing" }), []);
  assert.deepEqual(dioramaLines("implementing", statuses, {}, 100), [
    "/^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\\",
    "|    ___        /^^^\\      (___)      |===|      _____   |",
    "|   |===|      ( o o )    ( o o )    [ o o ]    ( o O )  |",
    "|    | |        |___|      ~~~~~      |===|      \\___/   |",
    "|             ◐          ·          ·          ·         |",
    "|             [master]   designer   backend    qa        |",
  ]);
  assert.deepEqual(dioramaLines("scouting", blobStatuses(task({ state: "scouting" }), []), {}, 40), [
    "|scouting the codebase                 |",
    "|<^>(o.o)  ~,~(o.o)  [=](o.o)  (o.o)<o>|",
    "|◐         ·         ·         ·       |",
  ]);
});

const ANSI_THEME: PanelTheme = {
  fg: (_color, text) => `\x1b[91m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

test("theme colors keep every row's visible width and mark the active agent and glyphs", () => {
  const sceneTask = task({ state: "implementing" });
  const runs = statusRuns();
  const plain = panelLines(sceneTask, runs, NOW, true, { width: 100 });
  const colored = panelLines(sceneTask, runs, NOW, true, { width: 100, theme: ANSI_THEME });
  assert.equal(colored.length, plain.length);
  colored.forEach((line, index) => {
    assert.equal(visibleWidth(line), visibleWidth(plain[index]!), `row ${index} width changed`);
    assert.equal(stripAnsi(line), plain[index]!, `row ${index} content changed`);
  });
  const labelRow = colored.find((line) => line.includes("[backend]"))!;
  assert.match(labelRow, /\x1b\[[0-9;]*m\[backend\]/);
  const statusRowPlain = dioramaLines("implementing", blobStatuses(sceneTask, runs), {}, 100)[4]!;
  const statusRow = colored.find((line) => stripAnsi(line) === statusRowPlain)!;
  for (const glyph of [STATUS_GLYPHS.running, STATUS_GLYPHS.failed, STATUS_GLYPHS.done]) {
    assert.match(statusRow, new RegExp(`\\x1b\\[[0-9;]*m${glyph}`), `${glyph} was not painted`);
  }
});

// --- working line ---

test("workingLine spins through the quarter circles and names the running agent", () => {
  const runs = [run({ domain: "qa", role: "worker" })];
  const frames = ["◐", "◓", "◑", "◒"];
  frames.forEach((frame, tick) => {
    assert.equal(workingLine(runs, tick, undefined, NOW), `  ${frame} agents working (1) · qa/worker running 10s`);
  });
  assert.ok(workingLine(runs, 4, undefined, NOW).startsWith("  ◐"));
  assert.ok(workingLine(runs, -1, undefined, NOW).startsWith("  ◓"));
  assert.match(workingLine([...runs, run({ runId: "r2" })], 0, undefined, NOW), /agents working \(2\)/);
});

test("workingLine reports the last finished run when nothing is running", () => {
  const finished = run({ status: "success", startedAt: "2026-01-01T00:09:50.000Z", finishedAt: "2026-01-01T00:09:55.000Z" });
  assert.equal(workingLine([finished], 0, undefined, NOW), "  · no agents running · last backend/scout success 5s");
});

test("workingLine keeps the legacy waiting string before the first agent", () => {
  assert.equal(workingLine([], 0, undefined, NOW), "  ○ waiting for the first agent…");
});

// --- header, alerts and checklist behavior kept from the previous panel ---

test("no task means no panel lines", () => {
  assert.deepEqual(panelLines(undefined, [], NOW, true), []);
});

test("the header shows the concise task name, state, elapsed time and quiet mode", () => {
  const pagination = task({ id: "TASK-add-pagination", state: "scouting" });
  assert.equal(headerOf(panelLines(pagination, [], NOW, true)), "dev-house TASK-add-pagination · scouting   ⏱ 10m 00s · tools hidden (alt+t)");
  assert.equal(headerOf(panelLines(pagination, [], NOW, false)), "dev-house TASK-add-pagination · scouting   ⏱ 10m 00s · tools shown");
});

test("the header marks a paused task", () => {
  assert.match(headerOf(panelLines(task({ state: "implementing", paused: true }), [], NOW, true)), /implementing \(paused\)/);
});

test("pending approvals surface before blockers", () => {
  const withBoth = task({
    approvals: [
      { id: "APR-1", kind: "dependency", domain: "backend", detail: "install zod", status: "pending", createdAt: "now" },
      { id: "APR-2", kind: "dependency", domain: "backend", detail: "already handled", status: "approved", createdAt: "now" },
    ],
    blockers: [{ domain: "backend", reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }],
  });
  const lines = panelLines(withBoth, [], NOW, true, { width: 100 });
  const alert = lines.find((line) => line.startsWith("approvals pending:"));
  assert.equal(alert, "approvals pending: APR-1");
  assert.ok(!lines.some((line) => line.startsWith("blocked:")), "approvals win when both exist");
  const waiting = lines.find((line) => line.includes("waiting for the first agent"));
  assert.ok(lines.indexOf(alert!) < lines.indexOf(waiting!), "the alert precedes the working line");
});

test("a blocker surfaces when no approval is pending", () => {
  const blocked = task({
    blockers: [{ domain: "backend", reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }],
  });
  assert.ok(panelLines(blocked, [], NOW, true, { width: 100 }).includes("blocked: schema owner must confirm"));
});

test("the checklist shows a window around the current step", () => {
  const steps = ["a", "b", "c", "d", "e", "f", "g", "h"].map((letter) => `\`src/${letter}.ts\`: step ${letter}`);
  const runs = [run({ role: "worker", instruction: "implement `src/e.ts` now" })];
  const lines = panelLines(task({ state: "implementing", plan: plan(...steps) }), runs, NOW, true, { width: 100 });
  assert.ok(lines.includes("steps 4/8"));
  // banner (3) + header (1) + diorama (6) leave room for a two-row window.
  assert.deepEqual(checklistRows(lines), [
    "  ◐ 5. `src/e.ts`: step e",
    "  ○ 6. `src/f.ts`: step f",
  ]);
  assert.ok(lines.length <= MAX_PANEL_LINES, `panel has ${lines.length} lines`);
});

test("formatDuration switches to minutes past 60s and clamps negatives", () => {
  assert.equal(formatDuration(9_000), "9s");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(-5), "0s");
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
