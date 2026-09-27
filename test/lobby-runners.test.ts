import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeToolCall } from "../src/pi/activity.ts";
import { createStreamCollector, finishedThought, MAX_THOUGHT_CHARS, type PiStreamEvent, type ProcessOutcome, type ProcessRunner, type ProcessRunOptions } from "../src/execution/pi-runner.ts";
import { chatFromEntries, chatText, LobbyFeed, textOf } from "../src/lobby/feed.ts";
import { QUICK_FIX_TOOLS, QuickFixQueue, jobTitle, quickFixPrompt } from "../src/lobby/quickfix.ts";
import { PLANNER_TOOLS, RESEARCH_PANEL_TOOLS, PlanningSession, appendAssumptions, commentBlock, memberPrompt, oracleClosing, optionLabel, panelSection, parseMemberReply, parseOption, parsePlannerReply, plannerSays, plannerTranscript, recommendedOption, roundMode, roundQuestions } from "../src/lobby/planner.ts";
import { roundLabel } from "../src/lobby/tabs/plan.ts";
import { MAX_QUESTIONS } from "../src/lobby/ask.ts";
import { createIssue, ghError, IssuesState, issueText, listIssues, splitIssueText, viewIssue, type Exec } from "../src/lobby/issues.ts";
import { listPlannedTasks } from "../src/state/backlog.ts";
import { readMetrics } from "../src/state/metrics.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "bl-lobby-run-"));
}

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/served", stopReason: "stop", usage: { input: 100, output: 40, cost: { total: 0.02 } } } });
}

