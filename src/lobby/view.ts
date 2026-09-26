/**
 * The lobby: a full-screen, tabbed view over everything bot-lobby does. A tab
 * bar on top, the active tab's body, a prompt at the bottom whose target
 * follows the tab (the oracle, a plan comment, the planner, a quick fix, a new
 * issue) and a key-hint line. Two modes, like a modal editor: typing mode sends
 * keys to the prompt; browsing mode (esc) moves through lists and runs the
 * tab's single-key commands. Everything bot-lobby-specific arrives through
 * `LobbyHost`, so the view renders and reacts the same in tests.
 */
import { decodeKittyPrintable, Editor, Key, matchesKey, visibleWidth, type Component, type EditorTheme, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import type { AgentRun } from "../schemas/findings.ts";
import type { PlannedTask } from "../state/backlog.ts";
import type { PlanComment } from "../state/comments.ts";
import { aggregateMetrics, collectMetrics, SORT_KEYS, sortGroups, taskStats, taskTimesByModel, type GroupBy, type MetricRecord, type SortKey } from "../state/metrics.ts";
import type { LobbyAgentKind } from "../schemas/configuration.ts";
import type { LobbyFeed } from "./feed.ts";
import type { QuickFixQueue } from "./quickfix.ts";
import type { PlannerSeed, PlanningSession } from "./planner.ts";
import { issueText, type IssuesState } from "./issues.ts";
import { bold, fit, paint, spinner, type LobbyTheme } from "./layout.ts";
import { renderHome } from "./tabs/home.ts";
import { planDetailLines, renderTasks, taskDetailLines, taskRows, type TaskRow } from "./tabs/tasks.ts";
import { renderPlan } from "./tabs/plan.ts";
import { newestFirst, renderQuickFix } from "./tabs/quickfix.ts";
import { renderIssues } from "./tabs/issues.ts";
import { renderMetrics } from "./tabs/metrics.ts";

export const TAB_IDS = ["lobby", "tasks", "plan", "quickfix", "issues", "metrics"] as const;
export type TabId = (typeof TAB_IDS)[number];

export const TAB_LABELS: Record<TabId, string> = {
  lobby: "Lobby",
  tasks: "Tasks",
  plan: "Plan",
  quickfix: "Quick fix",
  issues: "Issues",
  metrics: "Metrics",
};

/** Tabs where the prompt is the point: they open in typing mode and typing in browsing mode resumes it. */
const PROMPT_FIRST: ReadonlySet<TabId> = new Set(["lobby", "plan", "quickfix"]);

export type LobbyMode = "type" | "browse";

/** Everything the view needs from pi and bot-lobby. */
export interface LobbyHost {
  rows(): number;
  theme(): LobbyTheme;
  sessionId(): string | undefined;
  /** This session's active task and its runs, as the zen widget sees them. */
  zen(): { task?: Task; runs: readonly AgentRun[] };
  /** Draw the zen scene into at most `height` lines. */
  scene(width: number, height: number): string[];
  /** Advance the scene's clock; returns the delay it wants until the next step. */
  advanceScene(now: number): number;
  feed: LobbyFeed;
  masterBusy(): boolean;
  tasks(): Task[];
  plans(): PlannedTask[];
  comments(taskId: string): PlanComment[];
  metrics(): MetricRecord[];
  /** Send text to the oracle, or start a task when none is active; returns a notice. */
  toOracle(text: string): string | undefined;
  comment(taskId: string, text: string): string;
  startPlanned(plan: PlannedTask): string;
  discardPlan(id: string): void;
  abortMaster(): void;
  hide(): void;
  quickfix: QuickFixQueue;
  planner(): PlanningSession | undefined;
  newPlanner(seed?: PlannerSeed): PlanningSession;
  issues: IssuesState;
  profileLabel(kind: LobbyAgentKind): string;
  requestRender(): void;
  now?(): number;
}

/** Live work speeds the clock up so spinners and the scene move. */
export const LIVE_MS = 250;
export const IDLE_MS = 1000;
/** How often task and metrics data is reread from disk while the lobby is open. */
export const DATA_REFRESH_MS = 2000;
const NOTICE_MS = 6000;

/** The prompt editor, with its target written into the top border. */
class LobbyEditor extends Editor {
  label = "";
  paintLabel: (text: string) => string = (text) => text;

  protected override renderTopBorder(width: number, hiddenLineCount: number): string {
    if (!this.label) return super.renderTopBorder(width, hiddenLineCount);
    const label = ` ${this.label} `;
    const more = hiddenLineCount > 0 ? ` ↑${hiddenLineCount} ` : "";
    const rest = width - 2 - visibleWidth(label) - visibleWidth(more);
    if (rest < 1) return super.renderTopBorder(width, hiddenLineCount);
    return `${this.borderColor("──")}${this.paintLabel(label)}${this.borderColor("─".repeat(rest))}${more ? this.borderColor(more) : ""}`;
  }
}

/** The editor's reverse-video block cursor. */
const REVERSE_VIDEO = /\x1b\[7m([^\x1b]*)\x1b\[0m/g;

interface Notice {
  text: string;
  at: number;
  kind: "info" | "warning";
}

function isPrintable(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  return data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) !== 127 ? data : undefined;
}

export class LobbyView implements Component, Focusable {
  tab: TabId = "lobby";
  mode: LobbyMode = "type";
  private readonly host: LobbyHost;
  private readonly editor: LobbyEditor;
  private focusedState = false;
  private tick = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private notice: Notice | undefined;
  private readonly drafts: Partial<Record<TabId, string>> = {};
  /** Double-press confirmations, such as discarding a plan. */
  private armed: string | undefined;

  private chatOffset = 0;
  private tasksSelected = 0;
  private tasksFocus: "list" | "detail" = "list";
  private tasksDetailOffset = 0;
  private commentTarget: string | undefined;
  private planOffset = 0;
  private fixSelected = 0;
  private fixFocus: "list" | "detail" = "list";
  private fixDetailOffset = 0;
  private issueSelected = 0;
  private issueFocus: "list" | "detail" = "list";
  private issueDetailOffset = 0;
  private issueDraft = false;
  private metricsSelected = 0;
  private metricsBy: GroupBy = "model";
  private metricsSort: SortKey = "runs";

  private data: { tasks: Task[]; plans: PlannedTask[]; comments: Map<string, PlanComment[]>; metrics: MetricRecord[]; at: number } = {
    tasks: [],
    plans: [],
    comments: new Map(),
    metrics: [],
    at: 0,
  };

  constructor(tui: TUI, host: LobbyHost, editorTheme: EditorTheme) {
    this.host = host;
    this.editor = new LobbyEditor(tui, editorTheme, { paddingX: 1 });
    this.editor.onSubmit = (text) => this.submit(text);
  }

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.editor.focused = value && this.mode === "type";
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  /** Start the lobby clock (while visible). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.refreshData(true);
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.stop();
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => this.step(), delay);
    this.timer.unref?.();
  }

  private isLive(): boolean {
    const zen = this.host.zen();
    return this.host.masterBusy()
      || Boolean(this.host.quickfix.running)
      || Boolean(this.host.planner()?.busy)
      || this.host.issues.loading
      || zen.runs.some((run) => run.status === "running")
      || Boolean(zen.task && !zen.task.paused && !TERMINAL_STATES.includes(zen.task.state));
  }

  /** One clock step: advance the scene, reread data when due, repaint. */
  private step(): void {
    if (!this.running) return;
    const now = this.now();
    this.tick += 1;
    let delay = this.isLive() ? LIVE_MS : IDLE_MS;
    if (this.tab === "lobby" && this.host.zen().task) delay = Math.min(delay, this.host.advanceScene(now));
    this.refreshData(false);
    this.host.requestRender();
    this.schedule(delay);
  }

  /** Reread tasks, plans, comments and metrics from disk (throttled unless forced). */
  refreshData(force: boolean): void {
    const now = this.now();
    if (!force && now - this.data.at < DATA_REFRESH_MS) return;
    const tasks = this.host.tasks();
    const comments = new Map<string, PlanComment[]>();
    if (this.tab === "tasks") {
      const row = this.taskRowList(tasks)[this.tasksSelected];
      if (row?.kind === "task") comments.set(row.id, this.host.comments(row.id));
    }
    this.data = {
      tasks,
      plans: this.host.plans(),
      comments,
      metrics: this.tab === "metrics" ? this.host.metrics() : this.data.metrics,
      at: now,
    };
  }

  private say(text: string, kind: Notice["kind"] = "info"): void {
    this.notice = { text, at: this.now(), kind };
  }

  /* ---------------------------------------------------------------- tabs */

  setTab(tab: TabId): void {
    if (tab === this.tab) return;
    this.drafts[this.tab] = this.editor.getText();
    this.tab = tab;
    this.editor.setText(this.drafts[tab] ?? "");
    this.commentTarget = undefined;
    this.issueDraft = false;
    this.armed = undefined;
    this.setMode(PROMPT_FIRST.has(tab) ? "type" : "browse");
    this.refreshData(true);
    if (tab === "issues" && !this.host.issues.loaded && !this.host.issues.loading) void this.host.issues.refresh().then(() => this.loadIssueDetail());
    this.host.requestRender();
  }

  private cycleTab(direction: 1 | -1): void {
    const index = TAB_IDS.indexOf(this.tab);
    this.setTab(TAB_IDS[(index + direction + TAB_IDS.length) % TAB_IDS.length]!);
  }

  private setMode(mode: LobbyMode): void {
    this.mode = this.tab === "metrics" ? "browse" : mode;
    this.editor.focused = this.focusedState && this.mode === "type";
  }

  /** Open the prompt for a comment on `taskId`'s plan (from any tab). */
  commentOn(taskId: string): void {
    this.setTab("tasks");
    const rows = this.taskRowList(this.data.tasks);
    const index = rows.findIndex((row) => row.id === taskId);
    if (index >= 0) this.tasksSelected = index;
    this.refreshData(true);
    this.commentTarget = taskId;
    this.setMode("type");
  }

  /** Plan an issue: seed a planning session with it and switch to the Plan tab. */
  async planIssue(number: number): Promise<void> {
    const detail = await this.host.issues.detail(number);
    if (!detail) return this.say(`could not load issue #${number}`, "warning");
    const session = this.host.newPlanner({ issue: { number: detail.number, title: detail.title, ...(detail.url ? { url: detail.url } : {}) }, body: issueText(detail) });
    this.planOffset = 0;
    this.setTab("plan");
    void session.open();
  }

  /* --------------------------------------------------------------- input */

  handleInput(data: string): void {
    this.handleKey(data);
    this.host.requestRender();
  }

  private handleKey(data: string): void {
    if (matchesKey(data, Key.alt("l"))) return this.host.hide();
    if (matchesKey(data, Key.tab)) return this.cycleTab(1);
    if (matchesKey(data, Key.shift("tab"))) return this.cycleTab(-1);
    for (const [index, tab] of TAB_IDS.entries()) {
      if (matchesKey(data, Key.alt(String(index + 1) as "1"))) return this.setTab(tab);
    }
    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.editor.getText()) return this.editor.setText("");
      return this.host.hide();
    }
    if (matchesKey(data, Key.pageUp)) return this.scroll(-10);
    if (matchesKey(data, Key.pageDown)) return this.scroll(10);
    if (this.mode === "type") return this.typeKey(data);
    return this.browseKey(data);
  }

  private typeKey(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.tab === "lobby" && this.host.masterBusy() && !this.editor.getText().trim()) {
        this.host.abortMaster();
        return this.say("stopping the oracle…");
      }
      this.commentTarget = undefined;
      this.issueDraft = false;
      return this.setMode("browse");
    }
    this.editor.handleInput(data);
  }

  private browseKey(data: string): void {
    if (matchesKey(data, Key.up) || (!PROMPT_FIRST.has(this.tab) && data === "k")) return this.scroll(-1);
    if (matchesKey(data, Key.down) || (!PROMPT_FIRST.has(this.tab) && data === "j")) return this.scroll(1);
    if (!PROMPT_FIRST.has(this.tab) && /^[1-6]$/.test(data)) return this.setTab(TAB_IDS[Number(data) - 1]!);
    if (data === "i" && this.tab !== "metrics" && this.tab !== "tasks" && this.tab !== "issues") return this.setMode("type");
    if (this.tabCommand(data)) return;
    const printable = isPrintable(data);
    if (printable && PROMPT_FIRST.has(this.tab)) {
      this.setMode("type");
      this.editor.handleInput(data);
    }
  }

  /** Arrow keys and page keys: scroll or select, depending on the tab and its focus. */
  private scroll(delta: number): void {
    switch (this.tab) {
      case "lobby":
        this.chatOffset = Math.max(0, this.chatOffset - delta);
        return;
      case "plan":
        this.planOffset = Math.max(0, this.planOffset - delta);
        return;
      case "tasks":
        if (this.tasksFocus === "detail" || Math.abs(delta) > 1) this.tasksDetailOffset = Math.max(0, this.tasksDetailOffset + delta);
        else this.selectTask(this.tasksSelected + delta);
        return;
      case "quickfix":
        if (this.fixFocus === "detail" || Math.abs(delta) > 1) this.fixDetailOffset = Math.max(0, this.fixDetailOffset + delta);
        else {
          this.fixSelected = Math.max(0, Math.min(this.host.quickfix.jobs.length - 1, this.fixSelected + delta));
          this.fixDetailOffset = 0;
        }
        return;
      case "issues":
        if (this.issueFocus === "detail" || Math.abs(delta) > 1) this.issueDetailOffset = Math.max(0, this.issueDetailOffset + delta);
        else {
          this.issueSelected = Math.max(0, Math.min(this.host.issues.issues.length - 1, this.issueSelected + delta));
          this.issueDetailOffset = 0;
          void this.loadIssueDetail();
        }
        return;
      case "metrics":
        this.metricsSelected = Math.max(0, this.metricsSelected + delta);
        return;
    }
  }

  private selectTask(index: number): void {
    const rows = this.taskRowList(this.data.tasks);
    this.tasksSelected = Math.max(0, Math.min(rows.length - 1, index));
    this.tasksDetailOffset = 0;
    this.refreshData(true);
  }

  private async loadIssueDetail(): Promise<void> {
    const issue = this.host.issues.issues[this.issueSelected];
    if (issue) await this.host.issues.detail(issue.number);
  }

  /** The tab's single-key commands in browsing mode; true when the key was one. */
  private tabCommand(data: string): boolean {
    const enter = matchesKey(data, Key.enter);
    const escape = matchesKey(data, Key.escape);
    switch (this.tab) {
      case "lobby":
        if (escape && this.host.masterBusy()) {
          this.host.abortMaster();
          this.say("stopping the oracle…");
          return true;
        }
        if (data === "c") {
          const task = this.host.zen().task;
          if (task) this.commentOn(task.id);
          else this.say("no task in this session to comment on", "warning");
          return true;
        }
        return enter ? (this.setMode("type"), true) : false;
      case "tasks":
        return this.tasksCommand(data, enter, escape);
      case "plan":
        return this.planCommand(data, escape);
      case "quickfix":
        if (enter) return (this.fixFocus = this.fixFocus === "list" ? "detail" : "list"), true;
        if (escape && this.fixFocus === "detail") return (this.fixFocus = "list"), true;
        if (data === "x") {
          const job = newestFirst(this.host.quickfix.jobs)[this.fixSelected];
          if (job && this.host.quickfix.cancel(job.id)) this.say(`cancelling ${job.id}`);
          return true;
        }
        return false;
      case "issues":
        return this.issuesCommand(data, enter, escape);
      case "metrics":
        if (data === "g") return (this.metricsBy = this.metricsBy === "model" ? "model-kind" : "model", this.metricsSelected = 0), true;
        if (data === "s") return (this.metricsSort = SORT_KEYS[(SORT_KEYS.indexOf(this.metricsSort) + 1) % SORT_KEYS.length]!), true;
        if (data === "r") return this.refreshData(true), true;
        return false;
    }
  }

  private tasksCommand(data: string, enter: boolean, escape: boolean): boolean {
    const row = this.taskRowList(this.data.tasks)[this.tasksSelected];
    if (enter) return (this.tasksFocus = this.tasksFocus === "list" ? "detail" : "list"), true;
    if (escape) return (this.tasksFocus = "list"), true;
    if (data === "r") return this.refreshData(true), true;
    if (!row) return false;
    if (data === "c") {
      const task = this.data.tasks.find((entry) => entry.id === row.id);
      if (row.kind !== "task" || !task) this.say("pick a task to comment on its plan", "warning");
      else if (TERMINAL_STATES.includes(task.state)) this.say(`${task.id} is ${task.state}; there is no plan left to change`, "warning");
      else {
        this.commentTarget = task.id;
        this.setMode("type");
      }
      return true;
    }
    const plan = row.kind === "plan" ? this.data.plans.find((entry) => entry.id === row.id) : undefined;
    if (data === "s" && plan) {
      this.say(this.host.startPlanned(plan));
      this.refreshData(true);
      return true;
    }
    if (data === "d" && plan) {
      if (this.armed !== `discard:${plan.id}`) {
        this.armed = `discard:${plan.id}`;
        this.say(`press d again to discard ${plan.id}`, "warning");
        return true;
      }
      this.armed = undefined;
      this.host.discardPlan(plan.id);
      this.say(`discarded ${plan.id}`);
      this.refreshData(true);
      return true;
    }
    return false;
  }

  private planCommand(data: string, escape: boolean): boolean {
    const session = this.host.planner();
    if (data === "x" || (escape && session?.busy)) {
      if (session?.busy) {
        session.cancel();
        this.say("stopping the planner…");
      }
      return true;
    }
    if (data === "r") {
      if (session && !session.busy && session.messages.at(-1)?.role === "you") void session.retry();
      else this.say("nothing to retry", "warning");
      return true;
    }
    if (data === "s") {
      try {
        const saved = session?.save();
        this.say(saved ? `saved ${saved.id} — start it from Tasks (2) when you are ready` : "nothing to save yet", saved ? "info" : "warning");
      } catch (error) {
        this.say((error as Error).message, "warning");
      }
      this.refreshData(true);
      return true;
    }
    if (data === "n") {
      const unsaved = session && session.messages.length > 0 && !session.saved;
      if (unsaved && this.armed !== "new-plan") {
        this.armed = "new-plan";
        this.say("this plan is not saved — press n again to start over anyway", "warning");
        return true;
      }
      this.armed = undefined;
      session?.cancel();
      this.host.newPlanner();
      this.planOffset = 0;
      this.setMode("type");
      return true;
    }
    return false;
  }

  private issuesCommand(data: string, enter: boolean, escape: boolean): boolean {
    const issue = this.host.issues.issues[this.issueSelected];
    if (enter) {
      this.issueFocus = this.issueFocus === "list" ? "detail" : "list";
      void this.loadIssueDetail();
      return true;
    }
    if (escape) return (this.issueFocus = "list"), true;
    if (data === "r") {
      this.host.issues.details.clear();
      void this.host.issues.refresh().then(() => this.loadIssueDetail());
      return true;
    }
    if (data === "n") {
      this.issueDraft = true;
      this.setMode("type");
      return true;
    }
    if (data === "p" && issue) {
      void this.planIssue(issue.number);
      return true;
    }
    return false;
  }

  /* -------------------------------------------------------------- submit */

  private submit(text: string): void {
    const body = text.trim();
    if (!body) return;
    this.editor.addToHistory(body);
    switch (this.tab) {
      case "lobby": {
        const notice = this.host.toOracle(body);
        if (notice) this.say(notice);
        this.chatOffset = 0;
        return;
      }
      case "tasks":
        if (!this.commentTarget) {
          this.editor.setText(body);
          return this.say("press c on a task to comment on its plan", "warning");
        }
        this.say(this.host.comment(this.commentTarget, body));
        this.commentTarget = undefined;
        this.setMode("browse");
        this.refreshData(true);
        return;
      case "plan": {
        const session = this.host.planner() ?? this.host.newPlanner();
        if (session.busy) {
          this.editor.setText(body);
          return this.say("the planner is still thinking — x stops it", "warning");
        }
        this.planOffset = 0;
        session.send(body).catch((error: Error) => this.say(error.message, "warning"));
        return;
      }
      case "quickfix": {
        const job = this.host.quickfix.submit(body);
        this.fixSelected = 0;
        this.fixDetailOffset = 0;
        this.say(this.host.quickfix.running?.id === job.id ? `${job.id} started` : `${job.id} queued behind the running quick fix`);
        return;
      }
      case "issues":
        if (!this.issueDraft) {
          this.editor.setText(body);
          return this.say("press n to file a new issue", "warning");
        }
        this.issueDraft = false;
        this.setMode("browse");
        this.say("filing the issue…");
        void this.host.issues.create(body);
        return;
      case "metrics":
        return;
    }
  }

  /* -------------------------------------------------------------- render */

  private taskRowList(tasks: readonly Task[]): TaskRow[] {
    return taskRows(tasks, this.data.plans, this.host.sessionId(), this.now());
  }

  private tabBar(width: number, theme: LobbyTheme): string {
    const zen = this.host.zen();
    const badges: Partial<Record<TabId, string>> = {};
    const active = this.data.tasks.filter((task) => !TERMINAL_STATES.includes(task.state)).length;
    if (active > 0) badges.tasks = String(active);
    if (this.host.planner()?.busy) badges.plan = spinner(this.tick);
    if (this.host.quickfix.running) badges.quickfix = spinner(this.tick);
    if (this.host.issues.issues.length > 0) badges.issues = String(this.host.issues.issues.length);
    const tabs = TAB_IDS.map((tab, index) => {
      const label = `${index + 1} ${TAB_LABELS[tab]}${badges[tab] ? ` ${badges[tab]}` : ""}`;
      if (tab !== this.tab) return paint(theme, "muted", ` ${label} `);
      const text = bold(theme, paint(theme, "accent", ` ${label} `));
      return theme.bg ? theme.bg("selectedBg", text) : `[${text}]`;
    });
    const brand = bold(theme, paint(theme, "accent", " ◆ bot-lobby "));
    const left = `${brand}${paint(theme, "borderMuted", "│")}${tabs.join("")}`;
    const room = width - visibleWidth(left) - 1;
    const dot = paint(theme, this.host.masterBusy() ? "accent" : "dim", this.host.masterBusy() ? spinner(this.tick) : "●");
    const state = zen.task ? paint(theme, "muted", zen.task.paused ? `${zen.task.state} (paused)` : zen.task.state) : "";
    // Long task ids give way to the state, then to the dot alone.
    const choices = zen.task
      ? [`${dot} ${zen.task.id} ${state} `, `${dot} ${state} `, `${dot} `]
      : [paint(theme, "dim", "no task in this session "), ""];
    const status = choices.find((choice) => visibleWidth(choice) <= room) ?? "";
    const gap = width - visibleWidth(left) - visibleWidth(status);
    return gap >= 1 ? `${left}${" ".repeat(gap)}${status}` : fit(left, width);
  }

  private promptLabel(): string {
    const zen = this.host.zen();
    const browsing = this.mode === "browse";
    switch (this.tab) {
      case "lobby":
        if (!zen.task) return browsing ? "describe a task to start — i to type" : "describe a task to start · enter starts it";
        return browsing ? "message the oracle — i to type" : this.host.masterBusy() ? "message the oracle · enter steers the running turn" : "message the oracle";
      case "tasks":
        return this.commentTarget ? `comment on ${this.commentTarget}'s plan · enter sends it to the oracle` : "c comments on the selected task's plan";
      case "plan": {
        const session = this.host.planner();
        if (session?.busy) return "the planner is thinking · x stops it";
        return session && session.messages.length > 0 ? "answer the planner" : "describe the task you want to plan";
      }
      case "quickfix":
        return this.host.quickfix.running ? "describe a quick change · queues behind the running one" : "describe a quick change · runs now, beside any task";
      case "issues":
        return this.issueDraft ? "new issue · first line is the title" : "n files a new issue";
      case "metrics":
        return "";
    }
  }

  private promptLines(width: number, theme: LobbyTheme): string[] {
    if (this.tab === "metrics") return [];
    this.editor.label = this.promptLabel();
    this.editor.paintLabel = (text) => paint(theme, this.mode === "type" ? "accent" : "dim", text);
    this.editor.borderColor = (text) => paint(theme, this.mode === "type" ? "border" : "borderMuted", text);
    const lines = this.editor.render(width);
    // The editor always draws its block cursor; while browsing it would suggest the prompt has focus.
    return this.mode === "type" ? lines : lines.map((line) => line.replace(REVERSE_VIDEO, "$1"));
  }

  private hints(): string {
    if (this.mode === "type") {
      const esc = this.tab === "lobby" && this.host.masterBusy() ? "esc stops the oracle" : "esc browse";
      return `enter send · shift+enter newline · ${esc} · tab next tab · alt+l hide lobby`;
    }
    const common = "tab next · alt+l hide";
    switch (this.tab) {
      case "lobby":
        return `type to talk · ↑↓ scroll · c comment on the plan · ${this.host.masterBusy() ? "esc stop the oracle · " : ""}${common}`;
      case "tasks":
        return `↑↓ select · enter detail · c comment · s start plan · d discard plan · r refresh · ${common}`;
      case "plan":
        return `type to answer · s save as pending task · n new plan · x stop · r retry · ↑↓ scroll · ${common}`;
      case "quickfix":
        return `type a change · ↑↓ select · enter detail · x cancel · ${common}`;
      case "issues":
        return `↑↓ select · enter read · p plan it · n new issue · r refresh · ${common}`;
      case "metrics":
        return `↑↓ select · g group by agent · s sort · r refresh · ${common}`;
    }
  }

  private hintLine(width: number, theme: LobbyTheme): string {
    const notice = this.notice && this.now() - this.notice.at < NOTICE_MS ? this.notice : undefined;
    if (notice) return fit(paint(theme, notice.kind === "warning" ? "warning" : "accent", ` ${notice.text}`), width);
    const mode = this.mode === "type" ? paint(theme, "accent", " TYPE ") : paint(theme, "muted", " BROWSE ");
    return fit(`${mode}${paint(theme, "dim", ` ${this.hints()}`)}`, width);
  }

  private body(width: number, height: number, theme: LobbyTheme): string[] {
    const now = this.now();
    switch (this.tab) {
      case "lobby":
        return this.homeBody(width, height, theme, now);
      case "tasks":
        return this.tasksBody(width, height, theme, now);
      case "plan": {
        const session = this.host.planner();
        return renderPlan({
          ...(session ? { session: { messages: session.messages, ...(session.reply ? { reply: session.reply } : {}), busy: session.busy, ...(session.step ? { step: session.step } : {}), ...(session.error ? { error: session.error } : {}), turns: session.turns, ...(session.seed ? { seed: session.seed } : {}), ...(session.saved ? { saved: session.saved } : {}), ...(session.title ? { title: session.title } : {}) } } : {}),
          profile: this.host.profileLabel("planner"),
          offset: this.planOffset,
          tick: this.tick,
        }, width, height, theme);
      }
      case "quickfix":
        this.fixSelected = Math.min(this.fixSelected, Math.max(0, this.host.quickfix.jobs.length - 1));
        return renderQuickFix({ jobs: this.host.quickfix.jobs, selected: this.fixSelected, focus: this.fixFocus, detailOffset: this.fixDetailOffset, profile: this.host.profileLabel("quickfix"), tick: this.tick, now }, width, height, theme);
      case "issues": {
        const issues = this.host.issues;
        this.issueSelected = Math.min(this.issueSelected, Math.max(0, issues.issues.length - 1));
        const selected = issues.issues[this.issueSelected];
        const detail = selected ? issues.details.get(selected.number) : undefined;
        return renderIssues({
          issues: issues.issues, selected: this.issueSelected, ...(detail ? { detail } : {}), focus: this.issueFocus, detailOffset: this.issueDetailOffset,
          loading: issues.loading, loaded: issues.loaded, ...(issues.error ? { error: issues.error } : {}), ...(issues.notice ? { notice: issues.notice } : {}), tick: this.tick, now,
        }, width, height, theme);
      }
      case "metrics": {
        const records = collectMetrics(this.data.metrics, this.data.tasks);
        const groups = sortGroups(aggregateMetrics(records, this.metricsBy), this.metricsSort);
        this.metricsSelected = Math.min(this.metricsSelected, Math.max(0, groups.length - 1));
        const taskTimes = taskTimesByModel(this.data.tasks, records);
        return renderMetrics({ groups, taskTimes, records, stats: taskStats(this.data.tasks), by: this.metricsBy, sort: this.metricsSort, selected: this.metricsSelected }, width, height, theme);
      }
    }
  }

  private homeBody(width: number, height: number, theme: LobbyTheme, now: number): string[] {
    const zen = this.host.zen();
    const feed = this.host.feed;
    const sessionId = this.host.sessionId();
    const others = this.data.tasks.filter((task) => !TERMINAL_STATES.includes(task.state) && task.ownerSessionId !== sessionId).length;
    return renderHome({
      ...(zen.task ? { task: zen.task, scene: (w: number, h: number) => this.host.scene(w, h) } : {}),
      chat: feed.chat,
      ...(feed.reply ? { liveReply: feed.reply } : {}),
      activity: feed.activity,
      thoughts: feed.thoughts,
      busy: this.host.masterBusy(),
      others,
      pending: this.data.plans.filter((plan) => plan.status === "pending").length,
      chatOffset: this.chatOffset,
      tick: this.tick,
      now,
    }, width, height, theme);
  }

  private tasksBody(width: number, height: number, theme: LobbyTheme, now: number): string[] {
    const rows = this.taskRowList(this.data.tasks);
    this.tasksSelected = Math.min(this.tasksSelected, Math.max(0, rows.length - 1));
    const row = rows[this.tasksSelected];
    const detailWidth = width >= 90 ? Math.max(24, width - Math.round((width - 3) * 0.38) - 3) : width;
    let detail: string[] = [];
    if (row?.kind === "task") {
      const task = this.data.tasks.find((entry) => entry.id === row.id);
      if (task) detail = taskDetailLines(task, this.data.comments.get(task.id) ?? [], this.host.sessionId(), detailWidth, now, theme);
    } else if (row?.kind === "plan") {
      const plan = this.data.plans.find((entry) => entry.id === row.id);
      if (plan) detail = planDetailLines(plan, detailWidth, now, theme);
    }
    return renderTasks({ rows, selected: this.tasksSelected, detail, focus: this.tasksFocus, detailOffset: this.tasksDetailOffset }, width, height, theme);
  }

  render(width: number): string[] {
    const theme = this.host.theme();
    const rows = Math.max(1, this.host.rows());
    const top = [this.tabBar(width, theme), paint(theme, "borderMuted", "─".repeat(Math.max(0, width)))];
    const prompt = this.promptLines(width, theme);
    const hint = this.hintLine(width, theme);
    const bodyHeight = Math.max(0, rows - top.length - prompt.length - 1);
    const body = this.body(width, bodyHeight, theme);
    return [...top, ...body, ...prompt, hint].slice(0, rows).map((line) => fit(line, width));
  }

  invalidate(): void {
    this.editor.invalidate();
  }
}
