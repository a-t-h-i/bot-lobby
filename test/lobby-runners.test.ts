import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeToolCall } from "../src/pi/activity.ts";
import { createStreamCollector, finishedThought, MAX_THOUGHT_CHARS, type PiStreamEvent, type ProcessOutcome, type ProcessRunner, type ProcessRunOptions } from "../src/execution/pi-runner.ts";
import { chatFromEntries, chatText, LobbyFeed, textOf } from "../src/lobby/feed.ts";
import { QUICK_FIX_TOOLS, QuickFixQueue, jobTitle, quickFixPrompt } from "../src/lobby/quickfix.ts";
import { PLANNER_TOOLS, PlanningSession, parsePlannerReply, plannerSays, plannerTranscript } from "../src/lobby/planner.ts";
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

test("the conversation keeps text only and shortens bot-lobby's own kickoff", () => {
  assert.equal(textOf([{ type: "thinking", thinking: "hidden" }, { type: "text", text: "Hello" }, { type: "toolCall", name: "read" }]), "Hello");
  assert.deepEqual(chatText("user", "A bot-lobby task is active: TASK-x\nTitle: add login\nRequest: ..."), { role: "note", text: "task TASK-x started — add login" });
  assert.deepEqual(chatText("assistant", "  Two questions.  "), { role: "oracle", text: "Two questions." });
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

test("the planner reply parses status, title, questions and plan, and degrades gracefully", () => {
  const grilling = parsePlannerReply(["## Status", "GRILLING", "## Title", "**Dark mode**", "## Questions", "1. Which pages?", "   All of them?", "2. Persist the choice?", "## Plan", "draft"].join("\n"));
  assert.deepEqual(grilling, { status: "grilling", title: "Dark mode", questions: ["Which pages? All of them?", "Persist the choice?"], plan: "draft" });
  assert.equal(parsePlannerReply(READY_REPLY).status, "ready");
  assert.deepEqual(parsePlannerReply("What do you mean by fast?"), { status: "grilling", questions: ["What do you mean by fast?"] });
  assert.equal(plannerSays({ status: "grilling", questions: ["A?", "B?"] }), "1. A?\n2. B?");
  assert.match(plannerSays({ status: "ready", questions: [] }), /Press s to save/);
});

test("the planner transcript carries the issue, every turn and the current draft", () => {
  const transcript = plannerTranscript(
    [{ role: "you", text: "add dark mode", at: 0 }, { role: "planner", text: "1. Which pages?", at: 1 }, { role: "you", text: "all", at: 2 }],
    { issue: { number: 7, title: "Dark mode" }, body: "Please add it" },
    "### Steps\n1. tokens",
  );
  assert.match(transcript, /^## Source: GitHub issue #7 — Dark mode\n\nPlease add it/);
  assert.match(transcript, /### User\n\nadd dark mode\n\n### Planner\n\n1\. Which pages\?\n\n### User\n\nall/);
  assert.match(transcript, /## Your current draft plan\n\n### Steps\n1\. tokens/);
});

test("a planning session grills over read-only tools and saves the agreed plan as a pending task", async () => {
  const root = tempRoot();
  const seen: Array<{ args: string[]; options: ProcessRunOptions }> = [];
  let answer = "## Status\nGRILLING\n## Title\nDark mode\n## Questions\n1. Which pages?\n## Plan\n### Steps\n1. draft";
  const runner: ProcessRunner = (args, options) => fakeRunner(answer, [], seen)(args, options);
  const session = new PlanningSession(
    { cwd: root, root, configDir: ".pi", profile: () => ({ model: "p/plan", thinking: "high", timeoutMs: 60_000 }), runProcess: runner },
    { issue: { number: 7, title: "Dark mode please", url: "https://x/7" }, body: "Please add it" },
  );
  await session.send("add dark mode");
  assert.equal(session.reply?.status, "grilling");
  assert.deepEqual(session.messages.map((message) => message.role), ["you", "planner"]);
  const args = seen[0]!.args;
  assert.equal(args[args.indexOf("--tools") + 1], PLANNER_TOOLS.join(","));
  answer = "## Status\nREADY\n## Title\nDark mode toggle";
  await session.send("all pages");
  assert.equal(session.reply?.status, "ready");
  assert.equal(session.reply?.plan, "### Steps\n1. draft", "a turn without a plan keeps the previous draft");
  assert.match(seen[1]!.options.prompt!, /## Your current draft plan/);
  const saved = session.save(new Date("2026-02-01T00:00:00Z"));
  assert.equal(saved.id, "PLAN-dark-mode-toggle");
  assert.deepEqual(listPlannedTasks(root, ".pi")[0]!.issue, { number: 7, title: "Dark mode please", url: "https://x/7" });
  assert.deepEqual(readMetrics(root, ".pi").map((metric) => [metric.kind, metric.thinking]), [["planner", "high"], ["planner", "high"]]);
});

test("a failed planner turn keeps the conversation and reports the error", async () => {
  const root = tempRoot();
  const runner: ProcessRunner = async () => ({ exitCode: 1, stdout: "", stderr: "boom", killed: false, timedOut: false });
  const session = new PlanningSession({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "high", timeoutMs: 60_000 }), runProcess: runner });
  await session.send("idea");
  assert.equal(session.error, "boom");
  assert.equal(session.status, "idle");
  assert.deepEqual(session.messages.map((message) => message.role), ["you"]);
  assert.throws(() => session.save(), /no draft plan/);
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