/** A fake pi process: emits `events`, then answers `text` (or waits for the abort signal when `hang`). */
function fakeRunner(text: string, events: PiStreamEvent[] = [], seen: Array<{ args: string[]; options: ProcessRunOptions }> = [], hang = false): ProcessRunner {
  return (args, options) => {
    seen.push({ args, options });
    for (const event of events) options.onEvent?.(event);
    if (!hang) return Promise.resolve({ exitCode: 0, stdout: reply(text), stderr: "", killed: false, timedOut: false } satisfies ProcessOutcome);
    return new Promise((resolve) => {
      options.signal?.addEventListener("abort", () => resolve({ exitCode: 1, stdout: "", stderr: "", killed: true, timedOut: false }), { once: true });
    });
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("describeToolCall narrates tool calls in plain words", () => {
  assert.equal(describeToolCall("read", { path: "src/site/file.html" }), "reading file.html");
  assert.equal(describeToolCall("grep", { pattern: "router", path: "src/app" }), 'searching for "router" in app');
  assert.equal(describeToolCall("find", { pattern: "*.ts" }), "finding *.ts");
  assert.equal(describeToolCall("bash", { command: "npm test" }), "running npm test");
  assert.equal(describeToolCall("edit", { path: "users.ts" }), "editing users.ts");
  assert.equal(describeToolCall("ls", {}), "listing the folder");
  assert.equal(describeToolCall("web_search", { query: "pi rpc" }), 'searching the web for "pi rpc"');
  assert.equal(describeToolCall("fetch_content", { url: "https://example.com/docs/a?x=1" }), "fetching example.com/docs/a");
  assert.equal(describeToolCall("orchestrate", { action: "scout", domains: ["designer", "backend"] }), "scouting designer, backend");
  assert.equal(describeToolCall("orchestrate", { action: "implement", assignments: [{ domain: "backend" }, { domain: "qa" }] }), "delegating to backend, qa");
  assert.equal(describeToolCall("orchestrate", { action: "implement", domain: "backend", task: "Step 2: add the route" }), "delegating to backend: Step 2: add the route");
  assert.equal(describeToolCall("orchestrate", { action: "qa" }), "running the QA gate");
  assert.equal(describeToolCall("mystery"), "using mystery");
});

test("a finished thinking block is forwarded as one thought, bounded", () => {
  const line = (content: string) => JSON.stringify({ type: "message_update", message: {}, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content } });
  assert.equal(finishedThought(line("  weigh the options  ")), "weigh the options");
  assert.equal(finishedThought(line("x".repeat(MAX_THOUGHT_CHARS + 50)))!.length, MAX_THOUGHT_CHARS);
  assert.equal(finishedThought(line("   ")), undefined);
  assert.equal(finishedThought("not json"), undefined);
  const events: PiStreamEvent[] = [];
  const collector = createStreamCollector((event) => events.push(event));
  collector.push(`${JSON.stringify({ type: "message_update", message: {}, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "hm" } })}\n`);
  collector.push(`${line("check the router first")}\n`);
  assert.deepEqual(events.filter((event) => event.type !== "heartbeat"), [{ type: "thinking" }, { type: "thought", text: "check the router first" }]);
});

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return { runId: "r1", taskId: "T", domain: "backend", role: "worker", status: "running", output: "", attempts: 1, startedAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

test("the feed logs each new subagent step once and settles the previous one", () => {
  const feed = new LobbyFeed();
  feed.runs([run()], 1);
  feed.runs([run({ step: "reading users.ts" })], 2);
  feed.runs([run({ step: "reading users.ts", tools: 2 })], 3);
  feed.runs([run({ step: "editing users.ts", thought: "add a limit param" })], 4);
  feed.runs([run({ status: "success", finishedAt: "2026-01-01T00:01:00.000Z" })], 5);
  assert.deepEqual(feed.activity.map((entry) => [entry.source, entry.text, entry.pending, entry.kind]), [
    ["DEV", "started as worker", false, "info"],
    ["DEV", "reading users.ts", false, "info"],
    ["DEV", "editing users.ts", false, "info"],
    ["DEV", "worker finished", false, "success"],
  ]);
  assert.deepEqual(feed.thoughts.map((entry) => [entry.source, entry.text]), [["DEV", "add a limit param"]]);
});

test("the feed streams the Master's thought into one entry and closes it", () => {
  const feed = new LobbyFeed();
  feed.thinkDelta("MASTER", "Let me ");
  feed.thinkDelta("MASTER", "scout first.");
  assert.equal(feed.thoughts.length, 1);
  assert.equal(feed.thoughts[0]!.live, true);
  feed.thinkEnd("MASTER");
  assert.deepEqual(feed.thoughts.map((entry) => [entry.text, entry.live]), [["Let me scout first.", false]]);
  feed.begin("MASTER", "reading a.ts", "call-1");
  feed.end("call-1", true);
  assert.deepEqual(feed.activity.map((entry) => [entry.pending, entry.kind]), [[false, "error"]]);
});

test("the conversation keeps text only and turns bot-lobby's kickoff into the task starting and your request", () => {
  assert.equal(textOf([{ type: "thinking", thinking: "hidden" }, { type: "text", text: "Hello" }, { type: "toolCall", name: "read" }]), "Hello");
  assert.deepEqual(chatText("user", "A bot-lobby task is active: TASK-x\nTitle: add login\nRequest: add a login page\nwith email\nState: clarifying\n\nDrive it…"), [
    { role: "note", text: "task started · add login" },
    { role: "you", text: "add a login page\nwith email" },
  ]);
  assert.deepEqual(chatText("user", "The user left a comment on the proposal of TASK-x from the lobby:\n- cap it"), [{ role: "note", text: "your comment on the proposal went to the oracle" }]);
  assert.deepEqual(chatText("assistant", "  Two questions.  "), [{ role: "oracle", text: "Two questions." }]);
  assert.deepEqual(chatText("user", "   "), []);
  const chat = chatFromEntries([
    { type: "message", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "build a page" } },
    { type: "message", message: { role: "toolResult", content: "x" } },
    { type: "custom", customType: "bot-lobby" },
    { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "t" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "On it." }] } },
  ]);
  assert.deepEqual(chat.map((entry) => [entry.role, entry.text]), [["you", "build a page"], ["oracle", "On it."]]);
  assert.equal(chat[0]!.at, Date.parse("2026-01-01T00:00:00.000Z"));
});

