import type { TaskState } from "../schemas/task.ts";

/**
 * Pure ASCII art data for the scene-based zen panel. No logic lives here: the
 * captions, status vocabulary, frame sets and tower templates are constants
 * that `zen.ts` and `zen-large.ts` compose. Every glyph is exactly one visible
 * column so the art stays narrow/ambiguous-width safe: the non-ASCII glyphs are
 * the lobby `⌂` in `BANNER_NARROW`, the panel's ◐/✓/✗ status family, and the
 * box-drawing, bar and eye glyphs of the large scene (─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ═ █ ▓ ░ ◉ ◍ ◎ ◌ ○).
 */

/**
 * One-column status glyphs, matching the glyph family the panel already uses
 * for runs and steps (◐ running, ✓ success, ✗ failure); the slot roster below
 * reuses them so a status never rests on colour alone.
 */
const STATUS_GLYPHS = { idle: "·", running: "◐", done: "✓", failed: "✗" } as const;

/** Braille spinner frames shared by the large scene and the compact working line. */
export const SPIN_FRAMES: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const BANNER_TITLE = "THE BOT LOBBY";
export const BANNER_NARROW = "⌂ THE BOT LOBBY";

/** One-line (<= 30 chars) caption per task state, labelling the compact strip. */
export const SCENE_PROPS: Record<TaskState, string> = {
  created: "no work started yet",
  clarifying: "clarifying the request",
  scouting: "scouting the codebase",
  synthesizing: "synthesizing findings",
  awaiting_approval: "awaiting your approval",
  planning: "writing the plan",
  implementing: "agents at work",
  reviewing: "reviewing the diff",
  blocked: "blocked, needs a hand",
  completed: "work complete",
  abandoned: "task set aside",
};


/* -------------------------------------------------------------------------
 * Slot roster and animated art for the zen scene (composed by zen-large.ts at
 * >= LARGE_MIN_WIDTH and by zen.ts's compact strip below it).
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

/** One-column status glyph sitting beside the state word, so status never rests on colour alone. */
export const SLOT_STATE_GLYPHS: Record<SlotState, string> = {
  working: STATUS_GLYPHS.running,
  idle: STATUS_GLYPHS.idle,
  done: STATUS_GLYPHS.done,
  failed: STATUS_GLYPHS.failed,
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

/** One oracle frame: the tower orb, both window eyes and the seven-column mouth. */
export interface OracleFrame {
  orb: string;
  winL: string;
  winR: string;
  /** Exactly seven one-column glyphs; never moves the tower geometry. */
  mouth: string;
}

/**
 * Indexed oracle expressions per pose: 0 rests, 1 blinks and 2-3 emote with a
 * pulsing orb, sweeping window eyes and a moving mouth. Every glyph is one
 * column and every mouth seven, so a frame swap never moves the tower geometry.
 */
export const ORACLE_FRAMES: Record<OraclePose, readonly OracleFrame[]> = {
  orchestrating: [
    { orb: "◉", winL: "◉", winR: "◉", mouth: "═══════" },
    { orb: "◉", winL: "─", winR: "─", mouth: "═══════" },
    { orb: "◎", winL: "◍", winR: "◉", mouth: "◡◡◡◡◡◡◡" },
    { orb: "◍", winL: "◉", winR: "◍", mouth: "▁▂▃▂▃▂▁" },
  ],
  dormant: [
    { orb: "◌", winL: "◌", winR: "◌", mouth: "═══════" },
    { orb: "◌", winL: "─", winR: "─", mouth: "═══════" },
    { orb: "○", winL: "◌", winR: "◌", mouth: "▂▂▂▂▂▂▂" },
    { orb: "○", winL: "─", winR: "─", mouth: "▁▁▁▁▁▁▁" },
  ],
};

/**
 * One frame per status and expression: index 0 is the calm rest face, 1 the
 * blink and 2-3 the emotes. Every status keeps the same frame count and one row
 * each, so a caller-chosen index stays comparable across statuses.
 */
const FACE_FRAMES: Record<SlotState, readonly string[]> = {
  working: ["(^_^)", "(-_-)", "(^o^)", "(^-^)"],
  idle: ["(-_-)", "(u_u)", "(-.-)", "(u.u)"],
  done: ["(o_o)", "(-_-)", "(^-^)", "(^_^)"],
  failed: ["(>_<)", "(x_x)", "(T_T)", "(;_;)"],
};

/** Kaomoji emotes for the large scene: working nervous, done happy, failed scared. */
const EMOTE_FACES: Record<SlotState, readonly string[]> = {
  working: ["(٥↼_↼)", "(●´⌓`●)"],
  idle: ["(-.-)", "(u.u)"],
  done: ["(✿^‿^)", "(っ˘з(˘⌣˘ )"],
  failed: ["ಥ_ಥ", "(〒﹏〒)"],
};

/** QA's success emotes are a flex and a victory dance rather than a smile. */
const QA_DONE_FACES: readonly string[] = ["ᕙ( • ‿ • )ᕗ", "ᕕ( ᐛ )ᕗ"];

/** Every compact face is five columns, so a centered column never shifts between frames. */
export const FACE_WIDTH = 5;

function buildSlotFrames(id: SlotId): Record<SlotState, readonly string[][]> {
  const frames = {} as Record<SlotState, readonly string[][]>;
  for (const state of SLOT_STATES) {
    const emotes = id === "qa" && state === "done" ? QA_DONE_FACES : EMOTE_FACES[state];
    frames[state] = [...FACE_FRAMES[state].slice(0, 2), ...emotes].map((face) => [face]);
  }
  return frames;
}

/**
 * Animated faces per slot: one row each. Rest (0) and blink (1) stay the five-column
 * ASCII eyes; the emote frames (2+) are status-aware kaomoji, wider than five columns,
 * so the scene centres each frame inside its fixed slot cell.
 */
export const SLOT_FRAMES: Record<SlotId, Record<SlotState, readonly string[][]>> = {
  dev: buildSlotFrames("dev"),
  design: buildSlotFrames("design"),
  research: buildSlotFrames("research"),
  qa: buildSlotFrames("qa"),
};

/** Three-column accessory that marks each slot in the one-row compact strip. */
const SLOT_MARKS: Record<SlotId, string> = {
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
  tokens: { orb: string; winL: string; winR: string; door: string; mouth: string };
}

export const TOWER_WIDTH = 13;

export const TOWER_DOOR = "ORC";

export const TOWER: TowerSpec = {
  rows: [
    "    \\ | /    ",
    "     \\|/     ",
    "     ─{orb}─     ",
    "      │      ",
    "┌─────┴─────┐",
    "│▓▓▓▓▓▓▓▓▓▓▓│",
    "├───────────┤",
    "│ ┌─┐   ┌─┐ │",
    "│ │{winL}│   │{winR}│ │",
    "│ └─┘   └─┘ │",
    "├───────────┤",
    "│  {mouth}  │",
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
  tokens: { orb: "{orb}", winL: "{winL}", winR: "{winR}", door: "{door}", mouth: "{mouth}" },
};
