/**
 * The lobby inside pi: one runtime per interactive session. It mounts the
 * full-screen view as an overlay on pi's own TUI (captured through a zero-line
 * anchor widget, so pi does not treat the lobby as a blocking dialog), steps
 * aside while a real dialog asks the user something, narrates the Master's own
 * turn into the feed, passes plan comments to the Master that owns a task and
 * records each Master turn in the metrics log.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Key, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import { TERMINAL_STATES } from "../schemas/task.ts";
import { listTasks, loadTask } from "../state/persistence.ts";
import { detectProjectRoot, loadConfig, saveConfig } from "../state/project.ts";
import { addPlanComment, commentMessage, markCommentsDelivered, readPlanComments, undeliveredComments } from "../state/comments.ts";
import { discardPlannedTask, listPlannedTasks, markPlannedTaskStarted, plannedTaskRequest, type PlannedTask } from "../state/backlog.ts";
import { appendMetrics, readMetrics, type MetricStatus } from "../state/metrics.ts";
import { describeToolCall } from "../pi/activity.ts";
import { applyStatus, currentZenTask, isMinimized, onMinimizeChange, onRunUpdates, setMinimized, setWidgetSuppressor, ZenScene, zenSnapshot } from "../pi/ui.ts";
import { isSubagentProcess } from "../pi/quiet.ts";
import { modelRef, resolveLobbyProfile, resolvePanelProfile } from "../pi/model-support.ts";
import { modelLookup } from "../pi/tools.ts";
import { startTask } from "../pi/start-task.ts";
import type { LobbyAgentKind, LobbyPanel, PanelMember } from "../schemas/configuration.ts";
import { chatFromEntries, chatText, lobbyFeed, textOf } from "./feed.ts";
import { answerMessage, dialogAsker, loadAskTool, questionnaires, toolAsker, type Asker } from "./ask.ts";
import { QuickFixQueue } from "./quickfix.ts";
import { PlanningSession, type PlannerSeed } from "./planner.ts";
import { execCommand, IssuesState } from "./issues.ts";
import { LobbyView, type LobbyHost, type TabId } from "./view.ts";
import type { LobbyTheme } from "./layout.ts";
import { createMarkdownRenderer } from "./markdown.ts";
import { openEntrySettings, openSettings } from "../pi/settings-ui.ts";

export const ANCHOR_KEY = "bot-lobby-anchor";
/** How often the owning session looks for new plan comments. */
export const COMMENT_POLL_MS = 3000;

interface Runtime {
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
  scene: ZenScene;
  quickfix: QuickFixQueue;
  planner?: PlanningSession;
  issues: IssuesState;
  poll?: ReturnType<typeof setInterval>;
  unsubscribeFeed?: () => void;
  /** The ask-user-question tool (or pi's dialogs), loaded once on first use. */
  asker?: Promise<Asker>;
  /** A questionnaire is on screen. */
  asking: boolean;
  /** The lobby turned the terminal's mouse reporting on (pi's regular screen only). */
  mouse: boolean;
  /** Settings opened from the lobby are on screen; the lobby stays aside until they close. */
  inSettings: boolean;
}

let runtime: Runtime | undefined;

export function isLobbyVisible(): boolean {
  return runtime?.visible === true;
}

function rerender(): void {
  if (runtime?.visible) runtime.tui?.requestRender();
}

function sessionModel(ctx: ExtensionContext): string | undefined {
  return ctx.model ? modelRef(ctx.model) : undefined;
}

function lobbyProfile(state: Runtime, kind: LobbyAgentKind) {
  return resolveLobbyProfile(loadConfig(), kind, {
    lookup: modelLookup(state.ctx),
    sessionModel: sessionModel(state.ctx),
    warn: (message) => state.ctx.ui.notify(message, "warning"),
  });
}

/** Pass new comments on this session's task to its Master (held while minimized or paused). */
export function deliverComments(): number {
  const state = runtime;
  if (!state || isMinimized()) return 0;
  const task = currentZenTask();
  if (!task || task.paused || TERMINAL_STATES.includes(task.state)) return 0;
  const fresh = undeliveredComments(readPlanComments(state.root, state.configDir, task.id));
  if (fresh.length === 0) return 0;
  const current = loadTask(state.root, state.configDir, task.id) ?? task;
  state.pi.sendUserMessage(commentMessage(task.id, fresh, Boolean(current.plan)), state.ctx.isIdle() ? undefined : { deliverAs: "steer" });
  markCommentsDelivered(state.root, state.configDir, task.id, fresh.map((comment) => comment.id));
  lobbyFeed.log("LOBBY", `passed ${fresh.length} plan comment${fresh.length === 1 ? "" : "s"} on ${task.id} to the oracle`, "info");
  return fresh.length;
}

