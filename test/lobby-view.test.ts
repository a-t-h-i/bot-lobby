import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { LobbyView, TAB_IDS, type LobbyHost } from "../src/lobby/view.ts";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { QuickFixQueue } from "../src/lobby/quickfix.ts";
import { IssuesState, type Exec } from "../src/lobby/issues.ts";
import { PlanningSession, type PlannerSeed } from "../src/lobby/planner.ts";
import { createTask, type Task } from "../src/schemas/task.ts";
import type { PlannedTask } from "../src/state/backlog.ts";
import type { PlanComment } from "../src/state/comments.ts";
import type { MetricRecord } from "../src/state/metrics.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import { activityLine, chatLines, renderHome } from "../src/lobby/tabs/home.ts";
import { renderTasks, taskDetailLines, taskRows } from "../src/lobby/tabs/tasks.ts";
import { renderPlan, type SeatView } from "../src/lobby/tabs/plan.ts";
import { jobDetailLines } from "../src/lobby/tabs/quickfix.ts";
import { renderIssues } from "../src/lobby/tabs/issues.ts";
import { fittedColumns, renderMetrics } from "../src/lobby/tabs/metrics.ts";
import { aggregateMetrics, taskStats } from "../src/state/metrics.ts";
import { fit, rule, tail, windowStart, wrapHanging } from "../src/lobby/layout.ts";

const KEY = {
  tab: "\t",
  shiftTab: "\x1b[Z",
  escape: "\x1b",
  enter: "\r",
  ctrlC: "\x03",
  up: "\x1b[A",
  down: "\x1b[B",
  alt: (key: string) => `\x1b${key}`,
};

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const hangingRunner: ProcessRunner = () => new Promise(() => {});

const PLAN = "## Objective\nLogin.\n## Steps\n1. Add the form\n2. Wire the API\n## Testing\nunit";

interface Calls {
  oracle: string[];
  comments: Array<[string, string]>;
  started: string[];
  discarded: string[];
  aborted: number;
  hidden: number;
  seeds: Array<PlannerSeed | undefined>;
  seats: Array<string[] | undefined>;
}

function makeView(options: { rows?: number; busy?: boolean; task?: Task; tasks?: Task[]; plans?: PlannedTask[]; exec?: Exec } = {}) {
  const root = mkdtempSync(join(tmpdir(), "bl-view-"));
  const calls: Calls = { oracle: [], comments: [], started: [], discarded: [], aborted: 0, hidden: 0, seeds: [], seats: [] };
  const rows = options.rows ?? 40;
  const tui = { terminal: { rows, columns: 120 }, requestRender() {} } as unknown as TUI;
  const feed = new LobbyFeed();
  const quickfix = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "low", timeoutMs: 1000 }), runProcess: hangingRunner });
  const issues = new IssuesState(options.exec ?? (async () => ({ stdout: "[]", stderr: "", code: 0 })), root);
  let planner: PlanningSession | undefined;
  const host: LobbyHost = {
    rows: () => rows,
    theme: () => ({ fg: (_color, text) => text, bold: (text) => text }),
    sessionId: () => "me",
    zen: () => ({ ...(options.task ? { task: options.task } : {}), runs: [] }),
    scene: (_width, height) => Array.from({ length: Math.min(height, 12) }, (_, index) => `scene ${index}`),
    advanceScene: () => 250,
    feed,
    masterBusy: () => options.busy === true,
    tasks: () => options.tasks ?? (options.task ? [options.task] : []),
    plans: () => options.plans ?? [],
    comments: (): PlanComment[] => [],
    metrics: (): MetricRecord[] => [],
    toOracle: (text) => {
      calls.oracle.push(text);
      return undefined;
    },
    comment: (taskId, text) => {
      calls.comments.push([taskId, text]);
      return "comment sent";
    },
    startPlanned: (plan) => {
      calls.started.push(plan.id);
      return "starting";
    },
    discardPlan: (id) => void calls.discarded.push(id),
    abortMaster: () => void (calls.aborted += 1),
    hide: () => void (calls.hidden += 1),
    quickfix,
    planner: () => planner,
    newPlanner: (seed, seats) => {
      calls.seeds.push(seed);
      calls.seats.push(seats ? [...seats] : undefined);
      planner = new PlanningSession({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "high", timeoutMs: 1000 }), ...(seats ? { panel: seats } : {}), runProcess: hangingRunner }, seed);
      return planner;
    },
    defaultPanel: () => ["backend", "designer", "qa", "researcher"],
    seatLabel: (member) => `p/${member} · medium`,
    issues,
    profileLabel: () => "p/model · high",
    requestRender: () => {},
    now: () => NOW,
  };
  const noop = (text: string) => text;
  const view = new LobbyView(tui, host, { borderColor: noop, selectList: { selectedPrefix: noop, selectedText: noop, description: noop, scrollInfo: noop, noMatch: noop } });
  view.focused = true;
  view.refreshData(true);
  return { view, calls, feed, quickfix, issues, root, planner: () => planner };
}

