import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import { Classifier } from "../src/classifier/classifier.ts";
import type { Answer, FetchLike, Question } from "../src/classifier/client.ts";
import { decideSeats, seatRequest, type SeatInput } from "../src/classifier/seats.ts";
import { ASK_THE_USER, answerRequest, decideAnswers, type AnswerCandidate } from "../src/classifier/answers.ts";
import { CLASSIFIER_CONTINUE, PlanningSession } from "../src/lobby/planner.ts";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { DEFAULT_CONFIG, type ClassifierConfig } from "../src/schemas/configuration.ts";

const THRESHOLDS = DEFAULT_CONFIG.classifier.thresholds;

test("seat questions judge the idea in round 1 and the latest answers after it", () => {
  const input: SeatInput = {
    round: 1,
    idea: "add a dark mode toggle",
    latest: "add a dark mode toggle",
    candidates: [
      { member: "designer", label: "DESIGN", owns: "flows and screens" },
      { member: "qa", label: "QA", owns: "tests", lastStatus: "ready", notes: ["e2e in tests/e2e"] },
    ],
  };
  const first = seatRequest(input);
  assert.deepEqual(Object.keys(first.questions), ["seat_designer", "seat_qa"]);
  assert.match(String(first.questions.seat_designer!.instructions), /Does `idea` involve anything that the DESIGN seat/);
  assert.equal((first.state as Record<string, unknown>).latest, "", "round 1 has only the idea");
  const later = seatRequest({ ...input, round: 3, latest: "1. evergreen only", draft: "### Steps" });
  assert.match(String(later.questions.seat_qa!.instructions), /does the user's `latest` message raise or leave open anything that only the QA seat/);
  const seats = (later.state as { seats: Record<string, { last_round: string; notes: string[] }> }).seats;
  assert.match(seats.QA!.last_round, /^READY/);
  assert.deepEqual(seats.QA!.notes, ["e2e in tests/e2e"]);

  const answers: Record<string, Answer> = { seat_designer: { type: "noul", noul: 0.4 }, seat_qa: { type: "noul", noul: 0.5 } };
  const decision = decideSeats(answers, input, THRESHOLDS);
  assert.deepEqual([...decision.seat], ["designer"], "0.4 clears 0.35; a READY seat needs 0.6 to come back");
  assert.deepEqual([...decideSeats({}, input, THRESHOLDS).seat], ["designer", "qa"], "a seat the classifier did not answer for sits");
});

function candidate(overrides: Partial<AnswerCandidate> = {}): AnswerCandidate {
  return { index: 0, from: "QA", text: "Which browsers must pass?", options: [{ label: "Evergreen", description: "Chrome, Firefox, Safari" }, { label: "All", description: "IE too" }], recommended: "Evergreen", ...overrides };
}

function picked(choice: string, probability: number, others: Record<string, number> = {}): Answer {
  return { type: "choice", choice, probabilities: { [choice]: probability, ...others }, confidence: probability };
}

test("an obvious answer must be the recommended option, confident and clearly ahead; asking the user is always possible", () => {
  const request = answerRequest([candidate(), candidate({ index: 1, from: "DEV", options: [{ label: "REST", description: "" }, { label: "REST", description: "dup" }], recommended: "REST" })], { request: "idea", conversation: "talk", draft: "plan" });
  assert.deepEqual(Object.keys((request.questions.q1 as Extract<Question, { type: "choice" }>).criteria), ["Evergreen", "All", ASK_THE_USER]);
  assert.deepEqual(Object.keys((request.questions.q2 as Extract<Question, { type: "choice" }>).criteria), ["REST", "REST (2)", ASK_THE_USER], "labels stay unique");
  assert.match(String(request.questions.q1!.instructions), /The planning panel's QA seat asks the user: "Which browsers must pass\?"/);
  const decide = (answer: Answer, overrides: Partial<AnswerCandidate> = {}) => decideAnswers({ q1: answer }, [candidate(overrides)], THRESHOLDS);
  assert.deepEqual(decide(picked("Evergreen", 0.95, { All: 0.03 })), [{ index: 0, from: "QA", question: "Which browsers must pass?", answer: "Evergreen", probability: 0.95 }]);
  assert.deepEqual(decide(picked("All", 0.97, { Evergreen: 0.01 })), [], "a confident pick against the recommendation is still your call");
  assert.deepEqual(decide(picked("Evergreen", 0.85, { All: 0.1 })), [], "below 0.9");
  assert.deepEqual(decide(picked(ASK_THE_USER, 0.99)), []);
  assert.deepEqual(decideAnswers({}, [candidate()], THRESHOLDS), [], "no answer, no decision");
  assert.deepEqual(decideAnswers({ q1: picked("Evergreen", 0.92, { All: 0.9 }) }, [candidate()], THRESHOLDS), [], "not clearly ahead of the runner-up");
});

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/served", stopReason: "stop", usage: { input: 100, output: 40, cost: { total: 0.02 } } } });
}

/** A fake pi answering as whichever seat (or the oracle) the task names. */
function panelRunner(answers: Record<string, string | undefined>, seen: Array<{ who: string; prompt: string }>): ProcessRunner {
  return (_args, options) => {
    const prompt = options.prompt ?? "";
    const who = /You are (DEV|DESIGN|QA|RESEARCH) on the planning panel/.exec(prompt)?.[1] ?? "ORACLE";
    seen.push({ who, prompt });
    const text = answers[who];
    if (text === undefined) return Promise.resolve({ exitCode: 1, stdout: "", stderr: `${who} crashed`, killed: false, timedOut: false });
    return Promise.resolve({ exitCode: 0, stdout: reply(text), stderr: "", killed: false, timedOut: false });
  };
}

/** A fake Jev: seat questions answer from `seats`, panel questions pick from `picks` (by question text). */
function fakeJev(seats: Record<string, number>, picks: Record<string, [string, number]>, calls: Array<Record<string, Question>>, fail = false): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, Question> };
    calls.push(body.questions);
    if (fail) return new Response("{}", { status: 400 });
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(body.questions)) {
      if (key.startsWith("seat_")) answers[key] = { type: "noul", noul: seats[key.slice(5)] ?? 0 };
      else {
        const text = String(question.instructions);
        const match = Object.entries(picks).find(([needle]) => text.includes(needle));
        const [label, probability] = match?.[1] ?? [ASK_THE_USER, 0.9];
        answers[key] = picked(label, probability);
      }
    }
    return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
  };
}

