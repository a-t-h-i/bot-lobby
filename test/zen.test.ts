import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  MAX_PANEL_LINES,
  MAX_PLAN_STEPS,
  bannerLines,
  formatDuration,
  frameIndex,
  largeLineBudget,
  panelLines,
  planChecklist,
  planSteps,
  workingLine,
  type PanelTheme,
} from "../src/pi/zen.ts";
import { LARGE_MIN_WIDTH, MAX_LARGE_LINES } from "../src/pi/zen-large.ts";
import {
  BANNER_NARROW,
  COMPACT_FRAMES,
  COMPACT_WIDTH,
  SCENE_PROPS,
  SLOT_IDS,
  SLOT_STATE_GLYPHS,
  SLOT_STATE_WORDS,
} from "../src/pi/mascot-art.ts";
import { TERMINAL_STATES, TASK_STATES, createTask, type Task } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

const NOW = Date.parse("2026-01-01T00:10:00.000Z");
const NON_TERMINAL = TASK_STATES.filter((state) => !TERMINAL_STATES.includes(state));
const COMPACT_OPTS = { width: 40, rows: 30 } as const;
const WIDE_COMPACT_OPTS = { width: 71, rows: 30 } as const;
const LARGE_OPTS = { width: 100, rows: 50 } as const;

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

