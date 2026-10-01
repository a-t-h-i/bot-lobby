/**
 * The lobby inside pi: one runtime per interactive session. It mounts the
 * full-screen view as an overlay on pi's own TUI (captured through a zero-line
 * anchor widget, so pi does not treat the lobby as a blocking dialog), steps
 * aside while a real dialog asks the user something, narrates the Master's own
 * turn into the feed, passes plan comments to the Master that owns a task and
 * records each Master turn in the metrics log.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Key, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import { detectProjectRoot, loadConfig, saveConfig } from "../state/project.ts";
import { appendMetrics, type MetricStatus } from "../state/metrics.ts";
import { describeToolCall } from "../pi/activity.ts";
import { applyStatus, currentZenTask, isMinimized, onMinimizeChange, onRunUpdates, setMinimized, taskSnapshot } from "../pi/ui.ts";
import type { WorkspaceInfo } from "../execution/workspace.ts";
import { basename } from "node:path";
import { isSubagentProcess } from "../pi/quiet.ts";
import { modelRef } from "../pi/model-support.ts";
import { modelLookup } from "../pi/tools.ts";
import { setQuickFixHandoff } from "../pi/route.ts";
import { currentWebServer } from "../webui/server.ts";
import type { Domain } from "../schemas/agent.ts";
import type { LobbyPanel } from "../schemas/configuration.ts";
import { chatFromEntries, lobbyFeed, narrateEvent, type AgentEventLike } from "./feed.ts";
import { classifier, effortFor, hintsFor } from "../classifier/instance.ts";
import { checkThinking } from "../pi/model-support.ts";
import { jobTitle, QuickFixQueue } from "./quickfix.ts";
import type { Asker } from "./ask.ts";
import { miniLine, type MiniInput } from "./mini.ts";
import type { PlanningSession } from "./planner.ts";
import { execCommand, IssuesState } from "./issues.ts";
import { PullsState } from "./pulls.ts";
import { PullReviews } from "./pr-review.ts";
import { KnowledgeBook } from "./knowledge.ts";
import { ExcalidrawBook } from "../excalidraw/sessions.ts";
import { LobbyView, type LobbyHost, type TabId } from "./view.ts";
import { createLobbyService, lobbyProfile, miniShown, repaintLobby, reviewProfile, seatProfile, setServiceState, takeReopenAfterSwitch, savePlan as serviceSavePlan, answerPanel as serviceAnswerPanel, type LobbyService } from "./service.ts";
import { lobbyTopics } from "./topics.ts";
import { promptHub } from "./prompt-hub.ts";
export { backgroundSessions, FRAME_MS, setSessionLauncher } from "./service.ts";
import { lobbyTheme } from "./theme.ts";
import { deliverComments, onOwnerEvent } from "../pi/owner.ts";
import { openEntrySettings, openSettings } from "../pi/settings-ui.ts";

export const ANCHOR_KEY = "bot-lobby-anchor";
export { deliverComments };

export interface Runtime {
  pi: ExtensionAPI;
  configDir: string;
  ctx: ExtensionContext;
  root: string;
  tui?: TUI;
  view?: LobbyView;
  handle?: OverlayHandle;
  visible: boolean;
  /** Stepped aside while pi shows a dialog. */
  asideForPrompt: boolean;
  quickfix: QuickFixQueue;
  planner?: PlanningSession;
  issues: IssuesState;
  pulls: PullsState;
  reviews: PullReviews;
  knowledge: KnowledgeBook;
  excalidraw: ExcalidrawBook;
  unsubscribeFeed?: () => void;
  /** The terminal's subscription to every topic (repaints, as before). */
  unsubscribeTopics?: () => void;
  /** The terminal's registration as the hub's only prompt surface. */
  unregisterTerminalSurface?: () => void;
  /** Puts the panel's questions to the user: the questionnaire unless a test sets another. */
  asker?: Asker;
  /** A questionnaire is on screen. */
  asking: boolean;
  /** The lobby turned the terminal's mouse reporting on (pi's regular screen only). */
  mouse: boolean;
  /** Settings opened from the lobby are on screen; the lobby stays aside until they close. */
  inSettings: boolean;
  /** The repository (or folder) and branch the lobby's title shows, and whether git is being asked now. */
  workspace: WorkspaceInfo;
  readingWorkspace: boolean;
}

