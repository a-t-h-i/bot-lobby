import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  BAR,
  COMPACT_FRAMES,
  COMPACT_WIDTH,
  FACE_WIDTH,
  ORACLE_FRAMES,
  ORACLE_POSES,
  SLOT_FRAMES,
  SLOT_IDS,
  SLOT_LABELS,
  SLOT_STATES,
  SLOT_STATE_COLORS,
  SLOT_STATE_GLYPHS,
  SLOT_STATE_WORDS,
  SPIN_FRAMES,
  TOWER,
  TOWER_DOOR,
  TOWER_WIDTH,
} from "../src/pi/mascot-art.ts";
import {
  LARGE_MIN_WIDTH,
  MAX_LARGE_LINES,
  MAX_TASK_ROWS,
  SCENE_WIDTH,
  SLOT_CELL,
  largeLines,
  type LargeSceneInput,
} from "../src/pi/zen-large.ts";
import type { PanelTheme } from "../src/pi/zen.ts";
import { BLINK_FRAME, EMOTE_FRAME, EMOTE_FRAMES, REST_FRAME } from "../src/pi/expressions.ts";

/** Representative scene: mixed statuses, six plan steps and an injected spinner frame. */
function scene(overrides: Partial<LargeSceneInput> = {}): LargeSceneInput {
  return {
    taskId: "TASK-core-feature",
    taskTitle: "core-feature",
    state: "implementing",
    elapsedLabel: "12m 30s",
    etaLabel: "ETA ~50m",
    quietHint: "tools hidden (alt+t)",
    tick: 0,
    done: 3,
    total: 6,
    slots: [
      { id: "dev", label: SLOT_LABELS.dev, status: "working", frame: 0 },
      { id: "design", label: SLOT_LABELS.design, status: "idle", frame: 1 },
      { id: "research", label: SLOT_LABELS.research, status: "done", frame: 2 },
      { id: "qa", label: SLOT_LABELS.qa, status: "failed", frame: 3 },
    ],
    tasks: [
      { text: "Research reqs", status: "done" },
      { text: "Design architecture", status: "done" },
      { text: "Implement feature", status: "current" },
      { text: "Write tests", status: "pending" },
      { text: "Run QA", status: "pending" },
      { text: "Deploy", status: "pending" },
    ],
    oracle: { pose: "orchestrating", frame: 0 },
    alert: "approvals pending: APR-1",
    ...overrides,
  };
}

function withStatus(status: LargeSceneInput["slots"][number]["status"], frame = 0): LargeSceneInput {
  const slots = scene().slots.map((slot) => ({ ...slot, status, frame }));
  return scene({ slots });
}

const TASK_ROW = /\[[x> ]\] /;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- animated art contract ---

test("every slot frame is one row that fits its cell, and the eyes stay five-column ASCII", () => {
  for (const id of SLOT_IDS) {
    for (const status of SLOT_STATES) {
      const frames = SLOT_FRAMES[id][status];
      assert.equal(frames.length, EMOTE_FRAME + EMOTE_FRAMES, `${id}/${status} frame count`);
      for (const frame of frames) {
        assert.equal(frame.length, 1, `${id}/${status} frame row count`);
        assert.ok(visibleWidth(frame[0]!) <= SLOT_CELL, `${id}/${status} ${JSON.stringify(frame[0])} overflows the cell`);
      }
      assert.equal(visibleWidth(frames[REST_FRAME]![0]!), FACE_WIDTH, `${id}/${status} rest face`);
      assert.equal(visibleWidth(frames[BLINK_FRAME]![0]!), FACE_WIDTH, `${id}/${status} blink face`);
    }
  }
});

test("emote frames are status-aware kaomoji with no zero-width joiners", () => {
  const emotes = (id: (typeof SLOT_IDS)[number], status: (typeof SLOT_STATES)[number]) =>
    SLOT_FRAMES[id][status].slice(EMOTE_FRAME, EMOTE_FRAME + EMOTE_FRAMES).map((frame) => frame[0]!);
  for (const id of SLOT_IDS) {
    for (const status of SLOT_STATES) {
      for (const face of emotes(id, status)) assert.doesNotMatch(face, /[\u2060\u2063]/);
    }
  }
  assert.ok(emotes("dev", "working")[0]!.includes("٥"), "working emotes are nervous");
  assert.ok(emotes("dev", "done")[0]!.includes("✿"), "done emotes are happy");
  assert.ok(emotes("dev", "done")[1]!.includes("っ"), "done emotes include in-love");
  assert.ok(emotes("dev", "failed")[0]!.includes("ಥ"), "failed emotes are scared");
  assert.ok(emotes("qa", "done")[0]!.includes("ᕙ"), "qa flexes on success");
  assert.ok(emotes("qa", "done").some((face) => face.includes("ᕕ( ᐛ )ᕗ")), "qa dances on success");
  assert.notDeepEqual(emotes("qa", "done"), emotes("dev", "done"));
});