function type(view: LobbyView, text: string): void {
  for (const char of text) view.handleInput(char);
}

function activeTask(): Task {
  return { ...createTask("TASK-login", "add login", "2026-09-26T11:00:00.000Z", "Add a login page", "me"), state: "implementing", plan: PLAN };
}

test("every tab fills the terminal exactly, at wide and narrow sizes", () => {
  for (const [width, rows] of [[120, 40], [80, 24], [60, 16]] as const) {
    const { view } = makeView({ rows, task: activeTask() });
    for (const tab of TAB_IDS) {
      view.setTab(tab);
      const lines = view.render(width);
      assert.equal(lines.length, rows, `${tab} at ${width}x${rows}`);
      for (const line of lines) assert.ok(visibleWidth(line) <= width, `${tab} at ${width}: "${line}"`);
    }
  }
});

test("tab and alt+digit switch tabs; prompt tabs open in typing mode, list tabs in browsing mode", () => {
  const { view } = makeView();
  assert.equal(view.tab, "lobby");
  assert.equal(view.mode, "type");
  view.handleInput(KEY.tab);
  assert.deepEqual([view.tab, view.mode], ["tasks", "browse"]);
  view.handleInput(KEY.shiftTab);
  assert.equal(view.tab, "lobby");
  view.handleInput(KEY.alt("4"));
  assert.deepEqual([view.tab, view.mode], ["quickfix", "type"]);
  view.handleInput(KEY.alt("6"));
  assert.deepEqual([view.tab, view.mode], ["metrics", "browse"]);
  view.handleInput("3");
  assert.equal(view.tab, "plan", "digits switch tabs while browsing a list tab");
});

test("drafts stay with their tab", () => {
  const { view } = makeView();
  type(view, "half a thought");
  view.handleInput(KEY.alt("4"));
  assert.ok(!view.render(100).some((line) => line.includes("half a thought")));
  view.handleInput(KEY.alt("1"));
  assert.ok(view.render(100).some((line) => line.includes("half a thought")));
});

test("the Lobby prompt goes to the oracle, and esc stops a running turn only when the prompt is empty", () => {
  const { view, calls } = makeView({ busy: true, task: activeTask() });
  type(view, "use port 8080");
  view.handleInput(KEY.enter);
  assert.deepEqual(calls.oracle, ["use port 8080"]);
  type(view, "draft");
  view.handleInput(KEY.escape);
  assert.equal(calls.aborted, 0, "esc with text only leaves typing mode");
  assert.equal(view.mode, "browse");
  view.handleInput(KEY.escape);
  assert.equal(calls.aborted, 1, "esc while browsing stops the oracle");
  view.handleInput("x");
  assert.equal(view.mode, "type", "typing while browsing a prompt tab resumes typing");
});