test("quick fixes run one at a time with full tools and land in metrics", async () => {
  const root = tempRoot();
  const seen: Array<{ args: string[]; options: ProcessRunOptions }> = [];
  const feed = new LobbyFeed();
  const events: PiStreamEvent[] = [{ type: "turn_start" }, { type: "tool_execution_start", toolName: "edit", args: { path: "src/a.ts" } }, { type: "thought", text: "tiny change" }];
  const queue = new QuickFixQueue({
    cwd: root, root, configDir: ".pi", feed,
    profile: () => ({ model: "p/fast", thinking: "low", timeoutMs: 60_000, instructions: "keep it tiny" }),
    runProcess: fakeRunner("## Done\nRenamed it.", events, seen),
  });
  const first = queue.submit("rename foo to bar\nin a.ts");
  const second = queue.submit("fix the typo");
  assert.equal(second.status, "queued", "the second job waits for the first");
  await settle();
  assert.equal(first.status, "success");
  assert.equal(first.report, "## Done\nRenamed it.");
  assert.equal(first.model, "p/served");
  assert.deepEqual(first.steps.map((step) => [step.text, step.pending]), [["editing a.ts", false]]);
  assert.equal(second.status, "success");
  assert.equal(seen.length, 2);
  const args = seen[0]!.args;
  assert.equal(args[args.indexOf("--tools") + 1], QUICK_FIX_TOOLS.join(","));
  assert.equal(args[args.indexOf("--model") + 1], "p/fast");
  assert.equal(args[args.indexOf("--thinking") + 1], "low");
  assert.equal(seen[0]!.options.prompt, "Task: rename foo to bar\nin a.ts");
  assert.ok(feed.activity.some((entry) => entry.source === "QUICK FIX" && entry.text === "done: rename foo to bar"));
  assert.deepEqual(feed.thoughts.map((entry) => entry.text), ["tiny change", "tiny change"]);
  const metrics = readMetrics(root, ".pi");
  assert.deepEqual(metrics.map((metric) => [metric.kind, metric.model, metric.thinking, metric.status]), [["quickfix", "p/served", "low", "success"], ["quickfix", "p/served", "low", "success"]]);
  assert.equal(jobTitle(first), "rename foo to bar");
  assert.match(quickFixPrompt("keep it tiny"), /Quick Fix Agent[\s\S]*## Custom Instructions\n\nkeep it tiny$/);
  assert.throws(() => queue.submit("   "), /needs a prompt/);
});

test("a running quick fix can be cancelled and a queued one is dropped", async () => {
  const root = tempRoot();
  const queue = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "low", timeoutMs: 60_000 }), runProcess: fakeRunner("", [], [], true) });
  const first = queue.submit("slow one");
  const second = queue.submit("next one");
  await settle();
  assert.equal(first.status, "running");
  assert.equal(queue.cancel(second.id), true);
  assert.equal(second.status, "cancelled");
  queue.cancel(first.id);
  await settle();
  assert.equal(first.status, "cancelled");
  assert.equal(queue.cancel(first.id), false, "finished jobs stay finished");
});

const READY_REPLY = [
  "## Status", "READY", "", "## Title", "Dark mode toggle", "", "## Plan", "### Objective", "Add a toggle.", "### Steps", "1. tokens", "2. toggle",
].join("\n");

test("the oracle's and the seats' replies parse forgivingly", () => {
  const grilling = parsePlannerReply(["## Status", "GRILLING", "## Title", "**Dark mode**", "## Questions", "1. Which pages?", "   All of them?", "2. Persist the choice?", "## Plan", "draft"].join("\n"));
  assert.deepEqual(grilling, { status: "grilling", title: "Dark mode", questions: [{ text: "Which pages? All of them?", options: [] }, { text: "Persist the choice?", options: [] }], plan: "draft" });
  assert.equal(parsePlannerReply(READY_REPLY).status, "ready");
  assert.deepEqual(parsePlannerReply("What do you mean by fast?"), { status: "grilling", questions: [{ text: "What do you mean by fast?", options: [] }] });
  assert.deepEqual(parseMemberReply("## Status\nOPEN\n## Questions\n1. REST or RPC?\n## Notes\n- api lives in src/api"), { status: "open", questions: [{ text: "REST or RPC?", options: [] }], notes: ["api lives in src/api"] });
  assert.deepEqual(parseMemberReply("## Status\nREADY\n## Questions\n1. stray?\n## Notes\n- ok"), { status: "ready", questions: [], notes: ["ok"] }, "a READY seat asks nothing");
  assert.equal(plannerSays(false, [{ from: "ORACLE", text: "A?", options: [] }, { from: "QA", text: "B?", options: [{ label: "Yes", description: "do it" }] }]), "1. [ORACLE] A?\n2. [QA] B?\n   - Yes — do it");
  assert.match(plannerSays(true, []), /panel agrees/);
});