test("eye frames differ within every status and across statuses", () => {
  for (const status of SLOT_STATES) {
    assert.ok(new Set(SLOT_FRAMES.dev[status].map((frame) => frame[0]!)).size > 2, status);
  }
  const first = SLOT_STATES.map((status) => SLOT_FRAMES.dev[status][0]![0]!);
  assert.equal(new Set(first).size, SLOT_STATES.length);
});

test("compact frames are one animated row of COMPACT_WIDTH columns per slot and status", () => {
  assert.equal(COMPACT_WIDTH, FACE_WIDTH + 3);
  for (const id of SLOT_IDS) {
    for (const status of SLOT_STATES) {
      const frames = COMPACT_FRAMES[id][status];
      assert.ok(frames.length > 1, `${id}/${status} must animate`);
      for (const frame of frames) assert.equal(frame.length, COMPACT_WIDTH, `${id}/${status} ${frame}`);
    }
  }
});

test("the braille spinner frames are the shared ten-frame set", () => {
  assert.deepEqual([...SPIN_FRAMES], ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
  for (const frame of SPIN_FRAMES) assert.equal(visibleWidth(frame), 1, frame);
});

test("oracle frames stay one column wide and read distinctly per pose", () => {
  for (const pose of ORACLE_POSES) {
    assert.ok(ORACLE_FRAMES[pose].length > 1, pose);
    for (const frame of ORACLE_FRAMES[pose]) {
      for (const glyph of [frame.orb, frame.winL, frame.winR]) assert.equal(visibleWidth(glyph), 1, glyph);
      assert.equal(frame.mouth.length, 7, frame.mouth);
      assert.equal(visibleWidth(frame.mouth), 7, frame.mouth);
    }
  }
  const dormantOrbs = ORACLE_FRAMES.dormant.map((frame) => frame.orb);
  assert.ok(dormantOrbs.every((orb) => !ORACLE_FRAMES.orchestrating.some((frame) => frame.orb === orb)));
  assert.ok(ORACLE_FRAMES.dormant.some((frame) => frame.winL !== frame.orb));
});

test("the oracle mouth follows the injected expression frame", () => {
  for (const frame of ORACLE_FRAMES.orchestrating.keys()) {
    const value = ORACLE_FRAMES.orchestrating[frame]!;
    const lines = largeLines(scene({ oracle: { pose: "orchestrating", frame } }), 72, 40);
    assert.ok(lines.some((line) => line.includes(value.mouth)), `mouth at frame ${frame}`);
    for (const line of lines) assert.ok(visibleWidth(line) <= 72, `overflow at frame ${frame}`);
  }
  const rest = largeLines(scene({ oracle: { pose: "orchestrating", frame: 0 } }), 72, 40);
  const emote = largeLines(scene({ oracle: { pose: "orchestrating", frame: 2 } }), 72, 40);
  assert.notDeepEqual(rest, emote, "the emote frame must change the tower");
});

test("tower templates render TOWER_WIDTH columns and carry every token", () => {
  const fill = (row: string) =>
    row
      .replace(TOWER.tokens.door, TOWER_DOOR)
      .replace(TOWER.tokens.orb, "◉")
      .replace(TOWER.tokens.winL, "◉")
      .replace(TOWER.tokens.winR, "◉")
      .replace(TOWER.tokens.mouth, "═══════");
  for (const rows of [TOWER.rows, TOWER.smallRows]) {
    for (const row of rows) assert.equal(visibleWidth(fill(row)), TOWER_WIDTH, JSON.stringify(row));
  }
  const joined = TOWER.rows.join("\n");
  for (const token of Object.values(TOWER.tokens)) assert.ok(joined.includes(token), token);
  assert.ok(TOWER.rows.some((row) => row.includes(TOWER.tokens.mouth)), "the mouth row is missing");
  assert.ok(TOWER.smallRows.length < TOWER.rows.length);
  for (const row of TOWER.smallRows) assert.ok(TOWER.rows.includes(row), `small row missing: ${JSON.stringify(row)}`);
});

// --- tier and width invariants ---

test("the large scene renders nothing below LARGE_MIN_WIDTH", () => {
  assert.equal(LARGE_MIN_WIDTH, 72);
  assert.deepEqual(largeLines(scene(), LARGE_MIN_WIDTH - 1, 40), []);
  assert.deepEqual(largeLines(scene(), 0, 40), []);
  assert.ok(largeLines(scene(), LARGE_MIN_WIDTH, 40).length > 0);
});

test("no width, height, status or alert combination overflows the terminal", () => {
  for (const width of [72, 100, 200]) {
    for (const rows of [0, 1, 8, 18, 24, 30, 34, 40, 60]) {
      for (const status of SLOT_STATES) {
        for (const alert of [undefined, `blocked: ${"reason ".repeat(30)}`]) {
          const input = { ...withStatus(status), alert, oracle: { pose: "dormant" as const, frame: 4 } };
          const lines = largeLines(input, width, rows);
          assert.ok(lines.length <= MAX_LARGE_LINES, `${width}/${rows}: ${lines.length} lines`);
          for (const line of lines) {
            assert.ok(visibleWidth(line) <= width, `${width}/${rows} overflowed: ${JSON.stringify(line)}`);
          }
          if (alert) assert.ok(lines.some((line) => line.includes("blocked:")), `alert lost at ${width}/${rows}`);
        }
      }
    }
  }
});

test("the large scene is byte-identical to the locked art at 72 and 100 columns", () => {
  const at72 = [
    "    ┌─ BOT-LOBBY ── TASK-core-feature · implementing ─────────────┐",
    "    │ core-feature                                       ETA ~50m │",
    "    │ █████░░░░░  50%  (3/6 tasks)                                │",
    "    └─ ⏱ 12m 30s · tools hidden (alt+t) ──────────────────────────┘",
    "    ! approvals pending: APR-1",
    "                                 \\ | /    ",
    "                                  \\|/     ",
    "                                  ─◉─     ",
    "                                   │      ",
    "                             ┌─────┴─────┐",
    "                             │▓▓▓▓▓▓▓▓▓▓▓│",
    "                             ├───────────┤",
    "                             │ ┌─┐   ┌─┐ │",
    "                             │ │◉│   │◉│ │",
    "                             │ └─┘   └─┘ │",
    "                             ├───────────┤",
    "                             │  ═══════  │",
    "                             ├───┬───┬───┤",
    "                             │▓▓▓│ORC│▓▓▓│",
    "                             └───┴───┴───┘",
    "                                   │                        ",
    "           ┌───────────────┬───────┴───────┬───────────────┐",
    "           │               │               │               │",
    "         (^_^)           (u_u)          (✿^‿^)         (〒﹏〒)    ",
    "          DEV           DESIGN         RESEARCH           QA       ",
    "     ⠋ working...       · idle          ✓ done         ✗ failed    ",
    "     TASKS",
    "    [x] Research reqs                                          ",
    "    [x] Design architecture                                    ",
    "    [>] Implement feature                                      ",
    "    [ ] Write tests                                            ",
    "    [ ] Run QA                                                 ",
    "    [ ] Deploy                                                 ",
  ];
  const at100 = [
    "                  ┌─ BOT-LOBBY ── TASK-core-feature · implementing ─────────────┐",
    "                  │ core-feature                                       ETA ~50m │",
    "                  │ █████░░░░░  50%  (3/6 tasks)                                │",
    "                  └─ ⏱ 12m 30s · tools hidden (alt+t) ──────────────────────────┘",
    "                  ! approvals pending: APR-1",
    "                                               \\ | /    ",
    "                                                \\|/     ",
    "                                                ─◉─     ",
    "                                                 │      ",
    "                                           ┌─────┴─────┐",
    "                                           │▓▓▓▓▓▓▓▓▓▓▓│",
    "                                           ├───────────┤",
    "                                           │ ┌─┐   ┌─┐ │",
    "                                           │ │◉│   │◉│ │",
    "                                           │ └─┘   └─┘ │",
    "                                           ├───────────┤",
    "                                           │  ═══════  │",
    "                                           ├───┬───┬───┤",
    "                                           │▓▓▓│ORC│▓▓▓│",
    "                                           └───┴───┴───┘",
    "                                                 │                        ",
    "                         ┌───────────────┬───────┴───────┬───────────────┐",
    "                         │               │               │               │",
    "                       (^_^)           (u_u)          (✿^‿^)         (〒﹏〒)    ",
    "                        DEV           DESIGN         RESEARCH           QA       ",
    "                   ⠋ working...       · idle          ✓ done         ✗ failed    ",
    "                   TASKS",
    "                  [x] Research reqs                                          ",
    "                  [x] Design architecture                                    ",
    "                  [>] Implement feature                                      ",
    "                  [ ] Write tests                                            ",
    "                  [ ] Run QA                                                 ",
    "                  [ ] Deploy                                                 ",
  ];
  assert.deepEqual(largeLines(scene(), 72, 40), at72);
  assert.deepEqual(largeLines(scene(), 100, 40), at100);
});

test("the box keeps the task id, state, title, estimate, elapsed and quiet hint", () => {
  const lines = largeLines(scene({ etaLabel: "ETA —" }), 72, 40);
  const box = lines.slice(0, 4).join("\n");
  assert.ok(box.includes("TASK-core-feature · implementing"));
  assert.ok(box.includes("core-feature"));
  assert.ok(box.includes("ETA —"));
  assert.ok(box.includes("(3/6 tasks)"));
  assert.ok(box.includes("12m 30s"));
  assert.ok(box.includes("tools hidden (alt+t)"));
  assert.ok(box.includes("50%"));
  assert.equal(visibleWidth(lines[0]!.trimStart()), SCENE_WIDTH);
  assert.ok(lines.some((line) => line.includes(TOWER_DOOR)));
});

test("an empty plan renders a zero bar and no checklist section", () => {
  const lines = largeLines(scene({ done: 0, total: 0, tasks: [], etaLabel: "ETA —" }), 72, 40);
  assert.ok(lines.some((line) => line.includes("(0/0 tasks)")));
  assert.ok(lines.some((line) => line.includes("  0%")));
  assert.ok(!lines.some((line) => line.includes("TASKS")));
});

// --- geometry ---

test("the tower stem, the tree branch and the agent columns share one centre", () => {
  const lines = largeLines(scene(), 100, 40);
  const roof = lines.findIndex((line) => line.includes("┌─────┴─────┐"));
  const tree = lines.findIndex((line) => line.includes("┬") && line.includes("┴"));
  const centre = lines[roof]!.indexOf("┴");
  assert.equal(lines[roof - 1]!.indexOf("│"), centre, "tower stem above the roof");
  assert.equal(lines[tree]!.indexOf("┴"), centre, "tree branch meets the stem");
  assert.equal(lines[tree + 1]!.indexOf("│"), lines[tree]!.indexOf("┌"), "pipes under the first node");
  const face = lines.find((line) => line.includes("(^_^)"))!;
  assert.equal(face.indexOf("(^_^)") + 2, lines[tree]!.indexOf("┌"), "first column sits under its node");
  const orb = lines.find((line) => line.includes("─◉─"))!;
  assert.equal(orb.indexOf("◉"), centre, "orb over the stem");
});

test("the tower stem, the branch stem and the tree node share the terminal centre at every large width", () => {
  for (const width of [72, 100, 133]) {
    const lines = largeLines(scene(), width, 34);
    const centre = Math.floor((width - 1) / 2);
    const roof = lines.findIndex((line) => line.includes("┌─────┴─────┐"));
    const tree = lines.findIndex((line) => line.includes("┬") && line.includes("┴"));
    assert.equal(lines[roof - 1]!.indexOf("│"), centre, `tower stem at ${width}`);
    assert.equal(lines[tree - 1]!.trim(), "│", `branch stem row at ${width}`);
    assert.equal(lines[tree - 1]!.indexOf("│"), centre, `branch stem column at ${width}`);
    assert.equal(lines[tree]!.indexOf("┴"), centre, `tree node at ${width}`);
  }
});

// --- animation, status colours and determinism ---

test("the same input and frame render identically, and a new frame moves the eyes", () => {
  const base = scene();
  assert.deepEqual(largeLines(base, 72, 40), largeLines(base, 72, 40));
  const shifted = largeLines(
    { ...base, slots: base.slots.map((slot) => ({ ...slot, frame: slot.frame + 1 })) },
    72,
    40,
  );
  assert.ok(largeLines(base, 72, 40).some((line) => line.includes(SLOT_FRAMES.dev.working[0]![0]!)));
  assert.ok(shifted.some((line) => line.includes(SLOT_FRAMES.dev.working[1]![0]!)), "the blink frame is missing");
  assert.notDeepEqual(shifted, largeLines(base, 72, 40));
  const wrapped = largeLines(scene({ slots: base.slots.map((slot) => ({ ...slot, frame: 99 })) }), 72, 40);
  assert.equal(wrapped.length, largeLines(base, 72, 40).length);
  const negative = largeLines(scene({ slots: base.slots.map((slot) => ({ ...slot, frame: -3 })) }), 72, 40);
  assert.ok(negative.some((line) => line.includes(SLOT_FRAMES.dev.working.at(-3)![0]!)), "negative frames wrap from the end");
});

test("a working agent shows the braille spinner with 'working...' and animates off the injected tick", () => {
  const rows = (tick: number) => largeLines(scene({ tick }), 72, 40).filter((line) => line.includes("working..."));
  const base = rows(0);
  assert.equal(base.length, 1, "one status row");
  assert.ok(base[0]!.includes(`${SPIN_FRAMES[0]} working...`));
  assert.ok(rows(1)[0]!.includes(`${SPIN_FRAMES[1]} working...`));
  assert.ok(rows(SPIN_FRAMES.length)[0]!.includes(`${SPIN_FRAMES[0]} working...`), "the tick wraps");
  assert.ok(rows(-1)[0]!.includes(`${SPIN_FRAMES.at(-1)} working...`), "negative ticks wrap from the end");
  assert.ok(!largeLines(withStatus("done"), 72, 40).some((line) => line.includes("working...")));
});

test("faces and state words follow each slot status", () => {
  for (const status of SLOT_STATES) {
    const lines = largeLines(withStatus(status), 72, 40);
    assert.ok(lines.some((line) => line.includes(SLOT_STATE_WORDS[status])), status);
    for (const id of SLOT_IDS) {
      const face = SLOT_FRAMES[id][status][0]![0]!;
      assert.ok(lines.some((line) => line.includes(face)), `${id}/${status} face`);
    }
  }
  for (const pose of ORACLE_POSES) {
    const lines = largeLines(scene({ oracle: { pose, frame: 0 } }), 72, 40);
    assert.ok(lines.some((line) => line.includes(ORACLE_FRAMES[pose][0]!.orb)), `orb for ${pose}`);
    assert.ok(lines.some((line) => line.includes(ORACLE_FRAMES[pose][0]!.winL)), `window eye for ${pose}`);
  }
});

const CODES: Record<string, string> = { accent: "35", muted: "90", dim: "2", success: "32", error: "31", warning: "33" };

const ANSI_THEME: PanelTheme = {
  fg: (color, text) => `\x1b[${CODES[color]}m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

test("the theme paints every status and keeps the geometry identical", () => {
  const input = scene();
  const plain = largeLines(input, 72, 40);
  const colored = largeLines(input, 72, 40, ANSI_THEME);
  assert.equal(colored.length, plain.length);
  colored.forEach((line, index) => {
    assert.equal(stripAnsi(line), plain[index]!, `row ${index} content changed`);
    assert.equal(visibleWidth(line), visibleWidth(plain[index]!), `row ${index} width changed`);
  });
  for (const status of SLOT_STATES) {
    const style = SLOT_STATE_COLORS[status];
    const face = SLOT_FRAMES.dev[status][0]![0]!;
    const themed = largeLines(withStatus(status), 72, 40, ANSI_THEME);
    const faceRow = themed.find((line) => stripAnsi(line).includes(face))!;
    const span = new RegExp(`\\x1b\\[${CODES[style.color]}m[^\\x1b]*${escapeRegExp(face)}`);
    assert.match(faceRow, span, `${status} face colour`);
  }
  const alertRow = colored.find((line) => stripAnsi(line).includes("approvals pending"))!;
  assert.ok(alertRow.includes(`\x1b[${CODES.warning}m`), "alert colour");
  const headerBar = colored.find((line) => stripAnsi(line).includes("(3/6 tasks)"))!;
  assert.ok(headerBar.includes(`\x1b[1m\x1b[${CODES.accent}m${BAR.filled.repeat(5)}`), "header bar fill");
  assert.ok(headerBar.includes(`\x1b[${CODES.dim}m${BAR.empty.repeat(5)}`), "header bar track");
  const spinnerRow = colored.find((line) => stripAnsi(line).includes("working..."))!;
  assert.ok(spinnerRow.includes(`\x1b[1m`), "working row bold");
  const orbRow = colored.find((line) => stripAnsi(line).includes("─◉─"))!;
  assert.ok(orbRow.includes(`\x1b[${CODES.accent}m◉\x1b[0m`), "oracle orb colour");
});

test("each agent column renders its status in one row", () => {
  for (const status of SLOT_STATES) {
    const lines = largeLines(withStatus(status), 72, 34);
    const marker = status === "working" ? "working..." : `${SLOT_STATE_GLYPHS[status]} ${SLOT_STATE_WORDS[status]}`;
    const rows = lines.filter((line) => line.includes(marker));
    assert.equal(rows.length, 1, `${status} status row`);
    assert.equal(rows[0]!.split(marker).length - 1, 4, `${status} marker in every column`);
    assert.ok(visibleWidth(rows[0]!) <= 72, `${status} status row width`);
  }
});

test("the status glyph, state word or spinner shares the status colour and weight", () => {
  for (const status of SLOT_STATES) {
    const style = SLOT_STATE_COLORS[status];
    const marker = status === "working" ? `${SPIN_FRAMES[0]} working...` : `${SLOT_STATE_GLYPHS[status]} ${SLOT_STATE_WORDS[status]}`;
    const row = largeLines(withStatus(status), 72, 34, ANSI_THEME).find((line) => stripAnsi(line).includes(marker))!;
    assert.match(row, new RegExp(`\\x1b\\[${CODES[style.color]}m[^\\x1b]*${escapeRegExp(marker)}`), `${status} colour`);
    if (style.bold) assert.ok(row.includes(`\x1b[1m`), `${status} bold`);
  }
});

test("the alert keeps its marker and paints the severity it is given", () => {
  const warning = largeLines(scene({ alertKind: "warning" }), 72, 34, ANSI_THEME).find((line) =>
    stripAnsi(line).includes("approvals pending"),
  )!;
  assert.ok(warning.includes(`\x1b[${CODES.warning}m`), "warning colour");
  assert.ok(stripAnsi(warning).includes("! approvals pending: APR-1"), "warning marker and text");
  const error = largeLines(scene({ alertKind: "error", alert: "blocked: needs a decision" }), 72, 34, ANSI_THEME).find(
    (line) => stripAnsi(line).includes("blocked:"),
  )!;
  assert.ok(error.includes(`\x1b[${CODES.error}m`), "error colour");
  assert.ok(stripAnsi(error).includes("! blocked: needs a decision"), "error marker and text");
});

test("a budget below the fixed frame stays bounded, width-safe and keeps the alert", () => {
  for (const budget of [0, 1, 4]) {
    const lines = largeLines(scene({ alertKind: "error" }), 72, budget);
    assert.equal(lines.length, 5, `fixed frame at budget ${budget}`);
    assert.ok(lines.some((line) => line.includes("! approvals pending: APR-1")), `alert at ${budget}`);
    assert.ok(lines.every((line) => visibleWidth(line) <= 72), `width at ${budget}`);
    assert.ok(lines.length <= MAX_LARGE_LINES, `cap at ${budget}`);
  }
  assert.equal(largeLines(scene({ alert: undefined }), 72, Number.NaN).length, 4, "non-finite budget keeps the box");
});

// --- sections and degradation ---

test("TASKS is capped at its row limit", () => {
  const many = scene({
    tasks: Array.from({ length: MAX_TASK_ROWS + 3 }, (_value, index) => ({ text: `step ${index}`, status: "pending" as const })),
  });
  const lines = largeLines(many, 72, MAX_LARGE_LINES);
  assert.equal(lines.filter((line) => TASK_ROW.test(line)).length, MAX_TASK_ROWS);
  assert.ok(lines.length <= MAX_LARGE_LINES);
});

test("TASKS outranks the tower, so a taller terminal never hides checklist rows", () => {
  const many = scene({
    tasks: Array.from({ length: MAX_TASK_ROWS }, (_value, index) => ({ text: `step ${index}`, status: "pending" as const })),
  });
  const tall = largeLines(many, 72, MAX_LARGE_LINES);
  assert.equal(tall.filter((line) => TASK_ROW.test(line)).length, MAX_TASK_ROWS);
  assert.ok(tall.some((line) => line.includes("│▓▓▓▓▓▓▓▓▓▓▓│")), "the full tower fits a full checklist");
  const roomy = largeLines(many, 72, 30);
  assert.equal(roomy.filter((line) => TASK_ROW.test(line)).length, MAX_TASK_ROWS);
  assert.ok(!roomy.some((line) => line.includes("│▓▓▓▓▓▓▓▓▓▓▓│")), "the tower shrinks before the checklist");
  const tiny = largeLines(many, 72, 18);
  assert.equal(tiny.filter((line) => TASK_ROW.test(line)).length, 0);
  assert.ok(tiny.some((line) => line.includes("┌─────┴─────┐")), "the tower stays");
});

test("TASKS takes the full scene width for its step text", () => {
  const row = largeLines(scene({ tasks: [{ text: "x".repeat(50), status: "pending" }] }), 72, 34).find((line) =>
    TASK_ROW.test(line),
  )!;
  assert.ok(row.includes("x".repeat(50)), "the step text spans the free width");
  assert.ok(visibleWidth(row) <= 72, "the row stays inside the terminal");
});

test("checklist presence and visible rows are monotonic across the whole height budget", () => {
  const input = scene();
  const samples = Array.from({ length: 31 }, (_value, index) => index + 4).map((budget) => {
    const lines = largeLines(input, 72, budget);
    return { budget, tasks: lines.filter((line) => TASK_ROW.test(line)).length };
  });
  samples.slice(1).forEach((sample, index) => {
    const previous = samples[index]!;
    if (previous.tasks > 0) assert.ok(sample.tasks > 0, `TASKS vanished at budget ${sample.budget}`);
    assert.ok(sample.tasks >= previous.tasks, `TASKS shrank at budget ${sample.budget}`);
  });
  assert.ok(samples.some((sample) => sample.tasks === MAX_TASK_ROWS));
});

test("every line budget keeps the alert, stays inside the cap and degrades monotonically", () => {
  const input = scene();
  const counts = Array.from({ length: 41 }, (_value, budget) => budget).map((budget) => {
    const lines = largeLines(input, 72, budget);
    assert.ok(lines.some((line) => line.includes("approvals pending: APR-1")), `alert at ${budget}`);
    assert.ok(lines.length <= MAX_LARGE_LINES, `cap at ${budget}`);
    assert.ok(lines.length <= Math.max(budget, 5), `budget at ${budget}`);
    assert.ok(lines.every((line) => visibleWidth(line) <= 72), `width at ${budget}`);
    return lines.length;
  });
  for (let index = 1; index < counts.length; index += 1) {
    assert.ok(counts[index]! >= counts[index - 1]!, `length fell at budget ${index}`);
  }
  assert.ok(counts.at(-1)! > counts[0]!);
  const sampled = [40, 34, 30, 24, 18].map((budget) => largeLines(input, 72, budget));
  assert.ok(sampled[0]!.length > sampled.at(-1)!.length);
  assert.equal(sampled[0]!.length, MAX_LARGE_LINES);
});

test("the header bar fills proportionally and clamps out-of-range counts", () => {
  const barRow = (done: number, total: number): string =>
    largeLines(scene({ done, total }), 72, 40).find((line) => line.includes("tasks)"))!;
  assert.ok(barRow(5, 10).includes(`${BAR.filled.repeat(5)}${BAR.empty.repeat(5)}`));
  assert.ok(barRow(0, 10).includes(BAR.empty.repeat(BAR.cells)));
  assert.ok(barRow(10, 10).includes(BAR.filled.repeat(BAR.cells)));
  assert.ok(barRow(20, 10).includes(BAR.filled.repeat(BAR.cells)));
  assert.ok(barRow(0, 0).includes(BAR.empty.repeat(BAR.cells)));
});
