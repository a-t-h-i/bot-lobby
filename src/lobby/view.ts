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
import type { LobbyFeed } from "./feed.ts";
import type { QuickFixQueue } from "./quickfix.ts";
import { MEMBER_LABELS, ORACLE_LABEL, type PlannerSeed, type PlanningSession } from "./planner.ts";
import { issueText, type IssuesState } from "./issues.ts";
import { actionFor, keyLabel, keyMap, LOBBY_ACTIONS, type KeyMap, type LobbyAction } from "./keys.ts";
import { beside, bold, box, fit, highlight, paint, spinner, wrapHanging, type LobbyTheme } from "./layout.ts";
import { renderHome } from "./tabs/home.ts";
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
const PANEL_NAMES: Record<LobbyPanel, string> = { scene: "zen scene", conversation: "conversation", activity: "activity log", thinking: "thinking" };
const PANEL_ACTIONS: Record<LobbyPanel, LobbyAction> = { scene: "toggleScene", conversation: "toggleConversation", activity: "toggleActivity", thinking: "toggleThinking" };

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

/** A key and what it does, for the help screen; `hint` is the short form on the hint line. */
interface KeyHelp {
  key: string;
  text: string;
  hint?: string;
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
  private readonly keys: KeyMap;
  private panels: Record<LobbyPanel, boolean>;
  private readonly issuesOn: boolean;
  /** The help screen covers the body. */
  help = false;
  /** The search bar has the keys. */
  searching = false;
  /** Each tab's search, kept while you move between tabs. */
  private readonly queries: Partial<Record<TabId, string>> = {};
  /** Where the body starts and where each tab's label sits in the tab bar, for clicks. */
  private bodyTop = 1;
  private promptTop = Number.POSITIVE_INFINITY;
  private tabSpans: Array<{ tab: TabId; from: number; to: number }> = [];

  private chatOffset = 0;
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
    if (this.tab === "lobby" && this.panels.scene && this.host.zen().task) delay = Math.min(delay, this.host.advanceScene(now));
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
    this.chatOffset = 0;
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
      case "search":
        return this.searching ? this.closeSearch() : this.openSearch();
      case "nextTab":
        return this.cycleTab(1);
      case "prevTab":
        return this.cycleTab(-1);
      case "toggleScene":
        return this.togglePanel("scene");
      case "toggleConversation":
        return this.togglePanel("conversation");
      case "toggleActivity":
        return this.togglePanel("activity");
      case "toggleThinking":
        return this.togglePanel("thinking");
      case "scrollUp":
        return this.scroll(-10);
      case "scrollDown":
        return this.scroll(10);
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