test("alt+l hides the lobby; ctrl+c clears the prompt first", () => {
  const { view, calls } = makeView();
  type(view, "something");
  view.handleInput(KEY.ctrlC);
  assert.equal(calls.hidden, 0);
  view.handleInput(KEY.ctrlC);
  assert.equal(calls.hidden, 1);
  view.handleInput(KEY.alt("l"));
  assert.equal(calls.hidden, 2);
});

test("browsing hides the prompt's block cursor", () => {
  const { view } = makeView();
  assert.ok(view.render(100).some((line) => line.includes("\x1b[7m")));
  view.handleInput(KEY.escape);
  assert.ok(!view.render(100).some((line) => line.includes("\x1b[7m")));
});

test("c comments on the selected task's plan; finished tasks refuse", () => {
  const done = { ...createTask("TASK-old", "old thing", "2026-09-20T00:00:00.000Z"), state: "completed" as const };
  const { view, calls } = makeView({ tasks: [activeTask(), done] });
  view.setTab("tasks");
  view.handleInput("c");
  assert.equal(view.mode, "type");
  assert.ok(view.render(120).some((line) => line.includes("comment on TASK-login's plan")));
  type(view, "cap the page size");
  view.handleInput(KEY.enter);
  assert.deepEqual(calls.comments, [["TASK-login", "cap the page size"]]);
  assert.equal(view.mode, "browse");
  view.handleInput(KEY.down);
  view.handleInput("c");
  assert.equal(view.mode, "browse");
  assert.ok(view.render(120).at(-1)!.includes("is completed"));
});

test("pending plans start with s and are discarded with a double d", () => {
  const plan: PlannedTask = { id: "PLAN-dark", title: "dark mode", brief: "## Steps\n1. tokens", createdAt: "2026-09-26T10:00:00.000Z", updatedAt: "2026-09-26T10:00:00.000Z", status: "pending" };
  const { view, calls } = makeView({ plans: [plan] });
  view.setTab("tasks");
  view.handleInput("s");
  assert.deepEqual(calls.started, ["PLAN-dark"]);
  view.handleInput("d");
  assert.deepEqual(calls.discarded, []);
  view.handleInput("d");
  assert.deepEqual(calls.discarded, ["PLAN-dark"]);
});

test("the Quick fix prompt queues a job and x cancels the selected one", async () => {
  const { view, quickfix } = makeView();
  view.setTab("quickfix");
  type(view, "fix the typo");
  view.handleInput(KEY.enter);
  assert.equal(quickfix.jobs.length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quickfix.jobs[0]!.status, "running");
  view.handleInput(KEY.escape);
  view.handleInput("x");
  assert.ok(view.render(120).at(-1)!.includes("cancelling QF-1"));
});

test("the Plan prompt starts a planning session; s without a draft warns", () => {
  const { view, planner } = makeView();
  view.setTab("plan");
  type(view, "add dark mode");
  view.handleInput(KEY.enter);
  assert.equal(planner()?.messages[0]?.text, "add dark mode");
  assert.equal(planner()?.busy, true);
  view.handleInput(KEY.escape);
  view.handleInput("s");
  assert.ok(view.render(120).at(-1)!.includes("there is no draft plan to save yet"));
  view.handleInput("x");
  assert.ok(view.render(120).at(-1)!.includes("stopping the panel"));
});

test("n files an issue and p plans the selected one", async () => {
  const calls: string[][] = [];
  const exec: Exec = async (_command, args) => {
    calls.push(args);
    if (args[1] === "list") return { stdout: JSON.stringify([{ number: 5, title: "Crash", labels: [] }]), stderr: "", code: 0 };
    if (args[1] === "view") return { stdout: JSON.stringify({ number: 5, title: "Crash", body: "it crashes", labels: [], comments: [] }), stderr: "", code: 0 };
    return { stdout: "https://github.com/o/r/issues/6\n", stderr: "", code: 0 };
  };
  const { view, calls: host } = makeView({ exec });
  view.setTab("issues");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(view.render(120).some((line) => line.includes("#5 Crash")));
  view.handleInput("n");
  type(view, "New bug");
  view.handleInput(KEY.enter);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(calls.some((args) => args[1] === "create" && args.includes("New bug")));
  view.handleInput("p");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(view.tab, "plan");
  assert.deepEqual(host.seeds.at(-1), { issue: { number: 5, title: "Crash" }, body: "it crashes" });
});

