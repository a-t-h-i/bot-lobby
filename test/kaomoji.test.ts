import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  EMOTE_STEPS,
  EMOTIONS,
  emoteFrames,
  emotionsFor,
  PERSONALITY_EMOTES,
  pickEmote,
  SHARED_EMOTES,
  slotEmote,
  type Emote,
} from "../src/pi/kaomoji.ts";
import { SLOT_IDS } from "../src/pi/mascot-art.ts";
import { SLOT_CELL } from "../src/pi/zen-large.ts";

function everyEmote(): Array<{ where: string; emote: Emote }> {
  const all: Array<{ where: string; emote: Emote }> = [];
  for (const emotion of EMOTIONS) {
    for (const emote of SHARED_EMOTES[emotion]) all.push({ where: `shared/${emotion}`, emote });
    for (const slot of SLOT_IDS) for (const emote of PERSONALITY_EMOTES[slot][emotion]) all.push({ where: `${slot}/${emotion}`, emote });
  }
  return all;
}

/** Glyphs that misrender in terminals: combining marks, RTL scripts, emoji presentation, joiners and format chars. */
const UNSAFE = /[\p{M}\p{Script=Arabic}\p{Script=Hebrew}\p{Emoji_Presentation}\p{Cf}️]/u;

test("every face fits a slot cell and is terminal-safe", () => {
  for (const { where, emote } of everyEmote()) {
    for (const face of [emote.open, emote.blink, emote.action].filter((frame): frame is string => frame !== undefined)) {
      assert.ok(visibleWidth(face) <= SLOT_CELL, `${where} ${JSON.stringify(face)} is ${visibleWidth(face)} wide`);
      assert.doesNotMatch(face, UNSAFE, `${where} ${JSON.stringify(face)} has an unsafe glyph`);
      assert.ok(face.trim().length > 0, where);
    }
  }
});

test("every emote blinks: a distinct blink frame of exactly the open face's width", () => {
  for (const { where, emote } of everyEmote()) {
    assert.notEqual(emote.blink, emote.open, `${where} ${emote.open} has no blink`);
    assert.equal(visibleWidth(emote.blink), visibleWidth(emote.open), `${where} ${emote.open} → ${emote.blink} shifts`);
  }
});

test("variety: at least four shared faces per emotion and four personality faces per emotion per agent", () => {
  for (const emotion of EMOTIONS) {
    assert.ok(SHARED_EMOTES[emotion].length >= 4, `shared/${emotion}`);
    for (const slot of SLOT_IDS) assert.ok(PERSONALITY_EMOTES[slot][emotion].length >= 4, `${slot}/${emotion}`);
  }
  const faces = new Set(everyEmote().map(({ emote }) => emote.open));
  assert.ok(faces.size >= 250, `only ${faces.size} distinct faces`);
});

test("each agent has its signature moves", () => {
  const opens = (slot: (typeof SLOT_IDS)[number], emotion: (typeof EMOTIONS)[number]) =>
    PERSONALITY_EMOTES[slot][emotion].map((emote) => emote.action ?? emote.open).join(" ");
  assert.match(opens("dev", "angry"), /┻━┻/, "DEV flips tables");
  assert.match(opens("dev", "happy"), /⌐■_■/, "DEV wears shades");
  assert.match(opens("design", "excited"), /✧/, "DESIGN sparkles");
  assert.match(opens("research", "confused"), /¯\\_\(ツ\)_\/¯/, "RESEARCH shrugs");
  assert.match(opens("research", "focused"), /φ/, "RESEARCH takes notes");
  assert.match(opens("qa", "focused"), /ಠ_ಠ/, "QA side-eyes");
  assert.match(opens("qa", "proud"), /ᕙ\( • ‿ • \)ᕗ/, "QA flexes");
  assert.match(opens("qa", "excited"), /ᕕ\( ᐛ \)ᕗ/, "QA dances");
});

test("an emote plays open, blink, then its action", () => {
  const flip = PERSONALITY_EMOTES.dev.angry[0]!;
  assert.deepEqual(emoteFrames(flip), ["(╯°□°)╯", "(╯-□-)╯", "(╯°□°)╯︵ ┻━┻", "(╯°□°)╯︵ ┻━┻"]);
  assert.equal(emoteFrames(SHARED_EMOTES.happy[0]!).length, EMOTE_STEPS);
  assert.deepEqual(emoteFrames({ open: "(•_•)", blink: "(-_-)" }), ["(•_•)", "(-_-)", "(•_•)", "(•_•)"]);
});

test("the situation decides the emotion", () => {
  assert.deepEqual(emotionsFor({ status: "working", activity: "running" }), ["nervous", "focused"]);
  assert.deepEqual(emotionsFor({ status: "working", activity: "reading" }), ["curious", "focused"]);
  assert.deepEqual(emotionsFor({ status: "working", flag: "waiting" }), ["waiting"]);
  assert.deepEqual(emotionsFor({ status: "working", flag: "quiet" }), ["confused", "sleepy"]);
  assert.deepEqual(emotionsFor({ status: "working", handover: true }), ["grateful", "happy"]);
  assert.ok(emotionsFor({ status: "done" }).includes("happy"));
  assert.deepEqual(emotionsFor({ status: "done", wrappedUp: true }), ["nervous", "proud"]);
  assert.ok(emotionsFor({ status: "failed" }).includes("angry"));
  assert.ok(emotionsFor({ status: "idle" }).includes("sleepy"));
});

test("picking is deterministic per variant, stays in the emotion, and mixes personality with the shared pool", () => {
  const situation = { status: "failed" as const };
  assert.deepEqual(slotEmote("dev", situation, 12345), slotEmote("dev", situation, 12345));
  let own = 0;
  const total = 2000;
  for (let variant = 0; variant < total; variant += 1) {
    const emote = pickEmote("dev", situation, variant);
    const emotion = emotionsFor(situation)[variant % emotionsFor(situation).length]!;
    const inPersonality = PERSONALITY_EMOTES.dev[emotion].includes(emote);
    assert.ok(inPersonality || SHARED_EMOTES[emotion].includes(emote), `variant ${variant} left its emotion`);
    if (inPersonality) own += 1;
  }
  assert.ok(own / total > 0.5 && own / total < 0.7, `personality share ${own / total}`);
  for (const bad of [Number.NaN, -3, 1.7]) assert.ok(pickEmote("qa", situation, bad));
});
