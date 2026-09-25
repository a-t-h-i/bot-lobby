import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  BAR,
  COMPACT_FRAMES,
  COMPACT_WIDTH,
  FACE_WIDTH,
  BUBBLE,
  EYE_WIDTH,
  ORACLE_AURA,
  ORACLE_AURA_TICKS,
  GAZE_AHEAD,
  ORACLE_BLINK,
  ORACLE_FRAMES,
  ORACLE_GAZE_TICKS,
  ORACLE_IDLE_WORD,
  ORACLE_LOOK,
  ORACLE_LOOK_PATH,
  ORACLE_MOOD_MOUTHS,
  ORACLE_MOUTH,
  ORACLE_PUPILS,
  ORACLE_TALK,
  ORACLE_WANDER,
  ORACLE_WANDER_TICKS,
  ORACLE_POSES,
  ORACLE_WORDS,
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
  oracleAside,
  oracleFace,
  oracleGaze,
  oracleMood,
  oracleSpeech,
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
    quietHint: "tools hidden (alt+t)",
    tick: 0,
    done: 3,
    total: 6,
    slots: [
      { id: "dev", label: SLOT_LABELS.dev, status: "working", frame: 0, activity: "reading", elapsedLabel: "12s" },
      { id: "design", label: SLOT_LABELS.design, status: "idle", frame: 1, elapsedLabel: "—" },
      { id: "research", label: SLOT_LABELS.research, status: "done", frame: 2, elapsedLabel: "1m 05s" },
      { id: "qa", label: SLOT_LABELS.qa, status: "failed", frame: 3, elapsedLabel: "42s" },
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
  const activity = status === "working" ? "reading" : undefined;
  const slots = scene().slots.map((slot) => ({ ...slot, status, frame, activity }));
  return scene({ slots });
}

const TASK_ROW = /\[[x> ]\] /;