test("g and s regroup and resort the metrics table", () => {
  const { view } = makeView();
  view.setTab("metrics");
  assert.ok(view.render(140).some((line) => line.includes("grouped by model + thinking · sorted by runs")));
  view.handleInput("g");
  view.handleInput("s");
  assert.ok(view.render(140).some((line) => line.includes("grouped by model + thinking + agent · sorted by avg")));
});

test("the home tab puts the scene first, the thinking pane last, and stacks panes when narrow", () => {
  const feed = new LobbyFeed();
  feed.say("you", "build it");
  feed.log("DEV", "reading a.ts", "info", NOW);
  feed.thought("DEV", "the router lives in a.ts");
  const input = { task: activeTask(), scene: () => ["SCENE"], chat: feed.chat, activity: feed.activity, thoughts: feed.thoughts, busy: false, others: 0, pending: 0, chatOffset: 0, tick: 0, now: NOW };
  const wide = renderHome(input, 120, 30);
  assert.equal(wide[0], fit("SCENE", 120));
  assert.ok(wide.some((line) => line.includes("Conversation · TASK-login") && line.includes("Activity")));
  assert.ok(wide.some((line) => line.includes("── Thinking") && line.includes("DEV")));
  assert.ok(wide.some((line) => line.includes("the router lives in a.ts")));
  const narrow = renderHome(input, 70, 30);
  assert.ok(narrow.some((line) => line.startsWith("── Activity")), "narrow terminals stack the activity log under the conversation");
  const empty = renderHome({ ...input, task: undefined, chat: [], activity: [], thoughts: [], others: 2, pending: 1 }, 100, 20);
  assert.ok(empty.some((line) => line.includes("No task is running in this session.")));
  assert.ok(empty.some((line) => line.includes("2 tasks are running in other sessions")));
});

test("activity lines spin while pending and mark how a step ended", () => {
  const base = { id: 1, at: NOW, source: "DEV", text: "reading a.ts", kind: "info" as const, pending: true };
  assert.match(activityLine(base, 80, 0), /DEV {7}⠋ reading a\.ts…$/);
  assert.match(activityLine({ ...base, pending: false, kind: "error" }, 80, 0), /✗ reading a\.ts$/);
  assert.match(activityLine({ ...base, pending: false, kind: "success" }, 80, 0), /✓ reading a\.ts$/);
  assert.deepEqual(chatLines([], 40, undefined, undefined, true, 0), ["oracle ▸ ⠋ working…"]);
});

test("task rows group this session, other sessions, pending plans and recent tasks", () => {
  const mine = activeTask();
  const theirs = { ...createTask("TASK-cache", "fix cache", "2026-09-26T09:00:00.000Z", "fix", "someone-else-1234"), state: "reviewing" as const };
  const done = { ...createTask("TASK-old", "old", "2026-09-20T00:00:00.000Z"), state: "completed" as const, updatedAt: "2026-09-25T12:00:00.000Z" };
  const plan: PlannedTask = { id: "PLAN-x", title: "x", brief: "b", createdAt: "", updatedAt: "", status: "pending", issue: { number: 3, title: "t" } };
  const rows = taskRows([mine, theirs, done], [plan], "me", NOW);
  assert.deepEqual(rows.map((row) => [row.section, row.id, row.meta]), [
    ["mine", "TASK-login", "0/2"],
    ["others", "TASK-cache", "session someone-"],
    ["pending", "PLAN-x", "#3"],
    ["recent", "TASK-old", "24h"],
  ]);
  const lines = renderTasks({ rows, selected: 1, detail: ["DETAIL"], focus: "list", detailOffset: 0 }, 120, 12);
  assert.equal(lines.length, 12);
  assert.ok(lines.some((line) => line.includes("OTHER SESSIONS")));
  assert.ok(lines.some((line) => line.includes("▸ fix cache")));
});

