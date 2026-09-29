import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { BRANCH_GLYPH, LobbyView, parseMouse, TAB_IDS, visibleTabs, type LiveSession, type LobbyHost, type SwitchTarget } from "../src/lobby/view.ts";
import type { WorkspaceInfo } from "../src/execution/workspace.ts";
import { DEFAULT_CONFIG, type LobbyPanel, type PanelMember } from "../src/schemas/configuration.ts";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { QuickFixQueue } from "../src/lobby/quickfix.ts";
import { IssuesState, type Exec } from "../src/lobby/issues.ts";
import { PlanningSession, type PlannerSeed } from "../src/lobby/planner.ts";
import { createTask, type Task } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";
import { listPlannedTasks, type PlannedTask } from "../src/state/backlog.ts";
import type { PlanComment } from "../src/state/comments.ts";
import type { MetricRecord } from "../src/state/metrics.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import { BackgroundSession } from "../src/lobby/sessions.ts";
import type { ChatEntry } from "../src/lobby/feed.ts";
import { FakeSessionProcess } from "./fake-session.ts";
import { activityLine, chatLines, renderHome } from "../src/lobby/tabs/home.ts";
import { renderTasks, taskDetailLines, taskRows } from "../src/lobby/tabs/tasks.ts";
import { renderPlan, rosterLines, type PlanLayout, type PlanView, type SeatView } from "../src/lobby/tabs/plan.ts";
import { jobDetailLines } from "../src/lobby/tabs/quickfix.ts";
import { renderIssues } from "../src/lobby/tabs/issues.ts";
import { filterRecords, fittedColumns, renderMetrics } from "../src/lobby/tabs/metrics.ts";
import { aggregateMetrics, taskStats } from "../src/state/metrics.ts";
import { fit, rule, tail, windowStart, wrapHanging } from "../src/lobby/layout.ts";

const KEY = {
  tab: "\t",
  shiftTab: "\x1b[Z",
  escape: "\x1b",
  enter: "\r",
  ctrlC: "\x03",
  ctrlS: "\x13",
  up: "\x1b[A",
  down: "\x1b[B",
  alt: (key: string) => `\x1b${key}`,
};

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const hangingRunner: ProcessRunner = () => new Promise(() => {});

const PLAN = "## Objective\nLogin.\n## Steps\n1. Add the form\n2. Wire the API\n## Testing\nunit";

interface Calls {
  settings: string[];
  answered: number;
  savedPanels: Array<Record<LobbyPanel, boolean>>;
  oracle: string[];
  comments: Array<[string, string]>;
  started: string[];
  discarded: string[];
  aborted: number;
  hidden: number;
  seeds: Array<PlannerSeed | undefined>;
  seats: Array<string[] | undefined>;
  sessionStarts: Array<{ request?: string; plan?: string; auto?: boolean }>;
  auto: Array<[string, boolean]>;
  inbox: Array<[string, string]>;
  sessionInbox: Array<[string, string]>;
  switches: SwitchTarget[];
  dialogs: string[];
  archived: string[];
  restored: string[];
  deleted: Array<[string, "list" | "archive"]>;
  historyLoads: string[];
}

interface ViewOptions {
  rows?: number;
  busy?: boolean;
  task?: Task;
  tasks?: Task[];
  plans?: PlannedTask[];
  exec?: Exec;
  issues?: boolean;
  panels?: Partial<Record<LobbyPanel, boolean>>;
  keys?: Record<string, string>;
  metrics?: MetricRecord[];
  runProcess?: ProcessRunner;
  panel?: PanelMember[];
  /** Chats of other sessions, by pi session id. */
  chats?: Record<string, ChatEntry[]>;
  /** Sessions running in other terminals. */
  live?: LiveSession[];
  /** Whole conversations served when scrolled back: this window's under "", others' by session id. */
  history?: Record<string, ChatEntry[]>;
  archivedTasks?: Task[];
  /** The task's runs, as streamed. */
  runs?: AgentRun[];
  /** The repository (or folder) and branch the title shows. */
  workspace?: WorkspaceInfo;
}

function makeView(options: ViewOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "bl-view-"));
  const calls: Calls = { settings: [], answered: 0, savedPanels: [], oracle: [], comments: [], started: [], discarded: [], aborted: 0, hidden: 0, seeds: [], seats: [], sessionStarts: [], auto: [], inbox: [], sessionInbox: [], switches: [], dialogs: [], archived: [], restored: [], deleted: [], historyLoads: [] };
  let taskList: Task[] = options.tasks ?? (options.task ? [options.task] : []);
  let archivedList: Task[] = options.archivedTasks ?? [];
  const sessions: BackgroundSession[] = [];
  const procs: FakeSessionProcess[] = [];
  const autoOn = new Set<string>();
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
    zen: () => ({ ...(options.task ? { task: options.task } : {}), runs: options.runs ?? [] }),
    feed,
    masterBusy: () => options.busy === true,
    tasks: () => taskList,
    plans: () => options.plans ?? [],
    comments: (): PlanComment[] => [],
    metrics: (): MetricRecord[] => options.metrics ?? [],
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
      planner = new PlanningSession({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "high", timeoutMs: 1000 }), ...(seats ? { panel: seats } : {}), runProcess: options.runProcess ?? hangingRunner }, seed);
      return planner;
    },
    answerPanel: async () => {
      calls.answered += 1;
      return "answers sent — the panel is on the next round";
    },
    issuesEnabled: () => options.issues === true,
    panels: () => ({ ...DEFAULT_CONFIG.lobby.panels, ...options.panels }),
    savePanels: (panels) => void calls.savedPanels.push({ ...panels }),
    keys: () => options.keys ?? {},
    openSettings: async (entry) => void calls.settings.push(entry ?? "all"),
    defaultPanel: () => options.panel ?? ["backend", "designer", "qa", "researcher"],
    seatLabel: (member) => `p/${member} · medium`,
    issues,
    profileLabel: () => "p/model · high",
    sessionName: () => "my window",
    sessions: () => sessions,
    startSession: (start) => {
      calls.sessionStarts.push({ ...(start.request ? { request: start.request } : {}), ...(start.plan ? { plan: start.plan.id } : {}), ...(start.auto ? { auto: true } : {}) });
      if (start.request === "fail") return "could not start a new session — no pi";
      const proc = new FakeSessionProcess();
      procs.push(proc);
      const session = new BackgroundSession(proc, { name: start.plan?.title ?? start.request!, ...(start.plan ? { planId: start.plan.id } : { request: start.request! }) });
      sessions.push(session);
      return session;
    },
    answerDialog: async (session) => {
      const dialog = session.dialogs[0];
      if (!dialog) return;
      calls.dialogs.push(dialog.title);
      session.answer(dialog.id, { value: dialog.options?.[0] ?? "" });
    },
    isAuto: (taskId) => autoOn.has(taskId),
    setAuto: (taskId, on) => {
      calls.auto.push([taskId, on]);
      if (on) autoOn.add(taskId);
      else autoOn.delete(taskId);
    },
    sendToTask: (taskId, text) => {
      calls.inbox.push([taskId, text]);
      return `sent — the session driving ${taskId} passes it to its oracle`;
    },
    sendToSession: (sessionId, text) => {
      calls.sessionInbox.push([sessionId, text]);
      return "sent — that session passes it to its oracle within a few seconds";
    },
    liveSessions: () => options.live ?? [],
    switchTo: async (target) => {
      calls.switches.push(target);
      return `switching this window to ${target.name}…`;
    },
    archivedTasks: () => archivedList,
    archiveTask: (taskId) => {
      const task = taskList.find((entry) => entry.id === taskId);
      if (!task) return `no task ${taskId}`;
      calls.archived.push(taskId);
      taskList = taskList.filter((entry) => entry !== task);
      archivedList = [{ ...task, archivedAt: new Date(NOW).toISOString() }, ...archivedList];
      return `archived ${taskId}`;
    },
    restoreTask: (taskId) => {
      const task = archivedList.find((entry) => entry.id === taskId);
      if (!task) return `${taskId} is not in the archive`;
      calls.restored.push(taskId);
      archivedList = archivedList.filter((entry) => entry !== task);
      taskList = [task, ...taskList];
      return `restored ${taskId} to the task list`;
    },
    deleteTask: (taskId, where) => {
      calls.deleted.push([taskId, where]);
      if (where === "archive") archivedList = archivedList.filter((entry) => entry.id !== taskId);
      else taskList = taskList.filter((entry) => entry.id !== taskId);
      return `deleted ${taskId} for good`;
    },
    sessionChat: (sessionId) => options.chats?.[sessionId] ?? [],
    hasOlderChat: (sessionId) => (options.history?.[sessionId]?.length ?? 0) > (options.chats?.[sessionId]?.length ?? 0),
    chatHistory: (sessionId) => {
      calls.historyLoads.push(sessionId ?? "");
      return options.history?.[sessionId ?? ""] ?? [];
    },
    ...(options.workspace ? { workspace: () => options.workspace! } : {}),
    requestRender: () => {},
    now: () => NOW,
  };
  const noop = (text: string) => text;
  const view = new LobbyView(tui, host, { borderColor: noop, selectList: { selectedPrefix: noop, selectedText: noop, description: noop, scrollInfo: noop, noMatch: noop } });
  view.focused = true;
  view.refreshData(true);
  return { view, calls, feed, quickfix, issues, root, planner: () => planner, sessions, procs };
}

/** A fake pi whose every run answers `text` as the assistant. */
function answering(text: string): ProcessRunner {
  const stdout = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/served", stopReason: "stop", usage: { input: 1, output: 1 } } });
  return async () => ({ exitCode: 0, stdout, stderr: "", killed: false, timedOut: false });
}

const ORACLE_REPLY = [
  "## Status", "GRILLING", "## Title", "Login",
  "## Questions", "1. Behind a flag?", "   - Yes (Recommended) — ship dark", "   - No — ship to everyone",
  "## Plan", "### Steps", "1. Add the form", "2. Wire the API",
].join("\n");

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** A lobby on the Plan tab whose panel has answered one round with a question and a draft. */
async function planned(options: ViewOptions = {}) {
  const made = makeView({ panel: [], runProcess: answering(ORACLE_REPLY), ...options });
  made.view.setTab("plan");
  type(made.view, "login page");
  made.view.handleInput(KEY.enter);
  await settle();
  assert.equal(made.planner()?.awaitingAnswers, true);
  made.view.render(140);
  return made;
}

