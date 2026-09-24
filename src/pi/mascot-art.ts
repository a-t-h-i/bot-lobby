import type { TaskState } from "../schemas/task.ts";

/**
 * Pure ASCII art data for the scene-based zen panel. No logic lives here:
 * the shapes, labels, props, captions and layout templates are constants that
 * `zen.ts` and `zen-large.ts` compose. Every glyph is exactly one visible
 * column so the art stays narrow/ambiguous-width safe: the non-ASCII glyphs are
 * the house `⌂` in `BANNER_NARROW`, the panel's ◐/✓/✗ status family, and the
 * box-drawing, bar and eye glyphs of the large scene (─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ═ █ ▓ ░ ◉ ◍ ◎ ◌ ○).
 */

/** The four blob mascots that are always present in the scene. */
export type MascotId = "master" | "designer" | "backend" | "qa";

/**
 * Three-row blob sprites. Every blob is 9 columns wide; `rest` and `blink`
 * differ only in the eye/face row (a single calm blink). Silhouette and a
 * per-domain accessory distinguish the mascots without relying on color.
 */
export const BLOB_ART: Record<MascotId, { rest: readonly string[]; blink: readonly string[] }> = {
  master: {
    rest: ["  /^^^\\  ", " ( o o ) ", "  |___|  "],
    blink: ["  /^^^\\  ", " ( - - ) ", "  |___|  "],
  },
  designer: {
    rest: ["  (___)  ", " ( o o ) ", "  ~~~~~  "],
    blink: ["  (___)  ", " ( - - ) ", "  ~~~~~  "],
  },
  backend: {
    rest: ["  |===|  ", " [ o o ] ", "  |===|  "],
    blink: ["  |===|  ", " [ - - ] ", "  |===|  "],
  },
  qa: {
    rest: ["  _____  ", " ( o O ) ", "  \\___/  "],
    blink: ["  _____  ", " ( - O ) ", "  \\___/  "],
  },
};

/** Condensed one-row blobs (8 columns) for the narrow compact strip. */
export const COMPACT_BLOB_ART: Record<MascotId, { rest: readonly string[]; blink: readonly string[] }> = {
  master: { rest: ["<^>(o.o)"], blink: ["<^>(-.-)"] },
  designer: { rest: ["~,~(o.o)"], blink: ["~,~(-.-)"] },
  backend: { rest: ["[=](o.o)"], blink: ["[=](-.-)"] },
  qa: { rest: ["(o.o)<o>"], blink: ["(-.-)<o>"] },
};

/** Short lowercase labels drawn beneath each blob. */
export const BLOB_LABELS: Record<MascotId, string> = {
  master: "master",
  designer: "designer",
  backend: "backend",
  qa: "qa",
};

/**
 * One-column status glyphs, matching the glyph family the panel already uses
 * for runs and steps (◐ running, ✓ success, ✗ failure). `zen.ts` derives its
 * blob status type from these keys.
 */
export const STATUS_GLYPHS = { idle: "·", running: "◐", done: "✓", failed: "✗" } as const;

/**
 * Marks wrapped around the active agent's label (`[backend]`) so the active
 * agent is emphasized without adding a row or relying on color.
 */
export const ACTIVE_LABEL_MARKS = ["[", "]"] as const;

export const BANNER_TITLE = "THE DEV HOUSE";
export const BANNER_NARROW = "⌂ THE DEV HOUSE";

/**
 * Per-state room prop (fixed 3 rows x 7 columns) plus a one-line caption
 * (<= 30 chars). The prop is what the room is "doing"; the caption says it.
 */
export const SCENE_PROPS: Record<TaskState, { prop: readonly string[]; caption: string }> = {
  created: {
    prop: ["  .-.  ", "  |_|  ", "  | |  "],
    caption: "no work started yet",
  },
  clarifying: {
    prop: ["  ,--, ", " ( ? ) ", "  '--' "],
    caption: "clarifying the request",
  },
  scouting: {
    prop: ["     __", "  __/ /", " /___/ "],
    caption: "scouting the codebase",
  },
  synthesizing: {
    prop: [" \\   / ", "  \\ /  ", "   V   "],
    caption: "synthesizing findings",
  },
  awaiting_approval: {
    prop: ["  ___  ", " |   | ", " |___| "],
    caption: "awaiting your approval",
  },
  planning: {
    prop: ["  ___  ", " |_|_| ", " |_|_| "],
    caption: "writing the plan",
  },
  implementing: {
    prop: ["  ___  ", " |===| ", "  | |  "],
    caption: "agents at work",
  },
  reviewing: {
    prop: ["  ___  ", " ( o ) ", "  `--' "],
    caption: "reviewing the diff",
  },
  blocked: {
    prop: [" __ __ ", "|__|__|", " |  |  "],
    caption: "blocked, needs a hand",
  },
  completed: {
    prop: ["  ___  ", " |   | ", "  \\_/  "],
    caption: "work complete",
  },
  abandoned: {
    prop: ["  ___  ", " |x x| ", " |___| "],
    caption: "task set aside",
  },
};