test("task detail shows plan progress, comment status, and recent runs", () => {
  const task = { ...activeTask(), workerRuns: [{ runId: "w1", domain: "designer" as const, instruction: "Step 1: add the form", status: "success" as const, startedAt: "2026-09-26T11:10:00.000Z", finishedAt: "2026-09-26T11:20:00.000Z" }] };
  const comments: PlanComment[] = [
    { id: "a", taskId: "TASK-login", text: "cap page size", createdAt: "2026-09-26T11:59:00.000Z", status: "delivered" },
    { id: "b", taskId: "TASK-login", text: "older", createdAt: "2026-09-26T11:00:00.000Z", status: "addressed" },
  ];
  const lines = taskDetailLines(task, comments, "me", 80, NOW);
  assert.ok(lines.some((line) => line.includes("Approved plan") && line.includes("1/2 steps")));
  assert.ok(lines.includes("✓ 1. Add the form"));
  assert.ok(lines.includes("▸ 2. Wire the API"));
  assert.ok(lines.some((line) => line.startsWith("◐ cap page size — sent to the oracle, 1m ago")));
  assert.ok(lines.some((line) => line.startsWith("✓ older — plan amended")));
  assert.ok(lines.some((line) => line.includes("Comments") && line.includes("1 open")));
});

test("the plan tab shows the verdict, the roster, attributed questions, the draft and each seat's needs", () => {
  const seat = (label: string, extra: Partial<SeatView> = {}): SeatView => ({ label, seated: true, status: "done", questions: 0, ready: false, ...extra });
  const lines = renderPlan({
    session: {
      messages: [
        { role: "you", text: "dark mode", at: 0 },
        { role: "planner", text: "", at: 1, questions: [{ from: "ORACLE", text: "Ship behind a flag?" }, { from: "DESIGN", text: "Which pages?" }] },
      ],
      reply: { status: "grilling", questions: ["Ship behind a flag?"], plan: "### Steps\n1. tokens" },
      questions: [{ from: "ORACLE", text: "Ship behind a flag?" }, { from: "DESIGN", text: "Which pages?" }],
      notes: [{ from: "QA", text: "e2e tests in tests/e2e" }],
      seats: [seat("ORACLE", { questions: 1 }), seat("DEV", { status: "thinking", step: "reading api.ts" }), seat("DESIGN", { questions: 1 }), seat("QA", { ready: true }), seat("RESEARCH", { seated: false, status: "idle" })],
      busy: false,
      turns: 1,
      title: "Dark mode",
    },
    profile: "p/m · high",
    seats: [],
    offset: 0,
    focus: "talk",
    draftOffset: 0,
    tick: 0,
  }, 140, 16);
  assert.ok(lines.some((line) => line.includes("Planning · Dark mode")));
  assert.ok(lines.some((line) => line.includes("● GRILLING · 2 open questions")));
  assert.ok(lines.some((line) => line.includes("panel  ORACLE 1 question · DEV ⠋ reading api.ts · DESIGN 1 question · QA ✓ ready · RESEARCH off")));
  assert.ok(lines.some((line) => line.includes(" 1. ORACLE   Ship behind a flag?")));
  assert.ok(lines.some((line) => line.includes(" 2. DESIGN   Which pages?")));
  assert.ok(lines.some((line) => line.includes("What each seat needs")));
  assert.ok(lines.some((line) => line.includes("QA       e2e tests in tests/e2e")));
  assert.ok(lines.some((line) => line.includes("── Conversation ◂")), "the focused pane is marked");
});