/** The SGR report a terminal sends for a left click at zero-based `x`, `y`. */
function click(x: number, y: number): string {
  return `\x1b[<0;${x + 1};${y + 1}M`;
}

function type(view: LobbyView, text: string): void {
  for (const char of text) view.handleInput(char);
}

function activeTask(): Task {
  return { ...createTask("TASK-login", "add login", "2026-09-26T11:00:00.000Z", "Add a login page", "me"), state: "implementing", plan: PLAN };
}

test("every tab fills the terminal exactly, at wide and narrow sizes", () => {
  for (const [width, rows] of [[120, 40], [80, 24], [60, 16]] as const) {
    const { view } = makeView({ rows, task: activeTask(), issues: true });
    for (const tab of TAB_IDS) {
      view.setTab(tab);
      assert.equal(view.tab, tab);
      for (const state of ["plain", "help", "search"] as const) {
        if (state === "help") view.handleInput(KEY.alt("h"));
        if (state === "search") type(view, "\x06login");
        const lines = view.render(width);
        assert.equal(lines.length, rows, `${tab} (${state}) at ${width}x${rows}`);
        for (const line of lines) assert.ok(visibleWidth(line) <= width, `${tab} (${state}) at ${width}: "${line}"`);
        if (state === "help") view.handleInput(KEY.escape);
        if (state === "search") view.handleInput(KEY.escape);
      }
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
  view.handleInput(KEY.alt("5"));
  assert.deepEqual([view.tab, view.mode], ["metrics", "browse"], "Issues is off, so Metrics is the fifth tab");
  view.handleInput("3");
  assert.equal(view.tab, "plan", "digits switch tabs while browsing a list tab");
});

test("the Issues tab is off unless lobby.issues turns it on", () => {
  assert.deepEqual(visibleTabs(false), ["lobby", "tasks", "plan", "quickfix", "metrics"]);
  assert.deepEqual(visibleTabs(true), [...TAB_IDS]);
  const { view } = makeView();
  assert.ok(!view.render(140)[0]!.includes("Issues"));
  view.setTab("issues");
  assert.equal(view.tab, "lobby");
  assert.match(view.render(140).at(-1)!, /the Issues tab is off — set lobby\.issues to true/);
  const on = makeView({ issues: true }).view;
  assert.ok(on.render(140)[0]!.includes("5 Issues"));
  on.handleInput(KEY.alt("6"));
  assert.equal(on.tab, "metrics");
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

test("pending plans start in a new session with s, here with h, and are discarded with a double d", () => {
  const plan: PlannedTask = { id: "PLAN-dark", title: "dark mode", brief: "## Steps\n1. tokens", createdAt: "2026-09-26T10:00:00.000Z", updatedAt: "2026-09-26T10:00:00.000Z", status: "pending" };
  const { view, calls } = makeView({ plans: [plan] });
  view.setTab("tasks");
  view.handleInput("s");
  assert.deepEqual(calls.sessionStarts, [{ plan: "PLAN-dark" }]);
  assert.equal(view.tab, "lobby", "the new session is shown at once");
  assert.equal(view.viewedEntry().name, "dark mode", "named after the task");
  view.setTab("tasks");
  view.handleInput("h");
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

test("the Plan prompt starts a planning session; saving without a draft warns", () => {
  const { view, planner } = makeView();
  view.setTab("plan");
  type(view, "add dark mode");
  view.handleInput(KEY.enter);
  assert.equal(planner()?.messages[0]?.text, "add dark mode");
  assert.equal(planner()?.busy, true);
  view.handleInput(KEY.ctrlS);
  assert.ok(view.render(120).at(-1)!.includes("the first draft is still being written"));
  view.handleInput(KEY.escape);
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
  const { view, calls: host } = makeView({ exec, issues: true });
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
  const { view } = makeView({ metrics: [{ id: "1", kind: "worker", agent: "DEV", model: "p/fast", thinking: "low", status: "success", startedAt: "2026-09-26T11:00:00.000Z", durationMs: 90_000 }] });
  view.setTab("metrics");
  assert.ok(view.render(140).some((line) => line.includes("by model · thinking · sorted by runs")));
  view.handleInput("g");
  view.handleInput("s");
  assert.ok(view.render(140).some((line) => line.includes("by model · thinking · agent · sorted by avg")));
});

const ALL_PANELS = { conversation: true, activity: true, thinking: true };

test("the home tab puts the conversation first, the thinking pane last, and stacks panes when narrow", () => {
  const feed = new LobbyFeed();
  feed.say("you", "build it");
  feed.log("DEV", "reading a.ts", "info", NOW);
  feed.thought("DEV", "the router lives in a.ts");
  const input = { task: activeTask(), chat: feed.chat, activity: feed.activity, thoughts: feed.thoughts, busy: false, others: 0, pending: 0, tick: 0, now: NOW, panels: ALL_PANELS };
  const wide = renderHome(input, 120, 30);
  assert.ok(wide.some((line) => line.includes("╭ Conversation ─") && line.includes("╭ Activity")), "the task id lives in the tab bar, not the pane title");
  assert.ok(wide.some((line) => line.includes("╭ Thinking") && line.includes("DEV · just now")));
  assert.ok(wide.some((line) => line.includes("the router lives in a.ts")));
  const narrow = renderHome(input, 70, 30);
  assert.ok(narrow.some((line) => line.startsWith("╭ Activity")), "narrow terminals stack the activity log under the conversation");
  const empty = renderHome({ ...input, task: undefined, chat: [], activity: [], thoughts: [], others: 2, pending: 1 }, 100, 20);
  assert.ok(empty.some((line) => line.includes("No task is running in this session.")));
  assert.ok(empty.some((line) => line.includes("2 tasks are running in other sessions")));
});

test("hidden panes give their room to the rest, and a search narrows every pane", () => {
  const feed = new LobbyFeed();
  feed.say("you", "build the router");
  feed.say("oracle", "On it.");
  feed.log("DEV", "reading a.ts", "info", NOW);
  feed.log("DEV", "editing router.ts", "info", NOW);
  feed.thought("DEV", "the router lives in a.ts");
  const keys = { conversation: "Alt+C", activity: "Alt+A", thinking: "Alt+K" };
  const input = { chat: feed.chat, activity: feed.activity, thoughts: feed.thoughts, busy: false, others: 0, pending: 0, tick: 0, now: NOW, panels: ALL_PANELS, keys };
  const quiet = renderHome({ ...input, panels: { ...ALL_PANELS, activity: false, thinking: false } }, 120, 20);
  assert.equal(quiet.length, 20);
  assert.ok(!quiet.some((line) => line.includes("Activity") || line.includes("Thinking")));
  assert.ok(quiet[0]!.startsWith("╭ Conversation") && quiet[0]!.endsWith("Alt+C ╮"), "the pane names its toggle");
  const onlyThinking = renderHome({ ...input, panels: { ...ALL_PANELS, conversation: false, activity: false } }, 120, 20);
  assert.ok(onlyThinking[0]!.startsWith("╭ Thinking"), "thinking takes the whole tab when it is all that shows");
  const none = renderHome({ ...input, panels: { conversation: false, activity: false, thinking: false } }, 120, 20);
  assert.ok(none.some((line) => line.includes("Every pane is hidden — Alt+C conversation · Alt+A activity · Alt+K thinking")));
  const searched = renderHome({ ...input, query: "router" }, 120, 20);
  assert.ok(searched.some((line) => line.includes("You ●")) && searched.some((line) => line.includes("build the router ▐")));
  assert.ok(!searched.some((line) => line.includes("On it.")));
  assert.ok(searched.some((line) => line.includes("editing router.ts")));
  assert.ok(!searched.some((line) => line.includes("reading a.ts")));
  assert.ok(searched[0]!.includes("1 match"));
});

test("activity lines spin while pending and mark how a step ended", () => {
  const base = { id: 1, at: NOW, source: "DEV", text: "reading a.ts", kind: "info" as const, pending: true };
  assert.match(activityLine(base, 80, 0), /DEV {7}⠋ reading a\.ts…$/);
  assert.match(activityLine({ ...base, pending: false, kind: "error" }, 80, 0), /✗ reading a\.ts$/);
  assert.match(activityLine({ ...base, pending: false, kind: "success" }, 80, 0), /✓ reading a\.ts$/);
  assert.deepEqual(chatLines([], 40, undefined, undefined, true, 0), ["◆ Oracle                      ⠋ working…"]);
});

test("task rows group this session, other sessions, pending plans and recent tasks", () => {
  const mine = activeTask();
  const theirs = { ...createTask("TASK-cache", "fix cache", "2026-09-26T09:00:00.000Z", "fix", "someone-else-1234"), state: "reviewing" as const };
  const done = { ...createTask("TASK-old", "old", "2026-09-20T00:00:00.000Z"), state: "completed" as const, updatedAt: "2026-09-25T12:00:00.000Z" };
  const plan: PlannedTask = { id: "PLAN-x", title: "x", brief: "b", createdAt: "", updatedAt: "", status: "pending", issue: { number: 3, title: "t" } };
  const rows = taskRows([mine, theirs, done], [plan], "me", NOW);
  assert.deepEqual(rows.map((row) => [row.section, row.id, row.check, row.progress ? `${row.progress.done}/${row.progress.total}` : "", row.owner ?? "", row.age ?? "", row.issue ?? ""]), [
    ["mine", "TASK-login", "open", "0/2", "", "", ""],
    ["others", "TASK-cache", "open", "", "session someone-", "", ""],
    ["pending", "PLAN-x", "open", "", "", "", 3],
    ["recent", "TASK-old", "done", "", "", "24h", ""],
  ]);
  const lines = renderTasks({ rows, selected: 1, detail: ["DETAIL"], focus: "list", detailOffset: 0 }, 120, 16);
  assert.equal(lines.length, 16);
  assert.ok(lines[0]!.includes("3 open · 1 finished"), "the list counts what is open and what is finished");
  assert.ok(lines.some((line) => /── OTHER SESSIONS ─+ 1 ──/.test(line)), "each section is a rule with its count");
  assert.ok(lines.some((line) => line.includes("▸ ☐ fix cache")));
  assert.ok(lines.some((line) => line.includes("reviewing · session someone-")), "an open row's second line says its state and owner");
  assert.ok(lines.some((line) => /☐ add login\s+▱▱ 0\/2/.test(line)), "plan progress sits on the right as a pip per step");
});

test("pending tasks wear an empty box, completed ones a ticked box, abandoned ones a crossed box and a struck title", () => {
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text, strike: (text: string) => `~${text}~` };
  const open = { ...createTask("TASK-open", "add search", "2026-09-26T09:00:00.000Z", "x", "me"), state: "implementing" as const };
  const done = { ...createTask("TASK-done", "rename getUser", "2026-09-20T00:00:00.000Z"), state: "completed" as const, updatedAt: "2026-09-26T10:00:00.000Z" };
  const dropped = { ...createTask("TASK-drop", "migrate to vite", "2026-09-20T00:00:00.000Z"), state: "abandoned" as const, updatedAt: "2026-09-24T12:00:00.000Z" };
  const plan: PlannedTask = { id: "PLAN-dark", title: "dark mode", brief: "b", createdAt: "2026-09-26T10:00:00.000Z", updatedAt: "", status: "pending" };
  const rows = taskRows([open, done, dropped], [plan], "me", NOW);
  assert.deepEqual(rows.map((row) => [row.id, row.check]), [["TASK-open", "open"], ["PLAN-dark", "open"], ["TASK-done", "done"], ["TASK-drop", "dropped"]]);
  const lines = renderTasks({ rows, selected: 0, detail: [], focus: "list", detailOffset: 0 }, 120, 20, theme as never);
  const row = (text: string) => lines.find((line) => line.includes(text)) ?? "";
  assert.match(row("add search"), /☐ add search/);
  assert.match(row("dark mode"), /☐ dark mode/);
  assert.ok(row("planned · saved 2h ago"), "a saved plan says when it was saved");
  assert.match(row("rename getUser"), /☑ rename getUser\s+2h/);
  assert.match(row("migrate to vite"), /☒ ~migrate to vite~\s+2d/);
  assert.ok(lines.some((line) => /── FINISHED ─+ 2 ──/.test(line)));

  const struck = taskDetailLines(dropped, [], "me", 80, NOW, theme as never);
  assert.equal(struck[0]!.trimEnd(), "☒ ~migrate to vite~");
  assert.match(struck[1]!, /abandoned · started 6d ago · dropped 2d ago/);
  assert.ok(struck.some((line) => line.includes("It ended before a plan was made.")));
  assert.equal(taskDetailLines(done, [], "me", 80, NOW, theme as never)[0]!.trimEnd(), "☑ rename getUser");
});

test("task detail shows plan progress, comment status, and recent runs", () => {
  const task = { ...activeTask(), workerRuns: [{ runId: "w1", domain: "designer" as const, instruction: "Step 1: add the form", status: "success" as const, startedAt: "2026-09-26T11:10:00.000Z", finishedAt: "2026-09-26T11:20:00.000Z" }] };
  const comments: PlanComment[] = [
    { id: "a", taskId: "TASK-login", text: "cap page size", createdAt: "2026-09-26T11:59:00.000Z", status: "delivered" },
    { id: "b", taskId: "TASK-login", text: "older", createdAt: "2026-09-26T11:00:00.000Z", status: "addressed" },
  ];
  const lines = taskDetailLines(task, comments, "me", 80, NOW);
  assert.equal(lines[0], "☐ add login");
  assert.match(lines[1]!, /^ {2}implementing · this session · started 1h ago/);
  assert.ok(lines.some((line) => /^ {2}▰+▱+ 1 of 2 steps$/.test(line)), "a pip bar shows how far the plan is");
  assert.ok(lines.some((line) => line.includes("Progress") && line.includes("1/2 steps")));
  assert.ok(lines.includes("☑ 1. Add the form"));
  assert.ok(lines.includes("☐ 2. Wire the API ◂ now"));
  assert.ok(lines.some((line) => line.includes("Approved plan")));
  assert.ok(lines.some((line) => line.startsWith("◐ cap page size — sent to the oracle, 1m ago")));
  assert.ok(lines.some((line) => line.startsWith("✓ older — plan amended")));
  assert.ok(lines.some((line) => line.includes("Comments") && line.includes("1 open")));
});

function planSession(extra: Partial<PlanView> = {}): PlanView {
  const seat = (label: string, more: Partial<SeatView> = {}): SeatView => ({ label, seated: true, status: "done", questions: 0, ready: false, ...more });
  const questions = [
    { from: "ORACLE", text: "Ship behind a flag?", options: [{ label: "Yes (Recommended)", description: "ship dark first" }, { label: "No", description: "" }] },
    { from: "DESIGN", text: "Which pages?", options: [] },
  ];
  return {
    messages: [
      { role: "you", text: "dark mode", at: 0 },
      { role: "planner", text: "", at: 1, questions },
    ],
    reply: { status: "grilling", questions: [], plan: "### Steps\n1. tokens\n2. toggle" },
    questions,
    notes: [{ from: "QA", text: "e2e tests in tests/e2e" }],
    seats: [seat("ORACLE", { questions: 1 }), seat("DEV", { status: "thinking", step: "reading api.ts" }), seat("DESIGN", { questions: 1 }), seat("QA", { ready: true }), seat("RESEARCH", { seated: false, status: "idle" })],
    busy: false,
    turns: 1,
    title: "Dark mode",
    awaitingAnswers: true,
    answeredChunks: 0,
    lineComments: [],
    ...extra,
  };
}

test("the plan tab shows the roster, attributed questions with their options, the draft and each seat's needs", () => {
  const layout: PlanLayout = { draftTop: 0, draftLeft: 0, draftWidth: 0, draftRows: 0, draftStart: 0, draftText: [] };
  const input = { session: planSession(), profile: "p/m · high", seats: [], offset: 0, focus: "talk" as const, draftOffset: 0, tick: 0, layout };
  const lines = renderPlan(input, 140, 20);
  assert.equal(lines.length, 20);
  assert.ok(lines.some((line) => line.includes("Planning · Dark mode") && line.includes("● 2 questions — enter answers them")));
  assert.ok(lines.some((line) => line.includes("panel  ORACLE 1 question · DEV ⠋ reading api.ts · DESIGN 1 question · QA ✓ ready · RESEARCH off")));
  const settled = planSession({ seats: [{ label: "DESIGN", seated: true, status: "done", questions: 0, ready: false }] });
  assert.deepEqual(rosterLines(settled, 80, 0), ["panel  DESIGN done"], "a seat the oracle answered for is done, not '0 questions'");
  assert.ok(lines.some((line) => line.includes(" 1. ORACLE   Ship behind a flag?")));
  assert.ok(lines.some((line) => line.includes("○ Yes (Recommended) — ship dark first")));
  assert.ok(lines.some((line) => line.includes(" 2. DESIGN   Which pages?")));
  assert.ok(lines.some((line) => line.includes("╭ Draft plan")));
  assert.ok(lines.some((line) => line.includes("What each seat needs")));
  assert.ok(lines.some((line) => line.includes("QA       e2e tests in tests/e2e")));
  assert.deepEqual(layout.draftText.slice(0, 3), ["Steps", "1. tokens", "2. toggle"]);
  const row = lines.findIndex((line) => line.includes("1. tokens"));
  assert.equal(row, layout.draftTop + 1, "the layout says where each draft line landed");
  assert.equal(lines[row]!.indexOf("1. tokens"), layout.draftLeft + 2, "text starts after the comment marker column");
  const partial = renderPlan({ ...input, session: planSession({ answeredChunks: 1, lineComments: [{ line: "1. tokens", text: "name them per theme" }] }) }, 140, 20);
  assert.ok(partial.some((line) => line.includes("● 2 questions — enter resumes") && line.includes("◆ 1 comment to send")));
  assert.ok(partial.some((line) => line.includes("◆ 1. tokens")));
  assert.ok(partial.some((line) => line.includes("↳ name them per theme")));
  const filtered = renderPlan({ ...input, query: "pages" }, 140, 20);
  assert.ok(filtered.some((line) => line.includes(" 2. DESIGN   Which pages?")), "a filtered question keeps its number");
  assert.ok(!filtered.some((line) => line.includes("Ship behind a flag?")), "a search narrows the conversation");
});

test("before a session, 1-4 choose the seats the next session starts with", () => {
  const { view, calls } = makeView();
  view.setTab("plan");
  let lines = view.render(140);
  assert.ok(lines.some((line) => line.includes("Describe a task below and the panel questions you until the plan is clear.")), "one sentence says what to do");
  const roster: Array<[string, string]> = [["ORACLE", "p/model · high"], ["DEV", "p/backend · medium"], ["DESIGN", "p/designer · medium"], ["QA", "p/qa · medium"], ["RESEARCH", "p/researcher · medium"]];
  for (const [seat, model] of roster) {
    assert.ok(lines.some((line) => line.includes(`│ ${seat.padEnd(10)}${model}`)), `${seat} and its model line up`);
  }
  view.handleInput(KEY.escape);
  view.handleInput("2");
  view.handleInput("4");
  assert.ok(view.render(140).at(-1)!.includes("RESEARCH leaves the panel from the next round"));
  view.handleInput("i");
  type(view, "dark mode");
  view.handleInput(KEY.enter);
  assert.deepEqual(calls.seats.at(-1), ["backend", "qa"]);
  lines = view.render(140);
  assert.ok(lines.some((line) => line.includes("reply to the panel") || line.includes("the panel is thinking")));
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

test("a quick fix detail lists its steps, the files it edited, and its report", () => {
  const lines = jobDetailLines({ id: "QF-1", prompt: "fix typo", status: "success", createdAt: NOW, startedAt: NOW, finishedAt: NOW + 65_000, model: "p/m", thinking: "low", steps: [{ at: NOW, text: "editing a.ts", pending: false }], tools: 1, turns: 2, report: "## Done\nFixed.", files: ["src/a.ts"] }, 80, 0, NOW);
  assert.ok(lines.includes("success · 1m 05s · p/m · low · 1 tool"));
  assert.ok(lines.some((line) => line.endsWith("· editing a.ts")));
  assert.ok(lines.some((line) => line.includes("Edited")) && lines.includes("· src/a.ts"));
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
  assert.equal(lines.length, 10);
  assert.ok(lines.some((line) => line.startsWith("│ fast") && line.includes("worker") && line.includes("1m 30s")));
  assert.ok(lines.some((line) => line.includes("■ DEV 100% avg 1m 30s ×1")));
});

test("the metrics dashboard leads with tiles and charts when there is room", () => {
  const records: MetricRecord[] = [
    { id: "1", kind: "worker", agent: "DEV", model: "p/fast", thinking: "low", status: "success", startedAt: "", durationMs: 90_000, cost: 0.1 },
    { id: "2", kind: "worker", agent: "QA", model: "p/fast", thinking: "low", status: "failed", startedAt: "", durationMs: 30_000 },
    { id: "3", kind: "master", agent: "MASTER", model: "p/big", thinking: "high", status: "success", startedAt: "", durationMs: 240_000, cost: 0.5 },
  ];
  const lines = renderMetrics({ groups: aggregateMetrics(records), records, stats: taskStats([]), by: "model", sort: "runs", selected: 0 }, 120, 36);
  assert.equal(lines.length, 36);
  for (const title of ["╭ Runs", "╭ Success", "╭ Avg run", "╭ Cost", "╭ Tasks", "╭ Average run time", "╭ Success rate", "╭ Where the time goes", "╭ All models"]) {
    assert.ok(lines.some((line) => line.includes(title)), title);
  }
  assert.ok(lines.some((line) => line.includes("✗  50%")), "a failing model shows an icon, not only a colour");
  assert.ok(lines.some((line) => line.includes("✓ 100%")));
  assert.ok(lines.some((line) => line.includes("$0.60")));
  assert.deepEqual(filterRecords(records, "master").map((record) => record.id), ["3"]);
  assert.deepEqual(filterRecords(records, "LOW").map((record) => record.id), ["1", "2"]);
  const empty = renderMetrics({ groups: [], records: [], stats: taskStats([]), by: "model", sort: "runs", selected: 0, query: "nothing" }, 100, 12);
  assert.ok(empty.some((line) => line.includes('No run matches "nothing".')));
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

test("alt+a, alt+k and alt+c show and hide panes, and the choice is remembered", () => {
  const { view, calls } = makeView({ task: activeTask() });
  const has = (text: string) => view.render(120).some((line) => line.includes(text));
  assert.ok(has("╭ Activity") && has("╭ Thinking"));
  view.handleInput(KEY.alt("a"));
  assert.ok(!has("╭ Activity"));
  assert.match(view.render(120).at(-1)!, /activity log hidden · Alt\+A shows it/);
  assert.deepEqual(calls.savedPanels.at(-1), { conversation: true, activity: false, thinking: true });
  view.handleInput(KEY.alt("k"));
  assert.ok(!has("╭ Thinking"));
  view.handleInput(KEY.alt("c"));
  assert.ok(has("Every pane is hidden"));
  view.handleInput(KEY.alt("a"));
  assert.ok(has("╭ Activity"));
  assert.equal(view.mode, "type", "pane keys work while typing and leave the prompt alone");
  view.setTab("tasks");
  view.handleInput(KEY.alt("k"));
  assert.match(view.render(120).at(-1)!, /thinking shown on the Lobby tab/);
});

test("panes start as the config left them, and lobby.keys rebinds the shortcuts", () => {
  const { view } = makeView({ panels: { thinking: false }, keys: { toggleThinking: "alt+t", help: "f1" } });
  const has = (text: string) => view.render(120).some((line) => line.includes(text));
  assert.ok(!has("╭ Thinking"));
  view.handleInput(KEY.alt("k"));
  assert.ok(!has("╭ Thinking"), "the default key no longer toggles");
  view.handleInput(KEY.alt("t"));
  assert.ok(has("╭ Thinking"));
  assert.ok(view.render(120)[0]!.includes("F1 keys"), "the tab bar names the help key");
  view.handleInput("\x1bOP");
  assert.equal(view.help, true);
  assert.ok(has("Alt+T") && has("show or hide thinking"));
});

test("the help screen lists every shortcut and this tab's keys; any key closes it", () => {
  const { view } = makeView();
  view.setTab("plan");
  view.handleInput(KEY.escape);
  view.handleInput("?");
  const lines = view.render(140);
  assert.ok(lines.some((line) => line.includes("╭ Keys")));
  for (const text of ["Alt+A", "show or hide the activity log", "Alt+K", "Ctrl+F", "search the current tab", "Plan tab", "comment on the picked draft line", "lobby.keys"]) {
    assert.ok(lines.some((line) => line.includes(text)), text);
  }
  view.handleInput("q");
  assert.equal(view.help, false);
  view.handleInput(KEY.alt("h"));
  assert.equal(view.help, true);
  view.handleInput(KEY.down);
  assert.equal(view.help, false, "other keys close it and still do their job");
});

test("ctrl+f and / search the current tab: filtered, highlighted, kept per tab, cleared with esc", () => {
  const cache = { ...createTask("TASK-cache", "fix cache", "2026-09-26T09:00:00.000Z", "fix the cache", "other"), state: "reviewing" as const };
  const { view, feed } = makeView({ tasks: [activeTask(), cache] });
  feed.say("you", "build the router");
  feed.say("oracle", "On it.");
  view.handleInput("\x06");
  assert.equal(view.searching, true);
  type(view, "router");
  let lines = view.render(120);
  assert.ok(lines.some((line) => line.includes("\x1b[7mrouter\x1b[27m")), "matches are highlighted");
  assert.ok(!lines.some((line) => line.includes("On it.")));
  assert.ok(lines.some((line) => line.includes(" / ") && line.includes("enter keep · esc clear")));
  view.handleInput(KEY.enter);
  assert.deepEqual([view.searching, view.query()], [false, "router"]);
  assert.ok(view.render(120).some((line) => line.includes("Ctrl+F or / edits")));
  view.setTab("tasks");
  assert.equal(view.query(), undefined, "each tab has its own search");
  view.handleInput("/");
  type(view, "cache");
  view.handleInput(KEY.enter);
  lines = view.render(120);
  assert.ok(lines.some((line) => line.includes("fix ") && line.includes("cache")));
  assert.ok(!lines.some((line) => line.includes("add login")));
  assert.ok(lines.some((line) => line.includes("1 match")));
  view.handleInput(KEY.escape);
  assert.equal(view.query(), undefined);
  assert.ok(view.render(120).some((line) => line.includes("add login")));
  view.setTab("lobby");
  assert.equal(view.query(), "router", "the Lobby search waited");
});

test("enter on an empty Plan prompt, or a while browsing, puts the panel's questions to the user", async () => {
  const { view, calls } = await planned();
  assert.ok(view.render(140)[0]!.includes("Plan 1?"), "the tab bar counts the open questions");
  assert.ok(view.render(140).some((line) => line.includes("press enter to answer 1 question, or type a reply")));
  assert.ok(view.render(140).at(-1)!.includes("enter answer questions"), "the hint line says what enter does here");
  view.handleInput(KEY.enter);
  assert.equal(calls.answered, 1);
  await settle();
  assert.match(view.render(140).at(-1)!, /answers sent — the panel is on the next round/);
  view.handleInput(KEY.escape);
  view.handleInput("a");
  assert.equal(calls.answered, 2);
  type(view, "i");
  type(view, "just use a flag");
  view.handleInput(KEY.enter);
  assert.equal(calls.answered, 2, "typed text is a reply, not a questionnaire");
});

test("↑↓ pick a draft line and c comments on it; the comment waits for the answers", async () => {
  const { view, planner } = await planned();
  view.handleInput(KEY.escape);
  view.handleInput(KEY.enter);
  view.handleInput(KEY.down);
  view.handleInput("c");
  assert.equal(view.mode, "type");
  assert.ok(view.render(140).some((line) => line.includes("comment on “1. Add the form”")));
  assert.match(view.render(140).at(-1)!, /enter add the comment {2}esc cancel/);
  type(view, "use a modal");
  view.handleInput(KEY.enter);
  assert.deepEqual(planner()!.lineComments, [{ line: "1. Add the form", text: "use a modal" }]);
  assert.match(view.render(140).at(-1)!, /comment kept — it goes with your answers/);
  const lines = view.render(140);
  assert.ok(lines.some((line) => line.includes("◆ 1. Add the form")));
  assert.ok(lines.some((line) => line.includes("↳ use a modal")));
  view.handleInput(KEY.down);
  view.handleInput("c");
  view.handleInput(KEY.escape);
  assert.equal(view.mode, "browse", "esc drops a comment being written");
  assert.equal(planner()!.lineComments.length, 1);
});

test("clicking a draft line opens a comment on it; clicking a tab opens the tab", async () => {
  const { view, planner } = await planned();
  const lines = view.render(140);
  const y = lines.findIndex((line) => line.includes("2. Wire the API"));
  const x = lines[y]!.indexOf("2. Wire the API");
  view.handleInput(click(x + 3, y));
  assert.equal(view.mode, "type");
  assert.ok(view.render(140).some((line) => line.includes("comment on “2. Wire the API”")));
  type(view, "retry on 503");
  view.handleInput(KEY.enter);
  assert.deepEqual(planner()!.lineComments, [{ line: "2. Wire the API", text: "retry on 503" }]);
  // Full-screen pi hands over normalized mouse events instead.
  const heading = view.render(140).findIndex((line) => line.includes("1. Add the form"));
  view.handleMouse({ type: "click", button: "left", x: lines[heading]!.indexOf("1. Add the form"), y: heading, screenX: 0, screenY: 0, width: 140, height: 40, shift: false, alt: false, ctrl: false });
  assert.ok(view.render(140).some((line) => line.includes("comment on “1. Add the form”")));
  view.handleInput(KEY.escape);
  const bar = view.render(140)[0]!;
  view.handleInput(click(bar.indexOf("Tasks"), 0));
  assert.equal(view.tab, "tasks");
});

test("mouse reports parse as clicks and wheel turns", () => {
  assert.deepEqual(parseMouse("\x1b[<0;10;5M"), { kind: "press", button: 0, x: 9, y: 4, delta: 0 });
  assert.deepEqual(parseMouse("\x1b[<0;10;5m"), { kind: "release", button: 0, x: 9, y: 4, delta: 0 });
  assert.equal(parseMouse("\x1b[<64;1;1M")?.delta, -1);
  assert.equal(parseMouse("\x1b[<65;1;1M")?.delta, 1);
  assert.equal(parseMouse("\x1b[A"), undefined);
  const { view } = makeView();
  view.handleInput("\x1b[<65;1;5M");
  assert.equal(view.mode, "type", "a wheel turn is not typed into the prompt");
  assert.ok(!view.render(100).some((line) => line.includes("[<65")));
});

const KEYS = { left: "\x1b[D", right: "\x1b[C", home: "\x1b[H", end: "\x1b[F", pageUp: "\x1b[5~", pageDown: "\x1b[6~" };

/** The SGR report for a wheel turn at zero-based `x`, `y` (up is -1). */
function wheelAt(x: number, y: number, direction: -1 | 1): string {
  return `\x1b[<${direction < 0 ? 64 : 65};${x + 1};${y + 1}M`;
}

function busyFeed(feed: LobbyFeed, count = 60): void {
  feed.say("you", "build it");
  feed.say("oracle", "On it.");
  for (let index = 0; index < count; index += 1) feed.log("DEV", `reading file-${index}.ts`, "info", NOW);
}

test("each Lobby pane scrolls on its own: ← → pick the pane, ↑↓ and page keys scroll it, Home and End jump", () => {
  const { view, feed } = makeView();
  busyFeed(feed);
  view.handleInput(KEY.escape);
  const shows = (text: string) => view.render(120).some((line) => line.includes(text));
  assert.ok(shows("file-59.ts") && !shows("file-20.ts"), "panes start on their newest lines");
  view.handleInput(KEYS.right);
  assert.equal(view.homeFocus, "activity");
  view.handleInput(KEY.up);
  assert.ok(!shows("file-59.ts") && shows("file-58.ts"));
  assert.ok(view.render(120).some((line) => line.includes("╭ Activity") && line.includes("↓1")));
  assert.ok(shows("On it."), "the conversation did not move");
  view.handleInput(KEYS.home);
  assert.ok(shows("file-0.ts") && !shows("file-59.ts"));
  view.handleInput(KEY.down);
  assert.ok(!shows("file-0.ts"), "at the top, one step down responds at once (the offset is clamped)");
  view.handleInput(KEYS.end);
  assert.ok(shows("file-59.ts"));
  view.handleInput(KEYS.pageUp);
  const paged = Number(/↓(\d+)/.exec(view.render(120).find((line) => line.includes("╭ Activity"))!)?.[1]);
  const rows = view.render(120).filter((line) => line.includes("reading file-")).length;
  assert.equal(paged, rows - 1, "a page is the pane's rows less one line of context");
  view.handleInput(KEYS.right);
  assert.equal(view.homeFocus, "thinking");
  view.handleInput(KEY.alt("k"));
  assert.equal(view.render(120) && view.homeFocus, "thinking");
  view.handleInput(KEY.up);
  assert.equal(view.homeFocus, "conversation", "a hidden pane hands the keys to the first one showing");
});

test("the wheel scrolls the pane under the pointer, and a scrolled-back pane holds its place as lines arrive", () => {
  const { view, feed } = makeView();
  busyFeed(feed);
  let lines = view.render(120);
  const top = lines.findIndex((line) => line.includes("╭ Activity"));
  const x = lines[top]!.indexOf("╭ Activity") + 5;
  view.handleInput(wheelAt(x, top + 3, -1));
  lines = view.render(120);
  assert.ok(!lines.some((line) => line.includes("file-59.ts")) && lines.some((line) => line.includes("file-56.ts")), "three lines back");
  assert.equal(view.homeFocus, "conversation", "the wheel does not move the keys");
  const content = (line: string) => line.slice(x - 5).replace(/[│┃]\s*$/, "");
  const before = lines.filter((line) => line.includes("reading file-")).map(content);
  feed.log("DEV", "reading late.ts", "info", NOW);
  feed.log("DEV", "reading later.ts", "info", NOW);
  const after = view.render(120).filter((line) => line.includes("reading file-")).map(content);
  assert.deepEqual(after, before, "new lines arrive below without moving what is being read");
  assert.ok(view.render(120).some((line) => line.includes("╭ Activity") && line.includes("↓5")));
  view.handleInput(wheelAt(2, top + 3, -1));
  const header = view.render(120).find((line) => line.includes("╭ Conversation"))!;
  assert.ok(!header.slice(0, header.indexOf("╭ Activity")).includes("↓"), "the conversation fits, so it does not scroll");
  view.handleInput(click(x, top + 2));
  assert.equal(view.homeFocus, "activity", "a click gives the pane the keys");
});

test("task and quick fix details scroll to their last line and no further; the wheel works on both panes", async () => {
  const task = { ...activeTask(), plan: Array.from({ length: 60 }, (_, index) => `${index + 1}. step number ${index + 1}`).join("\n") };
  const { view } = makeView({ tasks: [task, { ...createTask("TASK-two", "second", "2026-09-26T10:00:00.000Z"), state: "implementing" as const }] });
  view.setTab("tasks");
  view.handleInput(KEY.enter);
  for (let index = 0; index < 20; index += 1) view.handleInput(KEYS.pageDown);
  let lines = view.render(120);
  assert.ok(lines.some((line) => line.includes("60. step number 60")));
  const detail = lines.find((line) => line.includes("╭ Detail"))!;
  assert.match(detail, /\d+–(\d+)\/\1 /, "the position reads the last line");
  view.handleInput(KEYS.pageUp);
  assert.ok(!view.render(120).some((line) => line.includes("60. step number 60")), "one page up moves at once");
  view.handleInput(KEYS.home);
  assert.ok(view.render(120).some((line) => line.includes("add login") || line.includes("Add a login page")));
  lines = view.render(120);
  const row = lines.findIndex((line) => line.includes("TASK-two") || line.includes("second"));
  view.handleInput(wheelAt(3, row, 1));
  assert.ok(view.render(120).some((line) => line.includes("▸ ☐ second")), "the wheel over the list moves the selection");
});

test("the Plan conversation scrolls with the wheel while the draft keeps its cursor", async () => {
  const { view } = await planned();
  const lines = view.render(140);
  const top = lines.findIndex((line) => line.includes("╭ Conversation"));
  view.handleInput(wheelAt(3, top + 2, -1));
  assert.ok(view.render(140).some((line) => line.includes("╭ Conversation")));
  view.handleInput(KEY.escape);
  view.handleInput(KEYS.right);
  view.handleInput(KEYS.end);
  assert.ok(view.planCursor > 0, "End puts the draft cursor on the last line");
  view.handleInput(KEYS.home);
  assert.equal(view.planCursor, 0);
});

test("alt+s opens bot-lobby's settings; m opens the quick fix or planner entry; the lobby rereads the config after", async () => {
  const keys: Record<string, string> = {};
  const { view, calls } = makeView({ keys });
  view.handleInput(KEY.alt("s"));
  assert.deepEqual(calls.settings, ["all"]);
  view.setTab("quickfix");
  view.handleInput(KEY.escape);
  view.handleInput("m");
  assert.deepEqual(calls.settings, ["all", "quickfix"]);
  const intro = view.render(120);
  assert.ok(intro.some((line) => line.includes("Describe a small change below and one agent makes it now, beside any running task.")));
  assert.ok(intro.some((line) => line.includes("QUICK FIX  p/model · high")), "the agent and its model");
  assert.match(intro.at(-1)!, /BROWSE {2}m model {2}\? all keys/, "the hint line offers the model key");
  view.setTab("plan");
  view.handleInput(KEY.escape);
  view.handleInput("m");
  assert.deepEqual(calls.settings, ["all", "quickfix", "planner"]);
  keys.toggleThinking = "alt+t";
  view.reloadConfig();
  view.setTab("lobby");
  view.handleInput(KEY.alt("t"));
  assert.equal(view.panelShown("thinking"), false, "a key rebound in the settings works at once");
});

test("ctrl+s saves the plan while typing and from any tab; the Plan tab names the key", async () => {
  const ready = ORACLE_REPLY.replace("GRILLING", "READY").replace(/## Questions[\s\S]*?## Plan/, "## Plan");
  const { view, planner, root } = makeView({ panel: [], runProcess: answering(ready) });
  view.setTab("plan");
  type(view, "login page");
  view.handleInput(KEY.enter);
  await settle();
  assert.equal(planner()!.reply?.status, "ready");
  const lines = view.render(140);
  assert.ok(lines.some((line) => line.includes("✓ ready — Ctrl+S saves it")), "the status line names the key");
  assert.ok(lines.some((line) => line.includes("the plan is ready — Ctrl+S saves it, or reply to refine it")));
  assert.equal(view.mode, "type");
  type(view, "half a reply");
  view.handleInput(KEY.ctrlS);
  assert.equal(planner()!.saved?.id, "PLAN-login");
  assert.match(view.render(140).at(-1)!.trimEnd(), /saved PLAN-login to the pending tasks — start it from the Tasks tab$/);
  assert.ok(view.render(140).some((line) => line.includes("half a reply")), "the draft reply is left alone");
  assert.ok(listPlannedTasks(root, ".pi").some((plan) => plan.id === "PLAN-login"));
  view.setTab("tasks");
  view.handleInput(KEY.ctrlS);
  assert.match(view.render(140).at(-1)!, /saved PLAN-login/, "it works from another tab too");
  const rebound = makeView({ keys: { savePlan: "alt+w" } }).view;
  rebound.setTab("plan");
  rebound.handleInput(KEY.alt("w"));
  assert.match(rebound.render(140).at(-1)!, /no plan to save yet/, "lobby.keys rebinds it; with no session there is nothing to save");
});

test("the conversation shows each turn under a speaker line with its time, your words in a band, events as rules", () => {
  const at = new Date(2026, 8, 27, 12, 4).getTime();
  const chat = [
    { id: 1, at, role: "note" as const, text: "task started · add login" },
    { id: 2, at, role: "you" as const, text: "add a login page" },
    { id: 3, at: at + 60_000, role: "oracle" as const, text: "Proposal:\n\n- a form" },
    { id: 4, at: at + 120_000, role: "you" as const, text: "use port 8080" },
    { id: 5, at: at + 130_000, role: "you" as const, text: "and dark mode" },
    { id: 6, at: at + 140_000, role: "note" as const, text: "✗ the oracle's turn failed: 429" },
  ];
  const lines = chatLines(chat, 44);
  const oracle = (time: string) => `${"◆ Oracle".padEnd(44 - time.length)}${time}`;
  const you = (time: string) => `${time}  You ●`.padStart(44);
  const bubble = (text: string) => `${text} ▐`.padStart(44);
  assert.deepEqual(lines, [
    "───── task started · add login · 12:04 ─────",
    "",
    you("12:04"),
    bubble("add a login page"),
    "",
    oracle("12:05"),
    "  Proposal:",
    "",
    "  - a form",
    "",
    you("12:06"),
    bubble("use port 8080"),
    "",
    bubble("and dark mode"),
    "",
    "✗ the oracle's turn failed: 429",
  ], "you on the right, the oracle on the left; a second message within minutes shares the header; failures stand out instead of becoming a rule");
  const live = chatLines(chat.slice(0, 2), 44, undefined, "Writing the **plan**", true, 0);
  assert.deepEqual(live.slice(-2), [oracle("⠋ writing"), "  Writing the **plan**"]);
  // With a theme that has backgrounds, your words sit in a bubble of pi's user-message background, in the accent colour, only as wide as they are.
  const colours: string[] = [];
  const banded = chatLines(chat.slice(1, 2), 30, { fg: (color, text) => (colours.push(color), text), bold: (text) => text, bg: (color, text) => `<${color}>${text}</${color}>` });
  assert.equal(banded[1], `${" ".repeat(12)}<userMessageBg> add a login page </userMessageBg>`);
  assert.ok(colours.includes("accent"));
  // A long message wraps inside a bubble at most ~72% of a wide pane, flush with the right edge.
  const wide = chatLines([{ id: 1, at, role: "you" as const, text: "add a login page with email and password, and keep the session for a week" }], 80);
  const body = wide.slice(1);
  assert.ok(body.length > 1 && body.every((line) => line.endsWith(" ▐") && line.length === 80));
  assert.ok(body.every((line) => line.trimStart().length <= Math.floor(80 * 0.72)), "the bubble leaves the left of the pane to the oracle");
});

function task(id: string, owner: string, state: Task["state"], title = id): Task {
  return { ...createTask(id, title, "2026-09-26T10:00:00.000Z", `do ${title}`, owner), state };
}

test("alt+n starts a task in its own session named after it; the Lobby then shows and talks to that session", async () => {
  const { view, calls, procs } = makeView();
  view.handleInput(KEY.alt("n"));
  assert.ok(view.render(120).some((line) => line.includes("new task — it starts in its own session, named after it")));
  type(view, "add a login page");
  view.handleInput(KEY.enter);
  assert.deepEqual(calls.sessionStarts, [{ request: "add a login page" }]);
  assert.deepEqual(calls.oracle, [], "nothing went to this window's oracle");
  assert.deepEqual(procs[0]!.commands("prompt").map((command) => command.message), ["/bot-lobby --task add a login page"]);
  assert.equal(view.viewedEntry().where, "background");
  assert.ok(view.render(120)[0]!.includes("add a login page · starting"), "the tab bar names the session in view");

  procs[0]!.emit(
    { type: "response", command: "get_state", success: true, data: { sessionId: "child-1" } },
    { type: "agent_start" },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Scouting the auth code." }], stopReason: "stop" } },
  );
  assert.ok(view.render(120).some((line) => line.includes("Scouting the auth code.")));
  type(view, "use port 8080");
  view.handleInput(KEY.enter);
  assert.deepEqual(procs[0]!.commands("prompt").at(-1)!.message, "use port 8080");
  assert.equal(procs[0]!.commands("prompt").at(-1)!.streamingBehavior, "steer", "a working session is steered");

  procs[0]!.emit({ type: "extension_ui_request", id: "q1", method: "select", title: "Approve the proposal?", options: ["Approve", "Decline"] });
  const screen = view.render(120);
  assert.ok(screen[0]!.includes("● 1 waiting"));
  assert.ok(screen.some((line) => line.includes("press enter to answer add a login page's question")));
  view.handleInput(KEY.enter);
  await settle();
  assert.deepEqual(calls.dialogs, ["Approve the proposal?"]);
  assert.deepEqual(procs[0]!.commands("extension_ui_response"), [{ type: "extension_ui_response", id: "q1", value: "Approve" }]);

  view.handleInput(KEY.alt("n"));
  type(view, "fail");
  view.handleInput(KEY.enter);
  assert.ok(view.render(120).at(-1)!.includes("could not start a new session — no pi"));
  assert.equal(view.viewedEntry().name, "add a login page", "a failed start keeps the session in view");
});

test("alt+o browses sessions by where they run, previews the picked one, and views, messages or switches to it", () => {
  const elsewhere = task("TASK-api", "term-2", "implementing", "rate limits");
  const orphan = task("TASK-old", "gone-session", "clarifying", "old login");
  const chat: ChatEntry[] = [{ id: 1, at: NOW, role: "oracle", text: "Rate limits are in." }];
  const live: LiveSession[] = [
    { sessionId: "term-2", pid: 4242, name: "rate limits", taskId: "TASK-api", mode: "tui" },
    { sessionId: "term-3", pid: 4343, mode: "tui" },
  ];
  const { view, calls, procs } = makeView({ tasks: [elsewhere, orphan], chats: { "term-2": chat, "gone-session": [{ id: 1, at: NOW, role: "you", text: "add login" }] }, live });
  view.handleInput(KEY.alt("n"));
  type(view, "add a login page");
  view.handleInput(KEY.enter);

  view.handleInput(KEY.alt("o"));
  let screen = view.render(140);
  const has = (pattern: RegExp) => screen.some((line) => pattern.test(line));
  assert.ok(has(/╭ Sessions/) && has(/╭ Preview/), "a list and a preview");
  assert.ok(has(/── THIS WINDOW ─+ 1 ──/) && has(/── BACKGROUND ─+ 1 ──/) && has(/── OTHER TERMINALS ─+ 2 ──/) && has(/── NOT RUNNING ─+ 1 ──/));
  assert.ok(has(/◇ rate limits\s+implementing/) && has(/◇ unnamed session\s+no task/) && has(/○ old login\s+clarifying/));
  assert.ok(has(/▸ ◆ add a login page/), "the session in view is picked");
  assert.ok(has(/move it into this window/), "the preview says what s does");

  // A session in another terminal: previewed with its pid and conversation; enter views it, messages reach its own inbox; s is refused.
  view.handleInput(KEY.down);
  screen = view.render(140);
  assert.ok(has(/other terminal · implementing · pid 4242/) && has(/Rate limits are in\./) && has(/TASK-api/));
  view.handleInput("s");
  assert.equal(calls.switches.length, 0);
  assert.match(view.render(140).at(-1)!, /running in another terminal \(pid 4242\) — switch there/);
  view.handleInput(KEY.enter);
  assert.equal(view.viewedEntry().name, "rate limits");
  type(view, "also cap bursts");
  view.handleInput(KEY.enter);
  assert.deepEqual(calls.sessionInbox, [["term-2", "also cap bursts"]]);

  // A task whose session is not running: its messages wait in the task's inbox, and s resumes its session here.
  view.handleInput(KEY.alt("o"));
  view.handleInput(KEY.down);
  view.handleInput(KEY.down);
  screen = view.render(140);
  assert.ok(has(/not running · clarifying/) && has(/resume it in this window/));
  view.handleInput(KEY.enter);
  assert.equal(view.viewedEntry().where, "not running");
  assert.ok(view.render(140).some((line) => line.includes("leave old login a message for when it resumes")));
  type(view, "use sessions");
  view.handleInput(KEY.enter);
  assert.deepEqual(calls.inbox, [["TASK-old", "use sessions"]]);
  view.handleInput(KEY.escape);
  view.handleInput("s");
  assert.deepEqual(calls.switches.map((target) => [target.name, target.sessionId, Boolean(target.background)]), [["old login", "gone-session", false]]);

  // A background session moves into this window: s hands the switch its process to stop first.
  view.handleInput(KEY.alt("o"));
  view.handleInput(KEY.up);
  view.handleInput(KEY.up);
  view.handleInput(KEY.up);
  assert.ok(view.render(140).some((line) => line.includes("▸ ◆ add a login page")));
  procs[0]!.emit({ type: "response", command: "get_state", success: true, data: { sessionId: "child-1" } });
  view.handleInput("s");
  assert.equal(calls.switches.at(-1)!.sessionId, "child-1");
  assert.ok(calls.switches.at(-1)!.background, "the background process is stopped before the switch");

  view.handleInput(KEY.alt("o"));
  for (let index = 0; index < 5; index += 1) view.handleInput(KEY.up);
  view.handleInput(KEY.enter);
  assert.equal(view.viewedEntry().where, "this window");
  view.handleInput(KEY.alt("o"));
  view.handleInput(KEY.down);
  view.handleInput("x");
  assert.deepEqual(procs[0]!.signals, [], "one x only arms it");
  view.handleInput("x");
  assert.deepEqual(procs[0]!.signals, ["SIGTERM"]);
  view.handleInput(KEY.escape);
  assert.ok(!view.render(140).some((line) => line.includes("╭ Preview")), "esc closes the browser");
});

test("a task nobody ever owned is taken over, not resumed", () => {
  const unowned = { ...createTask("TASK-free", "free task", "2026-09-26T10:00:00.000Z", "x"), state: "clarifying" as const };
  const { view, calls } = makeView({ tasks: [unowned] });
  view.handleInput(KEY.alt("o"));
  view.handleInput(KEY.down);
  assert.ok(view.render(140).some((line) => line.includes("take it over in this window")));
  view.handleInput("s");
  assert.deepEqual(calls.switches, [{ name: "free task", claimTaskId: "TASK-free" }]);
});

test("the browser will not switch while this window's oracle is working", () => {
  const orphan = task("TASK-old", "gone-session", "clarifying", "old login");
  const { view, calls } = makeView({ tasks: [orphan], busy: true });
  view.handleInput(KEY.alt("o"));
  view.handleInput(KEY.down);
  view.handleInput("s");
  assert.deepEqual(calls.switches, []);
  assert.match(view.render(140).at(-1)!, /oracle is working — esc stops it, then switch/);
});


test("alt+g switches auto mode for the task in view; the tab bar and the Tasks list mark it", () => {
  const mine = task("TASK-login", "me", "implementing", "login");
  const { view, calls } = makeView({ task: mine });
  view.handleInput(KEY.alt("g"));
  assert.deepEqual(calls.auto, [["TASK-login", true]]);
  assert.ok(view.render(120)[0]!.includes("⟳ AUTO"));
  assert.ok(view.render(120).at(-1)!.includes("auto mode on"));
  view.setTab("tasks");
  assert.ok(view.render(120).some((line) => line.includes("TASK-login") && line.includes("⟳ auto")));
  view.handleInput(KEY.alt("g"));
  assert.deepEqual(calls.auto.at(-1), ["TASK-login", false]);
  assert.ok(!view.render(120)[0]!.includes("⟳ AUTO"));

  const idle = makeView();
  idle.view.handleInput(KEY.alt("g"));
  assert.deepEqual(idle.calls.auto, []);
  assert.ok(idle.view.render(120).at(-1)!.includes("no active task here"));
});

test("on the Tasks tab o shows the session driving a task, and n types a task for a new session", () => {
  const other = task("TASK-api", "other-terminal", "implementing", "rate limits");
  const done = task("TASK-old", "gone", "completed", "old work");
  const { view } = makeView({ tasks: [other, done] });
  view.setTab("tasks");
  const rows = view.render(120);
  assert.ok(rows.some((line) => line.includes("TASK-api")));
  view.handleInput("o");
  assert.equal(view.tab, "lobby");
  assert.equal(view.viewedEntry().name, "rate limits");
  view.setTab("tasks");
  view.handleInput(KEY.down);
  view.handleInput("o");
  assert.ok(view.render(120).at(-1)!.includes("is not running in any session now"));
  view.handleInput("n");
  assert.equal(view.tab, "lobby");
  assert.ok(view.render(120).some((line) => line.includes("new task — it starts in its own session")));
  view.handleInput(KEY.escape);
  assert.ok(!view.render(120).some((line) => line.includes("new task — it starts in its own session")), "esc drops the new-session prompt");
});

test("on the Tasks tab a archives a task, v shows the archive, a restores and d d deletes; A A archives everything finished", () => {
  const open = task("TASK-open", "gone-session", "clarifying", "stale login");
  const done = { ...task("TASK-done", "x", "completed", "rename getUser"), updatedAt: "2026-09-26T10:00:00.000Z" };
  const dropped = { ...task("TASK-drop", "x", "abandoned", "migrate to vite"), updatedAt: "2026-09-25T10:00:00.000Z" };
  const { view, calls } = makeView({ tasks: [open, done, dropped] });
  view.setTab("tasks");
  let screen = view.render(140);
  assert.ok(screen.some((line) => line.includes("clarifying · not running")), "a task whose session ended says so");
  assert.ok(screen[1]!.includes("1 open · 2 finished"));

  // An open task is abandoned by archiving, so a asks twice.
  view.handleInput("a");
  assert.deepEqual(calls.archived, []);
  assert.match(view.render(140).at(-1)!, /TASK-open is clarifying — press a again to abandon and archive it/);
  view.handleInput("a");
  assert.deepEqual(calls.archived, ["TASK-open"]);

  // A finished one goes at once.
  view.handleInput("a");
  assert.deepEqual(calls.archived, ["TASK-open", "TASK-done"]);
  screen = view.render(140);
  assert.ok(!screen.some((line) => line.includes("rename getUser")));
  assert.match(view.render(140).at(-1)!, /archived TASK-done/);

  view.handleInput("v");
  screen = view.render(140);
  assert.ok(screen.some((line) => /── ARCHIVED ─+ 2 ──/.test(line)));
  assert.ok(screen[1]!.includes("1 finished · 2 archived"));
  view.handleInput(KEY.down);
  screen = view.render(140);
  assert.ok(screen.some((line) => line.includes("▸ ☑ rename getUser")) && screen.some((line) => line.includes("archived just now")) && screen.some((line) => line.includes("restore it to the list")));
  view.handleInput("a");
  assert.deepEqual(calls.restored, ["TASK-done"]);
  view.handleInput(KEY.down);
  view.handleInput(KEY.down);
  view.handleInput("d");
  assert.deepEqual(calls.deleted, []);
  view.handleInput("d");
  assert.deepEqual(calls.deleted, [["TASK-open", "archive"]], "d d deletes an archived task for good");

  view.handleInput("A");
  assert.match(view.render(140).at(-1)!, /press A again to archive all 2 finished tasks/);
  view.handleInput("A");
  assert.deepEqual(calls.archived.slice(-2).sort(), ["TASK-done", "TASK-drop"]);
  view.handleInput("v");
  assert.match(view.render(140).at(-1)!, /archived tasks hidden/);
  assert.ok(view.render(140).some((line) => line.includes("No tasks yet")));
});

test("d d deletes a task on the list for good", () => {
  const done = task("TASK-done", "x", "completed", "rename getUser");
  const { view, calls } = makeView({ tasks: [done] });
  view.setTab("tasks");
  view.handleInput("d");
  assert.match(view.render(140).at(-1)!, /press d again to delete TASK-done for good/);
  view.handleInput("d");
  assert.deepEqual(calls.deleted, [["TASK-done", "list"]]);
});

test("the conversation keeps its newest messages; scrolling to the top loads the rest, and the newest lets it go", () => {
  const all: ChatEntry[] = Array.from({ length: 150 }, (_, index) => ({ id: 1000 + index, at: NOW + index * 600_000, role: index % 2 === 0 ? "you" as const : "oracle" as const, text: `message ${index}` }));
  const { view, feed, calls } = makeView({ history: { "": all } });
  feed.seedChat(all);
  assert.equal(feed.chat.length, 100, "only the newest are kept in memory");
  assert.equal(feed.chatOlder, true);
  view.handleInput(KEY.escape);
  const shows = (text: string) => view.render(120).some((line) => line.includes(text));
  assert.ok(shows("message 149") && !shows("message 49"));
  const loaded = () => (view as unknown as { history?: unknown }).history !== undefined;
  view.handleInput(KEY.up);
  view.render(120);
  assert.equal(loaded(), false, "scrolling a little stays within what is kept");
  view.handleInput(KEYS.home);
  view.render(120);
  assert.deepEqual(calls.historyLoads, [""], "at the top, the rest is loaded once");
  assert.ok(shows("message 0"), "Home goes on to the very first message");
  assert.ok(!shows("earlier messages load"));
  view.handleInput(KEYS.end);
  view.render(120);
  assert.ok(shows("message 149"));
  assert.equal(loaded(), false, "back at the newest, the loaded history is let go");
  for (let index = 0; index < 400 && !loaded(); index += 1) {
    view.handleInput(KEY.up);
    view.render(120);
    if (!loaded() && shows("earlier messages load as you scroll up")) break;
  }
  assert.ok(shows("earlier messages load as you scroll up") || loaded(), "scrolling up line by line reaches the note at the top of what is kept");
});

test("a conversation scrolled to its top scrolls down again, one line a press, and holds its place as messages arrive", () => {
  // Messages of very different heights, so the estimated total moves a lot as scrolling draws more or fewer of them.
  const long = Array.from({ length: 30 }, (_, line) => `line ${line} of a long answer`).join("\n\n");
  const all: ChatEntry[] = Array.from({ length: 150 }, (_, index) => ({ id: 1000 + index, at: NOW + index * 600_000, role: index % 2 === 0 ? "you" as const : "oracle" as const, text: index % 7 === 3 ? `message ${index}\n\n${long}` : `message ${index}` }));
  const { view, feed } = makeView({ history: { "": all } });
  feed.seedChat(all);
  view.handleInput(KEY.escape);
  const offset = () => (view as unknown as { homeOffsets: { conversation: number } }).homeOffsets.conversation;
  const press = (key: string) => {
    view.handleInput(key);
    view.render(120);
  };
  view.render(120);
  for (let step = 0; step < 40; step += 1) {
    const before = offset();
    press(KEY.up);
    assert.equal(offset(), before + 1, "each press up moves exactly one line");
  }
  press(KEYS.home);
  press(KEYS.home);
  assert.ok(view.render(120).some((line) => line.includes("message 0")), "at the very top");
  const top = offset();
  for (let step = 1; step <= 20; step += 1) {
    press(KEY.down);
    assert.equal(offset(), top - step, "each press down moves one line toward the newest");
  }
  press(KEYS.pageDown);
  assert.ok(offset() < top - 20, "a page down moves on too");
  press(KEYS.end);
  assert.equal(offset(), 0);
  // Within the messages kept in memory: one arriving below leaves what is being read where it is.
  for (let step = 0; step < 30; step += 1) press(KEY.up);
  const before = offset();
  const content = () => view.render(120).filter((line) => line.includes("line ") || line.includes("message ")).join("\n");
  const reading = content();
  feed.say("oracle", `a new message below\n\n${long}`);
  view.render(120);
  assert.ok(offset() > before + 30, "a message arriving below pushes the offset back by its height");
  assert.equal(content(), reading, "and what is being read stays put");
  press(KEY.down);
  assert.equal(content() === reading, false, "and it still scrolls");
});

test("the buttons on a scrolling pane's bottom edge scroll it a page or two, and only where it scrolls", () => {
  const { view, feed } = makeView();
  busyFeed(feed);
  let lines = view.render(120);
  const top = lines.findIndex((line) => line.includes("╭ Activity"));
  const bottom = lines.findIndex((line, index) => index > top && line.includes("╰") && line.includes("▲▲ ▲ ▼ ▼▼"));
  assert.ok(bottom > top, "a pane with more lines than rows carries the buttons");
  const conversationEdge = lines[bottom]!.slice(0, lines[bottom]!.indexOf("╰", 2));
  assert.ok(!conversationEdge.includes("▲"), "a pane that fits has none");
  const rows = bottom - top - 1;
  const at = lines[bottom]!.indexOf("▲▲ ▲ ▼ ▼▼");
  const shown = () => view.render(120).filter((line) => line.includes("reading file-")).length;
  assert.ok(shown() > 0);
  const newest = () => view.render(120).some((line) => line.includes("file-59.ts"));
  assert.equal(newest(), true);
  view.handleInput(click(at + 3, bottom)); // one page up
  assert.equal(newest(), false, "a page back leaves the newest line");
  const onePage = view.render(120).find((line) => /file-\d+\.ts/.test(line))!;
  view.handleInput(click(at + 3, bottom));
  assert.notEqual(view.render(120).find((line) => /file-\d+\.ts/.test(line)), onePage, "another page back");
  view.handleInput(click(at + 7, bottom)); // one page down
  view.handleInput(click(at + 7, bottom));
  assert.equal(newest(), true, "back at the newest");
  view.handleInput(click(at, bottom)); // two pages up
  const twoPages = view.render(120).find((line) => /file-\d+\.ts/.test(line))!;
  assert.notEqual(twoPages, onePage, "two pages go further than one");
  view.handleInput(click(at + 8, bottom)); // two pages down
  assert.equal(newest(), true);
  assert.equal(view.homeFocus, "activity", "using a pane's buttons gives it the keys");
  void rows;
});

test("the bottom line shows the subagents at work at its right end, and nothing when none is", () => {
  const run = (id: string, domain: "designer" | "backend", status: AgentRun["status"], activity?: string): AgentRun => ({ runId: id, taskId: "TASK-login", domain, role: "worker", status, instruction: "x", output: "", attempts: 1, startedAt: new Date(NOW - 130_000).toISOString(), ...(activity ? { activity } : {}) });
  const busy = makeView({ task: activeTask(), runs: [run("a", "designer", "running", "editing"), run("b", "backend", "running"), run("c", "backend", "success")] });
  const last = busy.view.render(140).at(-1)!;
  assert.match(last, /TYPE.*enter/, "the keys stay on the left");
  assert.match(last.trimEnd(), /DESIGN editing 2m · DEV 2m$/, "each running agent, its activity and time; finished ones are left out");
  const narrow = busy.view.render(60).at(-1)!;
  assert.ok(visibleWidth(narrow) <= 60);
  const idle = makeView({ task: activeTask(), runs: [run("c", "backend", "success")] });
  assert.ok(!/DEV|agents? working/.test(idle.view.render(140).at(-1)!), "nothing shows when no agent is working");
});

test("the title names the repository and its branch instead of bot-lobby", () => {
  const { view } = makeView({ workspace: { name: "my-repo", branch: "main" } });
  const bar = view.render(120)[0]!;
  assert.match(bar, new RegExp(`◆ my-repo \\(${BRANCH_GLYPH} main\\) `));
  assert.doesNotMatch(bar, /bot-lobby/);
  assert.equal(view.render(120)[0]!.length > 0 && visibleWidth(view.render(120)[0]!), 120, "the bar fills its width");
  // A folder outside git has just its name.
  assert.match(makeView({ workspace: { name: "notes" } }).view.render(120)[0]!, /◆ notes │/);
  // Nothing known yet: the plain product name, never an empty title.
  assert.match(makeView().view.render(120)[0]!, /◆ bot-lobby │/);
});

test("a long title gives up the branch, then the name, before it crowds out the tabs", () => {
  const { view } = makeView({ workspace: { name: "a-repository-with-quite-a-long-name-indeed", branch: "feature/some-very-long-branch-name-that-goes-on" } });
  const wide = view.render(200)[0]!;
  assert.match(wide, /◆ a-repository-with-quite-a-l… \(⎇ feature\/some-very-long-branch-name-…\) /, "clipped, with the branch");
  const medium = view.render(96)[0]!;
  assert.match(medium, /◆ a-repository-with-quite-a-l… │/, "the branch goes first");
  assert.match(medium, /Metrics/);
  const narrow = view.render(60)[0]!;
  assert.match(narrow, / ◆ /);
  assert.equal(visibleWidth(narrow), 60);
  // Every tab stays clickable where the tab bar says it is.
  const at = view.render(120)[0]!;
  assert.match(at, /1 Lobby/);
});

test("a task working in its own worktree shows that branch in the title; a branch task shows the checkout's", () => {
  const worktree: Task = { ...activeTask(), git: { mode: "worktree", branch: "Task-Change-Table-Font-27-09-2026", path: "/repo/.pi/bot-lobby/worktrees/Task-Change-Table-Font-27-09-2026" } };
  assert.match(makeView({ task: worktree, workspace: { name: "my-repo", branch: "main" } }).view.render(140)[0]!, new RegExp(`◆ my-repo \\(${BRANCH_GLYPH} Task-Change-Table-Font-27-09-2026\\) `));
  const branch: Task = { ...activeTask(), git: { mode: "branch", branch: "Task-Change-Table-Font-27-09-2026" } };
  assert.match(makeView({ task: branch, workspace: { name: "my-repo", branch: "Task-Change-Table-Font-27-09-2026" } }).view.render(140)[0]!, new RegExp(`\\(${BRANCH_GLYPH} Task-Change-Table-Font-27-09-2026\\)`), "the checkout is on it");
  assert.match(makeView({ task: branch, workspace: { name: "my-repo", branch: "main" } }).view.render(140)[0]!, new RegExp(`\\(${BRANCH_GLYPH} main\\)`), "switched away by hand: the title tells the truth");
});

test("shift+enter puts a new line in every prompt of the lobby instead of sending it", () => {
  const SHIFT_ENTER = ["\x1b[13;2u", "\x1b[27;2;13~"];
  const ctrlJ = "\n";
  const sent = (made: ReturnType<typeof makeView>) => [made.calls.oracle.length, made.calls.comments.length, made.calls.sessionStarts.length, made.quickfix.jobs.length];
  for (const newline of [...SHIFT_ENTER, ctrlJ]) {
    // The Lobby prompt talks to the oracle.
    const lobby = makeView();
    type(lobby.view, "first line");
    lobby.view.handleInput(newline);
    type(lobby.view, "second line");
    assert.deepEqual(sent(lobby), [0, 0, 0, 0], `${JSON.stringify(newline)} does not send`);
    const drawn = lobby.view.render(100).join("\n");
    assert.match(drawn, /first line[\s\S]*second line/, "both lines are in the prompt");
    lobby.view.handleInput(KEY.enter);
    assert.deepEqual(lobby.calls.oracle, ["first line\nsecond line"], "enter sends the whole message");

    // A comment on a task's plan.
    const tasks = makeView({ task: activeTask() });
    tasks.view.setTab("tasks");
    tasks.view.handleInput("c");
    type(tasks.view, "cap the page size");
    tasks.view.handleInput(newline);
    type(tasks.view, "and the rate");
    tasks.view.handleInput(KEY.enter);
    assert.deepEqual(tasks.calls.comments, [["TASK-login", "cap the page size\nand the rate"]]);

    // The planning panel, a quick fix and a new issue.
    const plan = makeView({ panel: [] });
    plan.view.setTab("plan");
    type(plan.view, "login page");
    plan.view.handleInput(newline);
    type(plan.view, "with a remember-me box");
    plan.view.handleInput(KEY.enter);
    assert.equal(plan.planner()?.messages[0]?.text, "login page\nwith a remember-me box");
    const fix = makeView();
    fix.view.setTab("quickfix");
    type(fix.view, "rename Save");
    fix.view.handleInput(newline);
    type(fix.view, "to Apply");
    assert.equal(fix.quickfix.jobs.length, 0);
    fix.view.handleInput(KEY.enter);
    assert.equal(fix.quickfix.jobs[0]?.prompt, "rename Save\nto Apply");
  }
});

test("a backslash before enter is a new line too, for terminals that cannot tell shift+enter apart", () => {
  const { view, calls } = makeView();
  type(view, "one\\");
  view.handleInput(KEY.enter);
  type(view, "two");
  view.handleInput(KEY.enter);
  assert.deepEqual(calls.oracle, ["one\ntwo"]);
});

test("the search bar is one line: shift+enter neither sends nor writes anything into it", () => {
  const { view } = makeView({ task: activeTask() });
  view.setTab("tasks");
  view.handleInput("\x06");
  type(view, "log");
  view.handleInput("\x1b[13;2u");
  type(view, "in");
  assert.equal(view.query(), "login", "the query carries on as one line");
  assert.equal(view.searching, true, "shift+enter does not close it");
});

test("a task's details name its branch, where it came from and its worktree", () => {
  const detail = (git: Task["git"]) => taskDetailLines({ ...activeTask(), ...(git ? { git } : {}) }, [], "me", 100, NOW).join("\n");
  assert.doesNotMatch(detail(undefined), new RegExp(BRANCH_GLYPH), "a task without git shows nothing about it");
  assert.match(detail({ mode: "branch", branch: "Task-Change-Table-Font-27-09-2026", from: "main" }), new RegExp(`${BRANCH_GLYPH} Task-Change-Table-Font-27-09-2026 · from main`));
  const worktree = detail({ mode: "worktree", branch: "Task-A-27-09-2026", from: "main", path: "/repo/.pi/bot-lobby/worktrees/Task-A-27-09-2026" });
  assert.match(worktree, /⎇ Task-A-27-09-2026 · from main · worktree \/repo\/\.pi\/bot-lobby\/worktrees\/Task-A-27-09-2026/);
});
