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
export const BLINK_MS = 150;
export const EMOTE_MS = 600;
/** Fast clock while an expression plays, short enough that a blink is never skipped. */
export const FAST_TICK_MS = 120;

/** Art frame indexes: 0 rests, 1 blinks, `2 ..` are emotes. */
export const REST_FRAME = 0;
export const BLINK_FRAME = 1;
export const EMOTE_FRAME = 2;
/** Emote frames the scheduler may pick: `EMOTE_FRAME .. EMOTE_FRAME + EMOTE_FRAMES - 1`. */
export const EMOTE_FRAMES = 2;

const BLINK_CHANCE = 0.65;

export interface ExpressionState {
  /** Earliest `now` the next expression may start. */
  nextAt: number;
  /** When the playing expression ends; not after `now` while resting. */
  until: number;
  /** Frame index for the art: 0 rest, 1 blink, 2+ emote. */
  frame: number;
}

/** A random draw clamped to `[0, 1]`, so a non-finite source value can never leak. */
function unit(rng: () => number): number {
  const value = rng();
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Random resting gap before the next expression, in `[BLINK_MIN_MS, BLINK_MAX_MS]`. */
export function nextGap(rng: () => number): number {
  return BLINK_MIN_MS + Math.round(unit(rng) * (BLINK_MAX_MS - BLINK_MIN_MS));
}

/** Whether the next expression blinks (~65%) or emotes (~35%). */
export function pickEvent(rng: () => number): "blink" | "emote" {
  return unit(rng) < BLINK_CHANCE ? "blink" : "emote";
}

/** A freshly rested expression that fires for the first time after one random gap. */
export function createExpression(now: number, rng: () => number): ExpressionState {
  const start = Number.isFinite(now) ? now : 0;
  return { nextAt: start + nextGap(rng), until: start, frame: REST_FRAME };
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
export function advanceExpression(state: ExpressionState, now: number, rng: () => number): ExpressionState {
  if (!Number.isFinite(now) || now < state.until) return state;
  if (now < state.nextAt) return state.frame === REST_FRAME ? state : { ...state, frame: REST_FRAME };
  return play(now, rng);
}

function play(now: number, rng: () => number): ExpressionState {
  const blink = pickEvent(rng) === "blink";
  const until = now + (blink ? BLINK_MS : EMOTE_MS);
  return { nextAt: until + nextGap(rng), until, frame: blink ? BLINK_FRAME : emoteFrame(rng) };
}

function emoteFrame(rng: () => number): number {
  return EMOTE_FRAME + Math.min(EMOTE_FRAMES - 1, Math.floor(unit(rng) * EMOTE_FRAMES));
}