/** backend ran twice (latest wins), designer failed, research succeeded, qa finished successfully. */
function statusRuns(): AgentRun[] {
  return [
    run({ runId: "b-old", status: "success", startedAt: "2026-01-01T00:09:00.000Z", finishedAt: "2026-01-01T00:09:10.000Z" }),
    run({ runId: "b-new", startedAt: "2026-01-01T00:09:50.000Z" }),
    run({ runId: "d", domain: "designer", role: "worker", status: "failed", startedAt: "2026-01-01T00:09:30.000Z" }),
    run({ runId: "rs", domain: "qa", role: "researcher", status: "success", startedAt: "2026-01-01T00:09:40.000Z", finishedAt: "2026-01-01T00:09:45.000Z" }),
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

/** The compact tier's three strip rows: caption, sprites, status glyphs. */
function stripRows(lines: string[]): string[] {
  return lines.filter((line) => line.startsWith("|") && line.endsWith("|"));
}

function boxLines(lines: string[]): string[] {
  return lines.filter((line) => line.includes("DEV-HOUSE"));
}

const ANSI_CODES: Record<string, string> = { accent: "35", muted: "90", dim: "2", success: "32", error: "31", warning: "33" };

const ANSI_THEME: PanelTheme = {
  fg: (color, text) => `\x1b[${ANSI_CODES[color]}m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

// --- frame clock ---

test("frameIndex wraps in both directions and never divides by zero", () => {
  assert.equal(frameIndex(0, 0, 8), 0);
  assert.equal(frameIndex(8, 0, 8), 0);
  assert.equal(frameIndex(-1, 0, 8), 7);
  assert.equal(frameIndex(-9, 0, 8), 7);
  assert.equal(frameIndex(0, 2, 8), 2);
  assert.equal(frameIndex(5, 9, 4), 2);
  assert.equal(frameIndex(3.7, 0, 8), 3);
  assert.equal(frameIndex(5, 3, 0), 0);
  assert.equal(frameIndex(5, 3, -2), 0);
});

// --- banner ---

test("bannerLines boxes the title on wide terminals and never overflows", () => {
  const banner = bannerLines(100);
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

// --- tier selection ---

test("widths below LARGE_MIN_WIDTH render the compact strip, not the scene", () => {
  assert.equal(LARGE_MIN_WIDTH, 72);
  const compact = panelLines(task({ state: "implementing" }), [], NOW, true, { width: LARGE_MIN_WIDTH - 1, rows: 50 });
  assert.equal(boxLines(compact).length, 0, "the 71-column tier must not draw the large scene");
  assert.equal(stripRows(compact).length, 3);
  const large = panelLines(task({ state: "implementing" }), [], NOW, true, { width: LARGE_MIN_WIDTH, rows: 50 });
  assert.equal(boxLines(large).length, 1);
  assert.ok(large.some((line) => line.includes("┌─────┴─────┐")), "the tower is missing at 72 columns");
});

test("short terminals fall back to the compact strip", () => {
  const short = panelLines(task({ state: "implementing" }), [], NOW, true, { width: 120, rows: 10 });
  assert.equal(boxLines(short).length, 0);
  assert.equal(stripRows(short).length, 3);
  const tall = panelLines(task({ state: "implementing" }), [], NOW, true, { width: 120, rows: 18 });
  assert.equal(boxLines(tall).length, 1);
});

test("largeLineBudget is a clamped fraction of the terminal rows", () => {
  assert.equal(MAX_LARGE_LINES, 34);
  assert.equal(largeLineBudget(200), MAX_LARGE_LINES);
  assert.equal(largeLineBudget(40), 30);
  assert.equal(largeLineBudget(18), 13);
  assert.equal(largeLineBudget(0), 30);
  assert.equal(largeLineBudget(-5), 30);
  assert.equal(largeLineBudget(Number.NaN), 30);
});

// --- compact strip ---

test("every non-terminal state draws a 40-column compact strip with its caption", () => {
  for (const state of NON_TERMINAL) {
    const lines = panelLines(task({ state }), [], NOW, true, COMPACT_OPTS);
    const strip = stripRows(lines);
    assert.equal(strip.length, 3, state);
    assert.equal(strip[0], `|${SCENE_PROPS[state].padEnd(38)}|`, state);
    for (const row of strip) assert.equal(visibleWidth(row), 40, `${state} ${JSON.stringify(row)}`);
    assert.deepEqual(bannerLines(COMPACT_OPTS.width), [BANNER_NARROW], state);
  }
  assert.equal(SCENE_PROPS.implementing, "agents at work");
});

test("the compact strip animates the four slots and follows each slot's status", () => {
  const lines = panelLines(task({ state: "implementing" }), statusRuns(), NOW, true, COMPACT_OPTS);
  const strip = stripRows(lines);
  const statuses = ["working", "failed", "done", "done"] as const;
  const glyphs = SLOT_IDS.map((_id, index) => SLOT_STATE_GLYPHS[statuses[index]!]);
  const glyphRow = strip[2]!;
  for (const glyph of glyphs) assert.ok(glyphRow.includes(glyph), `${glyph} missing from ${JSON.stringify(glyphRow)}`);
  for (const [index, id] of SLOT_IDS.entries()) {
    const frames = COMPACT_FRAMES[id][statuses[index]!];
    for (const frame of frames) assert.equal(visibleWidth(frame), COMPACT_WIDTH);
    assert.ok(frames.some((frame) => strip[1]!.includes(frame)), `${id} drew a foreign frame: ${JSON.stringify(strip[1])}`);
  }
  const ticked = stripRows(panelLines(task({ state: "implementing" }), statusRuns(), NOW, true, { ...COMPACT_OPTS, tick: 1 }));
  assert.notEqual(ticked[1], strip[1], "the sprites must move between frames");
  assert.equal(ticked[0], strip[0], "the caption must not animate");
});

test("the four slots do not animate in lockstep", () => {
  const runs = SLOT_IDS.map((id, index) =>
    run({ runId: `r${index}`, domain: id === "dev" ? "backend" : id === "design" ? "designer" : "qa", role: id === "research" ? "researcher" : "worker" }),
  );
  const strip = stripRows(panelLines(task({ state: "implementing" }), runs, NOW, true, COMPACT_OPTS));
  const sprites = [1, 11, 21, 31].map((offset) => strip[1]!.slice(offset, offset + COMPACT_WIDTH));
  assert.equal(new Set(sprites).size > 1, true, `all four sprites shared one frame: ${JSON.stringify(sprites)}`);
  for (const [index, id] of SLOT_IDS.entries()) {
    assert.ok(COMPACT_FRAMES[id].working.some((frame) => frame === sprites[index]), `${id} drew a foreign frame`);
  }
});

test("the retired 58-column diorama is gone from every tier", () => {
  for (const width of [40, 60, 71, 72, 100]) {
    const lines = panelLines(task({ state: "implementing" }), [], NOW, true, { width, rows: 50 });
    assert.ok(!lines.some((line) => line.includes("^^^^")), `width ${width} still draws the old box`);
    assert.ok(!lines.some((line) => line.includes("master")), `width ${width} still lists the master blob`);
  }
});

// --- large tier ---

test("the large tier keeps the task id, state, elapsed, quiet hint, counts and alert", () => {
  const approvals = [{ id: "APR-1", kind: "dependency" as const, domain: "backend" as const, detail: "install zod", status: "pending" as const, createdAt: "now" }];
  const lines = panelLines(task({ state: "implementing", paused: true, approvals }), statusRuns(), NOW, true, LARGE_OPTS);
  const box = lines.slice(0, 4).join("\n");
  assert.ok(box.includes("TASK-1 · implementing (paused)"));
  assert.ok(box.includes("10m 00s"));
  assert.ok(box.includes("tools hidden (alt+t)"));
  assert.ok(box.includes("ETA —"));
  assert.ok(lines.some((line) => line.includes("! approvals pending: APR-1")), "the approval alert was dropped");
  assert.ok(lines.some((line) => line.includes("(0/0 tasks)")), "the plan bar lost its task counts");
});

test("the large tier lists the plan steps in TASKS beside a LOG of real transitions", () => {
  const steps = ["`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third", "`src/d.ts`: fourth"];
  const runs = [run({ runId: "dev", domain: "backend", role: "worker", status: "running", instruction: "implement `src/c.ts` now" })];
  const lines = panelLines(task({ state: "implementing", plan: plan(...steps) }), runs, NOW, true, LARGE_OPTS);
  assert.ok(lines.some((line) => line.includes("[x] `src/a.ts`")), "a completed step is missing");
  assert.ok(lines.some((line) => line.includes("[>] `src/c.ts`")), "the current step is missing");
  assert.ok(lines.some((line) => line.includes("[ ] `src/d.ts`")), "a pending step is missing");
  assert.ok(lines.some((line) => /\d\d:\d\d ORACLE/.test(line)), "the oracle LOG row is missing");
  assert.ok(lines.some((line) => /\d\d:\d\d DEV\s+working/.test(line)), "the run LOG row is missing");
  assert.equal(checklistRows(lines).length, 0, "the large tier must not draw the compact checklist");
});

test("a long plan windows around the current step in the large tier", () => {
  const steps = Array.from({ length: 10 }, (_value, index) => `\`src/s${index}.ts\`: step ${index}`);
  const runs = [run({ runId: "dev", domain: "backend", role: "worker", status: "running", instruction: "implement `src/s6.ts` now" })];
  const lines = panelLines(task({ state: "implementing", plan: plan(...steps) }), runs, NOW, true, LARGE_OPTS);
  assert.ok(lines.some((line) => line.includes("[>] `src/s6.ts`")), "the current step 7 is missing");
  assert.ok(lines.some((line) => line.includes("(6/10 tasks)")), "the counts must span the whole plan");
  assert.ok(lines.some((line) => line.includes("60%")), "the bar percent must span the whole plan");
});

test("the alert survives every large-tier height that still renders the scene", () => {
  const blockers = [{ domain: "backend" as const, reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }];
  const alertTask = task({ state: "blocked", blockers });
  for (const rows of [18, 24, 30, 50]) {
    const lines = panelLines(alertTask, [], NOW, true, { width: 72, rows });
    assert.ok(lines.some((line) => line.includes("! blocked: schema owner must confirm")), `alert lost at ${rows} rows`);
  }
});

test("no state, width or height combination exceeds its cap or the terminal width", () => {
  const planText = plan(...Array.from({ length: 12 }, (_value, index) => `\`src/s${index}.ts\`: step ${index}`));
  const blockers = [{ domain: "backend" as const, reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }];
  const runs = statusRuns();
  assert.equal(MAX_PANEL_LINES, 14);
  for (const state of NON_TERMINAL) {
    for (const width of [1, 40, 60, 71, 72, 100, 200]) {
      for (const rows of [8, 18, 24, 40, 60]) {
        const lines = panelLines(task({ state, plan: planText, paused: true, blockers }), runs, NOW, false, { width, rows });
        const cap = boxLines(lines).length > 0 ? MAX_LARGE_LINES : MAX_PANEL_LINES;
        assert.ok(lines.length <= cap, `${state} @ ${width}x${rows}: ${lines.length} lines`);
        assert.ok(lines.every((line) => visibleWidth(line) <= width), `${state} @ ${width}x${rows} overflowed`);
      }
    }
  }
});

// --- determinism, status words and theme safety ---

test("the same tick renders identically and a later tick moves the eyes", () => {
  const input = [task({ state: "implementing" }), statusRuns(), NOW, true] as const;
  assert.deepEqual(panelLines(...input, COMPACT_OPTS), panelLines(...input, COMPACT_OPTS));
  assert.deepEqual(panelLines(...input, LARGE_OPTS), panelLines(...input, LARGE_OPTS));
  assert.notDeepEqual(panelLines(...input, { ...COMPACT_OPTS, tick: 5 }), panelLines(...input, COMPACT_OPTS));
  assert.notDeepEqual(panelLines(...input, { ...LARGE_OPTS, tick: 5 }), panelLines(...input, LARGE_OPTS));
});

test("faces and state words follow each slot status in both tiers", () => {
  const runs = statusRuns();
  const large = panelLines(task({ state: "implementing" }), runs, NOW, true, LARGE_OPTS);
  for (const status of ["working", "done", "failed"] as const) {
    const label = `${SLOT_STATE_GLYPHS[status]} ${SLOT_STATE_WORDS[status]}`;
    assert.ok(large.some((line) => line.includes(label)), `large tier lost the ${label} label`);
  }
  const idle = panelLines(task({ state: "implementing" }), [], NOW, true, LARGE_OPTS);
  assert.ok(idle.some((line) => line.includes(`${SLOT_STATE_GLYPHS.idle} idle`)), "large tier lost the idle label");
  const compact = panelLines(task({ state: "implementing" }), runs, NOW, true, COMPACT_OPTS);
  assert.ok(stripRows(compact)[2]!.includes(SLOT_STATE_GLYPHS.working), "the compact layer lost the active marker");
});

test("a theme recolours both tiers without changing a single visible column", () => {
  const sceneTask = task({ state: "implementing", approvals: [{ id: "APR-1", kind: "dependency", domain: "backend", detail: "install zod", status: "pending", createdAt: "now" }] });
  for (const opts of [COMPACT_OPTS, LARGE_OPTS]) {
    const plain = panelLines(sceneTask, statusRuns(), NOW, true, opts);
    const colored = panelLines(sceneTask, statusRuns(), NOW, true, { ...opts, theme: ANSI_THEME });
    assert.equal(colored.length, plain.length, `tier ${opts.width}`);
    colored.forEach((line, index) => {
      assert.equal(stripAnsi(line), stripAnsi(plain[index]!), `row ${index} content changed`);
      assert.equal(visibleWidth(line), visibleWidth(plain[index]!), `row ${index} width changed`);
    });
  }
  const colored = panelLines(sceneTask, statusRuns(), NOW, true, { ...LARGE_OPTS, theme: ANSI_THEME });
  const coloured = (word: string) => new RegExp(`\\x1b\\[[0-9;]*m[^\\x1b]*${word}`);
  assert.match(colored.find((line) => stripAnsi(line).includes("◐ working"))!, coloured("◐ working"));
  assert.match(colored.find((line) => stripAnsi(line).includes("✓ done"))!, coloured("✓ done"));
  assert.match(colored.find((line) => stripAnsi(line).includes("✗ failed"))!, coloured("✗ failed"));
  assert.ok(colored.some((line) => line.includes(`\x1b[${ANSI_CODES.warning}m`)), "the warning alert was not painted");
  const compact = panelLines(sceneTask, statusRuns(), NOW, true, { ...COMPACT_OPTS, theme: ANSI_THEME });
  assert.ok(stripRows(compact)[1]!.includes(`\x1b[${ANSI_CODES.accent}m`), "the working slot lost its accent colour");
  assert.ok(stripRows(compact)[1]!.includes(`\x1b[${ANSI_CODES.error}m`), "the failed slot lost its error colour");
  assert.ok(stripRows(compact)[2]!.includes(`\x1b[${ANSI_CODES.success}m`), "the done glyph lost its success colour");
});

// --- header, alerts and checklist behavior kept from the previous panel ---

test("no task means no panel lines", () => {
  assert.deepEqual(panelLines(undefined, [], NOW, true), []);
});

test("the header shows the concise task name, state, elapsed time and quiet mode", () => {
  const scouting = task({ state: "scouting" });
  assert.equal(headerOf(panelLines(scouting, [], NOW, true, WIDE_COMPACT_OPTS)), "dev-house TASK-1 · scouting   ⏱ 10m 00s · tools hidden (alt+t)");
  assert.equal(headerOf(panelLines(scouting, [], NOW, false, WIDE_COMPACT_OPTS)), "dev-house TASK-1 · scouting   ⏱ 10m 00s · tools shown");
});

test("the header marks a paused task", () => {
  const header = headerOf(panelLines(task({ state: "implementing", paused: true }), [], NOW, true, WIDE_COMPACT_OPTS));
  assert.match(header, /^dev-house TASK-1 · implementing \(paused\)/);
});

test("pending approvals surface before blockers", () => {
  const withBoth = task({
    approvals: [
      { id: "APR-1", kind: "dependency", domain: "backend", detail: "install zod", status: "pending", createdAt: "now" },
      { id: "APR-2", kind: "dependency", domain: "backend", detail: "already handled", status: "approved", createdAt: "now" },
    ],
    blockers: [{ domain: "backend", reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }],
  });
  const lines = panelLines(withBoth, [], NOW, true, COMPACT_OPTS);
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
  assert.ok(panelLines(blocked, [], NOW, true, COMPACT_OPTS).includes("blocked: schema owner must confirm"));
});

test("the checklist shows a window around the current step", () => {
  const steps = ["a", "b", "c", "d", "e", "f", "g", "h"].map((letter) => `\`src/${letter}.ts\`: step ${letter}`);
  const runs = [run({ role: "worker", instruction: "implement `src/e.ts` now" })];
  const lines = panelLines(task({ state: "implementing", plan: plan(...steps) }), runs, NOW, true, COMPACT_OPTS);
  assert.ok(lines.includes("steps 4/8"));
  assert.deepEqual(checklistRows(lines), [
    "  ✓ 4. `src/d.ts`: step d",
    "  ◐ 5. `src/e.ts`: step e",
    "  ○ 6. `src/f.ts`: step f",
  ]);
  assert.ok(lines.length <= MAX_PANEL_LINES, `panel has ${lines.length} lines`);
});

// --- durations, plan parsing and the working line ---

test("formatDuration switches to minutes past 60s and clamps negatives", () => {
  assert.equal(formatDuration(9_000), "9s");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(-5), "0s");
  assert.equal(formatDuration(Number.NaN), "0s");
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), "0s");
  assert.equal(formatDuration(Number.NEGATIVE_INFINITY), "0s");
  assert.equal(formatDuration(10 * 60_000), "10m 00s");
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

test("an unparsable timestamp never renders NaN in either tier", () => {
  const brokenTask = task({ state: "implementing", createdAt: "not-a-date", plan: plan("`src/a.ts`: first") });
  const brokenRuns = [
    run({ runId: "r1", status: "running", startedAt: "not-a-date" }),
    run({ runId: "r2", status: "running", startedAt: "not-a-date", finishedAt: "also-not-a-date" }),
  ];
  for (const opts of [COMPACT_OPTS, WIDE_COMPACT_OPTS, LARGE_OPTS]) {
    const lines = panelLines(brokenTask, brokenRuns, Number.NaN, true, opts);
    assert.ok(lines.length > 0, `width ${opts.width} drew nothing`);
    for (const line of lines) {
      assert.ok(!line.includes("NaN"), `width ${opts.width} rendered NaN: ${JSON.stringify(line)}`);
      assert.ok(visibleWidth(line) <= opts.width, `width ${opts.width} overflowed: ${JSON.stringify(line)}`);
    }
  }
});