function addComment(state: Runtime, taskId: string, text: string): string {
  const task = loadTask(state.root, state.configDir, taskId);
  if (!task) return `no task ${taskId}`;
  if (TERMINAL_STATES.includes(task.state)) return `${taskId} is ${task.state}; there is no plan left to change`;
  const sessionId = state.ctx.sessionManager.getSessionId();
  try {
    addPlanComment(state.root, state.configDir, taskId, text, sessionId);
  } catch (error) {
    return (error as Error).message;
  }
  lobbyFeed.log("LOBBY", `comment on ${taskId}'s plan saved`, "info");
  if (task.ownerSessionId === sessionId) {
    if (deliverComments() === 0) return `comment saved — it reaches the oracle once ${taskId} is resumed or restored`;
    return `comment sent to the oracle — it will ${task.plan ? "amend the plan" : "revise the proposal"}`;
  }
  if (!task.ownerSessionId) return `comment saved — ${taskId} has no owning session; it is delivered once a session claims it`;
  return `comment saved — the session driving ${taskId} passes it to its oracle`;
}

function failed(state: Runtime, what: string, error: Error): void {
  lobbyFeed.log("LOBBY", `${what} — ${error.message}`, "error");
  state.ctx.ui.notify(`bot-lobby: ${what} — ${error.message}`, "error");
}

function toOracle(state: Runtime, text: string): string | undefined {
  const busy = !state.ctx.isIdle();
  if (text.startsWith("/")) {
    state.pi.sendUserMessage(text, { expandPromptTemplates: true, ...(busy ? { deliverAs: "followUp" as const } : {}) });
    return `sent ${text.split(/\s+/)[0]} to pi (built-in commands need the lobby hidden: alt+l)`;
  }
  if (!currentZenTask()) {
    startTask(state.pi, state.ctx, state.configDir, text).catch((error: Error) => failed(state, "could not start the task", error));
    return "starting a task — the oracle takes it from here";
  }
  state.pi.sendUserMessage(text, busy ? { deliverAs: "steer" } : undefined);
  return undefined;
}

function startPlanned(state: Runtime, plan: PlannedTask): string {
  const current = currentZenTask();
  if (current) return `this session already drives ${current.id}; finish or cancel it first, or start ${plan.id} from another session`;
  startTask(state.pi, state.ctx, state.configDir, plannedTaskRequest(plan))
    .then((task) => {
      if (!task) return;
      markPlannedTaskStarted(state.root, state.configDir, plan.id, task.id);
      state.view?.setTab("lobby");
      rerender();
    })
    .catch((error: Error) => failed(state, `could not start ${plan.id}`, error));
  return `starting ${plan.id} as a task…`;
}

function seatProfile(state: Runtime, member: PanelMember) {
  return resolvePanelProfile(loadConfig(), member, {
    lookup: modelLookup(state.ctx),
    sessionModel: sessionModel(state.ctx),
    warn: (message) => state.ctx.ui.notify(message, "warning"),
  });
}

function newPlanner(state: Runtime, seed?: PlannerSeed, seats?: readonly PanelMember[]): PlanningSession {
  state.planner?.cancel();
  const config = loadConfig();
  const workflow = config.workflow;
  state.planner = new PlanningSession({
    cwd: state.ctx.cwd,
    root: state.root,
    configDir: state.configDir,
    profile: () => lobbyProfile(state, "planner"),
    memberProfile: (member) => seatProfile(state, member),
    panel: seats ?? config.lobby.planningPanel,
    stallTimeoutMs: workflow.stallTimeoutMs,
    toolStallTimeoutMs: workflow.toolStallTimeoutMs,
    feed: lobbyFeed,
    onChange: rerender,
    onRound: (session) => {
      // Put the questions to the user at once when they are looking at the Plan tab.
      if (loadConfig().lobby.autoAsk && state.visible && state.view?.tab === "plan" && session.awaitingAnswers) void answerPanel(state);
    },
  }, seed);
  return state.planner;
}

/** The library's questionnaire when it loads, pi's own dialogs otherwise. */
function panelAsker(state: Runtime): Promise<Asker> {
  state.asker ??= loadAskTool(state.pi).then((tool) => (tool ? toolAsker(tool) : dialogAsker()));
  return state.asker;
}

/**
 * The oracle puts the round's questions to the user, one at a time; answered
 * questionnaires are kept if the user stops, so the next call resumes there.
 * Once every questionnaire is done, the answers (and any line comments) start
 * the next round. Returns a notice for the lobby.
 */