let runtime: Runtime | undefined;
let lobbyService: LobbyService | undefined;

/** The lobby's backend, once its service has started (terminal and web alike). */
export function currentLobbyService(): LobbyService | undefined {
  return lobbyService;
}

export function isLobbyVisible(): boolean {
  return runtime?.visible === true;
}

/** The lobby's view, once it has been shown (tests drive it through this). */
export function lobbyView(): LobbyView | undefined {
  return runtime?.view;
}

/** Repaint through the lobby service's frame throttle (see service.ts). */
function rerender(): void {
  repaintLobby();
}

/** What the status line shows: the task, the planning round, the quick fix in hand. */
function miniInput(state: Runtime): MiniInput {
  const snapshot = taskSnapshot();
  const planner = state.planner;
  const job = state.quickfix.running ?? state.quickfix.jobs.find((entry) => entry.status === "queued");
  const queued = state.quickfix.jobs.filter((entry) => entry.status === "queued" && entry !== job).length;
  const webLink = currentWebServer()?.link;
  return {
    ...(snapshot.task ? { task: snapshot.task } : {}),
    runs: snapshot.runs,
    ...(planner ? { planning: { busy: planner.busy, round: planner.turns, limit: loadConfig().lobby.maxPlanningRounds, questions: planner.awaitingAnswers ? planner.questions.length : 0, ready: planner.reply?.status === "ready", saved: Boolean(planner.saved) } } : {}),
    ...(job ? { quickfix: { title: jobTitle(job), running: job.status === "running", queued } } : {}),
    ...(webLink ? { webLink } : {}),
    key: "Alt+L",
  };
}

/** Save the plan as a pending task; the service holds the implementation. */
export async function savePlan(state: Runtime | undefined = runtime): Promise<string> {
  return serviceSavePlan(state);
}

/** Put the panel's open questions to the user; the service holds the implementation. */
export async function answerPanel(state: Runtime | undefined = runtime): Promise<string> {
  return serviceAnswerPanel(state);
}

function host(state: Runtime, tui: TUI): LobbyHost {
  return {
    ...createLobbyService(state),
    rows: () => tui.terminal.rows,
    theme: () => lobbyTheme(state.ctx.ui.theme),
    hide: () => hideLobby(),
    panels: () => loadConfig().lobby.panels,
    savePanels: (panels) => savePanels(panels),
    keys: () => loadConfig().lobby.keys,
    openSettings: (entry) => lobbySettings(state, entry),
    editText: (title, text) => editText(state, title, text),
    requestRender: () => tui.requestRender(),
  };
}

/**
 * Run something pi draws itself (its settings menus, its multi-line editor)
 * with the lobby stepped aside for the whole visit, not only for each dialog,
 * so it does not flash between them; the lobby rereads the config after.
 */
async function whileAside<T>(state: Runtime, run: () => Promise<T>, failure: string): Promise<T | undefined> {
  if (state.inSettings) return undefined;
  state.inSettings = true;
  setMouse(state, false);
  state.handle?.setHidden(true);
  try {
    return await run();
  } catch (error) {
    state.ctx.ui.notify(`bot-lobby: ${failure} — ${(error as Error).message}`, "warning");
    return undefined;
  } finally {
    state.inSettings = false;
    state.asideForPrompt = false;
    if (state.visible && state.handle) {
      state.handle.setHidden(false);
      state.handle.focus();
      setMouse(state, true);
    }
    state.view?.reloadConfig();
    rerender();
  }
}

