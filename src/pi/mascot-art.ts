import type { TaskState } from "../schemas/task.ts";

/**
 * Pure ASCII art data for the scene-based zen panel. No logic lives here:
 * the shapes, labels, props, captions and layout templates are constants that
 * `zen.ts` composes. Every glyph is exactly one visible column so the diorama
 * stays narrow/ambiguous-width safe; the only non-ASCII glyphs are the house `⌂`
 * in `BANNER_NARROW` and the panel's ◐/✓/✗ status family.
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