test("before a session, 1-4 choose the seats the next session starts with", () => {
  const { view, calls } = makeView();
  view.setTab("plan");
  assert.match(view.render(140).map((line) => line.trim()).join(" "), /the oracle chairing, with DEV, DESIGN, QA, RESEARCH/);
  view.handleInput(KEY.escape);
  view.handleInput("2");
  view.handleInput("4");
  assert.ok(view.render(140).at(-1)!.includes("RESEARCH leaves the panel from the next round"));
  view.handleInput("i");
  type(view, "dark mode");
  view.handleInput(KEY.enter);
  assert.deepEqual(calls.seats.at(-1), ["backend", "qa"]);
});

test("during a session, 1-4 seat and unseat members for the next round", () => {
  const { view, planner } = makeView();
  view.setTab("plan");
  type(view, "dark mode");
  view.handleInput(KEY.enter);
  planner()!.cancel();
  view.handleInput(KEY.escape);
  view.handleInput("3");
  assert.equal(planner()!.seats.has("qa"), false);
  view.handleInput("3");
  assert.equal(planner()!.seats.has("qa"), true);
  assert.ok(view.render(140).some((line) => line.includes("panel  ORACLE")));
});

test("a quick fix detail lists its steps and its report", () => {
  const lines = jobDetailLines({ id: "QF-1", prompt: "fix typo", status: "success", createdAt: NOW, startedAt: NOW, finishedAt: NOW + 65_000, model: "p/m", thinking: "low", steps: [{ at: NOW, text: "editing a.ts", pending: false }], tools: 1, turns: 2, report: "## Done\nFixed." }, 80, 0, NOW);
  assert.ok(lines.includes("success · 1m 05s · p/m · low · 1 tool"));
  assert.ok(lines.some((line) => line.endsWith("· editing a.ts")));
  assert.ok(lines.includes("Done"));
  assert.ok(lines.includes("Fixed."));
});

test("the issues tab leads with an error it cannot recover from", () => {
  const lines = renderIssues({ issues: [], selected: 0, focus: "list", detailOffset: 0, loading: false, loaded: false, error: "gh is not signed in", tick: 0, now: NOW }, 80, 6);
  assert.equal(lines[0]!.trim(), "✗ gh is not signed in");
});

test("metrics columns drop from the right as the terminal narrows", () => {
  assert.ok(fittedColumns(160).length > fittedColumns(100).length);
  assert.equal(fittedColumns(50).length, 0, "model, thinking and agents always stay");
  const records: MetricRecord[] = [{ id: "1", kind: "worker", agent: "DEV", model: "p/fast", thinking: "low", status: "success", startedAt: "", durationMs: 90_000 }];
  const lines = renderMetrics({ groups: aggregateMetrics(records), records, stats: taskStats([]), by: "model", sort: "runs", selected: 0 }, 120, 10);
  assert.ok(lines.some((line) => line.startsWith("fast") && line.includes("worker") && line.includes("1m 30s")));
  assert.ok(lines.some((line) => line.includes("Avg by agent DEV 1m 30s ×1")));
});

test("layout helpers keep exact widths, tails and windows", () => {
  assert.equal(fit("abc", 5), "abc  ");
  assert.equal(visibleWidth(fit("abcdefgh", 5)), 5);
  assert.deepEqual(tail(["a", "b", "c", "d"], 2), ["c", "d"]);
  assert.deepEqual(tail(["a", "b", "c", "d"], 2, 1), ["b", "c"]);
  assert.deepEqual(tail(["a", "b", "c", "d"], 2, 10), ["a", "b"]);
  assert.equal(windowStart(9, 10, 4), 6);
  assert.equal(windowStart(0, 10, 4), 0);
  assert.deepEqual(wrapHanging("you ▸ ", "one two three", 12), ["you ▸ one", "      two", "      three"]);
  assert.equal(visibleWidth(rule(30, "Title", undefined, "right")), 30);
});