export async function answerPanel(state: Runtime | undefined = runtime): Promise<string> {
  const session = state?.planner;
  if (!state || !session) return "no planning session";
  if (session.busy) return "the panel is still thinking";
  if (session.questions.length === 0) return "no open questions";
  if (state.asking) return "the questions are already open";
  state.asking = true;
  try {
    const asker = await panelAsker(state);
    const chunks = questionnaires(session.questions);
    for (let index = session.answered.length; index < chunks.length; index++) {
      const result = await asker(chunks[index]!, state.ctx);
      if (result.cancelled) {
        rerender();
        return session.answered.length > 0 ? `answers kept — ${chunks.length - session.answered.length} questionnaire${chunks.length - session.answered.length === 1 ? "" : "s"} left; enter resumes` : "questions put away — enter brings them back";
      }
      session.answered = [...session.answered, result];
    }
    const message = answerMessage(session.questions, session.answered);
    if (!message) {
      session.answered = [];
      return "nothing was answered — the questions stay open";
    }
    void session.send(message);
    return "answers sent — the panel is on the next round";
  } catch (error) {
    return `could not put the questions: ${(error as Error).message}`;
  } finally {
    state.asking = false;
    rerender();
  }
}

const renderMarkdown = createMarkdownRenderer();
const lobbyThemes = new WeakMap<Theme, LobbyTheme>();

/** pi's theme as the lobby draws with it, plus Markdown rendering; one wrapper per theme so caches stay warm. */
function lobbyTheme(theme: Theme): LobbyTheme {
  let wrapped = lobbyThemes.get(theme);
  if (!wrapped) {
    wrapped = {
      fg: (color, text) => theme.fg(color, text),
      bold: (text) => theme.bold(text),
      italic: (text) => theme.italic(text),
      bg: (color, text) => theme.bg(color, text),
      markdown: renderMarkdown,
    };
    lobbyThemes.set(theme, wrapped);
  }
  return wrapped;
}

function host(state: Runtime, tui: TUI): LobbyHost {
  return {
    rows: () => tui.terminal.rows,
    theme: () => lobbyTheme(state.ctx.ui.theme),
    sessionId: () => state.ctx.sessionManager.getSessionId(),
    zen: () => {
      const snapshot = zenSnapshot();
      return { ...(snapshot.task ? { task: snapshot.task } : {}), runs: snapshot.runs };
    },
    // The scene's height budget is 3/4 of the rows it is given.
    scene: (width, height, animated) => state.scene.lines(width, Math.floor(height / 0.75), state.ctx.ui.theme, Date.now(), !animated),
    advanceScene: (now) => {
      state.scene.advance(now);
      return state.scene.delay(now);
    },
    feed: lobbyFeed,
    masterBusy: () => !state.ctx.isIdle(),
    tasks: () => listTasks(state.root, state.configDir),
    plans: () => listPlannedTasks(state.root, state.configDir),
    comments: (taskId) => readPlanComments(state.root, state.configDir, taskId),
    metrics: () => readMetrics(state.root, state.configDir),
    toOracle: (text) => toOracle(state, text),
    comment: (taskId, text) => addComment(state, taskId, text),
    startPlanned: (plan) => startPlanned(state, plan),
    discardPlan: (id) => discardPlannedTask(state.root, state.configDir, id),
    abortMaster: () => state.ctx.abort(),
    hide: () => hideLobby(),
    quickfix: state.quickfix,
    planner: () => state.planner,
    newPlanner: (seed, seats) => newPlanner(state, seed, seats),
    answerPanel: () => answerPanel(state),
    defaultPanel: () => loadConfig().lobby.planningPanel,
    issuesEnabled: () => loadConfig().lobby.issues,
    panels: () => loadConfig().lobby.panels,
    savePanels: (panels) => savePanels(panels),
    keys: () => loadConfig().lobby.keys,
    openSettings: (entry) => lobbySettings(state, entry),
    seatLabel: (member) => {
      const profile = seatProfile(state, member);
      return `${profile.model ?? "session model"} · ${profile.thinking}`;
    },
    issues: state.issues,
    profileLabel: (kind) => {
      const profile = lobbyProfile(state, kind);
      return `${profile.model ?? "session model"} · ${profile.thinking}`;
    },
    requestRender: () => tui.requestRender(),
  };
}

/**
 * bot-lobby's settings (or one agent's entry) from inside the lobby. The
 * lobby stays aside for the whole visit, not only for each menu, so it does
 * not flash between them, and rereads the config when it comes back.
 */