/** Box, alert, full tower, branch, agent strip, TASKS header and six entries. */
const FULL_SCENE_LINES = 4 + 1 + TOWER.rows.length + 3 + 4 + 1 + MAX_TASK_ROWS;

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
    const lines = largeLines(scene({ alert: undefined, oracle: { pose: "orchestrating", frame } }), 72, 40);
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
      .replace(TOWER.tokens.winL, " ◉ ")
      .replace(TOWER.tokens.winR, " ◉ ")
      .replace(TOWER.tokens.mouth, "═══════")
      .replace(TOWER.tokens.aura, ORACLE_AURA.orchestrating[0]!);
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
    "    ┌─ BOT-LOBBY ── core-feature · implementing ──────────────────┐",
    "    │ █████░░░░░  50%  (3/6 tasks)                                │",
    "    │ ⏱ 12m 30s · tools hidden (alt+t) · TASK-core-feature        │",
    "    └─────────────────────────────────────────────────────────────┘",
    "    ! approvals pending: APR-1",
    "                                ·  ✦  ·   ",
    "                                 ╲ │ ╱     ╭──────────────────────╮",
    "                                ──(◉)── ╶──┤ ⠋ orchestrating      │",
    "                                 ╱ │ ╲     │ → DEV                │",
    "                                   │       ╰──────────────────────╯",
    "                             ╭─────┴─────╮",
    "                             │╭───╮ ╭───╮│",
    "                             ││◒  │ │◒  ││",
    "                             │╰───╯ ╰───╯│",
    "                             │    ───    │",
    "                             ├───┬───┬───┤",
    "                             │░▒▓│ORC│▓▒░│",
    "                             └───┴───┴───┘",
    "                                   │                        ",
    "           ┌───────────────┬───────┴───────┬───────────────┐",
    "           │               │               │               │",
    "         (^_^)           (u_u)          (✿^‿^)         (〒﹏〒)    ",
    "          DEV           DESIGN         RESEARCH           QA       ",
    "       ⠋ reading        · idle          ✓ done         ✗ failed    ",
    "          12s              —            1m 05s            42s      ",
    "     TASKS",
    "    [x] Research reqs                                          ",
    "    [x] Design architecture                                    ",
    "    [>] Implement feature                                      ",
    "    [ ] Write tests                                            ",
    "    [ ] Run QA                                                 ",
    "    [ ] Deploy                                                 ",
  ];
  const at100 = [
    "                  ┌─ BOT-LOBBY ── core-feature · implementing ──────────────────┐",
    "                  │ █████░░░░░  50%  (3/6 tasks)                                │",
    "                  │ ⏱ 12m 30s · tools hidden (alt+t) · TASK-core-feature        │",
    "                  └─────────────────────────────────────────────────────────────┘",
    "                  ! approvals pending: APR-1",
    "                                              ·  ✦  ·   ",
    "                                               ╲ │ ╱     ╭──────────────────────╮",
    "                                              ──(◉)── ╶──┤ ⠋ orchestrating      │",
    "                                               ╱ │ ╲     │ → DEV                │",
    "                                                 │       ╰──────────────────────╯",
    "                                           ╭─────┴─────╮",
    "                                           │╭───╮ ╭───╮│",
    "                                           ││◒  │ │◒  ││",
    "                                           │╰───╯ ╰───╯│",
    "                                           │    ───    │",
    "                                           ├───┬───┬───┤",
    "                                           │░▒▓│ORC│▓▒░│",
    "                                           └───┴───┴───┘",
    "                                                 │                        ",
    "                         ┌───────────────┬───────┴───────┬───────────────┐",
    "                         │               │               │               │",
    "                       (^_^)           (u_u)          (✿^‿^)         (〒﹏〒)    ",
    "                        DEV           DESIGN         RESEARCH           QA       ",
    "                     ⠋ reading        · idle          ✓ done         ✗ failed    ",
    "                        12s              —            1m 05s            42s      ",
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

test("the oracle line spins the master's activity and reads dormant when idle", () => {
  const spinning = largeLines(scene({ oracleActivity: "delegating", tick: 1 }), 72, 40);
  assert.ok(spinning.some((line) => line.includes(`${SPIN_FRAMES[1]} delegating`)), "the oracle spinner is missing");
  const dormant = largeLines(scene({ oracle: { pose: "dormant", frame: 0 } }), 72, 40);
  assert.ok(dormant.some((line) => line.includes(`${SLOT_STATE_GLYPHS.idle} ${ORACLE_WORDS.dormant}`)), "the dormant word is missing");
});

test("the box keeps the task id, state, title, elapsed and quiet hint", () => {
  const lines = largeLines(scene(), 72, 40);
  const box = lines.slice(0, 4).join("\n");
  assert.ok(box.includes("core-feature · implementing"));
  assert.ok(box.includes("TASK-core-feature"));
  assert.ok(box.includes("core-feature"));
  assert.ok(box.includes("(3/6 tasks)"));
  assert.ok(box.includes("12m 30s"));
  assert.ok(box.includes("tools hidden (alt+t)"));
  assert.ok(box.includes("50%"));
  assert.equal(visibleWidth(lines[0]!.trimStart()), SCENE_WIDTH);
  assert.ok(lines.some((line) => line.includes(TOWER_DOOR)));
});

test("an empty plan renders a zero bar and no checklist section", () => {
  const lines = largeLines(scene({ done: 0, total: 0, tasks: [] }), 72, 40);
  assert.ok(lines.some((line) => line.includes("(0/0 tasks)")));
  assert.ok(lines.some((line) => line.includes("  0%")));
  assert.ok(!lines.some((line) => line.includes("TASKS")));
});

// --- geometry ---

test("the tower stem, the tree branch and the agent columns share one centre", () => {
  const lines = largeLines(scene(), 100, 40);
  const roof = lines.findIndex((line) => line.includes("╭─────┴─────╮"));
  const tree = lines.findIndex((line) => line.includes("┬") && line.includes("┴"));
  const centre = lines[roof]!.indexOf("┴");
  assert.equal(lines[roof - 1]!.indexOf("│"), centre, "tower stem above the roof");
  assert.equal(lines[tree]!.indexOf("┴"), centre, "tree branch meets the stem");
  assert.equal(lines[tree + 1]!.indexOf("│"), lines[tree]!.indexOf("┌"), "pipes under the first node");
  const face = lines.find((line) => line.includes("(^_^)"))!;
  assert.equal(face.indexOf("(^_^)") + 2, lines[tree]!.indexOf("┌"), "first column sits under its node");
  const orb = lines.find((line) => line.includes("(◉)"))!;
  assert.equal(orb.indexOf("◉"), centre, "orb over the stem");
});

test("the tower stem, the branch stem and the tree node share the terminal centre at every large width", () => {
  for (const width of [72, 100, 133]) {
    const lines = largeLines(scene(), width, MAX_LARGE_LINES);
    const centre = Math.floor((width - 1) / 2);
    const roof = lines.findIndex((line) => line.includes("╭─────┴─────╮"));
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

test("a working agent shows the braille spinner with its live activity and animates off the injected tick", () => {
  const rows = (tick: number) => largeLines(scene({ tick }), 72, 40).filter((line) => line.includes("reading"));
  const base = rows(0);
  assert.equal(base.length, 1, "one status row");
  assert.ok(base[0]!.includes(`${SPIN_FRAMES[0]} reading`));
  assert.ok(rows(1)[0]!.includes(`${SPIN_FRAMES[1]} reading`));
  assert.ok(rows(SPIN_FRAMES.length)[0]!.includes(`${SPIN_FRAMES[0]} reading`), "the tick wraps");
  assert.ok(rows(-1)[0]!.includes(`${SPIN_FRAMES.at(-1)} reading`), "negative ticks wrap from the end");
  assert.ok(!largeLines(withStatus("done"), 72, 40).some((line) => line.includes("reading")), "done agents drop the activity word");
});

test("a working agent without an activity word falls back to the state word", () => {
  const bare = scene({ slots: scene().slots.map((slot) => ({ ...slot, activity: undefined })) });
  assert.ok(largeLines(bare, 72, 40).some((line) => line.includes(`${SPIN_FRAMES[0]} ${SLOT_STATE_WORDS.working}`)));
});

test("the longest activity word fits its cell beside the braille spinner", () => {
  const slots = scene().slots.map((slot) => ({ ...slot, status: "working" as const, activity: "orchestrating" }));
  const row = largeLines(scene({ slots, oracleActivity: "delegating" }), 72, 40).find((line) => line.includes("orchestrating"))!;
  assert.ok(row.includes(`${SPIN_FRAMES[0]} orchestrating`), "the word must not truncate");
  assert.equal(row.split("orchestrating").length - 1, 4, "every column shows the word");
  assert.ok(visibleWidth(`${SPIN_FRAMES[0]} orchestrating`) <= SLOT_CELL, "the status cell must hold the word");
});

test("faces and state words follow each slot status", () => {
  for (const status of SLOT_STATES) {
    const word = status === "working" ? "reading" : SLOT_STATE_WORDS[status];
    const lines = largeLines(withStatus(status), 72, 40);
    assert.ok(lines.some((line) => line.includes(word)), `${status} word`);
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
  const spinnerRow = colored.find((line) => stripAnsi(line).includes("reading"))!;
  assert.ok(spinnerRow.includes(`\x1b[1m`), "working row bold");
  const orbRow = colored.find((line) => stripAnsi(line).includes("(◉)"))!;
  assert.ok(orbRow.includes(`\x1b[${CODES.accent}m◉\x1b[0m`), "oracle orb colour");
});

test("each agent column renders its status in one row", () => {
  for (const status of SLOT_STATES) {
    const lines = largeLines(withStatus(status), 72, 34);
    const marker = status === "working" ? "reading" : `${SLOT_STATE_GLYPHS[status]} ${SLOT_STATE_WORDS[status]}`;
    const rows = lines.filter((line) => line.includes(marker));
    assert.equal(rows.length, 1, `${status} status row`);
    assert.equal(rows[0]!.split(marker).length - 1, 4, `${status} marker in every column`);
    assert.ok(visibleWidth(rows[0]!) <= 72, `${status} status row width`);
  }
});

test("each agent column renders its elapsed label on a dim fourth row", () => {
  const row = largeLines(scene(), 72, 40).find((line) => line.includes("1m 05s") && line.includes("42s"))!;
  for (const label of ["12s", "—", "1m 05s", "42s"]) assert.ok(row.includes(label), label);
  assert.ok(visibleWidth(row) <= 72, "the elapsed row stays inside the terminal");
  const themed = largeLines(scene(), 72, 40, ANSI_THEME).find((line) => stripAnsi(line).includes("1m 05s"))!;
  assert.ok(themed.includes(`\x1b[${CODES.dim}m`), "the elapsed row is dim");
  const idle = largeLines(scene({ slots: scene().slots.map((slot) => ({ ...slot, status: "idle" })) }), 72, 40);
  assert.ok(idle.some((line) => line.includes("—")), "an idle agent reads an em-dash");
});

test("the status glyph, state word or spinner shares the status colour and weight", () => {
  for (const status of SLOT_STATES) {
    const style = SLOT_STATE_COLORS[status];
    const marker = status === "working" ? `${SPIN_FRAMES[0]} reading` : `${SLOT_STATE_GLYPHS[status]} ${SLOT_STATE_WORDS[status]}`;
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
  assert.ok(tall.some((line) => line.includes("│╭───╮ ╭───╮│")), "the full tower fits a full checklist");
  const roomy = largeLines(many, 72, 30);
  assert.equal(roomy.filter((line) => TASK_ROW.test(line)).length, MAX_TASK_ROWS);
  assert.ok(!roomy.some((line) => line.includes("│╭───╮ ╭───╮│")), "the tower shrinks before the checklist");
  const tiny = largeLines(many, 72, 18);
  assert.equal(tiny.filter((line) => TASK_ROW.test(line)).length, 0);
  assert.ok(tiny.some((line) => line.includes("╭─────┴─────╮")), "the tower stays");
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
  assert.equal(sampled[0]!.length, FULL_SCENE_LINES);
  assert.ok(FULL_SCENE_LINES <= MAX_LARGE_LINES);
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

// --- the oracle's speech bubble ---

test("the speech bubble hangs beside the crown with its tail on the orb row", () => {
  for (const width of [72, 100, 160]) {
    const lines = largeLines(scene({ oracleActivity: "delegating" }), width, 40);
    const orbRow = lines.find((line) => line.includes("(◉)"))!;
    assert.ok(orbRow.includes("(◉)── ╶──┤ ⠋ delegating"), `tail at ${width}: ${orbRow}`);
    const top = lines.indexOf(orbRow) - 1;
    assert.ok(lines[top]!.trimEnd().endsWith(`╭${"─".repeat(BUBBLE.width - 2)}╮`), "bubble top above the tail");
    assert.ok(lines[top + 3]!.trimEnd().endsWith(`╰${"─".repeat(BUBBLE.width - 2)}╯`), "bubble bottom");
    const right = (line: string) => visibleWidth(line.trimEnd());
    assert.equal(right(lines[top]!), right(lines[top + 3]!), "bubble edges line up");
    assert.equal(right(lines[top + 1]!), right(lines[top]!), "speech row closes the box");
    assert.ok(right(lines[top]!) <= Math.floor((width - SCENE_WIDTH) / 2) + SCENE_WIDTH, "bubble stays inside the scene");
  }
  const small = largeLines(scene(), 72, 24);
  assert.ok(small.some((line) => line.includes("╭─────┴─────╮╶┤")), "the small tower gets a stub tail");
});

test("the oracle says what the master does, oversees running agents, and waits on the user", () => {
  const idle = scene({ slots: scene().slots.map((slot) => ({ ...slot, status: "idle" as const, activity: undefined })) });
  assert.equal(oracleSpeech(scene({ oracleActivity: "planning", tick: 2 })), `${SPIN_FRAMES[2]} planning`);
  assert.equal(oracleSpeech(scene()), `${SPIN_FRAMES[0]} ${ORACLE_WORDS.orchestrating}`);
  assert.equal(oracleSpeech(idle), `${SLOT_STATE_GLYPHS.idle} ${ORACLE_IDLE_WORD}`);
  assert.equal(oracleSpeech(scene({ oracle: { pose: "dormant", frame: 0 }, oracleActivity: "planning" })), `${SLOT_STATE_GLYPHS.idle} ${ORACLE_WORDS.dormant}`);
  const both = scene({ slots: scene().slots.map((slot) => ({ ...slot, status: slot.id === "design" ? "working" as const : slot.status })) });
  assert.equal(oracleAside(both), "→ DEV · DESIGN");
  assert.equal(oracleAside(idle), "step 4 of 6");
  assert.equal(oracleAside({ ...idle, done: 6 }), "all steps done");
  assert.equal(oracleAside({ ...idle, state: "awaiting_approval", caption: "awaiting your approval" }), "awaiting your approval");
  assert.equal(oracleAside({ ...idle, state: "planning", caption: undefined }), "planning");
  const long = largeLines(scene({ oracleActivity: "x".repeat(60) }), 72, 40).find((line) => line.includes("xxx"))!;
  assert.ok(long.includes("…"), "a long activity is truncated inside the bubble");
  assert.ok(visibleWidth(long) <= 72);
});

test("the aura twinkles with the tick while orchestrating and drifts z's while dormant", () => {
  const aura = (input: LargeSceneInput) => largeLines(input, 72, 40)[5]!.trim();
  assert.equal(aura(scene({ tick: 0 })), ORACLE_AURA.orchestrating[0]!.trim());
  assert.equal(aura(scene({ tick: ORACLE_AURA_TICKS })), ORACLE_AURA.orchestrating[1]!.trim());
  assert.equal(aura(scene({ tick: 1 })), aura(scene({ tick: 0 })), "each aura frame holds for several ticks");
  assert.equal(aura(scene({ oracle: { pose: "dormant", frame: 0 } })), ORACLE_AURA.dormant[0]!.trim());
  for (const pose of ORACLE_POSES) {
    for (const frame of ORACLE_AURA[pose]) assert.equal(visibleWidth(frame), 7, `${pose} aura ${JSON.stringify(frame)}`);
  }
});

// --- the oracle's eyes and mouth ---

/** The eye row and mouth row, read off the rendered tower. */
function oracleFaceRows(input: LargeSceneInput): { eyes: string; mouth: string } {
  const lines = largeLines(input, 72, 40);
  const roof = lines.findIndex((line) => line.includes("╭─────┴─────╮"));
  const left = lines[roof]!.indexOf("╭");
  const row = (offset: number) => lines[roof + offset]!.slice(left, left + TOWER_WIDTH);
  return { eyes: row(2), mouth: row(4) };
}

const calm = (overrides: Partial<LargeSceneInput> = {}) =>
  scene({ alert: undefined, slots: scene().slots.map((slot) => ({ ...slot, status: "idle" as const })), ...overrides });

const working = (ids: string[], tick = 0) =>
  calm({ tick, slots: calm().slots.map((slot) => ({ ...slot, status: ids.includes(slot.id) ? "working" as const : "idle" as const })) });

test("the oracle keeps a straight, serious face at rest and never idles on a smile", () => {
  for (const overrides of [{}, { done: 6, total: 6 }, { alert: "approvals pending: APR-1", alertKind: "warning" as const }]) {
    assert.equal(oracleFaceRows(calm(overrides)).mouth, `│  ${ORACLE_MOUTH}  │`);
  }
  for (const frame of ORACLE_FRAMES.orchestrating) assert.equal(frame.mouth, ORACLE_MOUTH, "no smiling expression frame");
  for (const shape of [...ORACLE_TALK, ...Object.values(ORACLE_MOOD_MOUTHS)]) assert.doesNotMatch(shape, /╰|◡|‿/, `no smile in ${shape}`);
  assert.equal(oracleMood(calm({ alert: "blocked: stuck", alertKind: "error" })), "worried");
  assert.ok(oracleFaceRows(calm({ alert: "blocked: stuck", alertKind: "error" })).mouth.includes(ORACLE_MOOD_MOUTHS.worried), "a blocker tightens it into a frown");
});

test("the oracle's pupils reach all nine spots: left, centre, right and up, ahead, down", () => {
  const seen = new Set<string>();
  for (let tick = 0; tick < ORACLE_WANDER.length * ORACLE_WANDER_TICKS; tick += 1) seen.add(oracleFaceRows(calm({ tick })).eyes);
  for (let phase = 0; phase < ORACLE_LOOK_PATH.length; phase += 1) {
    seen.add(oracleFaceRows(calm({ oracle: { pose: "orchestrating", frame: ORACLE_LOOK, phase } })).eyes);
  }
  const cell = (x: number, glyph: string) => [" ", " ", " "].map((blank, column) => (column === x + 1 ? glyph : blank)).join("");
  for (const x of [-1, 0, 1]) {
    for (const glyph of Object.values(ORACLE_PUPILS)) {
      assert.ok(seen.has(`││${cell(x, glyph)}│ │${cell(x, glyph)}││`), `never looked at ${x}/${glyph}`);
    }
  }
});

test("idle, the oracle's eyes wander the room and keep coming back to you", () => {
  assert.deepEqual(oracleGaze(calm({ tick: 0 })), GAZE_AHEAD, "starts looking ahead");
  assert.deepEqual(oracleGaze(calm({ tick: ORACLE_WANDER_TICKS - 1 })), GAZE_AHEAD, "holds each spot");
  const spots = ORACLE_WANDER.map((_gaze, index) => oracleGaze(calm({ tick: index * ORACLE_WANDER_TICKS })));
  assert.deepEqual(spots, [...ORACLE_WANDER]);
  assert.ok(new Set(spots.map((gaze) => `${gaze.x},${gaze.y}`)).size >= 6, "it really looks around");
  assert.ok(spots.filter((gaze) => gaze.x === 0 && gaze.y === 0).length >= 3, "and returns to you between glances");
});

test("while agents work, the oracle looks down at them and takes turns between them", () => {
  assert.equal(oracleFaceRows(working(["dev"])).eyes, "││◒  │ │◒  ││", "down-left at DEV");
  assert.equal(oracleFaceRows(working(["qa"])).eyes, "││  ◒│ │  ◒││", "down-right at QA");
  assert.deepEqual(oracleGaze(working(["dev", "qa"], 0)), { x: -1, y: 1 });
  assert.deepEqual(oracleGaze(working(["dev", "qa"], ORACLE_GAZE_TICKS - 1)), { x: -1, y: 1 }, "holds its gaze");
  assert.deepEqual(oracleGaze(working(["dev", "qa"], ORACLE_GAZE_TICKS)), { x: 1, y: 1 }, "then moves to the next agent");
  assert.deepEqual(oracleGaze({ ...working(["dev"]), oracle: { pose: "orchestrating", frame: 0, talk: 0 } }), GAZE_AHEAD, "looks at you while talking");
  assert.deepEqual(oracleGaze({ ...working(["dev"]), oracle: { pose: "dormant", frame: 0 } }), GAZE_AHEAD, "asleep, it looks nowhere");
});

test("the look-around emote scans the room, and a blink steps the lids down and up", () => {
  const looked = ORACLE_LOOK_PATH.map((_gaze, phase) => oracleGaze(calm({ oracle: { pose: "orchestrating", frame: ORACLE_LOOK, phase } })));
  assert.deepEqual(looked, [...ORACLE_LOOK_PATH]);
  assert.deepEqual(oracleGaze(calm({ oracle: { pose: "orchestrating", frame: ORACLE_LOOK + 1, phase: 99 } })), ORACLE_LOOK_PATH.at(-1), "the second emote frame finishes the scan");
  for (const axis of ["x", "y"] as const) {
    for (const value of [-1, 1]) assert.ok(ORACLE_LOOK_PATH.some((gaze) => gaze[axis] === value), `the scan reaches ${axis}=${value}`);
  }
  const blink = (phase: number) => oracleFaceRows(calm({ oracle: { pose: "orchestrating", frame: ORACLE_BLINK, phase } })).eyes;
  assert.deepEqual([0, 1, 2, 3, 9].map(blink), [
    "││ ◒ │ │ ◒ ││",
    "││───│ │───││",
    "││───│ │───││",
    "││ ◒ │ │ ◒ ││",
    "││ ◒ │ │ ◒ ││",
  ]);
});

test("the oracle lip-syncs while it talks", () => {
  const talking = (talk: number) => oracleFaceRows(calm({ oracleActivity: "planning", oracle: { pose: "orchestrating", frame: 0, talk } })).mouth;
  const shapes = ORACLE_TALK.map((_shape, talk) => talking(talk));
  ORACLE_TALK.forEach((shape, talk) => assert.ok(shapes[talk]!.includes(shape), `talk shape ${talk}`));
  assert.ok(new Set(shapes).size >= 6, "the mouth moves through distinct shapes");
  assert.ok(shapes.some((shape) => shape.includes(ORACLE_MOUTH)), "it pauses for breath");
  assert.equal(talking(ORACLE_TALK.length), talking(0), "the lip-sync loops");
  const looking = oracleFaceRows(calm({ oracle: { pose: "orchestrating", frame: ORACLE_LOOK, talk: 2 } })).mouth;
  assert.ok(looking.includes(ORACLE_TALK[2]!), "it keeps talking while it looks around");
  const asleep = oracleFaceRows(calm({ oracle: { pose: "dormant", frame: 0, talk: 2 } })).mouth;
  assert.ok(asleep.includes(ORACLE_MOUTH), "a dormant oracle does not talk");
});

test("asleep, the oracle peeks one eye open and snores louder", () => {
  const dormant = (frame: number, phase = 0) => oracleFaceRows(calm({ oracle: { pose: "dormant", frame, phase } }));
  assert.equal(dormant(0).eyes, "││───│ │───││");
  assert.equal(dormant(1, 1).eyes, "││ ◉ │ │───││", "one eye cracks open");
  assert.equal(dormant(1, 99).eyes, "││───│ │───││", "and drifts shut again");
  assert.ok(dormant(2).mouth.includes("─o─") && dormant(3).mouth.includes("─O─"), "the snore grows");
});

test("every eye, lid and mouth combination keeps the tower exactly TOWER_WIDTH wide", () => {
  const bases = [calm(), calm({ alert: "blocked: x", alertKind: "error" }), working(["dev", "qa"], 9)];
  for (const base of bases) {
    for (const pose of ORACLE_POSES) {
      for (const frame of ORACLE_FRAMES[pose].keys()) {
        for (const phase of [0, 1, 3, 7, 12, 40]) {
          for (const talk of [undefined, 0, 3, 11]) {
            for (const tick of [0, 17, 55]) {
              const face = oracleFace({ ...base, tick, oracle: { pose, frame, phase, talk } });
              assert.equal(visibleWidth(face.left), EYE_WIDTH, `${pose}/${frame}/${phase} left`);
              assert.equal(visibleWidth(face.right), EYE_WIDTH, `${pose}/${frame}/${phase} right`);
              assert.equal(visibleWidth(face.mouth), 7, `${pose}/${frame}/${talk} mouth ${JSON.stringify(face.mouth)}`);
              assert.equal(visibleWidth(face.orb), 1);
            }
          }
        }
      }
    }
  }
  for (const glyph of Object.values(ORACLE_PUPILS)) assert.equal(visibleWidth(glyph), 1, glyph);
});