/** bot-lobby's settings (or one agent's entry) from inside the lobby. */
async function lobbySettings(state: Runtime, entry?: "quickfix" | "planner"): Promise<void> {
  await whileAside(state, () => (entry ? openEntrySettings(state.pi, state.ctx, entry) : openSettings(state.pi, state.ctx)), "settings failed");
}

/** A text edited in pi's multi-line editor (Enter saves, Shift+Enter is a new line); undefined when cancelled. */
async function editText(state: Runtime, title: string, text: string): Promise<string | undefined> {
  return whileAside(state, () => state.ctx.ui.editor(title, text), "the editor failed");
}

/** Remember which panes show, keeping every other setting as the file has it now. */
function savePanels(panels: Record<LobbyPanel, boolean>): void {
  try {
    const config = loadConfig();
    saveConfig({ ...config, lobby: { ...config.lobby, panels: { ...panels } } });
  } catch {
    // A read-only config only means the choice lasts for this session.
  }
}

/** SGR mouse reporting: presses, releases and the wheel, in cell coordinates. */
const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1006l\x1b[?1000l";

/**
 * In pi's regular screen nothing reports the mouse, so the lobby turns
 * reporting on while it is up (clicks pick tabs and draft lines, the wheel
 * scrolls) and off whenever it steps aside. Full-screen pi reports the mouse
 * itself and hands the events to the lobby.
 */
function setMouse(state: Runtime, on: boolean): void {
  const tui = state.tui;
  if (!tui || tui.mode === "fullscreen") return;
  const want = on && loadConfig().lobby.mouse;
  if (want === state.mouse) return;
  state.mouse = want;
  tui.terminal.write(want ? MOUSE_ON : MOUSE_OFF);
}

/** Show the lobby (optionally on `tab`); false when there is no interactive TUI. */
export function showLobby(tab?: TabId): boolean {
  const state = runtime;
  if (!state?.tui) return false;
  if (isMinimized()) setMinimized(false);
  if (!state.view || !state.handle) {
    const theme = state.ctx.ui.theme;
    state.view = new LobbyView(state.tui, host(state, state.tui), { borderColor: (text) => theme.fg("border", text), selectList: getSelectListTheme() });
    state.handle = state.tui.showOverlay(state.view, { width: "100%", maxHeight: "100%", anchor: "top-left" });
  } else {
    state.handle.setHidden(false);
    state.handle.focus();
  }
  state.visible = true;
  state.asideForPrompt = false;
  if (tab) state.view.setTab(tab);
  state.view.start();
  setMouse(state, true);
  applyStatus(state.ctx, state.root, state.configDir);
  state.tui.requestRender();
  return true;
}

export function hideLobby(): void {
  const state = runtime;
  if (!state?.view || !state.visible) return;
  state.visible = false;
  state.asideForPrompt = false;
  setMouse(state, false);
  state.view.stop();
  state.handle?.setHidden(true);
  applyStatus(state.ctx, state.root, state.configDir);
  state.tui?.requestRender();
}

export function toggleLobby(): boolean {
  if (isLobbyVisible()) {
    hideLobby();
    return true;
  }
  return showLobby();
}

/** Open the lobby when this session drives a task and the config asks for it. */
export function autoOpenLobby(): void {
  if (runtime && loadConfig().lobby.autoOpen && currentZenTask()) showLobby("lobby");
}

/** Step aside while pi shows a dialog (an approval, a question), and come back after. */
function promptStarted(): void {
  lobbyTopics.bump("status");
  const state = runtime;
  if (!state?.visible || !state.handle || state.inSettings) return;
  state.asideForPrompt = true;
  setMouse(state, false);
  state.handle.setHidden(true);
}

function promptEnded(): void {
  lobbyTopics.bump("status");
  const state = runtime;
  if (!state?.asideForPrompt || !state.handle || state.inSettings) return;
  state.asideForPrompt = false;
  if (!state.visible) return;
  state.handle.setHidden(false);
  setMouse(state, true);
}

function shutdown(): void {
  const state = runtime;
  if (!state) return;
  runtime = undefined;
  lobbyService = undefined;
  setServiceState(undefined);
  setQuickFixHandoff(undefined);
  setMouse(state, false);
  state.unsubscribeFeed?.();
  state.unsubscribeTopics?.();
  state.unregisterTerminalSurface?.();
  state.quickfix.cancelAll();
  state.reviews.cancelAll();
  state.planner?.cancel();
  state.view?.dispose();
  state.handle?.hide();
  onRunUpdates(undefined);
  onMinimizeChange(undefined);
}

/**
 * The oracle routed a request to the quick-fix agent: queue it (no "looks like
 * a task" hold, the oracle already decided), on its builder's settings when it
 * is a quick feature, and show it on the Quick fix tab.
 */
function handToQuickFix(state: Runtime, request: string, builder: Domain | undefined, reason: string): string {
  const quick = lobbyProfile(state, "quickfix");
  const profile = builder ? { ...seatProfile(state, builder), instructions: quick.instructions } : undefined;
  const job = state.quickfix.submit(request, Date.now(), {
    force: true,
    ...(profile ? { profile } : {}),
    note: `The oracle sent your request here: ${reason.replace(/[.\s]+$/, "")}.${builder ? ` A quick feature: it runs on ${builder === "designer" ? "DESIGN" : "DEV"}'s model, thinking and time limit.` : ""}`,
  });
  showLobby("quickfix");
  lobbyTopics.bump("quickfix");
  state.view?.showQuickFix(job.id);
  return job.id;
}

/** Whether the web server wants the lobby service without the terminal (a later step flips this on). */
function webServerOn(): boolean {
  return false;
}

/**
 * Start the lobby's backend: state, service and background wiring. Runs in
 * the terminal and, once the web server exists, whenever it is on.
 */
export function startLobbyService(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string): Runtime | undefined {
  shutdown();
  if (isSubagentProcess() || (ctx.mode !== "tui" && !webServerOn())) return undefined;
  const root = detectProjectRoot(ctx.cwd, configDir);
  const workflow = loadConfig().workflow;
  const state: Runtime = {
    pi,
    configDir,
    ctx,
    root,
    visible: false,
    asideForPrompt: false,
    asking: false,
    mouse: false,
    inSettings: false,
    workspace: { name: basename(ctx.cwd) || ctx.cwd },
    readingWorkspace: false,
    quickfix: undefined as unknown as QuickFixQueue,
    issues: new IssuesState(execCommand, ctx.cwd, () => {
      lobbyTopics.bump("issues");
      rerender();
    }),
    pulls: new PullsState(execCommand, ctx.cwd, () => {
      lobbyTopics.bump("git");
      rerender();
    }),
    reviews: undefined as unknown as PullReviews,
    knowledge: new KnowledgeBook({
      root,
      configDir,
      threshold: () => loadConfig().knowledge.compactionThreshold,
      backups: () => loadConfig().knowledge.backupCount,
      sessionId: () => ctx.sessionManager.getSessionId(),
    }),
    excalidraw: new ExcalidrawBook({ root }),
  };
  state.reviews = new PullReviews({
    cwd: ctx.cwd,
    root,
    configDir,
    exec: execCommand,
    profile: () => reviewProfile(state),
    stallTimeoutMs: workflow.stallTimeoutMs,
    toolStallTimeoutMs: workflow.toolStallTimeoutMs,
    feed: lobbyFeed,
    onChange: () => {
      lobbyTopics.bump("git");
      rerender();
    },
    notify: (message, level) => {
      lobbyTopics.bump("notices");
      if (!state.visible) ctx.ui.notify(message, level);
    },
    classifier: classifier(),
  });
  state.quickfix = new QuickFixQueue({
    cwd: ctx.cwd,
    root,
    configDir,
    profile: () => lobbyProfile(state, "quickfix"),
    stallTimeoutMs: workflow.stallTimeoutMs,
    toolStallTimeoutMs: workflow.toolStallTimeoutMs,
    feed: lobbyFeed,
    onChange: () => {
      lobbyTopics.bump("quickfix");
      rerender();
    },
    notify: (message, level) => {
      lobbyTopics.bump("notices");
      if (!state.visible) ctx.ui.notify(message, level);
    },
    hints: hintsFor({ cwd: ctx.cwd, root, configDir }),
    classifier: classifier(),
    effort: effortFor((model, thinking) => checkThinking(modelLookup(ctx)(model), thinking).level),
  });
  runtime = state;
  lobbyService = createLobbyService(state);
  setServiceState(state);
  // Topic routing (src/lobby/topics.ts): the terminal hears every topic and
  // repaints, as before. Sources bump on their way to rerender — lobbyFeed
  // (lobby), run updates (tasks), quick fix (quickfix), planner (planner),
  // background sessions (sessions), metrics (metrics), pulls/reviews (git),
  // issues (issues), the prompt hub (prompts), owner/notify events (notices),
  // dialogs/busy/workspace (status), link checks (excalidraw). File polling
  // for tasks/plans/knowledge starts once a non-terminal listener attaches.
  state.unsubscribeTopics = lobbyTopics.onChange(rerender);
  state.unregisterTerminalSurface = promptHub.registerSurface({ name: "terminal", show() {}, withdraw() {} });
  setQuickFixHandoff((request, builder, reason) => (runtime === state ? handToQuickFix(state, request, builder, reason) : undefined));
  lobbyFeed.clear();
  // Only the newest messages are kept; the feed learns whether earlier ones exist, and loads them when scrolled to.
  lobbyFeed.seedChat(chatFromEntries(ctx.sessionManager.getBranch(), Number.POSITIVE_INFINITY));
  state.unsubscribeFeed = lobbyFeed.onChange(() => {
    lobbyTopics.bump("lobby");
    rerender();
  });
  onRunUpdates((runs) => {
    lobbyFeed.runs(runs);
    lobbyTopics.bump("tasks");
  });
  onMinimizeChange((value) => {
    if (value) hideLobby();
  });
  // The owner's clock (pi/owner.ts) delivers comments and messages and drives auto mode; the lobby logs what it did.
  onOwnerEvent((event) => {
    lobbyTopics.bump("notices");
    if (event.kind === "comments") lobbyFeed.log("LOBBY", `passed ${event.count} plan comment${event.count === 1 ? "" : "s"} on ${event.taskId} to the oracle`, "info");
    else if (event.kind === "inbox" || event.kind === "messages") lobbyFeed.log("LOBBY", `passed ${event.count} message${event.count === 1 ? "" : "s"} from another session to the oracle`, "info");
    else if (event.kind === "auto") lobbyFeed.log("LOBBY", `auto mode ${event.on ? "on" : "off"} for ${event.taskId}`, event.on ? "success" : "info");
    else if (event.kind === "nudge") lobbyFeed.log("LOBBY", `auto mode: keeping the oracle going on ${event.taskId}`, "info");
    else lobbyFeed.log("LOBBY", `auto mode: no progress on ${event.taskId} — it needs you`, "warning");
    rerender();
  });
  return state;
}

/** Mount the terminal overlay: the zero-line anchor widget that captures pi's TUI. Runs only in the terminal. */
function mountTerminalLobby(state: Runtime): void {
  const ctx = state.ctx;
  // Capture pi's TUI through a zero-line widget below the editor.
  ctx.ui.setWidget(ANCHOR_KEY, (tui) => {
    state.tui = tui;
    // Zero lines while the lobby is up (or bot-lobby is minimized); one status line when it is hidden.
    return { render: (width: number) => (miniShown(state) ? [miniLine(miniInput(state), width, lobbyTheme(state.ctx.ui.theme))] : []), invalidate: () => {} };
  }, { placement: "belowEditor" });
}

/** Create the session's lobby runtime (interactive master sessions only). */
export function initLobby(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string): void {
  const state = startLobbyService(pi, ctx, configDir);
  if (state && ctx.mode === "tui") mountTerminalLobby(state);
}

interface MasterTurn {
  startedAt: number;
  /** The task the turn worked on; kept from the start so the turn that completes it still counts. */
  taskId?: string;
  model?: string;
  thinking: string;
  tools: number;
  turns: number;
  input: number;
  output: number;
  cost: number;
}

function turnStatus(messages: readonly unknown[]): MetricStatus {
  const last = [...messages].reverse().find((message) => (message as { role?: string })?.role === "assistant") as { stopReason?: string } | undefined;
  if (last?.stopReason === "aborted") return "cancelled";
  if (last?.stopReason === "error") return "failed";
  return "success";
}

/** Narrate the Master's own turn into the feed and record it as a metric; the lobby follows pi's dialogs. */
export function registerLobbyEvents(pi: ExtensionAPI, configDir: string): void {
  if (isSubagentProcess()) return;
  let turn: MasterTurn | undefined;
  const track = (ctx: ExtensionContext) => {
    if (runtime) runtime.ctx = ctx;
  };
  pi.registerShortcut(Key.alt("l"), {
    description: "bot-lobby: open or hide the lobby",
    handler: (ctx) => {
      if (!toggleLobby()) ctx.ui.notify("The lobby needs pi's interactive terminal UI.", "warning");
    },
  });
  pi.on("session_start", (_event, ctx) => {
    initLobby(pi, ctx, configDir);
    // A switch asked for from the lobby lands back in the lobby, on the session it switched to.
    if (takeReopenAfterSwitch()) showLobby("lobby");
    else autoOpenLobby();
  });
  pi.on("session_shutdown", () => shutdown());
  pi.on("ui_prompt_start", () => promptStarted());
  pi.on("ui_prompt_end", () => promptEnded());
  pi.on("agent_start", (_event, ctx) => {
    track(ctx);
    lobbyTopics.bump("status");
    const taskId = currentZenTask()?.id;
    turn = { startedAt: Date.now(), ...(taskId ? { taskId } : {}), ...(ctx.model ? { model: modelRef(ctx.model) } : {}), thinking: pi.getThinkingLevel(), tools: 0, turns: 0, input: 0, output: 0, cost: 0 };
  });
  const narrate = (event: AgentEventLike) => narrateEvent(lobbyFeed, event, describeToolCall);
  pi.on("tool_execution_start", (event) => {
    if (turn) turn.tools += 1;
    narrate(event);
  });
  pi.on("tool_execution_end", (event) => narrate(event));
  pi.on("message_update", (event) => narrate(event as AgentEventLike));
  pi.on("message_end", (event) => {
    const message = event.message as { role?: string; usage?: { input?: number; output?: number; cost?: { total?: number } } };
    if (message.role === "assistant" && turn) {
      turn.turns += 1;
      turn.input += message.usage?.input ?? 0;
      turn.output += message.usage?.output ?? 0;
      turn.cost += message.usage?.cost?.total ?? 0;
    }
    narrate(event as AgentEventLike);
  });
  pi.on("agent_end", (event, ctx) => {
    track(ctx);
    const finished = turn;
    turn = undefined;
    lobbyFeed.replyEnd();
    const taskId = finished?.taskId ?? currentZenTask()?.id;
    if (!finished || !taskId || !runtime) return;
    appendMetrics(runtime.root, configDir, [{
      id: `master-${finished.startedAt}`,
      kind: "master",
      agent: "MASTER",
      ...(finished.model ? { model: finished.model } : {}),
      thinking: finished.thinking,
      status: turnStatus(event.messages),
      startedAt: new Date(finished.startedAt).toISOString(),
      durationMs: Date.now() - finished.startedAt,
      ...(finished.turns ? { turns: finished.turns } : {}),
      tools: finished.tools,
      input: finished.input,
      output: finished.output,
      cost: finished.cost,
      taskId,
    }]);
    lobbyTopics.bump("metrics");
    lobbyTopics.bump("status");
  });
}