test("questions carry their options: indented bullets, inline a) b) choices, and a seat tag", () => {
  const reply = parsePlannerReply([
    "## Status", "GRILLING",
    "## Questions",
    "1. [DEV] Where do sessions live?",
    "   - Users table (Recommended) — one row per user,",
    "     easy to query",
    "   - **Redis**: fast, but another service",
    "2. Which browsers? a) evergreen only b) include Safari 15 c) everything",
    "3. Anything else to know?",
  ].join("\n"));
  assert.deepEqual(reply.questions, [
    { text: "[DEV] Where do sessions live?", options: [{ label: "Users table (Recommended)", description: "one row per user, easy to query" }, { label: "Redis", description: "fast, but another service" }] },
    { text: "Which browsers?", options: [{ label: "evergreen only", description: "" }, { label: "include Safari 15", description: "" }, { label: "everything", description: "" }] },
    { text: "Anything else to know?", options: [] },
  ]);
  assert.deepEqual(parseOption("Keep it - no change"), { label: "Keep it", description: "no change" });
  assert.deepEqual(parseOption("Just a label"), { label: "Just a label", description: "" });
  assert.equal(commentBlock([]), "");
  assert.equal(commentBlock([{ line: "1. Add   the form", text: "use a modal" }]), 'Comments on the draft plan:\n- On "1. Add the form": use a modal');
});

