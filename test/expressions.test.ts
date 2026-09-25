import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLINK_FRAME,
  BLINK_MAX_MS,
  BLINK_MIN_MS,
  BLINK_MS,
  EMOTE_FRAME,
  EMOTE_MS,
  EMOTE_STEP_MS,
  FAST_TICK_MS,
  REST_FRAME,
  advanceExpression,
  anyPlaying,
  createExpression,
  isPlaying,
  nextGap,
  pickEvent,
} from "../src/pi/expressions.ts";

/** Deterministic rng that walks a fixed queue and repeats its last value. */
function fake(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

test("nextGap stays inside the 20-30 s window and never emits NaN", () => {
  assert.equal(BLINK_MIN_MS, 20_000);
  assert.equal(BLINK_MAX_MS, 30_000);
  assert.equal(nextGap(fake(0)), 20_000);
  assert.equal(nextGap(fake(0.5)), 25_000);
  assert.equal(nextGap(fake(1)), 30_000);
  assert.equal(nextGap(fake(2)), 30_000);
  assert.equal(nextGap(fake(-1)), 20_000);
  for (const value of [0, 0.25, 0.5, 0.75, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const gap = nextGap(fake(value));
    assert.ok(Number.isFinite(gap), `${value} -> ${gap}`);
    assert.ok(gap >= BLINK_MIN_MS && gap <= BLINK_MAX_MS, `${value} -> ${gap}`);
  }
});

test("pickEvent favours blinks at ~65% but can emote", () => {
  assert.equal(pickEvent(fake(0)), "blink");
  assert.equal(pickEvent(fake(0.64)), "blink");
  assert.equal(pickEvent(fake(0.65)), "emote");
  assert.equal(pickEvent(fake(1)), "emote");
  assert.equal(pickEvent(fake(Number.NaN)), "blink");
});

test("a fresh expression rests and fires only after its random gap", () => {
  const now = 1_000;
  const state = createExpression(now, fake(0.5));
  assert.equal(state.frame, REST_FRAME);
  assert.equal(state.until, now);
  assert.equal(state.nextAt, now + 25_000);
  assert.equal(isPlaying(state, now), false);
  assert.equal(advanceExpression(state, now, fake(0)), state, "before the gap nothing changes");
  assert.equal(advanceExpression(state, now + 24_999, fake(0)), state);
});

test("a blink lasts BLINK_MS and drops back to rest afterwards", () => {
  const rested = createExpression(0, fake(0.5));
  const at = rested.nextAt;
  const blinking = advanceExpression(rested, at, fake(0, 0.5));
  assert.equal(blinking.frame, BLINK_FRAME);
  assert.equal(blinking.until, at + BLINK_MS);
  assert.equal(isPlaying(blinking, at), true);
  assert.equal(isPlaying(blinking, at + BLINK_MS - 1), true);
  assert.equal(isPlaying(blinking, at + BLINK_MS), false);
  assert.equal(advanceExpression(blinking, at + BLINK_MS - 1, fake(0)), blinking, "still blinking");
  const restedAgain = advanceExpression(blinking, at + BLINK_MS, fake(0));
  assert.equal(restedAgain.frame, REST_FRAME);
  assert.equal(restedAgain.until, blinking.until);
  assert.ok(restedAgain.nextAt >= blinking.until + BLINK_MIN_MS, "the next gap follows the blink");
});

test("an emote lasts EMOTE_MS and steps through its frames", () => {
  const rested = createExpression(0, fake(0.5));
  const at = rested.nextAt;
  const first = advanceExpression(rested, at, fake(0.9));
  assert.equal(first.frame, EMOTE_FRAME);
  assert.equal(first.until, at + EMOTE_MS);
  assert.equal(advanceExpression(first, at + EMOTE_STEP_MS - 1, fake(0)), first, "the first frame is held");
  const stepped = advanceExpression(first, at + EMOTE_STEP_MS, fake(0));
  assert.equal(stepped.frame, EMOTE_FRAME + 1);
  assert.equal(advanceExpression(stepped, at + EMOTE_MS - 1, fake(0)).frame, EMOTE_FRAME + 1, "the last frame holds to the end");
  assert.equal(isPlaying(first, at + EMOTE_MS - 1), true);
  assert.equal(isPlaying(first, at + EMOTE_MS), false);
});

test("each sprite keeps its own schedule and advancing one never touches another", () => {
  const first = createExpression(0, fake(0));
  const second = createExpression(0, fake(1));
  assert.notEqual(first.nextAt, second.nextAt);
  const advanced = advanceExpression(first, first.nextAt, fake(0, 0));
  assert.equal(advanced.frame, BLINK_FRAME);
  assert.equal(anyPlaying([advanced, second], first.nextAt), true);
  assert.equal(anyPlaying([second], first.nextAt), false);
});

test("a non-finite clock or source never yields NaN", () => {
  const state = createExpression(Number.NaN, fake(Number.NaN));
  assert.ok(Number.isFinite(state.nextAt));
  assert.equal(state.frame, REST_FRAME);
  assert.equal(advanceExpression(state, Number.NaN, fake(0)), state);
  assert.equal(isPlaying(state, Number.NaN), false);
  assert.equal(anyPlaying([state], Number.NaN), false);
  const fired = advanceExpression(state, state.nextAt, fake(0, Number.POSITIVE_INFINITY));
  for (const value of Object.values(fired)) assert.ok(Number.isFinite(value), JSON.stringify(fired));
});

test("the fast tick is shorter than a blink, so a blink is never skipped", () => {
  assert.ok(FAST_TICK_MS < BLINK_MS);
  assert.ok(FAST_TICK_MS < EMOTE_STEP_MS, "an emote step is never skipped");
});
