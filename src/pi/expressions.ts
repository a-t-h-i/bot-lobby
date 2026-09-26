/**
 * Caller-driven expression schedule for the zen sprites.
 *
 * Pure and deterministic: `now` and the random source are always injected, so
 * the art, layout and metrics stay free of `Date.now`/`Math.random`. Each slot
 * and the oracle keeps its own state, holds its rest frame between events and,
 * after a random 20-30 s gap, plays a short blink or a longer emote.
 */

/** Resting gap before the next expression, milliseconds. */
export const BLINK_MIN_MS = 20_000;
export const BLINK_MAX_MS = 30_000;
/** How long one blink and one emote are held. */
export const BLINK_MS = 500;
export const EMOTE_MS = 2000;
/** Fast clock while an expression plays, short enough that a blink is never skipped. */
export const FAST_TICK_MS = 120;

/** Art frame indexes: 0 rests, 1 blinks, `2 ..` are emotes. */
export const REST_FRAME = 0;
export const BLINK_FRAME = 1;
export const EMOTE_FRAME = 2;
/**
 * Emote frame range: `EMOTE_FRAME .. EMOTE_FRAME + EMOTE_FRAMES - 1`; an emote
 * steps through them: the open face, a blink, then its action (see kaomoji.ts).
 */
export const EMOTE_FRAMES = 4;
/** Each emote frame is held this long, so an emote steps through its frames. */
export const EMOTE_STEP_MS = Math.floor(EMOTE_MS / EMOTE_FRAMES);

const BLINK_CHANCE = 0.65;
/** Working agents emote as often as they blink. */
export const WORKING_BLINK_CHANCE = 0.5;
/** Upper bound (exclusive) of an expression's variant. */
const VARIANT_SPAN = 2 ** 30;

export interface ExpressionState {
  /** Earliest `now` the next expression may start. */
  nextAt: number;
  /** When the playing expression ends; not after `now` while resting. */
  until: number;
  /** When the current expression started; drives emote frame stepping. */
  startedAt: number;
  /** Frame index for the art: 0 rest, 1 blink, 2+ emote. */
  frame: number;
  /** Drawn once per expression; picks which face an emote shows (see kaomoji.ts). */
  variant: number;
}