function jev(fetch: FetchLike, overrides: Partial<ClassifierConfig> = {}): Classifier {
  return new Classifier({ config: () => ({ ...DEFAULT_CONFIG.classifier, enabled: true, ...overrides }), keys: async () => "ts_key", fetch, sleep: async () => {} });
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "bl-classifier-plan-"));
}

test("the classifier seats only the members the idea touches, pinned seats always sit, and obvious questions are answered", async () => {
  const root = tempRoot();
  const seen: Array<{ who: string; prompt: string }> = [];
  const calls: Array<Record<string, Question>> = [];
  const feed = new LobbyFeed();
  const answers: Record<string, string | undefined> = {
    DEV: "## Status\nOPEN\n## Questions\n1. REST or RPC?\n## Notes\n- routes in src/api",
    QA: "## Status\nOPEN\n## Questions\n1. Which browsers?",
    RESEARCH: "## Status\nREADY",
    ORACLE: "## Status\nGRILLING\n## Title\nDark mode\n## Questions\n1. [QA] Which browsers must pass?\n   - Evergreen (Recommended) — Chrome, Firefox, Safari\n   - All — IE too\n2. [DEV] Ship behind a flag?\n   - Yes (Recommended) — dark launch\n   - No — everyone at once\n## Plan\n### Steps\n1. Build it",
  };
  const session = new PlanningSession({
    cwd: root, root, configDir: ".pi", feed,
    panel: ["backend", "designer", "qa", "researcher"],
    profile: () => ({ thinking: "high", timeoutMs: 60_000 }),
    runProcess: panelRunner(answers, seen),
    classifier: jev(fakeJev({ backend: 0.92, designer: 0.05, qa: 0.5, researcher: 0.1 }, { "Which browsers must pass?": ["Evergreen", 0.96] }, calls)),
  });
  // Unseat RESEARCH, then seat it again: now it is pinned and sits whatever the classifier says.
  assert.equal(session.toggle("researcher"), false);
  assert.equal(session.toggle("researcher"), true);
  assert.ok(session.pins.has("researcher"));

  await session.send("add dark mode");
  assert.equal(session.error, undefined);
  assert.deepEqual(Object.keys(calls[0]!), ["seat_backend", "seat_designer", "seat_qa"], "pinned seats are not asked about");
  assert.deepEqual(seen.map((call) => call.who), ["DEV", "QA", "RESEARCH", "ORACLE"], "DESIGN sat out; RESEARCH is pinned");
  assert.deepEqual([...session.satOut], [["designer", 0.05]]);
  assert.ok(feed.activity.some((entry) => entry.source === "CLASSIFIER" && /seated DEV, QA, RESEARCH · DESIGN sat out \(0\.05\)/.test(entry.text)));

  // The browser question was obvious; the flag question stays yours.
  assert.deepEqual(session.questions.map((question) => question.text), ["Ship behind a flag?"]);
  const last = session.messages.at(-1)!;
  assert.deepEqual(last.decided, [{ index: 0, from: "QA", question: "Which browsers must pass?", answer: "Evergreen", probability: 0.96 }]);
  assert.deepEqual(last.questions?.map((question) => question.text), ["Ship behind a flag?"]);
  assert.ok(feed.activity.some((entry) => entry.source === "CLASSIFIER" && /answered \[QA\] Evergreen \(0\.96\); 1 left for you/.test(entry.text)));

  // Next round: every seat and the oracle read the decision; the READY seat stays out unless the answers touch it.
  answers.ORACLE = "## Status\nREADY\n## Plan\n### Steps\n1. Build it behind a flag";
  answers.DEV = "## Status\nREADY";
  answers.QA = "## Status\nREADY";
  await session.send("1. yes, behind a flag");
  const round2 = seen.slice(4);
  assert.ok(round2.every((call) => call.prompt.includes("Decided by the classifier") && call.prompt.includes("- [QA] Which browsers must pass? → Evergreen (0.96)")));
  assert.equal(session.reply?.status, "ready");
});