  /** Arrow keys and page keys: scroll or select, depending on the tab and its focus. */
  private scroll(delta: number): void {
    switch (this.tab) {
      case "lobby":
        this.chatOffset = Math.max(0, this.chatOffset - delta);
        return;
      case "plan":
        if (this.planFocus === "draft") this.moveCursor(delta);
        else this.planOffset = Math.max(0, this.planOffset - delta);
        return;
      case "tasks":
        if (this.tasksFocus === "detail" || Math.abs(delta) > 1) this.tasksDetailOffset = Math.max(0, this.tasksDetailOffset + delta);
        else this.selectTask(this.tasksSelected + delta);
        return;
      case "quickfix":
        if (this.fixFocus === "detail" || Math.abs(delta) > 1) this.fixDetailOffset = Math.max(0, this.fixDetailOffset + delta);
        else {
          this.fixSelected = Math.max(0, Math.min(this.fixJobs().length - 1, this.fixSelected + delta));
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
        return this.planCommand(data, enter, escape);
      case "quickfix":
        if (enter) return (this.fixFocus = this.fixFocus === "list" ? "detail" : "list"), true;
        if (escape && this.fixFocus === "detail") return (this.fixFocus = "list"), true;
        if (data === "x") {
          const job = this.fixJobs()[this.fixSelected];
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
    const row = this.taskRowList()[this.tasksSelected];
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
    if (data === "s") {
      try {
        const saved = session?.save();
        this.say(saved ? `saved ${saved.id} — start it from the Tasks tab when you are ready` : "nothing to save yet", saved ? "info" : "warning");
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
    if (event.type === "wheel") this.wheel(Math.sign(event.wheelDelta ?? 0) || 1);
    else if (event.type === "click" && event.button === "left") this.click(event.x, event.y);
    else return undefined;
    this.host.requestRender();
    return { handled: true };
  }

  /** Mouse reports in pi's regular screen, where the lobby turns reporting on itself. */
  private mouseReport(report: MouseReport): void {
    if (report.kind === "wheel") this.wheel(report.delta);
    else if (report.kind === "press" && report.button === 0) this.click(report.x, report.y);
  }

  private wheel(direction: number): void {
    if (this.help) return;
    if (this.tab === "plan" && this.planFocus === "draft") {
      // The wheel scrolls the draft; the cursor follows only when it would leave the screen.
      const rows = Math.max(1, this.planLayout.draftRows);
      const max = Math.max(0, this.planLayout.draftText.length - rows);
      this.planDraftOffset = Math.max(0, Math.min(max, this.planLayout.draftStart + direction * WHEEL_LINES));
      if (this.planCursor < this.planDraftOffset) this.planCursor = this.planDraftOffset;
      if (this.planCursor >= this.planDraftOffset + rows) this.planCursor = this.planDraftOffset + rows - 1;
      return;
    }
    this.scroll(direction * WHEEL_LINES);
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
      // An empty enter on the Plan tab opens the panel's questions.
      if (this.tab === "plan" && !this.lineTarget && this.host.planner()?.awaitingAnswers) this.answerQuestions();
      return;
    }
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
    const rows = taskRows(this.data.tasks, this.data.plans, this.host.sessionId(), this.now());
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
    const dot = paint(theme, this.host.masterBusy() ? "accent" : "dim", this.host.masterBusy() ? spinner(this.tick) : "●");
    const state = zen.task ? paint(theme, "muted", zen.task.paused ? `${zen.task.state} (paused)` : zen.task.state) : "";
    const help = paint(theme, "dim", `${keyLabel(this.keys.help)} keys `);
    // Long task ids give way to the state, then to the dot alone.
    const choices = zen.task
      ? [`${dot} ${zen.task.id} ${state}  ${help}`, `${dot} ${zen.task.id} ${state} `, `${dot} ${state} `, `${dot} `]
      : [`${paint(theme, "dim", "no task in this session")}  ${help}`, paint(theme, "dim", "no task in this session "), help, ""];
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
        if (this.lineTarget) return `comment on “${clip(this.lineTarget, 48)}” · enter adds it`;
        const session = this.host.planner();
        if (session?.busy) return "the panel is thinking · x stops it";
        if (session?.awaitingAnswers) {
          const count = session.questions.length;
          return `enter answers the panel's ${count} question${count === 1 ? "" : "s"} one at a time · or type a reply`;
        }
        return session && session.messages.length > 0 ? "reply to the panel" : "describe the task you want to plan";
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
    const session = this.host.planner();
    switch (this.tab) {
      case "lobby":
        return [
          { key: "type", text: "talk to the oracle (starts a task when none is running)", hint: "talk" },
          { key: "↑ ↓", text: "scroll the conversation", hint: "scroll" },
          { key: "c", text: "comment on this task's plan", hint: "comment on plan" },
          { key: "esc", text: "stop the oracle while it works" },
        ];
      case "tasks":
        return [
          { key: "↑ ↓", text: "select a task or plan", hint: "select" },
          { key: "enter", text: "move between the list and the detail", hint: "detail" },
          { key: "c", text: "comment on the selected task's plan", hint: "comment" },
          { key: "s", text: "start the selected planned task", hint: "start" },
          { key: "d d", text: "discard the selected planned task", hint: "discard" },
          { key: "r", text: "reread tasks from disk" },
        ];
      case "plan":
        return [
          { key: "a", text: "answer the panel's questions, one questionnaire at a time (enter on an empty prompt too)", ...(session?.awaitingAnswers ? { hint: "answer questions" } : {}) },
          { key: "enter", text: "move between the conversation and the draft", hint: "pane" },
          { key: "↑ ↓", text: "pick a draft line (draft) or scroll (conversation)", hint: "line" },
          { key: "c / click", text: "comment on the picked draft line", hint: "comment on line" },
          { key: "1-4", text: "seat or unseat DEV, DESIGN, QA, RESEARCH", hint: "seats" },
          { key: "s", text: "save the plan to the pending tasks", hint: "save" },
          { key: "n", text: "start a new plan", hint: "new" },
          { key: "x", text: "stop the round" },
          { key: "r", text: "retry a failed round or seat" },
        ];
      case "quickfix":
        return [
          { key: "type", text: "describe a quick change", hint: "new fix" },
          { key: "↑ ↓", text: "select a quick fix", hint: "select" },
          { key: "enter", text: "move between the list and the detail", hint: "detail" },
          { key: "x", text: "cancel the selected quick fix", hint: "cancel" },
        ];
      case "issues":
        return [
          { key: "↑ ↓", text: "select an issue", hint: "select" },
          { key: "enter", text: "read the selected issue", hint: "read" },
          { key: "p", text: "plan the selected issue", hint: "plan it" },
          { key: "n", text: "file a new issue", hint: "new" },
          { key: "r", text: "reload issues", hint: "refresh" },
        ];
      case "metrics":
        return [
          { key: "↑ ↓", text: "select a row of the table", hint: "select" },
          { key: "g", text: "group by model, or by model and agent", hint: "group" },
          { key: "s", text: "change the sort", hint: "sort" },
          { key: "r", text: "reread the metrics log", hint: "refresh" },
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
    if (this.mode === "type") {
      const esc = this.tab === "lobby" && this.host.masterBusy() ? "stop the oracle" : this.lineTarget ? "cancel" : "browse";
      const extra: Array<[string, string]> = this.tab === "plan" && this.host.planner()?.awaitingAnswers && !this.lineTarget ? [["enter", "answer questions"]] : [["enter", "send"]];
      return fit(`${badge("TYPE", "accent")} ${this.chips([...extra, ["shift+enter", "newline"], ["esc", esc], [k("nextTab"), "next tab"], [k("help"), "keys"], [k("hide"), "hide"]], theme)}`, width);
    }
    const tabHints = this.tabKeys().filter((entry) => entry.hint).map((entry) => [entry.key, entry.hint!] as const);
    const panes: Array<[string, string]> = this.tab === "lobby" ? [[k("toggleActivity"), "activity"], [k("toggleThinking"), "thinking"]] : [];
    return fit(`${badge("BROWSE", "muted")} ${this.chips([...tabHints, ...panes, ["/", "search"], ["?", "keys"], [k("hide"), "hide"]], theme)}`, width);
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
      ...row("click", "a tab to open it; a draft plan line to comment on it", inner),
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
        }, width, height, theme);
        if (!session) Object.assign(this.planLayout, { draftRows: 0, draftStart: 0, draftText: [] });
        this.planCursor = Math.min(this.planCursor, Math.max(0, this.planLayout.draftText.length - 1));
        return lines;
      }
      case "quickfix":
        this.fixSelected = Math.min(this.fixSelected, Math.max(0, this.fixJobs().length - 1));
        return renderQuickFix({ jobs: this.host.quickfix.jobs, selected: this.fixSelected, focus: this.fixFocus, detailOffset: this.fixDetailOffset, profile: this.host.profileLabel("quickfix"), tick: this.tick, now, ...(query ? { query } : {}) }, width, height, theme);
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
        return renderMetrics({ groups, taskTimes, records, stats: taskStats(this.data.tasks), by: this.metricsBy, sort: this.metricsSort, selected: this.metricsSelected, ...(query ? { query } : {}) }, width, height, theme);
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
        questions: state?.reply?.questions.length ?? 0,
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

  private homeBody(width: number, height: number, theme: LobbyTheme, now: number): string[] {
    const zen = this.host.zen();
    const feed = this.host.feed;
    const sessionId = this.host.sessionId();
    const others = this.data.tasks.filter((task) => !TERMINAL_STATES.includes(task.state) && task.ownerSessionId !== sessionId).length;
    const query = this.query();
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
      panels: this.panels,
      ...(query ? { query } : {}),
      keys: {
        scene: keyLabel(this.keys.toggleScene),
        conversation: keyLabel(this.keys.toggleConversation),
        activity: keyLabel(this.keys.toggleActivity),
        thinking: keyLabel(this.keys.toggleThinking),
      },
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
    return renderTasks({ rows, selected: this.tasksSelected, detail, focus: this.tasksFocus, detailOffset: this.tasksDetailOffset, ...(query ? { query } : {}) }, width, height, theme);
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
    let body = this.help ? this.helpBody(width, bodyHeight, theme) : this.body(width, bodyHeight, theme);
    const query = this.query();
    if (query && !this.help) body = body.map((line) => highlight(line, query));
    return [...top, ...body, ...search, ...prompt, hint].slice(0, rows).map((line) => fit(line, width));
  }

  invalidate(): void {
    this.editor.invalidate();
    this.search.invalidate();
  }
}