/** A random draw clamped to `[0, 1]`, so a non-finite source value can never leak. */
function unit(rng: () => number): number {
  const value = rng();
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Resting window between expressions, milliseconds. */
export interface ExpressionGap {
  min: number;
  max: number;
}

/** Idle agent slots rest 20-30 s between expressions. */
export const SLOT_GAP: ExpressionGap = { min: BLINK_MIN_MS, max: BLINK_MAX_MS };
/** Working agents are livelier: 8-15 s between expressions. */
export const WORKING_GAP: ExpressionGap = { min: 8_000, max: 15_000 };
/** The oracle is the scene's centrepiece: it blinks and emotes every 6-12 s. */
export const ORACLE_GAP: ExpressionGap = { min: 6_000, max: 12_000 };

/** Random resting gap before the next expression, inside `gap` (the slot window by default). */
export function nextGap(rng: () => number, gap: ExpressionGap = SLOT_GAP): number {
  return gap.min + Math.round(unit(rng) * (gap.max - gap.min));
}

/** Whether the next expression blinks (~65% by default) or emotes. */
export function pickEvent(rng: () => number, blinkChance = BLINK_CHANCE): "blink" | "emote" {
  return unit(rng) < blinkChance ? "blink" : "emote";
}

function drawVariant(rng: () => number): number {
  return Math.floor(unit(rng) * (VARIANT_SPAN - 1));
}

/** A freshly rested expression that fires for the first time after one random gap. */
export function createExpression(now: number, rng: () => number, gap: ExpressionGap = SLOT_GAP): ExpressionState {
  const start = Number.isFinite(now) ? now : 0;
  return { nextAt: start + nextGap(rng, gap), until: start, startedAt: start, frame: REST_FRAME, variant: 0 };
}

/** True while `now` is inside a playing blink or emote. */
export function isPlaying(state: ExpressionState, now: number): boolean {
  return Number.isFinite(now) && now < state.until;
}

/** True when any state is mid-expression; the caller uses it to retime its clock. */
export function anyPlaying(states: readonly ExpressionState[], now: number): boolean {
  return states.some((state) => isPlaying(state, now));
}

/**
 * Advance one sprite to `now`: start a blink or emote once the gap has elapsed,
 * drop back to the rest frame when it ends, and change nothing in between.
 */
export function advanceExpression(
  state: ExpressionState,
  now: number,
  rng: () => number,
  gap: ExpressionGap = SLOT_GAP,
  blinkChance = BLINK_CHANCE,
): ExpressionState {
  if (!Number.isFinite(now)) return state;
  if (now < state.until) return state.frame >= EMOTE_FRAME ? steppedEmote(state, now) : state;
  if (now < state.nextAt) return state.frame === REST_FRAME ? state : { ...state, frame: REST_FRAME };
  return play(now, rng, gap, blinkChance);
}

function play(now: number, rng: () => number, gap: ExpressionGap, blinkChance: number): ExpressionState {
  const blink = pickEvent(rng, blinkChance) === "blink";
  return blink ? startBlink(now, rng, gap) : triggerEmote(now, rng, gap);
}

function startBlink(now: number, rng: () => number, gap: ExpressionGap): ExpressionState {
  const until = now + BLINK_MS;
  return { nextAt: until + nextGap(rng, gap), until, startedAt: now, frame: BLINK_FRAME, variant: drawVariant(rng) };
}

/**
 * Start an emote right now, whatever the sprite was doing: the reaction when a
 * slot's situation changes (it starts, finishes, fails, stalls, waits or
 * receives a file). The next scheduled expression follows one gap later.
 */
export function triggerEmote(now: number, rng: () => number, gap: ExpressionGap = SLOT_GAP): ExpressionState {
  const start = Number.isFinite(now) ? now : 0;
  const until = start + EMOTE_MS;
  return { nextAt: until + nextGap(rng, gap), until, startedAt: start, frame: EMOTE_FRAME, variant: drawVariant(rng) };
}

/** One sub-step of a playing expression; the oracle's blink and glance step through these. */
export const PHASE_MS = FAST_TICK_MS;

/** Sub-steps elapsed in the playing expression, 0 while resting or on a bad clock. */
export function expressionPhase(state: ExpressionState, now: number): number {
  if (!isPlaying(state, now)) return 0;
  const elapsed = now - state.startedAt;
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed / PHASE_MS) : 0;
}

/** How long the oracle lip-syncs after it says something new, and one mouth shape's hold. */
export const TALK_MS = 1800;
export const TALK_STEP_MS = FAST_TICK_MS;

/** Mouth-shape index while the oracle is still talking about what it said at `since`, else undefined. */
export function talkFrame(since: number | undefined, now: number): number | undefined {
  if (since === undefined || !Number.isFinite(since) || !Number.isFinite(now)) return undefined;
  const elapsed = now - since;
  return elapsed >= 0 && elapsed < TALK_MS ? Math.floor(elapsed / TALK_STEP_MS) : undefined;
}

/** Emote frame for `now`: one step per EMOTE_STEP_MS, clamped to the last frame. */
function emoteFrameAt(startedAt: number, now: number): number {
  const elapsed = now - startedAt;
  const step = Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed / EMOTE_STEP_MS) : 0;
  return EMOTE_FRAME + Math.min(EMOTE_FRAMES - 1, Math.max(0, step));
}

/** Advance an in-flight emote's frame, keeping the same object when it has not changed. */
function steppedEmote(state: ExpressionState, now: number): ExpressionState {
  const frame = emoteFrameAt(state.startedAt, now);
  return frame === state.frame ? state : { ...state, frame };
}
