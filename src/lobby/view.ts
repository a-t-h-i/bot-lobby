/**
 * The lobby: a full-screen, tabbed view over everything bot-lobby does. A tab
 * bar on top, the active tab's body, a search bar while one is in force, a
 * prompt at the bottom whose target follows the tab (the oracle, a plan
 * comment, the planner, a comment on one draft line, a quick fix) and a
 * key-hint line. Two modes, like a modal editor: typing mode sends keys to the
 * prompt; browsing mode (esc) moves through lists and runs the tab's
 * single-key commands. The shortcuts in `keys.ts` (hide, help, search, tabs,
 * pane toggles, paging) work in both. Everything bot-lobby-specific arrives
 * through `LobbyHost`, so the view renders and reacts the same in tests.
 */
import { decodeKittyPrintable, Editor, Input, Key, matchesKey, visibleWidth, type Component, type EditorTheme, type Focusable, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import type { AgentRun } from "../schemas/findings.ts";
import type { PlannedTask } from "../state/backlog.ts";
import type { PlanComment } from "../state/comments.ts";
import { aggregateMetrics, collectMetrics, SORT_KEYS, sortGroups, taskStats, taskTimesByModel, type GroupBy, type MetricRecord, type SortKey } from "../state/metrics.ts";
import { PANEL_MEMBERS, type LobbyAgentKind, type LobbyPanel, type PanelMember } from "../schemas/configuration.ts";
import type { ChatEntry, LobbyFeed } from "./feed.ts";
import type { BackgroundSession } from "./sessions.ts";
import type { QuickFixQueue } from "./quickfix.ts";
import { MEMBER_LABELS, ORACLE_LABEL, type PlannerSeed, type PlanningSession } from "./planner.ts";
import { issueText, type IssuesState } from "./issues.ts";
import { actionFor, keyLabel, keyMap, LOBBY_ACTIONS, type KeyMap, type LobbyAction } from "./keys.ts";
import { beside, bold, box, fit, highlight, paint, selectRow, spinner, wrap, wrapHanging, type LobbyTheme, type PaneLayout } from "./layout.ts";
import { HOME_PANES, renderHome, type HomePane } from "./tabs/home.ts";
import { filterRows, planDetailLines, renderTasks, taskDetailLines, taskRows, tasksWidths, type TaskRow } from "./tabs/tasks.ts";
import { renderPlan, type PlanLayout, type PlanView, type SeatView } from "./tabs/plan.ts";
import { filterJobs, newestFirst, renderQuickFix } from "./tabs/quickfix.ts";
import { renderIssues } from "./tabs/issues.ts";
import { filterRecords, renderMetrics } from "./tabs/metrics.ts";

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

/** The tabs on show: Issues only while `lobby.issues` switches it on. */
export function visibleTabs(issues: boolean): TabId[] {
  return TAB_IDS.filter((tab) => issues || tab !== "issues");
}

/** Tabs where the prompt is the point: they open in typing mode and typing in browsing mode resumes it. */
const PROMPT_FIRST: ReadonlySet<TabId> = new Set(["lobby", "plan", "quickfix"]);

export type LobbyMode = "type" | "browse";

/** What each pane toggle is called in notices and help. */
const PANEL_NAMES: Record<LobbyPanel, string> = { animations: "oracle and agent animations", conversation: "conversation", activity: "activity log", thinking: "thinking" };
const PANEL_ACTIONS: Record<LobbyPanel, LobbyAction> = { animations: "toggleScene", conversation: "toggleConversation", activity: "toggleActivity", thinking: "toggleThinking" };

/** Which session the Lobby tab shows and talks to: this window, one it started in the background, or one in another terminal. */
export type SessionView = { kind: "here" } | { kind: "background"; key: string } | { kind: "other"; taskId: string };

/** One row of the session switcher. */
export interface SessionEntry {
  view: SessionView;
  name: string;
  where: "this window" | "background" | "other terminal";
  task?: Task;
  /** What it is doing: working, idle, starting, ended, or its task's state. */
  status: string;
  auto: boolean;
  /** Questions it waits on you for. */
  waiting: number;
}

/** Everything the view needs from pi and bot-lobby. */
export interface LobbyHost {
  rows(): number;
  theme(): LobbyTheme;
  sessionId(): string | undefined;
  /** This session's active task and its runs, as the zen widget sees them. */
  zen(): { task?: Task; runs: readonly AgentRun[] };
  /** Draw the zen scene into at most `height` lines: animated, or only the task's status when `animated` is false. */
  scene(width: number, height: number, animated: boolean): string[];
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
  /** Start a planning session (replacing any other) with these seats on the panel. */
  newPlanner(seed?: PlannerSeed, seats?: readonly PanelMember[]): PlanningSession;
  /** The oracle puts the panel's open questions to the user, one questionnaire at a time; returns a notice. */
  answerPanel(): Promise<string>;
  /** The seats a new session starts with, from settings. */
  defaultPanel(): readonly PanelMember[];
  /** `model · thinking` a panel seat runs on. */
  seatLabel(member: PanelMember): string;
  issues: IssuesState;
  /** The Issues tab is switched on (`lobby.issues`). */
  issuesEnabled(): boolean;
  /** Which panes show (`lobby.panels`), and remembering a change. */
  panels(): Record<LobbyPanel, boolean>;
  savePanels(panels: Record<LobbyPanel, boolean>): void;
  /** Key overrides from the config (`lobby.keys`). */
  keys(): Readonly<Record<string, string>>;
  /** Open bot-lobby's settings (or one agent's entry); the lobby steps aside and rereads the config after. */
  openSettings(entry?: "quickfix" | "planner"): Promise<void>;
  /** This window's pi session name, when it has one. */
  sessionName(): string | undefined;
  /** Background sessions this window started, oldest first. */
  sessions(): readonly BackgroundSession[];
  /** Start a task in a new background session, named after the task; the session, or why not. */
  startSession(start: { request?: string; plan?: PlannedTask; auto?: boolean }): BackgroundSession | string;
  /** Put the oldest question a background session waits on to the user in this window. */
  answerDialog(session: BackgroundSession): Promise<void>;
  /** Auto mode for any task, whichever session drives it. */
  isAuto(taskId: string): boolean;
  setAuto(taskId: string, on: boolean): void;
  /** Leave a message for the oracle of a task another terminal's session drives; returns a notice. */
  sendToTask(taskId: string, text: string): string;
  /** Another session's conversation, read from its saved session file. */
  sessionChat(sessionId: string): ChatEntry[];
  /** A task's status without animations, for a session other than this window's. */
  taskScene(task: Task, width: number, height: number): string[];
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
/** Lines one wheel notch scrolls. */
const WHEEL_LINES = 3;

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

/** A key and what it does, for the help screen. */
interface KeyHelp {
  key: string;
  text: string;
}

function isPrintable(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  return data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) !== 127 ? data : undefined;
}

/** A mouse report in SGR encoding (`ESC [ < b ; x ; y M` or `m`), zero-based cells. */
export interface MouseReport {
  kind: "press" | "release" | "wheel";
  button: number;
  x: number;
  y: number;
  /** Wheel direction: -1 up, 1 down. */
  delta: number;
}

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

/** Parse an SGR mouse report, the form terminals send once the lobby turns mouse reporting on. */
export function parseMouse(data: string): MouseReport | undefined {
  const match = SGR_MOUSE.exec(data);
  if (!match) return undefined;
  const code = Number(match[1]);
  const x = Number(match[2]) - 1;
  const y = Number(match[3]) - 1;
  if (code & 64) return { kind: "wheel", button: code, x, y, delta: (code & 1) === 1 ? 1 : -1 };
  return { kind: match[4] === "M" ? "press" : "release", button: code & 3, x, y, delta: 0 };
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export class LobbyView implements Component, Focusable {
  tab: TabId = "lobby";
  mode: LobbyMode = "type";
  private readonly host: LobbyHost;
  private readonly editor: LobbyEditor;
  private readonly search: Input;
  private focusedState = false;
  private tick = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private notice: Notice | undefined;
  private readonly drafts: Partial<Record<TabId, string>> = {};
  /** Double-press confirmations, such as discarding a plan. */
  private armed: string | undefined;
  /** The keys, the panes on show and whether Issues is on, read once from the config. */
  private keys: KeyMap;
  private panels: Record<LobbyPanel, boolean>;
  private issuesOn: boolean;
  /** The help screen covers the body. */
  help = false;
  /** The session switcher covers the body. */
  picking = false;
  private pickIndex = 0;
  /** The session the Lobby tab shows and talks to. */
  viewing: SessionView = { kind: "here" };
  /** The Lobby prompt starts a task in a new session instead of talking to an oracle. */
  newSession = false;
  /** The search bar has the keys. */
  searching = false;
  /** Each tab's search, kept while you move between tabs. */
  private readonly queries: Partial<Record<TabId, string>> = {};
  /** Where the body starts and where each tab's label sits in the tab bar, for clicks. */
  private bodyTop = 1;
  private promptTop = Number.POSITIVE_INFINITY;
  private tabSpans: Array<{ tab: TabId; from: number; to: number }> = [];

  /** Each Lobby pane's scroll, in lines back from its newest, and the pane the keys scroll. */
  private readonly homeOffsets: Record<HomePane, number> = { conversation: 0, activity: 0, thinking: 0 };
  homeFocus: HomePane = "conversation";
  /** How many lines each pane held last frame, so a pane scrolled back stays on what you are reading as lines arrive. */
  private readonly seenTotals = new Map<string, number>();
  /** Where the current tab's scrollable panes landed in the last frame. */
  private readonly panes: PaneLayout = new Map();
  private tasksSelected = 0;
  private tasksFocus: "list" | "detail" = "list";
  private tasksDetailOffset = 0;
  private commentTarget: string | undefined;
  private planOffset = 0;
  private planFocus: "talk" | "draft" = "talk";
  private planDraftOffset = 0;
  /** The draft line the cursor is on, and the one a comment is being written for. */
  planCursor = 0;
  private lineTarget: string | undefined;
  private readonly planLayout: PlanLayout = { draftTop: 0, draftLeft: 0, draftWidth: 0, draftRows: 0, draftStart: 0, draftText: [] };
  /** Seats for the next planning session, until one exists. */
  private seats: Set<PanelMember> | undefined;
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
    this.search = new Input({ prompt: "", placeholder: "type to search this tab" });
    this.keys = keyMap(host.keys());
    this.panels = { ...host.panels() };
    this.issuesOn = host.issuesEnabled();
  }

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.syncFocus();
  }

  private syncFocus(): void {
    this.editor.focused = this.focusedState && this.mode === "type" && !this.searching;
    this.search.focused = this.focusedState && this.searching;
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
      || this.host.sessions().some((session) => session.busy)
      || (this.issuesOn && this.host.issues.loading)
      || zen.runs.some((run) => run.status === "running")
      || Boolean(zen.task && !zen.task.paused && !TERMINAL_STATES.includes(zen.task.state));
  }

  /** One clock step: advance the scene, reread data when due, repaint. */
  private step(): void {
    if (!this.running) return;
    const now = this.now();
    this.tick += 1;
    let delay = this.isLive() ? LIVE_MS : IDLE_MS;
    if (this.tab === "lobby" && this.panels.animations && this.host.zen().task) delay = Math.min(delay, this.host.advanceScene(now));
    this.refreshData(false);
    this.host.requestRender();
    this.schedule(delay);
  }

  /** Reread tasks, plans, comments and metrics from disk (throttled unless forced). */
  refreshData(force: boolean): void {
    const now = this.now();
    if (!force && now - this.data.at < DATA_REFRESH_MS) return;
    this.data = {
      tasks: this.host.tasks(),
      plans: this.host.plans(),
      comments: new Map(),
      metrics: this.tab === "metrics" ? this.host.metrics() : this.data.metrics,
      at: now,
    };
    if (this.tab === "tasks") {
      const row = this.taskRowList()[this.tasksSelected];
      if (row?.kind === "task") this.data.comments.set(row.id, this.host.comments(row.id));
    }
  }

  private say(text: string, kind: Notice["kind"] = "info"): void {
    this.notice = { text, at: this.now(), kind };
  }

  /** The search in force on this tab. */
  query(): string | undefined {
    return this.queries[this.tab]?.trim() || undefined;
  }

  /* ---------------------------------------------------------------- tabs */

  tabs(): TabId[] {
    return visibleTabs(this.issuesOn);
  }

  setTab(tab: TabId): void {
    if (tab === this.tab) return;
    if (!this.tabs().includes(tab)) return this.say(`the ${TAB_LABELS[tab]} tab is off — set lobby.${tab} to true in the config to bring it back`, "warning");
    this.drafts[this.tab] = this.editor.getText();
    this.tab = tab;
    this.editor.setText(this.drafts[tab] ?? "");
    this.commentTarget = undefined;
    this.lineTarget = undefined;
    this.issueDraft = false;
    this.armed = undefined;
    this.help = false;
    this.picking = false;
    this.newSession = false;
    this.closeSearch();
    this.setMode(PROMPT_FIRST.has(tab) ? "type" : "browse");
    this.refreshData(true);
    if (tab === "issues" && !this.host.issues.loaded && !this.host.issues.loading) void this.host.issues.refresh().then(() => this.loadIssueDetail());
    this.host.requestRender();
  }

  private cycleTab(direction: 1 | -1): void {
    const tabs = this.tabs();
    const index = Math.max(0, tabs.indexOf(this.tab));
    this.setTab(tabs[(index + direction + tabs.length) % tabs.length]!);
  }

  private setMode(mode: LobbyMode): void {
    this.mode = this.tab === "metrics" ? "browse" : mode;
    this.syncFocus();
  }

  /** Open the prompt for a comment on `taskId`'s plan (from any tab). */
  commentOn(taskId: string): void {
    this.setTab("tasks");
    delete this.queries.tasks;
    const rows = this.taskRowList();
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
    const session = this.host.newPlanner({ issue: { number: detail.number, title: detail.title, ...(detail.url ? { url: detail.url } : {}) }, body: issueText(detail) }, [...this.seatSet()]);
    this.resetPlanScroll();
    this.setTab("plan");
    void session.open();
  }

  /** Show or hide one pane and remember it in the config. */
  togglePanel(panel: LobbyPanel): void {
    const shown = !this.panels[panel];
    this.panels = { ...this.panels, [panel]: shown };
    this.host.savePanels(this.panels);
    const key = keyLabel(this.keys[PANEL_ACTIONS[panel]]);
    const where = this.tab === "lobby" ? "" : " on the Lobby tab";
    this.say(`${PANEL_NAMES[panel]} ${shown ? "shown" : "hidden"}${where} · ${key} ${shown ? "hides" : "shows"} it`);
  }

  panelShown(panel: LobbyPanel): boolean {
    return this.panels[panel];
  }

  /** Reread keys, panes and the Issues switch, after the settings changed them. */
  reloadConfig(): void {
    this.keys = keyMap(this.host.keys());
    this.panels = { ...this.host.panels() };
    this.issuesOn = this.host.issuesEnabled();
    if (!this.tabs().includes(this.tab)) this.setTab("lobby");
  }

  private openSettings(entry?: "quickfix" | "planner"): void {
    void this.host.openSettings(entry).then(() => this.host.requestRender());
  }

  /* -------------------------------------------------------------- search */

  private openSearch(): void {
    this.help = false;
    this.searching = true;
    this.search.setValue(this.queries[this.tab] ?? "");
    this.syncFocus();
  }

  /** Close the search bar; the query stays in force unless `clear`. */
  private closeSearch(clear = false): void {
    if (clear) delete this.queries[this.tab];
    this.searching = false;
    this.syncFocus();
  }

  private searchKey(data: string): void {
    if (matchesKey(data, Key.escape)) {
      const had = Boolean(this.query());
      this.closeSearch(true);
      if (had) this.say("search cleared");
      return;
    }
    if (matchesKey(data, Key.enter)) {
      if (!this.query()) delete this.queries[this.tab];
      return this.closeSearch();
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      // Keep the query, let the arrows move through what it found.
      this.closeSearch();
      return this.scroll(matchesKey(data, Key.up) ? -1 : 1);
    }
    this.search.handleInput(data);
    const value = this.search.getValue();
    if (value) this.queries[this.tab] = value;
    else delete this.queries[this.tab];
    this.resetSelections();
  }

  /** A new search starts every list at its top. */
  private resetSelections(): void {
    for (const pane of HOME_PANES) this.homeOffsets[pane] = 0;
    this.planOffset = 0;
    switch (this.tab) {
      case "tasks":
        this.tasksSelected = 0;
        this.tasksDetailOffset = 0;
        return;
      case "quickfix":
        this.fixSelected = 0;
        this.fixDetailOffset = 0;
        return;
      case "metrics":
        this.metricsSelected = 0;
        return;
      default:
        return;
    }
  }

  /* --------------------------------------------------------------- input */

  handleInput(data: string): void {
    this.handleKey(data);
    this.host.requestRender();
  }

  private handleKey(data: string): void {
    const mouse = parseMouse(data);
    if (mouse) return this.mouseReport(mouse);
    const action = actionFor(data, this.keys);
    if (this.help) {
      this.help = false;
      // Esc, ?, q and the help key only close it; anything else also does its job.
      if (action === "help" || matchesKey(data, Key.escape) || data === "?" || data === "q" || matchesKey(data, Key.enter)) return;
    }
    // The session switcher takes the keys while it is open (shortcuts other than its own still work).
    if (this.picking && (!action || action === "sessions" || action === "newSession") && this.pickerKey(data, action)) return;
    // While searching, the shortcuts still work; everything else edits the query.
    if (this.searching) return action ? this.runAction(action) : this.searchKey(data);
    if (action) return this.runAction(action);
    const tabs = this.tabs();
    for (const [index, tab] of tabs.entries()) {
      if (matchesKey(data, Key.alt(String(index + 1) as "1"))) return this.setTab(tab);
    }
    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.editor.getText()) return this.editor.setText("");
      return this.host.hide();
    }
    if (this.mode === "type") return this.typeKey(data);
    return this.browseKey(data);
  }

  private runAction(action: LobbyAction): void {
    switch (action) {
      case "hide":
        return this.host.hide();
      case "help":
        this.help = !this.help;
        return;
      case "settings":
        return this.openSettings();
      case "savePlan":
        return this.savePlan();
      case "sessions":
        return this.picking ? void (this.picking = false) : this.openPicker();
      case "newSession":
        return this.startNewSessionPrompt();
      case "toggleAuto":
        return this.toggleAuto();
      case "search":
        return this.searching ? this.closeSearch() : this.openSearch();
      case "nextTab":
        return this.cycleTab(1);
      case "prevTab":
        return this.cycleTab(-1);
      case "toggleScene":
        return this.togglePanel("animations");
      case "toggleConversation":
        return this.togglePanel("conversation");
      case "toggleActivity":
        return this.togglePanel("activity");
      case "toggleThinking":
        return this.togglePanel("thinking");
      case "scrollUp":
        return this.scroll(-this.pageSize());
      case "scrollDown":
        return this.scroll(this.pageSize());
    }
  }

  private typeKey(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.tab === "lobby" && this.host.masterBusy() && !this.editor.getText().trim()) {
        this.host.abortMaster();
        return this.say("stopping the oracle…");
      }
      this.commentTarget = undefined;
      this.issueDraft = false;
      this.newSession = false;
      if (this.lineTarget) {
        this.lineTarget = undefined;
        this.planFocus = "draft";
      }
      return this.setMode("browse");
    }
    this.editor.handleInput(data);
  }

  private browseKey(data: string): void {
    if (matchesKey(data, Key.escape) && this.query()) {
      delete this.queries[this.tab];
      return this.say("search cleared");
    }
    if (data === "/") return this.openSearch();
    if (data === "?") {
      this.help = true;
      return;
    }
    if (matchesKey(data, Key.up) || (!PROMPT_FIRST.has(this.tab) && data === "k")) return this.scroll(-1);
    if (matchesKey(data, Key.down) || (!PROMPT_FIRST.has(this.tab) && data === "j")) return this.scroll(1);
    if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) return this.movePaneFocus(matchesKey(data, Key.left) ? -1 : 1);
    if (matchesKey(data, Key.home) || matchesKey(data, Key.end)) return this.scrollToEdge(matchesKey(data, Key.home));
    const tabs = this.tabs();
    if (!PROMPT_FIRST.has(this.tab) && /^[1-9]$/.test(data) && Number(data) <= tabs.length) return this.setTab(tabs[Number(data) - 1]!);
    if (data === "i" && this.tab !== "metrics" && this.tab !== "tasks" && this.tab !== "issues") return this.setMode("type");
    if (this.tabCommand(data)) return;
    const printable = isPrintable(data);
    if (printable && PROMPT_FIRST.has(this.tab)) {
      this.setMode("type");
      this.editor.handleInput(data);
    }
  }

  /** The pane the keys scroll on this tab. */
  private focusedPane(): string {
    switch (this.tab) {
      case "lobby":
        return this.homePane();
      case "plan":
        return this.planFocus;
      case "tasks":
        return this.tasksFocus;
      case "quickfix":
        return this.fixFocus;
      case "issues":
        return this.issueFocus;
      case "metrics":
        return "table";
    }
  }

  /** The focused Lobby pane, or the first one showing when it is hidden. */
  private homePane(): HomePane {
    const shown = this.shownHomePanes();
    if (!shown.includes(this.homeFocus) && shown.length > 0) this.homeFocus = shown[0]!;
    return this.homeFocus;
  }

  private shownHomePanes(): HomePane[] {
    const drawn = HOME_PANES.filter((pane) => this.tab === "lobby" && this.panes.has(pane));
    return drawn.length > 0 ? drawn : HOME_PANES.filter((pane) => this.panels[pane]);
  }

  /** A page of the focused pane: its rows less one, so a line of context carries over. */
  private pageSize(): number {
    const pane = this.panes.get(this.focusedPane());
    return pane && pane.rows > 2 ? pane.rows - 1 : 10;
  }

  /** ← → move between the tab's panes. */
  private movePaneFocus(direction: -1 | 1): void {
    switch (this.tab) {
      case "lobby": {
        const shown = this.shownHomePanes();
        if (shown.length === 0) return;
        const index = Math.max(0, shown.indexOf(this.homePane()));
        this.homeFocus = shown[(index + direction + shown.length) % shown.length]!;
        return;
      }
      case "plan":
        this.planFocus = direction < 0 ? "talk" : "draft";
        if (this.planFocus === "draft") this.cursorToView();
        return;
      case "tasks":
        this.tasksFocus = direction < 0 ? "list" : "detail";
        return;
      case "quickfix":
        this.fixFocus = direction < 0 ? "list" : "detail";
        return;
      case "issues":
        this.issueFocus = direction < 0 ? "list" : "detail";
        return;
      case "metrics":
        return;
    }
  }

  /** Arrow keys (±1) and page keys (± a page): scroll or select in the tab's focused pane. */
  private scroll(delta: number): void {
    switch (this.tab) {
      case "lobby":
        return this.scrollPane(this.homePane(), delta);
      case "plan":
        return this.scrollPane(this.planFocus, delta);
      case "tasks":
        // Page keys always page the detail; the arrows follow the focus.
        return this.scrollPane(Math.abs(delta) > 1 ? "detail" : this.tasksFocus, delta);
      case "quickfix":
        return this.scrollPane(Math.abs(delta) > 1 ? "detail" : this.fixFocus, delta);
      case "issues":
        if (this.issueFocus === "detail" || Math.abs(delta) > 1) this.issueDetailOffset = Math.max(0, this.issueDetailOffset + delta);
        else {
          this.issueSelected = Math.max(0, Math.min(this.host.issues.issues.length - 1, this.issueSelected + delta));
          this.issueDetailOffset = 0;
          void this.loadIssueDetail();
        }
        return;
      case "metrics":
        return this.scrollPane("table", delta);
    }
  }

  /**
   * Scroll one pane of the current tab by `delta` lines, positive toward its
   * end. Lists move their selection instead; the draft moves its cursor (the
   * wheel scrolls it and the cursor follows only when it would leave the screen).
   */
  private scrollPane(pane: string, delta: number, wheel = false): void {
    if (delta === 0) return;
    switch (pane) {
      case "conversation":
      case "activity":
      case "thinking":
        this.homeOffsets[pane] = Math.max(0, this.homeOffsets[pane] - delta);
        break;
      case "talk":
        this.planOffset = Math.max(0, this.planOffset - delta);
        break;
      case "draft":
        if (wheel) this.wheelDraft(delta);
        else this.moveCursor(delta);
        break;
      case "list":
        if (this.tab === "tasks") this.selectTask(this.tasksSelected + Math.sign(delta));
        else if (this.tab === "quickfix") {
          this.fixSelected = Math.max(0, Math.min(this.fixJobs().length - 1, this.fixSelected + Math.sign(delta)));
          this.fixDetailOffset = 0;
        }
        break;
      case "detail":
        if (this.tab === "tasks") this.tasksDetailOffset = Math.max(0, this.tasksDetailOffset + delta);
        else if (this.tab === "quickfix") this.fixDetailOffset = Math.max(0, this.fixDetailOffset + delta);
        break;
      case "table":
        this.metricsSelected = Math.max(0, this.metricsSelected + (wheel ? Math.sign(delta) : delta));
        break;
    }
    this.clampScroll();
  }

  /** Home and End: the oldest or first line of the focused pane, or back to its newest or last. */
  private scrollToEdge(start: boolean): void {
    const pane = this.focusedPane();
    const far = start ? -1e9 : 1e9;
    if (pane === "draft") {
      const last = this.planLayout.draftText.length - 1;
      this.planCursor = start ? 0 : Math.max(0, last);
      this.moveCursor(0);
      return;
    }
    if (pane === "list" && this.tab === "tasks") return this.selectTask(start ? 0 : this.taskRowList().length - 1);
    if (pane === "list" && this.tab === "quickfix") {
      this.fixSelected = start ? 0 : Math.max(0, this.fixJobs().length - 1);
      this.fixDetailOffset = 0;
      return;
    }
    if (pane === "table") {
      this.metricsSelected = start ? 0 : Number.MAX_SAFE_INTEGER;
      return;
    }
    this.scrollPane(pane, far);
  }

  /** The wheel over the draft scrolls it; the cursor follows only when it would leave the screen. */
  private wheelDraft(delta: number): void {
    const rows = Math.max(1, this.planLayout.draftRows);
    const max = Math.max(0, this.planLayout.draftText.length - rows);
    this.planDraftOffset = Math.max(0, Math.min(max, this.planLayout.draftStart + delta));
    if (this.planCursor < this.planDraftOffset) this.planCursor = this.planDraftOffset;
    if (this.planCursor >= this.planDraftOffset + rows) this.planCursor = this.planDraftOffset + rows - 1;
  }

  /**
   * Keep every offset within what its pane holds, so scrolling back the other
   * way responds at once; a pane scrolled back from its newest line stays on
   * the lines being read as new ones arrive. True when that moved a pane.
   */
  private clampScroll(): boolean {
    let moved = false;
    const limit = (name: string, offset: number, anchored: boolean): number => {
      const pane = this.panes.get(name);
      if (!pane) return offset;
      const seen = this.seenTotals.get(name);
      this.seenTotals.set(name, pane.total);
      let next = offset;
      if (anchored && next > 0 && seen !== undefined && pane.total > seen) {
        next += pane.total - seen;
        moved = true;
      }
      return Math.min(next, Math.max(0, pane.total - pane.rows));
    };
    switch (this.tab) {
      case "lobby":
        for (const pane of HOME_PANES) this.homeOffsets[pane] = limit(pane, this.homeOffsets[pane], true);
        break;
      case "plan":
        this.planOffset = limit("talk", this.planOffset, true);
        break;
      case "tasks":
        this.tasksDetailOffset = limit("detail", this.tasksDetailOffset, false);
        break;
      case "quickfix":
        this.fixDetailOffset = limit("detail", this.fixDetailOffset, false);
        break;
      default:
        break;
    }
    return moved;
  }

  /** Move the draft cursor by `delta` lines, skipping blank ones, and keep it on screen. */
  private moveCursor(delta: number): void {
    const lines = this.planLayout.draftText;
    if (lines.length === 0) return;
    const step = Math.sign(delta) || 1;
    let target = Math.max(0, Math.min(lines.length - 1, this.planCursor + delta));
    while (target > 0 && target < lines.length - 1 && !lines[target]!.trim()) target += step;
    if (!lines[target]?.trim()) {
      // Ran into a blank edge: look back the other way for the nearest line with text.
      let back = target;
      while (back >= 0 && back < lines.length && !lines[back]!.trim()) back -= step;
      if (back >= 0 && back < lines.length) target = back;
    }
    this.planCursor = target;
    this.keepCursorVisible();
  }

  private keepCursorVisible(): void {
    const rows = Math.max(1, this.planLayout.draftRows);
    const start = Math.min(this.planDraftOffset, Math.max(0, this.planLayout.draftText.length - rows));
    if (this.planCursor < start) this.planDraftOffset = this.planCursor;
    else if (this.planCursor >= start + rows) this.planDraftOffset = this.planCursor - rows + 1;
    else this.planDraftOffset = start;
  }

  /** Put the draft cursor on the first line with text on screen. */
  private cursorToView(): void {
    const lines = this.planLayout.draftText;
    const start = this.planLayout.draftStart;
    const end = Math.min(lines.length, start + Math.max(1, this.planLayout.draftRows));
    if (this.planCursor >= start && this.planCursor < end && lines[this.planCursor]?.trim()) return;
    for (let index = start; index < end; index++) {
      if (lines[index]?.trim()) {
        this.planCursor = index;
        return;
      }
    }
    this.planCursor = start;
  }

  private selectTask(index: number): void {
    const rows = this.taskRowList();
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
      case "lobby": {
        const background = this.viewedSession();
        if (escape && background?.busy) {
          background.abort();
          this.say(`stopping ${background.name}'s oracle…`);
          return true;
        }
        if (escape && this.viewing.kind === "here" && this.host.masterBusy()) {
          this.host.abortMaster();
          this.say("stopping the oracle…");
          return true;
        }
        if (data === "c") {
          const task = this.viewedEntry().task;
          if (task && !TERMINAL_STATES.includes(task.state)) this.commentOn(task.id);
          else this.say("no task in this session to comment on", "warning");
          return true;
        }
        return enter ? (this.setMode("type"), true) : false;
      }
      case "tasks":
        return this.tasksCommand(data, enter, escape);
      case "plan":
        return this.planCommand(data, enter, escape);
      case "quickfix":
        if (enter) return (this.fixFocus = this.fixFocus === "list" ? "detail" : "list"), true;
        if (escape && this.fixFocus === "detail") return (this.fixFocus = "list"), true;
        if (data === "x") {
          const job = this.fixJobs()[this.fixSelected];
          if (job && this.host.quickfix.cancel(job.id)) this.say(`cancelling ${job.id}`);
          return true;
        }
        if (data === "m") return this.openSettings("quickfix"), true;
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
    const row = this.taskRowList()[this.tasksSelected];
    if (enter) return (this.tasksFocus = this.tasksFocus === "list" ? "detail" : "list"), true;
    if (escape) return (this.tasksFocus = "list"), true;
    if (data === "r") return this.refreshData(true), true;
    if (data === "n") return this.startNewSessionPrompt(), true;
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
    // A planned task starts in a new session of its own (s), or in this window (h).
    if (data === "s" && plan) {
      this.startInNewSession({ plan });
      return true;
    }
    if (data === "h" && plan) {
      this.say(this.host.startPlanned(plan));
      this.refreshData(true);
      return true;
    }
    const task = row.kind === "task" ? this.data.tasks.find((entry) => entry.id === row.id) : undefined;
    if (data === "o" && task) {
      const target = this.sessionEntries().find((entry) => entry.task?.id === task.id);
      if (!target) this.say(`${task.id} is not running in any session now`, "warning");
      else {
        this.view(target.view);
        this.say(target.view.kind === "here" ? "this window's task" : `showing ${target.name}`);
      }
      return true;
    }
    if (data === "x" && task) {
      const session = this.host.sessions().find((entry) => entry.alive && entry.sessionId === task.ownerSessionId);
      if (!session) return this.say("only a background session this window started can be stopped from here", "warning"), true;
      if (this.armed !== `stop:${session.key}`) {
        this.armed = `stop:${session.key}`;
        this.say(`press x again to stop ${session.name} (its task keeps its state)`, "warning");
        return true;
      }
      this.armed = undefined;
      session.stop();
      this.say(`stopping ${session.name}`);
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

  /** Seats for the next round: the session's, or the ones chosen before it started. */
  private seatSet(): Set<PanelMember> {
    const session = this.host.planner();
    if (session) return session.seats;
    this.seats ??= new Set(this.host.defaultPanel());
    return this.seats;
  }

  private resetPlanScroll(): void {
    this.planOffset = 0;
    this.planDraftOffset = 0;
    this.planCursor = 0;
  }

  /** The Lobby prompt: a new task in its own session, or a message to the session in view. */
  private submitLobby(body: string): void {
    this.homeOffsets.conversation = 0;
    if (this.newSession) {
      this.newSession = false;
      return this.startInNewSession({ request: body });
    }
    const view = this.viewing;
    if (view.kind === "background") {
      const session = this.viewedSession();
      if (!session?.alive) {
        this.editor.setText(body);
        return this.say(`${session?.name ?? "that session"} has ended — alt+n starts a new one`, "warning");
      }
      session.send(body);
      return;
    }
    if (view.kind === "other") return this.say(this.host.sendToTask(view.taskId, body));
    const notice = this.host.toOracle(body);
    if (notice) this.say(notice);
  }

  /** Put the question the background session in view waits on to the user. */
  private answerSessionDialog(): void {
    const session = this.viewedSession();
    if (!session?.dialogs.length) return;
    void this.host.answerDialog(session).then(() => this.host.requestRender());
  }

  /* ------------------------------------------------------------ sessions */

  /** Every session the lobby can show: this window, the background sessions it started, then tasks other terminals drive. */
  sessionEntries(): SessionEntry[] {
    const me = this.host.sessionId();
    const zen = this.host.zen();
    const background = this.host.sessions();
    const started = new Set(background.map((session) => session.sessionId).filter((id): id is string => Boolean(id)));
    const auto = (task: Task | undefined) => Boolean(task && !TERMINAL_STATES.includes(task.state) && this.host.isAuto(task.id));
    const entries: SessionEntry[] = [{
      view: { kind: "here" },
      name: this.host.sessionName() ?? zen.task?.title ?? "unnamed session",
      where: "this window",
      ...(zen.task ? { task: zen.task } : {}),
      status: this.host.masterBusy() ? "working" : zen.task?.state ?? "no task",
      auto: auto(zen.task),
      waiting: 0,
    }];
    for (const session of background) {
      const task = session.sessionId ? this.data.tasks.find((entry) => entry.ownerSessionId === session.sessionId) : undefined;
      const status = session.status === "exited" ? "ended" : session.status === "starting" ? "starting" : session.busy ? "working" : task?.state ?? "idle";
      entries.push({ view: { kind: "background", key: session.key }, name: session.name, where: "background", ...(task ? { task } : {}), status, auto: auto(task), waiting: session.dialogs.length });
    }
    for (const task of this.data.tasks) {
      if (TERMINAL_STATES.includes(task.state) || !task.ownerSessionId || task.ownerSessionId === me || started.has(task.ownerSessionId)) continue;
      entries.push({ view: { kind: "other", taskId: task.id }, name: task.title, where: "other terminal", task, status: task.state, auto: auto(task), waiting: 0 });
    }
    return entries;
  }

  /** The entry the Lobby tab shows, falling back to this window when that session is gone. */
  viewedEntry(): SessionEntry {
    const entries = this.sessionEntries();
    const view = this.viewing;
    const found = view.kind === "here" ? undefined : entries.find((entry) => (entry.view.kind === "background" && view.kind === "background" && entry.view.key === view.key) || (entry.view.kind === "other" && view.kind === "other" && entry.view.taskId === view.taskId));
    if (!found && view.kind !== "here") this.viewing = { kind: "here" };
    return found ?? entries[0]!;
  }

  private viewedSession(): BackgroundSession | undefined {
    const view = this.viewing;
    return view.kind === "background" ? this.host.sessions().find((session) => session.key === view.key) : undefined;
  }

  /** Show a session in the Lobby tab, and talk to it from there. */
  view(target: SessionView): void {
    this.viewing = target;
    this.picking = false;
    this.newSession = false;
    for (const pane of HOME_PANES) this.homeOffsets[pane] = 0;
    if (this.tab !== "lobby") this.setTab("lobby");
    this.setMode("type");
  }

  private openPicker(): void {
    this.help = false;
    this.picking = true;
    const entries = this.sessionEntries();
    const current = this.viewedEntry();
    this.pickIndex = Math.max(0, entries.findIndex((entry) => entry.name === current.name && entry.where === current.where));
  }

  /** Keys while the session switcher is open; true when the key was handled. */
  private pickerKey(data: string, action: LobbyAction | undefined): boolean {
    const entries = this.sessionEntries();
    this.pickIndex = Math.min(this.pickIndex, Math.max(0, entries.length - 1));
    if (matchesKey(data, Key.escape) || action === "sessions") {
      this.picking = false;
      return true;
    }
    if (matchesKey(data, Key.up) || data === "k") return (this.pickIndex = Math.max(0, this.pickIndex - 1)), true;
    if (matchesKey(data, Key.down) || data === "j") return (this.pickIndex = Math.min(entries.length - 1, this.pickIndex + 1)), true;
    const entry = entries[this.pickIndex];
    if (matchesKey(data, Key.enter) && entry) {
      this.view(entry.view);
      this.say(entry.view.kind === "here" ? "back to this window" : `showing ${entry.name} — you talk to its oracle from here`);
      return true;
    }
    if (data === "n" || action === "newSession") {
      this.picking = false;
      this.startNewSessionPrompt();
      return true;
    }
    if (data === "x" && entry?.view.kind === "background") {
      const key = entry.view.key;
      if (this.armed !== `stop:${key}`) {
        this.armed = `stop:${key}`;
        this.say(`press x again to stop ${entry.name} (its task keeps its state)`, "warning");
        return true;
      }
      this.armed = undefined;
      this.host.sessions().find((session) => session.key === key)?.stop();
      this.say(`stopping ${entry.name}`);
      return true;
    }
    return true;
  }

  /** Start typing a task that begins in its own new session. */
  startNewSessionPrompt(): void {
    this.picking = false;
    this.help = false;
    if (this.tab !== "lobby") this.setTab("lobby");
    this.newSession = true;
    this.setMode("type");
  }

  /** Start a task in a new background session and show it. */
  startInNewSession(start: { request?: string; plan?: PlannedTask }): void {
    const session = this.host.startSession(start);
    if (typeof session === "string") return this.say(session, "warning");
    this.view({ kind: "background", key: session.key });
    this.say(`started ${session.name} in a new session — alt+o switches back`);
    this.refreshData(true);
  }

  /** The task auto mode applies to: the selected row on the Tasks tab, the viewed session's task elsewhere. */
  private autoTarget(): Task | undefined {
    if (this.tab === "tasks") {
      const row = this.taskRowList()[this.tasksSelected];
      return row?.kind === "task" ? this.data.tasks.find((task) => task.id === row.id) : undefined;
    }
    return this.viewedEntry().task;
  }

  /** Switch auto mode for the task in view. */
  toggleAuto(): void {
    const task = this.autoTarget();
    if (!task || TERMINAL_STATES.includes(task.state)) return this.say("no active task here — auto mode applies to a task", "warning");
    const on = !this.host.isAuto(task.id);
    this.host.setAuto(task.id, on);
    this.say(on ? `auto mode on — the oracle drives ${task.id} to completion without asking` : `auto mode off — the oracle asks you again on ${task.id}`);
  }

  /** Save the planning session's draft to the pending tasks, from any tab and in either mode. */
  savePlan(): void {
    const session = this.host.planner();
    if (!session?.reply?.plan) return this.say(session?.busy ? "the first draft is still being written" : "no plan to save yet — describe a task in the Plan tab", "warning");
    try {
      const saved = session.save();
      this.say(`saved ${saved.id} to the pending tasks — start it from the Tasks tab${session.reply.status === "ready" ? "" : " (the panel had not agreed yet)"}`);
    } catch (error) {
      this.say((error as Error).message, "warning");
    }
    this.refreshData(true);
  }

  /** The oracle puts the round's questions to the user through the questionnaire. */
  answerQuestions(): void {
    const session = this.host.planner();
    if (!session?.awaitingAnswers) return this.say(session?.busy ? "the panel is still thinking" : "no open questions", "warning");
    void this.host.answerPanel().then((notice) => {
      this.say(notice);
      this.host.requestRender();
    });
  }

  /** Start a comment on the draft line under the cursor. */
  private commentOnCursor(): void {
    const line = this.planLayout.draftText[this.planCursor];
    if (!this.host.planner()?.reply?.plan) return this.say("there is no draft to comment on yet", "warning");
    if (!line?.trim()) return this.say("that line is blank — ↑↓ picks another", "warning");
    this.lineTarget = line.trim();
    this.setMode("type");
  }

  private planCommand(data: string, enter: boolean, escape: boolean): boolean {
    const session = this.host.planner();
    if (enter) {
      this.planFocus = this.planFocus === "talk" ? "draft" : "talk";
      if (this.planFocus === "draft") this.cursorToView();
      return true;
    }
    if (data === "a") {
      this.answerQuestions();
      return true;
    }
    if (data === "m") {
      this.openSettings("planner");
      return true;
    }
    if (data === "c") {
      if (this.planFocus !== "draft") {
        this.planFocus = "draft";
        this.cursorToView();
        this.say("↑↓ picks a draft line, c comments on it (or click the line)");
        return true;
      }
      this.commentOnCursor();
      return true;
    }
    const seat = /^[1-4]$/.test(data) ? PANEL_MEMBERS[Number(data) - 1] : undefined;
    if (seat) {
      let seated: boolean;
      if (session) seated = session.toggle(seat);
      else {
        const seats = this.seatSet();
        seated = !seats.delete(seat);
        if (seated) seats.add(seat);
      }
      this.say(`${MEMBER_LABELS[seat]} ${seated ? "joins" : "leaves"} the panel from the next round`);
      return true;
    }
    if (data === "x" || (escape && session?.busy)) {
      if (session?.busy) {
        session.cancel();
        this.say("stopping the panel…");
      }
      return true;
    }
    if (escape && this.planFocus === "draft") {
      this.planFocus = "talk";
      return true;
    }
    if (data === "r") {
      if (session?.retryable) void session.retry();
      else this.say("nothing to retry", "warning");
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
      this.host.newPlanner(undefined, [...this.seatSet()]);
      this.resetPlanScroll();
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

  /* --------------------------------------------------------------- mouse */

  /** Mouse events when pi runs full screen (pi-tui dispatches them to the overlay). */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") this.wheel(Math.sign(event.wheelDelta ?? 0) || 1, event.x, event.y);
    else if (event.type === "click" && event.button === "left") this.click(event.x, event.y);
    else return undefined;
    this.host.requestRender();
    return { handled: true };
  }

  /** Mouse reports in pi's regular screen, where the lobby turns reporting on itself. */
  private mouseReport(report: MouseReport): void {
    if (report.kind === "wheel") this.wheel(report.delta, report.x, report.y);
    else if (report.kind === "press" && report.button === 0) this.click(report.x, report.y);
  }

  /** The pane of the current tab under a body cell, if any. */
  private paneAt(x: number, y: number): string | undefined {
    const row = y - this.bodyTop;
    for (const [name, pane] of this.panes) {
      if (row >= pane.top && row < pane.top + pane.height && x >= pane.left && x < pane.left + pane.width) return name;
    }
    return undefined;
  }

  /** The wheel scrolls the pane under the pointer (the focused one when it is over none). */
  private wheel(direction: number, x = -1, y = -1): void {
    if (this.help) return;
    if (this.tab === "issues") return this.scroll(direction * WHEEL_LINES);
    this.scrollPane(this.paneAt(x, y) ?? this.focusedPane(), direction * WHEEL_LINES, true);
  }

  /** A click: a tab in the tab bar, the prompt, or a line of the draft plan to comment on. */
  click(x: number, y: number): void {
    this.help = false;
    if (y === 0) {
      const span = this.tabSpans.find((entry) => x >= entry.from && x < entry.to);
      if (span) this.setTab(span.tab);
      return;
    }
    if (y >= this.promptTop) {
      if (this.searching) this.closeSearch();
      if (this.tab !== "metrics" && this.tab !== "tasks") this.setMode("type");
      return;
    }
    const row = y - this.bodyTop;
    // A click on a pane gives it the keys.
    const pane = this.paneAt(x, y);
    if (this.tab === "lobby" && pane) this.homeFocus = pane as HomePane;
    if (this.tab === "tasks" && (pane === "list" || pane === "detail")) this.tasksFocus = pane;
    if (this.tab === "quickfix" && (pane === "list" || pane === "detail")) this.fixFocus = pane;
    if (this.tab !== "plan" || row < 0 || !this.host.planner()) return;
    const layout = this.planLayout;
    // The draft pane: its border sits one row above its first line and two columns left of its text.
    const inDraftColumns = x >= layout.draftLeft - 2 && x < layout.draftLeft + layout.draftWidth + 2;
    const line = row - layout.draftTop;
    if (inDraftColumns && line >= -1 && line <= layout.draftRows) {
      this.planFocus = "draft";
      const index = layout.draftStart + line;
      if (line < 0 || line >= layout.draftRows || index >= layout.draftText.length) return;
      this.planCursor = index;
      if (this.searching) this.closeSearch();
      this.commentOnCursor();
      return;
    }
    // The conversation sits left of the draft on wide terminals, above it on narrow ones.
    const inTalk = layout.draftLeft > 2 ? x < layout.draftLeft - 2 : line < -1;
    if (inTalk) this.planFocus = "talk";
  }

  /* -------------------------------------------------------------- submit */

  private submit(text: string): void {
    const body = text.trim();
    if (!body) {
      // An empty enter on the Plan tab opens the panel's questions; on the Lobby, a background session's question.
      if (this.tab === "plan" && !this.lineTarget && this.host.planner()?.awaitingAnswers) this.answerQuestions();
      if (this.tab === "lobby" && !this.newSession) this.answerSessionDialog();
      return;
    }
    this.editor.addToHistory(body);
    switch (this.tab) {
      case "lobby":
        return this.submitLobby(body);
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
      case "plan":
        return this.submitPlan(body);
      case "quickfix": {
        const job = this.host.quickfix.submit(body);
        this.fixSelected = 0;
        this.fixDetailOffset = 0;
        delete this.queries.quickfix;
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

  private submitPlan(body: string): void {
    if (this.lineTarget) {
      const line = this.lineTarget;
      this.lineTarget = undefined;
      const session = this.host.planner();
      if (!session) return this.say("there is no draft to comment on", "warning");
      const sent = session.commentOnLine(line, body);
      this.planFocus = "draft";
      this.setMode("browse");
      if (sent) this.say("comment sent — the panel revises the draft");
      else if (session.busy) this.say("comment kept — it goes to the panel after this round");
      else this.say("comment kept — it goes with your answers (a answers the questions)");
      return;
    }
    const session = this.host.planner() ?? this.host.newPlanner(undefined, [...this.seatSet()]);
    if (session.busy) {
      this.editor.setText(body);
      return this.say("the panel is still thinking — x stops it", "warning");
    }
    this.planOffset = 0;
    this.planDraftOffset = 0;
    session.send(body).catch((error: Error) => this.say(error.message, "warning"));
  }

  /* -------------------------------------------------------------- render */

  /** Task rows, narrowed by the Tasks tab's search. */
  private taskRowList(): TaskRow[] {
    const names = new Map<string, string>();
    for (const session of this.host.sessions()) if (session.sessionId && session.alive) names.set(session.sessionId, session.name);
    const auto = new Set(this.data.tasks.filter((task) => !TERMINAL_STATES.includes(task.state) && this.host.isAuto(task.id)).map((task) => task.id));
    const rows = taskRows(this.data.tasks, this.data.plans, this.host.sessionId(), this.now(), { names, auto });
    return filterRows(rows, this.data.tasks, this.data.plans, this.queries.tasks);
  }

  /** Quick fix jobs as listed: newest first, narrowed by the search. */
  private fixJobs() {
    return newestFirst(filterJobs(this.host.quickfix.jobs, this.queries.quickfix));
  }

  private tabBar(width: number, theme: LobbyTheme): string {
    const zen = this.host.zen();
    const badges: Partial<Record<TabId, string>> = {};
    const active = this.data.tasks.filter((task) => !TERMINAL_STATES.includes(task.state)).length;
    if (active > 0) badges.tasks = String(active);
    const session = this.host.planner();
    if (session?.busy) badges.plan = spinner(this.tick);
    else if (session?.awaitingAnswers) badges.plan = `${session.questions.length}?`;
    if (this.host.quickfix.running) badges.quickfix = spinner(this.tick);
    if (this.issuesOn && this.host.issues.issues.length > 0) badges.issues = String(this.host.issues.issues.length);
    const brand = bold(theme, paint(theme, "accent", " ◆ bot-lobby "));
    let left = `${brand}${paint(theme, "borderMuted", "│")}`;
    const spans: Array<{ tab: TabId; from: number; to: number }> = [];
    for (const [index, tab] of this.tabs().entries()) {
      const number = paint(theme, tab === this.tab ? "accent" : "dim", String(index + 1));
      const name = tab === this.tab ? bold(theme, paint(theme, "text", TAB_LABELS[tab])) : paint(theme, "muted", TAB_LABELS[tab]);
      const badge = badges[tab] ? ` ${paint(theme, tab === "plan" && session?.awaitingAnswers ? "warning" : "accent", badges[tab]!)}` : "";
      let cell = ` ${number} ${name}${badge} `;
      if (tab === this.tab) cell = theme.bg ? theme.bg("selectedBg", cell) : `[${cell}]`;
      const from = visibleWidth(left);
      left += cell;
      spans.push({ tab, from, to: visibleWidth(left) });
    }
    this.tabSpans = spans;
    const room = width - visibleWidth(left) - 1;
    const entry = this.viewedEntry();
    const help = paint(theme, "dim", `${keyLabel(this.keys.help)} keys `);
    const auto = entry.auto ? ` ${bold(theme, paint(theme, "success", "⟳ AUTO"))}` : "";
    const waiting = this.host.sessions().reduce((count, session) => count + session.dialogs.length, 0);
    const asking = waiting > 0 ? ` ${paint(theme, "warning", `● ${waiting} waiting · ${keyLabel(this.keys.sessions)}`)}` : "";
    let choices: string[];
    if (entry.view.kind !== "here") {
      // Another session in view: its name and what it is doing lead, so it is never mistaken for this window.
      const working = entry.status === "working";
      const dot = paint(theme, working ? "accent" : "dim", working ? spinner(this.tick) : "◆");
      const where = paint(theme, "muted", `${entry.name} · ${entry.status}`);
      choices = [`${dot} ${where}${auto}${asking}  ${help}`, `${dot} ${where}${auto}${asking} `, `${dot} ${where}${auto} `, `${dot}${auto} `];
    } else {
      const dot = paint(theme, this.host.masterBusy() ? "accent" : "dim", this.host.masterBusy() ? spinner(this.tick) : "●");
      const state = zen.task ? paint(theme, "muted", zen.task.paused ? `${zen.task.state} (paused)` : zen.task.state) : "";
      // Long task ids give way to the state, then to the dot alone.
      choices = zen.task
        ? [`${dot} ${zen.task.id} ${state}${auto}${asking}  ${help}`, `${dot} ${zen.task.id} ${state}${auto}${asking} `, `${dot} ${state}${auto} `, `${dot}${auto} `]
        : [`${paint(theme, "dim", "no task in this session")}${asking}  ${help}`, `${paint(theme, "dim", "no task in this session")}${asking} `, help, ""];
    }
    const status = choices.find((choice) => visibleWidth(choice) <= room) ?? "";
    const gap = width - visibleWidth(left) - visibleWidth(status);
    return gap >= 1 ? `${left}${" ".repeat(gap)}${status}` : fit(left, width);
  }

  private promptLabel(): string {
    const zen = this.host.zen();
    const browsing = this.mode === "browse";
    switch (this.tab) {
      case "lobby": {
        if (this.newSession) return "new task — it starts in its own session, named after it";
        if (this.viewing.kind !== "here") {
          const entry = this.viewedEntry();
          const session = this.viewedSession();
          if (session && !session.alive) return `${entry.name} has ended`;
          if (session?.dialogs.length) return `press enter to answer ${entry.name}'s question, or type a message`;
          return entry.where === "other terminal" ? `message ${entry.name}'s oracle (its own session delivers it)` : `message ${entry.name}'s oracle`;
        }
        if (!zen.task) return browsing ? "describe a task to start — i to type" : "describe a task to start · enter starts it";
        return browsing ? "message the oracle — i to type" : this.host.masterBusy() ? "message the oracle · enter steers the running turn" : "message the oracle";
      }
      case "tasks":
        return this.commentTarget ? `comment on ${this.commentTarget}'s plan · enter sends it to the oracle` : "c comments on the selected task's plan";
      case "plan": {
        if (this.lineTarget) return `comment on “${clip(this.lineTarget, 48)}”`;
        const session = this.host.planner();
        if (session?.busy) return "the panel is thinking";
        if (session?.awaitingAnswers) {
          const count = session.questions.length;
          return `press enter to answer ${count} question${count === 1 ? "" : "s"}, or type a reply`;
        }
        if (session?.reply?.status === "ready") return `the plan is ready — ${keyLabel(this.keys.savePlan)} saves it, or reply to refine it`;
        return session && session.messages.length > 0 ? "reply to the panel" : "describe the task to plan";
      }
      case "quickfix":
        return this.host.quickfix.running ? "describe a quick change; it runs after the current one" : "describe a quick change";
      case "issues":
        return this.issueDraft ? "new issue · first line is the title" : "n files a new issue";
      case "metrics":
        return "";
    }
  }

  private promptLines(width: number, theme: LobbyTheme): string[] {
    if (this.tab === "metrics") return [];
    const typing = this.mode === "type" && !this.searching;
    this.editor.label = this.promptLabel();
    this.editor.paintLabel = (text) => paint(theme, typing ? (this.lineTarget ? "warning" : "accent") : "dim", text);
    this.editor.borderColor = (text) => paint(theme, typing ? "border" : "borderMuted", text);
    const lines = this.editor.render(width);
    // The editor always draws its block cursor; while browsing it would suggest the prompt has focus.
    return typing ? lines : lines.map((line) => line.replace(REVERSE_VIDEO, "$1"));
  }

  /** The search bar: the query being typed, or the one in force. */
  private searchLines(width: number, theme: LobbyTheme): string[] {
    const query = this.query();
    if (!this.searching && !query) return [];
    const lead = `${paint(theme, "accent", " / ")}`;
    const tail = this.searching
      ? paint(theme, "dim", " enter keep · esc clear · ↑↓ browse results ")
      : paint(theme, "dim", ` ${keyLabel(this.keys.search)} or / edits · esc clears `);
    const room = Math.max(4, width - visibleWidth(lead) - visibleWidth(tail));
    const field = this.searching ? this.search.render(room)[0] ?? "" : bold(theme, fit(query ?? "", room));
    return [fit(`${lead}${fit(field, room)}${tail}`, width)];
  }

  /** Every key the current tab understands while browsing. */
  private tabKeys(): KeyHelp[] {
    switch (this.tab) {
      case "lobby":
        return [
          { key: "type", text: "talk to the oracle of the session in view (in this window, starts a task when none is running)" },
          { key: "enter", text: "on an empty prompt: answer the question a background session waits on" },
          { key: "↑ ↓", text: "scroll the focused pane (PageUp/PageDown a page)" },
          { key: "← →", text: "move between the conversation, activity log and thinking" },
          { key: "Home End", text: "the oldest lines, or back to the newest" },
          { key: "c", text: "comment on this task's plan" },
          { key: "esc", text: "stop the oracle while it works" },
        ];
      case "tasks":
        return [
          { key: "↑ ↓", text: "select a task or plan, or scroll the detail (PageUp/PageDown)" },
          { key: "enter / ← →", text: "move between the list and the detail" },
          { key: "c", text: "comment on the selected task's plan" },
          { key: "s", text: "start the selected planned task in a new session, named after it" },
          { key: "h", text: "start the selected planned task here, in this window" },
          { key: "n", text: "type a new task that starts in its own session" },
          { key: "o", text: "show the session driving the selected task in the Lobby tab" },
          { key: "x x", text: "stop the background session driving the selected task" },
          { key: "d d", text: "discard the selected planned task" },
          { key: "r", text: "reread tasks from disk" },
        ];
      case "plan":
        return [
          { key: "a", text: "answer the panel's questions, one questionnaire at a time (enter on an empty prompt too)" },
          { key: "enter / ← →", text: "move between the conversation and the draft" },
          { key: "↑ ↓", text: "pick a draft line (draft) or scroll (conversation); PageUp/PageDown a page" },
          { key: "c / click", text: "comment on the picked draft line" },
          { key: "1-4", text: "seat or unseat DEV, DESIGN, QA, RESEARCH" },
          { key: "n", text: "start a new plan" },
          { key: "x", text: "stop the round" },
          { key: "r", text: "retry a failed round or seat" },
          { key: "m", text: "the oracle's model, thinking and time limit (Planner settings)" },
        ];
      case "quickfix":
        return [
          { key: "type", text: "describe a quick change" },
          { key: "↑ ↓", text: "select a quick fix, or scroll the detail (PageUp/PageDown)" },
          { key: "enter / ← →", text: "move between the list and the detail" },
          { key: "x", text: "cancel the selected quick fix" },
          { key: "m", text: "the quick fix agent's model, thinking, time limit and instructions" },
        ];
      case "issues":
        return [
          { key: "↑ ↓", text: "select an issue" },
          { key: "enter", text: "read the selected issue" },
          { key: "p", text: "plan the selected issue" },
          { key: "n", text: "file a new issue" },
          { key: "r", text: "reload issues" },
        ];
      case "metrics":
        return [
          { key: "↑ ↓", text: "select a row of the table" },
          { key: "g", text: "group by model, or by model and agent" },
          { key: "s", text: "change the sort" },
          { key: "r", text: "reread the metrics log" },
        ];
    }
  }

  private chips(entries: ReadonlyArray<readonly [string, string]>, theme: LobbyTheme): string {
    return entries.map(([key, text]) => `${paint(theme, "accent", key)} ${paint(theme, "dim", text)}`).join(paint(theme, "dim", "  "));
  }

  private hintLine(width: number, theme: LobbyTheme): string {
    const notice = this.notice && this.now() - this.notice.at < NOTICE_MS ? this.notice : undefined;
    if (notice) return fit(paint(theme, notice.kind === "warning" ? "warning" : "accent", ` ${notice.text}`), width);
    const k = (action: LobbyAction) => keyLabel(this.keys[action]).toLowerCase();
    const badge = (text: string, color: "accent" | "muted" | "warning") => {
      const label = bold(theme, paint(theme, color, ` ${text} `));
      return theme.bg ? theme.bg("selectedBg", label) : label;
    };
    if (this.help) return fit(`${badge("KEYS", "accent")} ${this.chips([["any key", "closes"]], theme)}`, width);
    if (this.searching) return fit(`${badge("SEARCH", "warning")} ${this.chips([["enter", "keep"], ["esc", "clear"], ["↑↓", "results"], [k("nextTab"), "next tab"]], theme)}`, width);
    const mode = this.mode === "type" ? badge("TYPE", "accent") : badge("BROWSE", "muted");
    return fit(`${mode} ${this.chips(this.hintChips(), theme)}`, width);
  }

  /**
   * The few keys that matter right now, most useful first: typing names what
   * enter does here; browsing names the tab's main commands, only those that
   * apply. Everything else is one `?` away.
   */
  private hintChips(): Array<[string, string]> {
    const k = (action: LobbyAction) => keyLabel(this.keys[action]).toLowerCase();
    const session = this.host.planner();
    if (this.mode === "type") {
      if (this.tab === "lobby" && this.newSession) return [["enter", "start in a new session"], ["esc", "cancel"]];
      if (this.tab === "lobby" && this.viewing.kind !== "here") {
        const background = this.viewedSession();
        if (background?.dialogs.length && !this.editor.getText().trim()) return [["enter", "answer its question"], [k("sessions"), "sessions"], [k("hide"), "hide"]];
        return [["enter", background?.busy ? "steer" : "send"], [k("sessions"), "sessions"], [k("toggleAuto"), "auto"]];
      }
      if (this.tab === "lobby" && this.host.masterBusy()) return [["enter", "steer"], ["esc", "stop the oracle"], [k("hide"), "hide"]];
      if (this.tab === "plan" && this.lineTarget) return [["enter", "add the comment"], ["esc", "cancel"]];
      const enter = this.tab === "plan" && session?.awaitingAnswers && !this.editor.getText().trim() ? "answer questions" : this.tab === "quickfix" ? "run it" : "send";
      return [["enter", enter], ["esc", "browse"], [k("hide"), "hide"]];
    }
    const keys: Array<[string, string]> = [];
    switch (this.tab) {
      case "lobby":
        keys.push(["←→", "pane"], ["↑↓", "scroll"], [k("sessions"), "sessions"], [k("newSession"), "new session"]);
        if (this.viewedEntry().task) keys.push([k("toggleAuto"), "auto"], ["c", "comment on plan"]);
        break;
      case "tasks": {
        const row = this.taskRowList()[this.tasksSelected];
        keys.push(["↑↓", "select"]);
        if (row?.kind === "task") keys.push(["c", "comment"], ["o", "open its session"], [k("toggleAuto"), "auto"]);
        if (row?.kind === "plan") keys.push(["s", "start in a new session"], ["h", "start here"], ["d", "discard"]);
        keys.push(["n", "new task"]);
        break;
      }
      case "plan":
        if (session?.awaitingAnswers) keys.push(["a", "answer"]);
        if (session?.reply?.plan) keys.push([k("savePlan"), "save"], ["c", "comment on a line"]);
        if (session?.busy) keys.push(["x", "stop"]);
        keys.push(["n", "new"], ["1-4", "seats"]);
        break;
      case "quickfix":
        if (this.host.quickfix.jobs.length > 0) keys.push(["↑↓", "select"], ["x", "cancel"]);
        keys.push(["m", "model"]);
        break;
      case "issues":
        keys.push(["↑↓", "select"], ["p", "plan it"], ["n", "new"]);
        break;
      case "metrics":
        keys.push(["↑↓", "select"], ["g", "group"], ["s", "sort"]);
        break;
    }
    return [...keys, ["?", "all keys"]];
  }

  /** The help screen: every shortcut, the typing and browsing keys, and this tab's commands. */
  private helpBody(width: number, height: number, theme: LobbyTheme): string[] {
    const keyWidth = 13;
    const row = (key: string, text: string, inner: number) => wrapHanging(`${paint(theme, "accent", fit(key, keyWidth))} `, text, inner);
    const section = (title: string) => bold(theme, paint(theme, "mdHeading", title));
    const tabs = this.tabs();
    const everywhere = (inner: number) => [
      section("Everywhere"),
      ...(Object.keys(LOBBY_ACTIONS) as LobbyAction[]).flatMap((action) => row(keyLabel(this.keys[action]), LOBBY_ACTIONS[action].help, inner)),
      ...row(`Alt+1…${tabs.length}`, "jump to a tab", inner),
      ...row("Ctrl+C", "clear the prompt, or hide the lobby", inner),
      ...row("click", "a tab to open it, a pane to give it the keys, a draft plan line to comment on it", inner),
      ...row("wheel", "scroll the pane under the pointer", inner),
    ];
    const modes = (inner: number) => [
      section("Typing"),
      ...row("Enter", "send", inner),
      ...row("Shift+Enter", "new line", inner),
      ...row("Esc", "stop typing and browse", inner),
      "",
      section("Browsing"),
      ...row("i", "type", inner),
      ...row("/", "search this tab (esc clears)", inner),
      ...row("?", "these keys", inner),
      "",
      section(`${TAB_LABELS[this.tab]} tab`),
      ...this.tabKeys().flatMap((entry) => row(entry.key, entry.text, inner)),
    ];
    const footer = paint(theme, "dim", "Rebind any shortcut under lobby.keys in the bot-lobby config, e.g. { \"toggleThinking\": \"alt+t\" }. Hidden panes stay hidden next time (lobby.panels); lobby.mouse turns clicks off.");
    const title = { title: "Keys", right: "any key closes", focused: true, theme } as const;
    if (width >= 100) {
      const left = Math.floor((width - 1) / 2);
      const inner = left - 4;
      const columns = beside([
        box(left, height, [...everywhere(inner), "", ...wrapHanging("", footer, inner)], title),
        box(width - 1 - left, height, modes(width - 1 - left - 4), { focused: true, theme }),
      ]);
      return columns;
    }
    const inner = width - 4;
    return box(width, height, [...everywhere(inner), "", ...modes(inner), "", ...wrapHanging("", footer, inner)], title);
  }

  private body(width: number, height: number, theme: LobbyTheme): string[] {
    const now = this.now();
    const query = this.query();
    this.panes.clear();
    switch (this.tab) {
      case "lobby":
        return this.homeBody(width, height, theme, now);
      case "tasks":
        return this.tasksBody(width, height, theme, now);
      case "plan": {
        const session = this.host.planner();
        const lines = renderPlan({
          ...(session ? { session: this.planView(session) } : {}),
          profile: this.host.profileLabel("planner"),
          seats: this.seatViews(undefined),
          offset: this.planOffset,
          focus: this.planFocus,
          draftOffset: this.planDraftOffset,
          cursor: this.planCursor,
          tick: this.tick,
          ...(query ? { query } : {}),
          layout: this.planLayout,
          panes: this.panes,
          saveKey: keyLabel(this.keys.savePlan),
        }, width, height, theme);
        if (!session) Object.assign(this.planLayout, { draftRows: 0, draftStart: 0, draftText: [] });
        this.planCursor = Math.min(this.planCursor, Math.max(0, this.planLayout.draftText.length - 1));
        return lines;
      }
      case "quickfix":
        this.fixSelected = Math.min(this.fixSelected, Math.max(0, this.fixJobs().length - 1));
        return renderQuickFix({ jobs: this.host.quickfix.jobs, selected: this.fixSelected, focus: this.fixFocus, detailOffset: this.fixDetailOffset, profile: this.host.profileLabel("quickfix"), tick: this.tick, now, ...(query ? { query } : {}), panes: this.panes }, width, height, theme);
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
        const records = filterRecords(collectMetrics(this.data.metrics, this.data.tasks), query);
        const groups = sortGroups(aggregateMetrics(records, this.metricsBy), this.metricsSort);
        this.metricsSelected = Math.min(this.metricsSelected, Math.max(0, groups.length - 1));
        const taskTimes = taskTimesByModel(this.data.tasks, records);
        return renderMetrics({ groups, taskTimes, records, stats: taskStats(this.data.tasks), by: this.metricsBy, sort: this.metricsSort, selected: this.metricsSelected, ...(query ? { query } : {}), panes: this.panes }, width, height, theme);
      }
    }
  }

  /** The roster: the oracle chairing, then every domain seat in order, seated or not. */
  private seatViews(session: PlanningSession | undefined): SeatView[] {
    const seats = session?.seats ?? this.seatSet();
    const oracleQuestions = session?.questions.filter((question) => question.from === ORACLE_LABEL).length ?? 0;
    // While the seats work the oracle waits for them; its own part fails only when the round reports an error.
    const status: SeatView["status"] = !session || session.turns === 0 ? "idle" : session.busy ? "thinking" : session.error ? "failed" : "done";
    const oracle: SeatView = {
      label: ORACLE_LABEL,
      seated: true,
      status,
      ...(session?.busy && session.step ? { step: session.step } : {}),
      questions: oracleQuestions,
      ready: session?.reply?.status === "ready",
      profile: this.host.profileLabel("planner"),
    };
    const members = PANEL_MEMBERS.map((member): SeatView => {
      const state = session?.members.find((entry) => entry.member === member);
      return {
        label: MEMBER_LABELS[member],
        seated: seats.has(member),
        status: state ? (state.status === "thinking" ? "thinking" : state.status) : "idle",
        ...(state?.step ? { step: state.step } : {}),
        // The questions from this seat that reached the user this round.
        questions: session?.questions.filter((question) => question.from === MEMBER_LABELS[member]).length ?? 0,
        ready: state?.reply?.status === "ready",
        profile: this.host.seatLabel(member),
      };
    });
    return [oracle, ...members];
  }

  private planView(session: PlanningSession): PlanView {
    return {
      messages: session.messages,
      ...(session.reply ? { reply: session.reply } : {}),
      questions: session.questions,
      notes: session.notes,
      seats: this.seatViews(session),
      busy: session.busy,
      ...(session.step ? { step: session.step } : {}),
      ...(session.error ? { error: session.error } : {}),
      turns: session.turns,
      ...(session.seed ? { seed: session.seed } : {}),
      ...(session.saved ? { saved: session.saved } : {}),
      ...(session.title ? { title: session.title } : {}),
      awaitingAnswers: session.awaitingAnswers,
      answeredChunks: session.answered.length,
      lineComments: session.lineComments,
    };
  }

  /** The session switcher: every session this window can show, with what each is doing. */
  private pickerBody(width: number, height: number, theme: LobbyTheme): string[] {
    const entries = this.sessionEntries();
    this.pickIndex = Math.min(this.pickIndex, Math.max(0, entries.length - 1));
    const inner = width - 4;
    const nameWidth = Math.min(34, Math.max(14, Math.floor(inner * 0.36)));
    const marks = { "this window": "●", background: "◆", "other terminal": "◇" } as const;
    const lines = entries.map((entry, index) => {
      const selected = index === this.pickIndex;
      const mark = paint(theme, entry.where === "this window" ? "accent" : "toolTitle", marks[entry.where]);
      const name = fit(selected ? bold(theme, entry.name) : entry.name, nameWidth);
      const status = paint(theme, entry.status === "working" ? "accent" : entry.status === "ended" ? "dim" : "muted", entry.status.replace(/_/g, " "));
      const badges = [entry.auto ? paint(theme, "success", "⟳ auto") : "", entry.waiting > 0 ? paint(theme, "warning", `● ${entry.waiting} waiting`) : ""].filter(Boolean).join(" ");
      const where = paint(theme, "dim", entry.where);
      return selectRow(theme, `${selected ? paint(theme, "accent", "▸") : " "} ${mark} ${name} ${where} ${paint(theme, "dim", "·")} ${status}${badges ? ` ${badges}` : ""}`, inner, selected, true);
    });
    const help = paint(theme, "dim", "enter shows it here · n new task in a new session · x x stops a background session · esc closes");
    return box(width, height, [...lines, "", ...wrap(help, inner)], { title: "Sessions", right: `${entries.length}`, focused: true, theme });
  }

  private homeBody(width: number, height: number, theme: LobbyTheme, now: number): string[] {
    const zen = this.host.zen();
    const feed = this.host.feed;
    const sessionId = this.host.sessionId();
    const others = this.data.tasks.filter((task) => !TERMINAL_STATES.includes(task.state) && task.ownerSessionId !== sessionId).length;
    const query = this.query();
    const entry = this.viewedEntry();
    if (entry.view.kind !== "here") return this.otherSessionBody(entry, width, height, theme, now);
    return renderHome({
      ...(zen.task ? { task: zen.task, scene: (w: number, h: number, animated: boolean) => this.host.scene(w, h, animated) } : {}),
      chat: feed.chat,
      ...(feed.reply ? { liveReply: feed.reply } : {}),
      activity: feed.activity,
      thoughts: feed.thoughts,
      busy: this.host.masterBusy(),
      others,
      pending: this.data.plans.filter((plan) => plan.status === "pending").length,
      offsets: this.homeOffsets,
      ...(this.mode === "browse" ? { focus: this.homeFocus } : {}),
      panes: this.panes,
      tick: this.tick,
      now,
      panels: this.panels,
      ...(query ? { query } : {}),
      keys: {
        animations: keyLabel(this.keys.toggleScene),
        conversation: keyLabel(this.keys.toggleConversation),
        activity: keyLabel(this.keys.toggleActivity),
        thinking: keyLabel(this.keys.toggleThinking),
      },
    }, width, height, theme);
  }

  /**
   * Another session on the Lobby tab: a background session's live feed, or an
   * other terminal's conversation read from its session file; the task's
   * status sits on top without animations.
   */
  private otherSessionBody(entry: SessionEntry, width: number, height: number, theme: LobbyTheme, now: number): string[] {
    const session = this.viewedSession();
    const task = entry.task;
    const query = this.query();
    const common = {
      ...(task ? { task, scene: (w: number, h: number) => this.host.taskScene(task, w, h), stillScene: true } : {}),
      others: 0,
      pending: 0,
      offsets: this.homeOffsets,
      ...(this.mode === "browse" ? { focus: this.homeFocus } : {}),
      panes: this.panes,
      tick: this.tick,
      now,
      panels: this.panels,
      ...(query ? { query } : {}),
      title: entry.name,
      keys: {
        animations: keyLabel(this.keys.toggleScene),
        conversation: keyLabel(this.keys.toggleConversation),
        activity: keyLabel(this.keys.toggleActivity),
        thinking: keyLabel(this.keys.toggleThinking),
      },
    };
    if (session) {
      const emptyNote = session.status === "starting" ? `starting ${session.name}…` : !session.alive ? `${session.name} has ended.` : `${session.name} has not said anything yet.`;
      return renderHome({
        ...common,
        chat: session.feed.chat,
        ...(session.feed.reply ? { liveReply: session.feed.reply } : {}),
        activity: session.feed.activity,
        thoughts: session.feed.thoughts,
        busy: session.busy,
        emptyNote,
      }, width, height, theme);
    }
    return renderHome({
      ...common,
      chat: task?.ownerSessionId ? this.host.sessionChat(task.ownerSessionId) : [],
      activity: [],
      thoughts: [],
      busy: false,
      emptyNote: "Nothing said in this session yet.",
      activityNote: "This session runs in another terminal: its conversation shows here and your messages reach its oracle, but live activity only streams from sessions started in this window.",
    }, width, height, theme);
  }

  private tasksBody(width: number, height: number, theme: LobbyTheme, now: number): string[] {
    const rows = this.taskRowList();
    this.tasksSelected = Math.min(this.tasksSelected, Math.max(0, rows.length - 1));
    const row = rows[this.tasksSelected];
    const detailWidth = tasksWidths(width).detail - 4;
    let detail: string[] = [];
    if (row?.kind === "task") {
      const task = this.data.tasks.find((entry) => entry.id === row.id);
      if (task) detail = taskDetailLines(task, this.data.comments.get(task.id) ?? [], this.host.sessionId(), detailWidth, now, theme);
    } else if (row?.kind === "plan") {
      const plan = this.data.plans.find((entry) => entry.id === row.id);
      if (plan) detail = planDetailLines(plan, detailWidth, now, theme);
    }
    const query = this.query();
    return renderTasks({ rows, selected: this.tasksSelected, detail, focus: this.tasksFocus, detailOffset: this.tasksDetailOffset, ...(query ? { query } : {}), panes: this.panes }, width, height, theme);
  }

  render(width: number): string[] {
    const theme = this.host.theme();
    const rows = Math.max(1, this.host.rows());
    const top = [this.tabBar(width, theme)];
    const prompt = this.promptLines(width, theme);
    const search = this.searchLines(width, theme);
    const hint = this.hintLine(width, theme);
    const bodyHeight = Math.max(0, rows - top.length - search.length - prompt.length - 1);
    this.bodyTop = top.length;
    this.promptTop = top.length + bodyHeight + search.length;
    let body = this.help ? this.helpBody(width, bodyHeight, theme) : this.picking ? this.pickerBody(width, bodyHeight, theme) : this.body(width, bodyHeight, theme);
    // A pane scrolled back that gained lines moves with them, so it keeps showing what was being read.
    if (!this.help && !this.picking && this.clampScroll()) body = this.body(width, bodyHeight, theme);
    const query = this.query();
    if (query && !this.help) body = body.map((line) => highlight(line, query));
    return [...top, ...body, ...search, ...prompt, hint].slice(0, rows).map((line) => fit(line, width));
  }

  invalidate(): void {
    this.editor.invalidate();
    this.search.invalidate();
  }
}