async function lobbySettings(state: Runtime, entry?: "quickfix" | "planner"): Promise<void> {
  if (state.inSettings) return;
  state.inSettings = true;
  setMouse(state, false);
  state.handle?.setHidden(true);
  try {
    if (entry) await openEntrySettings(state.pi, state.ctx, entry);
    else await openSettings(state.pi, state.ctx);
  } catch (error) {
    state.ctx.ui.notify(`bot-lobby: settings failed — ${(error as Error).message}`, "warning");
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
  const state = runtime;
  if (!state?.visible || !state.handle || state.inSettings) return;
  state.asideForPrompt = true;
  setMouse(state, false);
  state.handle.setHidden(true);
}

function promptEnded(): void {
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
  if (state.poll) clearInterval(state.poll);
  setMouse(state, false);
  state.unsubscribeFeed?.();
  state.quickfix.cancelAll();
  state.planner?.cancel();
  state.view?.dispose();
  state.handle?.hide();
  setWidgetSuppressor(() => false);
  onRunUpdates(undefined);
  onMinimizeChange(undefined);
}

/** Create the session's lobby runtime (interactive master sessions only). */
export function initLobby(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string): void {
  shutdown();
  if (isSubagentProcess() || ctx.mode !== "tui") return;
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
    scene: new ZenScene(),
    quickfix: undefined as unknown as QuickFixQueue,
    issues: new IssuesState(execCommand, ctx.cwd, rerender),
  };
  state.quickfix = new QuickFixQueue({
    cwd: ctx.cwd,
    root,
    configDir,
    profile: () => lobbyProfile(state, "quickfix"),
    stallTimeoutMs: workflow.stallTimeoutMs,
    toolStallTimeoutMs: workflow.toolStallTimeoutMs,
    feed: lobbyFeed,
    onChange: rerender,
    notify: (message, level) => {
      if (!state.visible) ctx.ui.notify(message, level);
    },
  });
  runtime = state;
  lobbyFeed.clear();
  lobbyFeed.seedChat(chatFromEntries(ctx.sessionManager.getBranch()));
  state.unsubscribeFeed = lobbyFeed.onChange(rerender);
  setWidgetSuppressor(() => runtime?.visible === true);
  onRunUpdates((runs) => lobbyFeed.runs(runs));
  onMinimizeChange((value) => {
    if (value) hideLobby();
  });
  // Capture pi's TUI through a zero-line widget below the editor.
  ctx.ui.setWidget(ANCHOR_KEY, (tui) => {
    state.tui = tui;
    return { render: () => [], invalidate: () => {} };
  }, { placement: "belowEditor" });
  state.poll = setInterval(() => deliverComments(), COMMENT_POLL_MS);
  state.poll.unref?.();
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
    autoOpenLobby();
  });
  pi.on("session_shutdown", () => shutdown());
  pi.on("ui_prompt_start", () => promptStarted());
  pi.on("ui_prompt_end", () => promptEnded());
  pi.on("agent_start", (_event, ctx) => {
    track(ctx);
    const taskId = currentZenTask()?.id;
    turn = { startedAt: Date.now(), ...(taskId ? { taskId } : {}), ...(ctx.model ? { model: modelRef(ctx.model) } : {}), thinking: pi.getThinkingLevel(), tools: 0, turns: 0, input: 0, output: 0, cost: 0 };
  });
  pi.on("tool_execution_start", (event) => {
    if (turn) turn.tools += 1;
    lobbyFeed.begin("MASTER", describeToolCall(event.toolName, event.args), event.toolCallId);
  });
  pi.on("tool_execution_end", (event) => lobbyFeed.end(event.toolCallId, event.isError));
  pi.on("message_update", (event) => {
    const update = event.assistantMessageEvent;
    if (update.type === "thinking_delta") lobbyFeed.thinkDelta("MASTER", update.delta);
    else if (update.type === "thinking_end") lobbyFeed.thinkEnd("MASTER", update.content);
    else if (update.type === "text_delta") lobbyFeed.replyDelta(update.delta);
  });
  pi.on("message_end", (event) => {
    const message = event.message as { role?: string; content?: unknown; stopReason?: string; errorMessage?: string; usage?: { input?: number; output?: number; cost?: { total?: number } } };
    if (message.role === "assistant") {
      lobbyFeed.replyEnd();
      lobbyFeed.thinkEnd("MASTER");
      if (message.stopReason === "error") {
        const error = (message.errorMessage ?? "the model call failed").split("\n")[0]!;
        lobbyFeed.say("note", `✗ the oracle's turn failed: ${error}`);
        lobbyFeed.log("MASTER", `turn failed — ${error}`, "error");
      }
      if (turn) {
        turn.turns += 1;
        turn.input += message.usage?.input ?? 0;
        turn.output += message.usage?.output ?? 0;
        turn.cost += message.usage?.cost?.total ?? 0;
      }
    }
    if (message.role !== "user" && message.role !== "assistant") return;
    for (const line of chatText(message.role, textOf(message.content))) lobbyFeed.say(line.role, line.text);
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
  });
}