test("the transcript carries the issue, every attributed question and the current draft", () => {
  const transcript = plannerTranscript(
    [
      { role: "you", text: "add dark mode", at: 0 },
      { role: "planner", text: "ignored", at: 1, questions: [{ from: "DESIGN", text: "Which pages?", options: [{ label: "All (Recommended)", description: "every page" }, { label: "Settings only", description: "" }] }, { from: "QA", text: "Which browsers?", options: [] }] },
      { role: "you", text: "1. all 2. chrome", at: 2 },
    ],
    { issue: { number: 7, title: "Dark mode" }, body: "Please add it" },
    "### Steps\n1. tokens",
  );
  assert.match(transcript, /^## Source: GitHub issue #7 — Dark mode\n\nPlease add it/);
  assert.match(transcript, /### User\n\nadd dark mode\n\n### Panel\n\n1\. \[DESIGN\] Which pages\?\n   - All \(Recommended\) — every page\n   - Settings only\n2\. \[QA\] Which browsers\?\n\n### User\n\n1\. all 2\. chrome/);
  assert.match(transcript, /## The oracle's current draft plan\n\n### Steps\n1\. tokens/);
  assert.match(panelSection([{ member: "qa", reply: { status: "ready", questions: [], notes: ["e2e in tests/e2e"] } }, { member: "researcher", error: "timeout" }]), /### QA — READY\nNotes:\n- e2e in tests\/e2e\n\n### RESEARCH — no answer this round \(timeout\)/);
});

test("each seat gets its domain's prompt layers, the panel role and its seat", () => {
  const dev = memberPrompt("backend", "prefer REST");
  assert.match(dev, /Global Engineering Agent[\s\S]*Backend Domain Agent[\s\S]*## Custom Instructions\n\nprefer REST[\s\S]*Planning Panel Member[\s\S]*## Your seat\n\nYou are DEV/);
  assert.match(memberPrompt("researcher"), /Global Engineering Agent[\s\S]*Planning Panel Member[\s\S]*You are RESEARCH/);
  assert.doesNotMatch(memberPrompt("researcher"), /Backend Domain Agent/);
});

/** A fake pi that answers as whichever seat (or the oracle) the task names. */
function panelRunner(answers: Record<string, string | undefined>, seen: Array<{ who: string; args: string[]; prompt: string }>): ProcessRunner {
  return (args, options) => {
    const prompt = options.prompt ?? "";
    const who = /You are (DEV|DESIGN|QA|RESEARCH) on the planning panel/.exec(prompt)?.[1] ?? "ORACLE";
    seen.push({ who, args, prompt });
    const text = answers[who];
    if (text === undefined) return Promise.resolve({ exitCode: 1, stdout: "", stderr: `${who} crashed`, killed: false, timedOut: false });
    return fakeRunner(text)(args, options);
  };
}

test("a panel round asks every seat on its own model, then lets the oracle fold them into the plan", async () => {
  const root = tempRoot();
  const seen: Array<{ who: string; args: string[]; prompt: string }> = [];
  const answers: Record<string, string | undefined> = {
    DEV: "## Status\nOPEN\n## Questions\n1. REST or RPC?\n## Notes\n- routes live in src/api",
    QA: "## Status\nREADY\n## Notes\n- e2e tests in tests/e2e",
    RESEARCH: "## Status\nOPEN\n## Questions\n1. prefers-color-scheme only, or a stored override?",
    // The oracle relays DEV's question, adds its own, and decides RESEARCH's (an assumption in the plan).
    ORACLE: "## Status\nGRILLING\n## Title\nDark mode\n## Questions\n1. [DEV] REST or RPC?\n2. [ORACLE] Ship behind a flag?\n## Plan\n### Steps\n1. draft\n### Assumptions\n- [RESEARCH] Stored override",
  };
  const models: Record<string, string> = { backend: "p/dev", qa: "p/qa", researcher: "p/research" };
  const session = new PlanningSession(
    {
      cwd: root, root, configDir: ".pi",
      profile: () => ({ model: "p/oracle", thinking: "high", timeoutMs: 60_000 }),
      memberProfile: (member) => ({ model: models[member], thinking: "medium", timeoutMs: 60_000 }),
      panel: ["backend", "qa", "researcher"],
      runProcess: panelRunner(answers, seen),
    },
    { issue: { number: 7, title: "Dark mode please", url: "https://x/7" }, body: "Please add it" },
  );
  await session.send("add dark mode");
  assert.equal(session.error, undefined);
  assert.deepEqual(seen.map((call) => call.who), ["DEV", "QA", "RESEARCH", "ORACLE"], "seats first, then the oracle");
  const arg = (call: { args: string[] }, flag: string) => call.args[call.args.indexOf(flag) + 1];
  assert.deepEqual(seen.map((call) => arg(call, "--model")), ["p/dev", "p/qa", "p/research", "p/oracle"], "every seat runs on its own model");
  assert.equal(arg(seen[0]!, "--tools"), PLANNER_TOOLS.join(","));
  assert.equal(arg(seen[2]!, "--tools"), RESEARCH_PANEL_TOOLS.join(","), "RESEARCH may use the web tools");
  assert.match(seen[3]!.prompt, /### DEV — OPEN\nQuestions for the user:\n- REST or RPC\?\nNotes:\n- routes live in src\/api/);
  assert.match(seen[3]!.prompt, /### QA — READY/);
  assert.deepEqual(session.questions, [
    { from: "DEV", text: "REST or RPC?", options: [] },
    { from: "ORACLE", text: "Ship behind a flag?", options: [] },
  ], "the oracle chooses what reaches the user; RESEARCH's question became an assumption");
  assert.equal(session.awaitingAnswers, true);
  assert.deepEqual(session.messages.at(-1)!.questions, session.questions);
  assert.deepEqual(session.notes, [{ from: "DEV", text: "routes live in src/api" }, { from: "QA", text: "e2e tests in tests/e2e" }]);
  assert.equal(session.reply?.status, "grilling");

  // Everyone settles: DEV and RESEARCH go READY, the oracle too; the answers reach every seat.
  answers.DEV = "## Status\nREADY\n## Notes\n- REST, as the user chose";
  answers.RESEARCH = "## Status\nREADY";
  answers.ORACLE = "## Status\nREADY\n## Title\nDark mode toggle";
  await session.send("1. no flag 2. REST 3. stored override");
  assert.ok(seen.slice(4, 7).every((call) => call.prompt.includes("1. no flag 2. REST 3. stored override")), "every seat reads every answer");
  assert.equal(session.reply?.status, "ready");
  assert.deepEqual(session.questions, []);
  assert.equal(session.reply?.plan, "### Steps\n1. draft\n### Assumptions\n- [RESEARCH] Stored override", "a round without a plan keeps the previous draft");
  assert.deepEqual(session.notes.map((note) => note.text), ["REST, as the user chose", "e2e tests in tests/e2e"], "each seat's latest notes; RESEARCH had none");
  const saved = session.save(new Date("2026-02-01T00:00:00Z"));
  assert.equal(saved.id, "PLAN-dark-mode-toggle");
  assert.deepEqual(listPlannedTasks(root, ".pi")[0]!.issue, { number: 7, title: "Dark mode please", url: "https://x/7" });
  const metrics = readMetrics(root, ".pi");
  assert.deepEqual(metrics.slice(0, 4).map((metric) => [metric.kind, metric.agent]).sort(), [["panel", "DEV"], ["panel", "QA"], ["panel", "RESEARCH"], ["planner", "ORACLE"]]);
});

test("a round never puts more than four questions to the user; seats' own go through only when the oracle fails", () => {
  const asked = (text: string) => ({ text, options: [] });
  const reply = { status: "grilling" as const, questions: ["[QA] One?", "[DEV] Two?", "Three?", "[DESIGN] Four?", "[RESEARCH] Five?"].map(asked) };
  const seats = [{ from: "DEV", ...asked("Seat one?") }, { from: "QA", ...asked("Seat two?") }];
  assert.deepEqual(roundQuestions(reply, seats).map((question) => `${question.from} ${question.text}`), ["QA One?", "DEV Two?", "ORACLE Three?", "DESIGN Four?"]);
  assert.deepEqual(roundQuestions({ status: "grilling", questions: [] }, seats), [], "the oracle decided everything itself");
  assert.deepEqual(roundQuestions(undefined, seats).map((question) => question.text), ["Seat one?", "Seat two?"], "a failed oracle lets the seats ask");
  assert.equal(MAX_QUESTIONS, 4, "one questionnaire holds a whole round");
});

test("a seat that fails does not sink the round, but keeps the plan from READY", async () => {
  const root = tempRoot();
  const seen: Array<{ who: string; args: string[]; prompt: string }> = [];
  const answers: Record<string, string | undefined> = { DEV: "## Status\nREADY", ORACLE: "## Status\nREADY\n## Plan\n1. x" };
  const session = new PlanningSession({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "high", timeoutMs: 60_000 }), panel: ["backend", "qa"], runProcess: panelRunner(answers, seen) });
  await session.send("idea");
  assert.deepEqual(session.members.map((member) => [member.member, member.status]), [["backend", "done"], ["qa", "failed"]]);
  assert.match(seen.at(-1)!.prompt, /### QA — no answer this round \(QA crashed\)/);
  assert.equal(session.reply?.status, "grilling", "READY needs every seat");
  assert.equal(session.retryable, true, "a round that lost a seat can be retried");
  assert.equal(session.toggle("qa"), false);
  await session.retry();
  assert.deepEqual(session.messages.map((message) => message.role), ["you", "planner"], "the retried round replaces the old one");
  assert.equal(session.reply?.status, "ready", "without QA seated the panel can agree");
  assert.deepEqual(seen.slice(3).map((call) => call.who), ["DEV", "ORACLE"]);
});

test("a failed oracle keeps the conversation and reports the error", async () => {
  const root = tempRoot();
  const runner: ProcessRunner = async () => ({ exitCode: 1, stdout: "", stderr: "boom", killed: false, timedOut: false });
  const session = new PlanningSession({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "high", timeoutMs: 60_000 }), panel: [], runProcess: runner });
  await session.send("idea");
  assert.match(session.error!, /the oracle's part of the round failed — boom/);
  assert.equal(session.status, "idle");
  assert.deepEqual(session.messages.map((message) => message.role), ["you"]);
  assert.throws(() => session.save(), /no draft plan/);
});

test("line comments wait for the answers when questions are open, and start a round of their own otherwise", async () => {
  const root = tempRoot();
  const seen: Array<{ who: string; args: string[]; prompt: string }> = [];
  const answers: Record<string, string | undefined> = {
    ORACLE: "## Status\nGRILLING\n## Questions\n1. Behind a flag?\n   - Yes (Recommended) — ship dark\n   - No — ship to everyone\n## Plan\n### Steps\n1. Add the form",
  };
  const rounds: Array<[number, boolean]> = [];
  const session = new PlanningSession({
    cwd: root, root, configDir: ".pi", panel: [],
    profile: () => ({ thinking: "high", timeoutMs: 60_000 }),
    runProcess: panelRunner(answers, seen),
    onRound: (current) => rounds.push([current.turns, current.awaitingAnswers]),
  });
  await session.send("login page");
  assert.deepEqual(rounds, [[1, true]], "the lobby hears when a round ends with questions");
  assert.deepEqual(session.questions[0]!.options.map((option) => option.label), ["Yes (Recommended)", "No"]);
  assert.equal(session.commentOnLine("1. Add the form", "use a modal"), false, "open questions hold the comment");
  assert.equal(session.lineComments.length, 1);
  session.answered = [{ answers: [], cancelled: false }];
  answers.ORACLE = "## Status\nGRILLING\n## Plan\n### Steps\n1. Add the modal";
  await session.send("1. Yes");
  assert.match(seen.at(-1)!.prompt, /### User\n\n1\. Yes\n\nComments on the draft plan:\n- On "1\. Add the form": use a modal/);
  assert.deepEqual(session.lineComments, []);
  assert.deepEqual(session.answered, [], "a new round starts a new questionnaire");
  assert.equal(session.awaitingAnswers, false);
  assert.equal(session.commentOnLine("1. Add the modal", "name it LoginDialog"), true, "nothing open: the comment starts a round");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(session.turns, 3);
  assert.match(seen.at(-1)!.prompt, /### User\n\nComments on the draft plan:\n- On "1\. Add the modal": name it LoginDialog/);
  assert.equal(session.commentOnLine("  ", "x"), false);
});

test("the round limit: normal rounds, then the final round, then revisions; 0 means unlimited", () => {
  assert.deepEqual([1, 2, 3, 4].map((round) => roundMode(round, 3)), ["normal", "normal", "final", "revise"]);
  assert.deepEqual([1, 9, 50].map((round) => roundMode(round, 0)), ["normal", "normal", "normal"]);
  assert.match(oracleClosing("normal", 2, 5), /^Round 2 of 5; in round 5 you settle whatever is still open alone/);
  assert.doesNotMatch(oracleClosing("normal", 2, 0), /Round/);
  assert.match(oracleClosing("final", 5, 5), /Final round \(5 of 5\)[\s\S]*decide every point still open with its recommended option[\s\S]*Status READY/);
  assert.match(oracleClosing("revise", 6, 5), /round limit \(5\) is reached[\s\S]*Ask nothing/);
  assert.deepEqual([[3, 5], [5, 5], [6, 5], [4, 0]].map(([turns, limit]) => roundLabel(turns!, limit)), ["round 3/5", "final round 5/5", "round 6 · past the limit, revising", "round 4"]);
});

test("questions left at the limit become assumptions decided with the recommended option", () => {
  const question = (from: string, text: string, labels: string[]) => ({ from, text, options: labels.map((label) => ({ label, description: "" })) });
  const flag = question("DEV", "Behind a flag?", ["No", "Yes (Recommended)"]);
  const browsers = question("QA", "Which browsers?", ["Evergreen", "All"]);
  assert.equal(optionLabel(recommendedOption(flag)!), "Yes", "the marked option wins over the first");
  assert.equal(recommendedOption(browsers)!.label, "Evergreen", "otherwise the first");
  const plan = "### Objective\nx\n### Assumptions\n- [QA] Evergreen\n\n### Steps\n1. y";
  assert.equal(appendAssumptions(plan, [flag, question("ORACLE", "Anything else?", [])], "decided at the round limit"),
    "### Objective\nx\n### Assumptions\n- [QA] Evergreen\n- [DEV] Behind a flag? → Yes (decided at the round limit)\n- [ORACLE] Anything else? → the oracle's call (decided at the round limit)\n\n### Steps\n1. y");
  assert.equal(appendAssumptions("### Steps\n1. y\n", [browsers], "why"), "### Steps\n1. y\n\n### Assumptions\n- [QA] Which browsers? → Evergreen (why)");
  assert.equal(appendAssumptions(plan, [], "why"), plan);
});

test("at the round limit the oracle settles the plan alone, and later replies only revise it", async () => {
  const root = tempRoot();
  const seen: Array<{ who: string; args: string[]; prompt: string }> = [];
  const grilling = "## Status\nGRILLING\n## Questions\n1. [DEV] REST or RPC?\n   - RPC — one endpoint\n   - REST (Recommended) — follows the API\n## Plan\n### Steps\n1. Build it\n### Assumptions\n- [QA] Evergreen";
  const answers: Record<string, string | undefined> = { DEV: "## Status\nOPEN\n## Questions\n1. REST or RPC?", ORACLE: grilling };
  let limit = 2;
  const session = new PlanningSession({ cwd: root, root, configDir: ".pi", panel: ["backend"], maxRounds: () => limit, profile: () => ({ thinking: "high", timeoutMs: 60_000 }), runProcess: panelRunner(answers, seen) });
  assert.equal(session.nextMode, "normal");
  await session.send("an API");
  assert.deepEqual(seen.map((call) => call.who), ["DEV", "ORACLE"]);
  assert.match(seen[0]!.prompt, /You are DEV on the planning panel \(round 1 of 2\)/);
  assert.match(seen[1]!.prompt, /Round 1 of 2; in round 2 you settle/);
  assert.equal(session.questions.length, 1);
  assert.equal(session.nextMode, "final");

  // The final round: no seat runs, and the question the oracle still asks is decided for it.
  await session.send("1. not sure");
  assert.deepEqual(seen.slice(2).map((call) => call.who), ["ORACLE"], "the seats have had their rounds");
  assert.match(seen[2]!.prompt, /No domain seats this round[\s\S]*Final round \(2 of 2\)/);
  assert.equal(session.mode, "final");
  assert.equal(session.reply?.status, "ready");
  assert.deepEqual(session.questions, []);
  assert.equal(session.awaitingAnswers, false);
  assert.match(session.reply!.plan!, /### Assumptions\n- \[QA\] Evergreen\n- \[DEV\] REST or RPC\? → REST \(decided at the round limit\)$/);
  assert.match(session.messages.at(-1)!.text, /round limit is reached/);

  // Past the limit: a reply revises, alone, without questions; a retry does not use up a round.
  answers.ORACLE = "## Status\nREADY\n## Plan\n### Steps\n1. Build it with REST";
  await session.send("use REST");
  assert.equal(session.turns, 3);
  assert.equal(session.mode, "revise");
  assert.deepEqual(seen.slice(3).map((call) => call.who), ["ORACLE"]);
  assert.match(seen[3]!.prompt, /round limit \(2\) is reached: revise the plan/);
  assert.equal(session.reply?.plan, "### Steps\n1. Build it with REST");
  answers.ORACLE = undefined;
  await session.send("one more thing");
  assert.ok(session.retryable);
  answers.ORACLE = "## Status\nREADY\n## Plan\n1. z";
  await session.retry();
  assert.equal(session.turns, 4, "the retried round keeps its number");
  assert.equal(session.reply?.plan, "1. z");

  // Raising the limit mid-session brings the seats back.
  limit = 0;
  answers.DEV = "## Status\nREADY";
  await session.send("more");
  assert.equal(seen.at(-2)!.who, "DEV");
});

function fakeExec(responses: Record<string, { stdout?: string; stderr?: string; code?: number }>, calls: string[][] = []): Exec {
  return async (_command, args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(" ");
    const response = responses[key] ?? { code: 1, stderr: "unexpected" };
    return { stdout: response.stdout ?? "", stderr: response.stderr ?? "", code: response.code ?? 0 };
  };
}

test("issues list, view and create through gh", async () => {
  const calls: string[][] = [];
  const exec = fakeExec({
    "issue list": { stdout: JSON.stringify([{ number: 3, title: "Crash on save", labels: [{ name: "bug" }], author: { login: "ana" }, url: "https://gh/3" }, { title: "no number" }]) },
    "issue view": { stdout: JSON.stringify({ number: 3, title: "Crash on save", body: "Steps...", state: "OPEN", labels: [], author: { login: "ana" }, comments: [{ author: { login: "bo" }, body: "same here" }] }) },
    "issue create": { stdout: "Creating issue...\nhttps://github.com/o/r/issues/9\n" },
  }, calls);
  const issues = await listIssues(exec, "/repo");
  assert.deepEqual(issues, [{ number: 3, title: "Crash on save", labels: ["bug"], author: "ana", url: "https://gh/3" }]);
  const detail = await viewIssue(exec, "/repo", 3);
  assert.equal(issueText(detail), "Steps...\n\n**bo** commented:\nsame here");
  assert.deepEqual(await createIssue(exec, "/repo", "New bug", "details"), { url: "https://github.com/o/r/issues/9", number: 9 });
  assert.deepEqual(calls[2], ["issue", "create", "--title", "New bug", "--body", "details"]);
  await assert.rejects(createIssue(exec, "/repo", "  ", ""), /needs a title/);
  assert.deepEqual(splitIssueText("\n# Title here\nline 1\nline 2\n"), { title: "Title here", body: "line 1\nline 2" });
});

test("gh failures read as one actionable line", async () => {
  assert.match(ghError({ code: 127, stderr: "" }), /not installed/);
  assert.match(ghError({ error: "spawn gh ENOENT" }), /not installed/);
  assert.match(ghError({ code: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login" }), /not signed in/);
  assert.match(ghError({ code: 1, stderr: "none of the git remotes configured for this repository point to a known GitHub host" }), /no GitHub remote/);
  const state = new IssuesState(fakeExec({ "issue list": { code: 127 } }), "/repo");
  await state.refresh();
  assert.match(state.error!, /not installed/);
  assert.equal(state.loading, false);
});