/**
 * Layout contract for one diorama.
 *
 * `rows` are literal templates and their visible width *is* the rendered
 * width: a token is replaced by fixed-width content that also consumes the
 * `cellWidth - tokenWidth` characters following it, so a row never grows.
 * `{prop}` and `{blobs}` repeat on every art row starting at `propRows[0]` /
 * `blobRow`; `labelRow` is -1 when labels are omitted.
 *
 * Cell widths (cells are padded/truncated to this width, gaps are 2 spaces):
 * - full: `{prop}` 7 cols; `{blobs}`/`{status}`/`{labels}` 4 x 9 + 3 gaps = 42
 * - compact: `{prop}` is the state caption (variable, 13..22 cols);
 *   `{blobs}`/`{status}` 4 x 8 + 3 gaps = 38
 */
export interface DioramaSpec {
  rows: readonly string[];
  blobRow: number;
  statusRow: number;
  labelRow: number;
  blobColumns: readonly number[];
  propRows: readonly number[];
  propColumn: number;
}

/**
 * Full scene (58 cols x 6 rows) for terminals >= 60 cols, and the compact
 * strip (40 cols x 3 rows) below that. `{blobs}`/`{status}`/`{labels}` are
 * the four cells joined by two-space gaps at `blobColumns`; compact uses the
 * one-row `COMPACT_BLOB_ART` and its `{prop}` is the state caption.
 */
export const DIORAMA: { full: DioramaSpec; compact: DioramaSpec } = {
  full: {
    rows: [
      "/^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\\",
      "|  {prop}     {blobs}                                    |",
      "|  {prop}     {blobs}                                    |",
      "|  {prop}     {blobs}                                    |",
      "|             {status}                                   |",
      "|             {labels}                                   |",
    ],
    blobRow: 1,
    statusRow: 4,
    labelRow: 5,
    blobColumns: [14, 25, 36, 47],
    propRows: [1, 2, 3],
    propColumn: 3,
  },
  compact: {
    rows: [
      "|{prop}                                |",
      "|{blobs}                               |",
      "|{status}                              |",
    ],
    blobRow: 1,
    statusRow: 2,
    labelRow: -1,
    blobColumns: [1, 11, 21, 31],
    propRows: [0],
    propColumn: 1,
  },
};

/* -------------------------------------------------------------------------
 * Large scene (>= LARGE_MIN_WIDTH columns, composed by zen-large.ts).
 *
 * The 58-column full diorama above and the four-mascot `BLOB_*` art stay until
 * the backend pass moves zen.ts onto this slot roster; they are then dead and
 * can be deleted with the compact strip's own wiring.
 * ---------------------------------------------------------------------- */

/** The four agent columns of the large scene, in the order the scene draws them. */
export type SlotId = "dev" | "design" | "research" | "qa";

export const SLOT_IDS: readonly SlotId[] = ["dev", "design", "research", "qa"];

/** Uppercase column captions; RESEARCH is the longest at 8 columns. */
export const SLOT_LABELS: Record<SlotId, string> = {
  dev: "DEV",
  design: "DESIGN",
  research: "RESEARCH",
  qa: "QA",
};

/** Status the roster reports; drives the face, the colour and the state word. */
export type SlotState = "working" | "idle" | "done" | "failed";

export const SLOT_STATES: readonly SlotState[] = ["working", "idle", "done", "failed"];

export const SLOT_STATE_WORDS: Record<SlotState, string> = {
  working: "working",
  idle: "idle",
  done: "done",
  failed: "failed",
};

/** The slice of a panel theme's colour vocabulary this art maps onto. */
export type PanelColor = "accent" | "muted" | "dim" | "success" | "error" | "warning";

/** Status -> colour for the face, state word and bar fill. Working is bold as well. */
export const SLOT_STATE_COLORS: Record<SlotState, { color: PanelColor; bold: boolean }> = {
  working: { color: "accent", bold: true },
  idle: { color: "dim", bold: false },
  done: { color: "success", bold: false },
  failed: { color: "error", bold: false },
};

/** Ten-cell progress bar; the caller fills `cells` of it from a percentage. */
export const BAR = { filled: "█", empty: "░", cells: 10 } as const;

/** The master's pose: orchestrating while the task is live, dormant when paused or finished. */
export type OraclePose = "orchestrating" | "dormant";

export const ORACLE_POSES: readonly OraclePose[] = ["orchestrating", "dormant"];

export const ORACLE_WORDS: Record<OraclePose, string> = {
  orchestrating: "orchestrating",
  dormant: "dormant",
};

export const ORACLE_COLORS: Record<OraclePose, { color: PanelColor; bold: boolean }> = {
  orchestrating: { color: "accent", bold: true },
  dormant: { color: "dim", bold: false },
};

/** One oracle frame: the tower orb plus both window eyes, each exactly one column. */
export interface OracleFrame {
  orb: string;
  winL: string;
  winR: string;
}