test("when the classifier settles every question the panel continues once on its own, then waits for you", async () => {
  const root = tempRoot();
  const seen: Array<{ who: string; prompt: string }> = [];
  const calls: Array<Record<string, Question>> = [];
  const oracle = "## Status\nGRILLING\n## Questions\n1. [QA] Which browsers must pass?\n   - Evergreen (Recommended) — modern\n   - All — IE too\n## Plan\n### Steps\n1. x";
  const session = new PlanningSession({
    cwd: root, root, configDir: ".pi", panel: [],
    profile: () => ({ thinking: "high", timeoutMs: 60_000 }),
    runProcess: panelRunner({ ORACLE: oracle }, seen),
    classifier: jev(fakeJev({}, { "Which browsers must pass?": ["Evergreen", 0.97] }, calls)),
  });
  await session.send("idea");
  assert.deepEqual(session.messages.map((message) => message.role), ["you", "planner", "you", "planner"], "one automatic round");
  assert.equal(session.messages[2]!.text, CLASSIFIER_CONTINUE);
  assert.equal(session.turns, 2);
  assert.deepEqual(session.questions, [], "the second round was settled too, but the panel waits for you now");
  assert.equal(session.awaitingAnswers, false);
  assert.match(session.messages.at(-1)!.text, /The classifier settled this round's questions/);
  // The round limit still counts classifier rounds.
  assert.equal(seen.filter((call) => call.who === "ORACLE").length, 2);
});

test("with the classifier off or failing, every seat sits and every question is yours", async () => {
  const root = tempRoot();
  const oracle = "## Status\nGRILLING\n## Questions\n1. [QA] Which browsers must pass?\n   - Evergreen (Recommended) — modern\n   - All — IE too\n## Plan\n1. x";
  for (const classifier of [jev(fakeJev({}, {}, [], true)), jev(fakeJev({ backend: 0 }, {}, []), { enabled: false }), jev(fakeJev({ backend: 0 }, { browsers: ["Evergreen", 0.99] }, []), { features: { ...DEFAULT_CONFIG.classifier.features, seats: false, answers: false } })]) {
    const seen: Array<{ who: string; prompt: string }> = [];
    const session = new PlanningSession({
      cwd: root, root, configDir: ".pi", panel: ["backend", "qa"],
      profile: () => ({ thinking: "high", timeoutMs: 60_000 }),
      runProcess: panelRunner({ DEV: "## Status\nOPEN", QA: "## Status\nOPEN", ORACLE: oracle }, seen),
      classifier,
    });
    await session.send("idea");
    assert.deepEqual(seen.map((call) => call.who), ["DEV", "QA", "ORACLE"]);
    assert.equal(session.satOut.size, 0);
    assert.equal(session.questions.length, 1);
    assert.equal(session.messages.at(-1)!.decided, undefined);
  }
});

test("the Plan tab shows seats that sat out with their probability, and answers the classifier decided", async () => {
  const { conversationLines, rosterLines } = await import("../src/lobby/tabs/plan.ts");
  const base = { messages: [], questions: [], notes: [], busy: false, turns: 1, awaitingAnswers: false, answeredChunks: 0, lineComments: [] };
  const seats = [
    { label: "ORACLE", seated: true, status: "done" as const, questions: 0, ready: false },
    { label: "DESIGN", seated: true, status: "idle" as const, questions: 0, ready: false, satOut: 0.07 },
    { label: "DEV", seated: true, status: "done" as const, questions: 1, ready: false, pinned: true },
  ];
  const roster = rosterLines({ ...base, seats }, 200, 0).join(" ");
  assert.match(roster, /DESIGN sat out · 0\.07/);
  assert.match(roster, /DEV 1 question/);
  const lines = conversationLines({ ...base, seats, messages: [{ role: "planner", text: "The classifier settled this round's questions.", at: 0, decided: [{ index: 0, from: "QA", question: "Which browsers?", answer: "Evergreen", probability: 0.94 }] }] }, 200).join("\n");
  assert.match(lines, /✓ \[QA\] Which browsers\? → Evergreen · decided by the classifier \(0\.94\); comment on the plan to overrule/);
});