/**
 * Orb pulse and window-eye tracking per pose. Orchestrating sweeps the eyes and
 * pulses the orb; dormant half-closes them and dims the orb. Every alternate is
 * one column wide, so a frame swap never moves the tower geometry.
 */
export const ORACLE_FRAMES: Record<OraclePose, readonly OracleFrame[]> = {
  orchestrating: [
    { orb: "◉", winL: "◉", winR: "◉" },
    { orb: "◍", winL: "◉", winR: "◉" },
    { orb: "◉", winL: "◍", winR: "◉" },
    { orb: "◉", winL: "◉", winR: "◍" },
    { orb: "◎", winL: "◉", winR: "◉" },
    { orb: "◉", winL: "─", winR: "─" },
    { orb: "◍", winL: "◍", winR: "◍" },
    { orb: "◉", winL: "◉", winR: "◉" },
  ],
  dormant: [
    { orb: "◌", winL: "◌", winR: "◌" },
    { orb: "○", winL: "◌", winR: "◌" },
    { orb: "◌", winL: "─", winR: "─" },
    { orb: "◌", winL: "◌", winR: "◌" },
  ],
};

/**
 * Eye-shift and blink frames per status, one row each: working looks around and
 * blinks, idle droops, done is calm and content, failed winces. Same length for
 * every state so the caller's frame index stays comparable across statuses.
 */
const FACE_FRAMES: Record<SlotState, readonly string[]> = {
  working: ["(^_^)", "(^-^)", "(^o^)", "(^_^)", "(-_-)", "(-.-)", "(^o^)", "(^_^)"],
  idle: ["(-_-)", "(-_-)", "(u_u)", "(-.-)", "(-_-)", "(-_-)", "(u_u)", "(-.-)"],
  done: ["(o_o)", "(^_^)", "(o_o)", "(^-^)", "(o_-)", "(o_o)", "(-_-)", "(^_^)"],
  failed: ["(>_<)", "(>o<)", "(x_x)", "(>_<)", "(T_T)", "(>_<)", "(;_;)", "(>o<)"],
};

/** Every face is five columns, so a centered column never shifts between frames. */
export const FACE_WIDTH = 5;

function buildSlotFrames(): Record<SlotState, readonly string[][]> {
  const frames = {} as Record<SlotState, readonly string[][]>;
  for (const state of SLOT_STATES) frames[state] = FACE_FRAMES[state].map((face) => [face]);
  return frames;
}

/** Animated faces per slot: frames of one row each, identical width in every frame. */
export const SLOT_FRAMES: Record<SlotId, Record<SlotState, readonly string[][]>> = {
  dev: buildSlotFrames(),
  design: buildSlotFrames(),
  research: buildSlotFrames(),
  qa: buildSlotFrames(),
};

/** Three-column accessory that marks each slot in the one-row compact strip. */
export const SLOT_MARKS: Record<SlotId, string> = {
  dev: "[=]",
  design: "~,~",
  research: "<?>",
  qa: "<o>",
};

/** Eight columns: the slot's accessory followed by one face frame. */
export const COMPACT_WIDTH = 8;

function buildCompactFrames(id: SlotId): Record<SlotState, readonly string[]> {
  const mark = SLOT_MARKS[id];
  const frames = {} as Record<SlotState, readonly string[]>;
  for (const state of SLOT_STATES) frames[state] = FACE_FRAMES[state].map((face) => `${mark}${face}`);
  return frames;
}

/** Animated one-row sprites per slot and status for the compact strip. */
export const COMPACT_FRAMES: Record<SlotId, Record<SlotState, readonly string[]>> = {
  dev: buildCompactFrames("dev"),
  design: buildCompactFrames("design"),
  research: buildCompactFrames("research"),
  qa: buildCompactFrames("qa"),
};

/**
 * The oracle tower: 13 columns wide, `rows` while height allows and `smallRows`
 * when it must shrink. `{orb}` is the pulsing bead, `{winL}`/`{winR}` the two
 * window eyes and `{door}` the name over the door.
 */
export interface TowerSpec {
  rows: readonly string[];
  smallRows: readonly string[];
  tokens: { orb: string; winL: string; winR: string; door: string };
}

export const TOWER_WIDTH = 13;

export const TOWER_DOOR = "ORC";

export const TOWER: TowerSpec = {
  rows: [
    "     \\|/     ",
    "     ─{orb}─     ",
    "      │      ",
    "┌─────┴─────┐",
    "│ ┌─┐   ┌─┐ │",
    "│ │{winL}│   │{winR}│ │",
    "│ └─┘   └─┘ │",
    "│  ═══════  │",
    "├───┬───┬───┤",
    "│▓▓▓│{door}│▓▓▓│",
    "└───┴───┴───┘",
  ],
  smallRows: [
    "     ─{orb}─     ",
    "┌─────┴─────┐",
    "│ ┌─┐   ┌─┐ │",
    "│ │{winL}│   │{winR}│ │",
    "│▓▓▓│{door}│▓▓▓│",
    "└───┴───┴───┘",
  ],
  tokens: { orb: "{orb}", winL: "{winL}", winR: "{winR}", door: "{door}" },
};
