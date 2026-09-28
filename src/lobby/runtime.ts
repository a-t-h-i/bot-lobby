/**
 * The lobby inside pi: one runtime per interactive session. It mounts the
 * full-screen view as an overlay on pi's own TUI (captured through a zero-line
 * anchor widget, so pi does not treat the lobby as a blocking dialog), steps
 * aside while a real dialog asks the user something, narrates the Master's own
 * turn into the feed, passes plan comments to the Master that owns a task and
 * records each Master turn in the metrics log.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSelectListTheme, SessionManager } from "@earendil-works/pi-coding-agent";
import { Key, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { loadTask, peekTasks } from "../state/persistence.ts";
import { detectProjectRoot, loadConfig, saveConfig } from "../state/project.ts";
import { addPlanComment, readPlanComments } from "../state/comments.ts";
import { isAutoMode } from "../state/auto.ts";
import { sendToInbox, sendToSession as leaveForSession } from "../state/inbox.ts";
import { livePresence } from "../state/presence.ts";
import { archiveTask as archiveTaskOnDisk, deleteTask as deleteTaskOnDisk, listArchivedTasks, restoreTask as restoreTaskOnDisk } from "../state/archive.ts";
import { discardPlannedTask, listPlannedTasks, type PlannedTask } from "../state/backlog.ts";
import { appendMetrics, readClassifierMetrics, readMetrics, type MetricStatus } from "../state/metrics.ts";
import { describeToolCall } from "../pi/activity.ts";
import { applyStatus, currentZenTask, isMinimized, onMinimizeChange, onRunUpdates, persistedRuns, setMinimized, setWidgetSuppressor, ZenScene, zenSnapshot } from "../pi/ui.ts";
import { panelLines } from "../pi/zen.ts";
import { shortTitle } from "../text.ts";
import { isSubagentProcess } from "../pi/quiet.ts";
import { modelRef, resolveLobbyProfile, resolvePanelProfile } from "../pi/model-support.ts";
import { modelLookup } from "../pi/tools.ts";
import { startPlannedTask } from "../pi/start-task.ts";
import { pendingRequest, setQuickFixHandoff, startRequest } from "../pi/route.ts";
import type { Domain } from "../schemas/agent.ts";
import type { LobbyAgentKind, LobbyPanel, PanelMember } from "../schemas/configuration.ts";
import { chatFromEntries, lobbyFeed, narrateEvent, type AgentEventLike, type ChatEntry } from "./feed.ts";
import { classifier, effortFor, hintsFor } from "../classifier/instance.ts";
import { checkThinking } from "../pi/model-support.ts";
import { launchPi, SessionRegistry, type BackgroundSession, type SessionLauncher } from "./sessions.ts";
import { SessionChats } from "./session-files.ts";
import { answerMessage, askUser, questionnaires, type Asker } from "./ask.ts";
import { QuickFixQueue } from "./quickfix.ts";
import { PlanningSession, type PlannerSeed } from "./planner.ts";
import { execCommand, IssuesState } from "./issues.ts";
import { LobbyView, type LiveSession, type LobbyHost, type SwitchTarget, type TabId } from "./view.ts";
import { lobbyTheme } from "./theme.ts";
import { deliverComments, onOwnerEvent, setAuto } from "../pi/owner.ts";
import { openEntrySettings, openSettings } from "../pi/settings-ui.ts";
import { budgetClock } from "../state/budget.ts";

export const ANCHOR_KEY = "bot-lobby-anchor";
export { deliverComments };

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
  unsubscribeFeed?: () => void;
  /** Puts the panel's questions to the user: the questionnaire unless a test sets another. */
  asker?: Asker;
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

/** The lobby's view, once it has been shown (tests drive it through this). */
export function lobbyView(): LobbyView | undefined {
  return runtime?.view;
}

/** Repaints asked for by what happens in the background (a streamed token, a run update) come at most this often. */
export const FRAME_MS = 40;
let lastFrame = 0;
let frameTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Repaint the lobby for something that happened in the background. A reply
 * streams dozens of events a second; they share frames, at most one per
 * `FRAME_MS`, instead of each asking for its own. Keys repaint at once
 * through pi.
 */
function rerender(): void {
  if (!runtime?.visible || frameTimer) return;
  const wait = lastFrame + FRAME_MS - Date.now();
  const paint = () => {
    frameTimer = undefined;
    lastFrame = Date.now();
    if (runtime?.visible) runtime.tui?.requestRender();
  };
  if (wait <= 0) return paint();
  frameTimer = setTimeout(paint, wait);
  frameTimer.unref?.();
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
  // While the oracle decides where a request goes, what the user types joins that conversation.
  if (!currentZenTask() && !pendingRequest()) {
    startRequest(state.pi, state.ctx, state.configDir, text).catch((error: Error) => failed(state, "could not start the task", error));
    return "reading your request — a quick fix or a task, the oracle takes it from here";
  }
  state.pi.sendUserMessage(text, busy ? { deliverAs: "steer" } : undefined);
  return undefined;
}

function startPlanned(state: Runtime, plan: PlannedTask): string {
  const current = currentZenTask();
  if (current) return `this session already drives ${current.id}; finish or cancel it first, or start ${plan.id} from another session`;
  startPlannedTask(state.pi, state.ctx, state.configDir, plan.id)
    .then((task) => {
      if (typeof task === "string") return failed(state, `could not start ${plan.id}`, new Error(task));
      state.view?.setTab("lobby");
      rerender();
    })
    .catch((error: Error) => failed(state, `could not start ${plan.id}`, error));
  return `starting ${plan.id} here — its agreed plan needs no approval…`;
}

/* ------------------------------------------------- background sessions */

let launcher: SessionLauncher = launchPi;
let registry: SessionRegistry | undefined;
let exitHooked = false;
/** How many questions of each session were already announced, and which exits, so each is said once. */
const announced = new Map<string, number>();
const exitsSaid = new Set<string>();
/** Other sessions' conversations, read from their files. */
const chats = new SessionChats(async () => {
  const state = runtime;
  if (!state) return [];
  const dirs = new Map<string, string | undefined>([[state.ctx.cwd, state.ctx.sessionManager.getSessionDir()]]);
  if (!dirs.has(state.root)) dirs.set(state.root, undefined);
  const lists = await Promise.all([...dirs].map(([cwd, dir]) => SessionManager.list(cwd, dir).catch(() => [])));
  return lists.flat();
}, () => rerender());

/** Launch background sessions with something else (tests); resets the registry. */
export function setSessionLauncher(next: SessionLauncher | undefined): void {
  registry?.stopAll();
  registry = undefined;
  launcher = next ?? launchPi;
  announced.clear();
  exitsSaid.clear();
}

/**
 * The background sessions this window started. The registry belongs to the
 * process, not to one pi session, so switching sessions here keeps them
 * running; they stop when pi exits (each is a saved session `/resume` finds).
 */
function sessionRegistry(): SessionRegistry {
  if (!registry) registry = new SessionRegistry(launcher, sessionsChanged);
  if (!exitHooked) {
    exitHooked = true;
    process.once("exit", () => registry?.stopAll());
  }
  return registry;
}

export function backgroundSessions(): readonly BackgroundSession[] {
  return registry?.sessions ?? [];
}

/** A background session changed: redraw, and say so when one asks something or fails while the lobby is hidden. */
function sessionsChanged(): void {
  const state = runtime;
  for (const session of registry?.sessions ?? []) {
    if (session.sessionId && session.sessionFile) chats.remember(session.sessionId, session.sessionFile);
    const seen = announced.get(session.key) ?? 0;
    announced.set(session.key, session.dialogs.length);
    if (!state || state.visible) continue;
    if (session.dialogs.length > seen) state.ctx.ui.notify(`bot-lobby: ${session.name} is waiting for you — alt+l opens the lobby`, "info");
    if (!session.alive && !exitsSaid.has(session.key)) {
      exitsSaid.add(session.key);
      if (session.exitCode) state.ctx.ui.notify(`bot-lobby: ${session.name} exited (${session.exitCode})${session.lastError() ? `: ${session.lastError()}` : ""}`, "warning");
    }
  }
  rerender();
}

/** Start a task in its own new pi session, named after the task; the session, or why not. */
function startSession(state: Runtime, start: { request?: string; plan?: PlannedTask; auto?: boolean }): BackgroundSession | string {
  const request = start.request?.trim();
  const plan = start.plan;
  if (!plan && !request) return "describe the task first";
  if (!plan && request!.startsWith("/")) return "a new session starts from a task description, not a command";
  if (plan) {
    if (plan.status !== "pending") return `${plan.id} was already started${plan.startedTaskId ? ` as ${plan.startedTaskId}` : ""}`;
    const starting = backgroundSessions().find((session) => session.alive && session.planId === plan.id);
    if (starting) return `${plan.id} is already starting in ${starting.name}`;
  }
  const name = plan?.title ?? shortTitle(request!);
  try {
    const session = sessionRegistry().start(state.ctx.cwd, { name, ...(plan ? { planId: plan.id } : { request: request! }), ...(start.auto ? { auto: true } : {}) }, sessionModel(state.ctx));
    lobbyFeed.log("LOBBY", `started "${name}" in a new session`, "success");
    return session;
  } catch (error) {
    return `could not start a new session — ${(error as Error).message}`;
  }
}

/** Put the oldest question a background session waits on to the user, with pi's own dialogs; escape cancels it as it would there. */
async function answerDialog(state: Runtime, session: BackgroundSession): Promise<void> {
  const dialog = session.dialogs[0];
  if (!dialog) return;
  const title = `${session.name} — ${dialog.title}`;
  const ui = state.ctx.ui;
  try {
    if (dialog.method === "select") {
      const value = await ui.select(title, dialog.options ?? []);
      session.answer(dialog.id, value === undefined ? { cancelled: true } : { value });
    } else if (dialog.method === "confirm") {
      session.answer(dialog.id, { confirmed: await ui.confirm(title, dialog.message ?? "") });
    } else {
      const value = dialog.method === "input" ? await ui.input(title, dialog.placeholder) : await ui.editor(title, dialog.prefill);
      session.answer(dialog.id, value === undefined ? { cancelled: true } : { value });
    }
  } catch (error) {
    failed(state, `could not answer ${session.name}`, error as Error);
  }
}

/** Leave a message for a task another terminal's session drives; its owner passes it to the oracle. */
function sendToTask(state: Runtime, taskId: string, text: string): string {
  const task = loadTask(state.root, state.configDir, taskId);
  if (!task) return `no task ${taskId}`;
  if (TERMINAL_STATES.includes(task.state)) return `${taskId} is ${task.state}`;
  try {
    sendToInbox(state.root, state.configDir, taskId, text, state.ctx.sessionManager.getSessionId());
  } catch (error) {
    return (error as Error).message;
  }
  lobbyFeed.log("LOBBY", `message for ${taskId}'s oracle saved`, "info");
  return task.ownerSessionId ? `sent — the session driving ${taskId} passes it to its oracle` : `saved — ${taskId} has no owning session; its oracle gets it once a session claims it`;
}

/** Auto mode as the lobby last read it, per task: every frame asks, the file is read at most once a second. */
const autoSeen = new Map<string, { at: number; on: boolean }>();
const AUTO_READ_MS = 1000;

function autoFor(state: Runtime, taskId: string): boolean {
  const now = Date.now();
  const seen = autoSeen.get(taskId);
  if (seen && now - seen.at < AUTO_READ_MS) return seen.on;
  const on = isAutoMode(state.root, state.configDir, taskId);
  autoSeen.set(taskId, { at: now, on });
  return on;
}

function switchAuto(state: Runtime, taskId: string, on: boolean): void {
  setAuto(state.root, state.configDir, taskId, on, state.ctx.sessionManager.getSessionId());
  autoSeen.set(taskId, { at: Date.now(), on });
}

/** Heartbeats of the other sessions running in this project, reread at most once a second (every frame asks). */
let liveSeen: { at: number; root: string; sessions: LiveSession[] } | undefined;
const LIVE_READ_MS = 1000;

function liveSessions(state: Runtime): LiveSession[] {
  const now = Date.now();
  if (liveSeen && liveSeen.root === state.root && now - liveSeen.at < LIVE_READ_MS) return liveSeen.sessions;
  const me = state.ctx.sessionManager.getSessionId();
  let sessions: LiveSession[] = [];
  try {
    sessions = livePresence(state.root, state.configDir, now).filter((presence) => presence.sessionId !== me);
  } catch {
    // An unreadable folder only means no other sessions are listed.
  }
  liveSeen = { at: now, root: state.root, sessions };
  return sessions;
}

/**
 * A session's whole conversation, oldest first: this window's from pi's
 * branch (already in memory), another's from its session file. Loaded only
 * while the lobby is scrolled back through it.
 */
function chatHistory(state: Runtime, sessionId?: string): ChatEntry[] {
  if (sessionId) return chats.history(sessionId);
  return chatFromEntries(state.ctx.sessionManager.getBranch(), Number.POSITIVE_INFINITY).map((line, index) => ({ id: -(index + 1), at: line.at ?? 0, role: line.role, text: line.text }));
}

/** Leave a message for a session running in another terminal. */
function sendToSession(state: Runtime, sessionId: string, text: string): string {
  try {
    leaveForSession(state.root, state.configDir, sessionId, text, state.ctx.sessionManager.getSessionId());
  } catch (error) {
    return (error as Error).message;
  }
  lobbyFeed.log("LOBBY", "message for another session's oracle saved", "info");
  return "sent — that session passes it to its oracle within a few seconds";
}

/** The lobby reopens on the session this window switches to (set just before asking pi to switch). */
let reopenAfterSwitch = false;

/**
 * Run another session in this window through `/bot-lobby switch`, which pi
 * runs with a command context (the only one that may replace the session).
 * A background session is stopped first, so one process writes its file; a
 * task no session owns is claimed instead.
 */
async function switchTo(state: Runtime, target: SwitchTarget): Promise<string> {
  if (!state.ctx.isIdle()) return "this window's oracle is working — esc stops it, then switch";
  if (target.claimTaskId) {
    reopenAfterSwitch = false;
    state.pi.sendUserMessage(`/bot-lobby claim ${target.claimTaskId}`, { expandPromptTemplates: true });
    return `taking ${target.claimTaskId} over in this window`;
  }
  let file = target.background?.sessionFile;
  if (target.background) {
    target.background.stop();
    await target.background.whenExited();
  }
  file ??= target.sessionId ? await chats.locate(target.sessionId) : undefined;
  if (!file) return `could not find ${target.name}'s session file — /resume lists every saved session`;
  reopenAfterSwitch = true;
  state.pi.sendUserMessage(`/bot-lobby switch ${file}`, { expandPromptTemplates: true });
  return `switching this window to ${target.name}…`;
}

/** Why a task cannot be archived or deleted now: a running session drives it. */
function drivenElsewhere(state: Runtime, task: Task): string | undefined {
  if (TERMINAL_STATES.includes(task.state) || !task.ownerSessionId) return undefined;
  if (task.ownerSessionId === state.ctx.sessionManager.getSessionId()) return `this window drives ${task.id} — cancel it first (/bot-lobby cancel ${task.id})`;
  const background = backgroundSessions().find((session) => session.alive && session.sessionId === task.ownerSessionId);
  if (background) return `${background.name} is driving ${task.id} in the background — stop it first (x x)`;
  if (liveSessions(state).some((session) => session.sessionId === task.ownerSessionId)) return `a session in another terminal is driving ${task.id} — finish or cancel it there first`;
  return undefined;
}

function archiveTask(state: Runtime, taskId: string): string {
  const task = loadTask(state.root, state.configDir, taskId);
  if (!task) return `no task ${taskId}`;
  const busy = drivenElsewhere(state, task);
  if (busy) return busy;
  try {
    archiveTaskOnDisk(state.root, state.configDir, taskId);
  } catch (error) {
    return (error as Error).message;
  }
  lobbyFeed.log("LOBBY", `archived ${taskId}`, "info");
  return `archived ${taskId}${TERMINAL_STATES.includes(task.state) ? "" : " (abandoned first)"} — v shows archived tasks, a restores one`;
}

function restoreTask(state: Runtime, taskId: string): string {
  try {
    restoreTaskOnDisk(state.root, state.configDir, taskId);
  } catch (error) {
    return (error as Error).message;
  }
  lobbyFeed.log("LOBBY", `restored ${taskId}`, "info");
  return `restored ${taskId} to the task list`;
}

function deleteTask(state: Runtime, taskId: string, where: "list" | "archive"): string {
  if (where === "list") {
    const task = loadTask(state.root, state.configDir, taskId);
    if (!task) return `no task ${taskId}`;
    const busy = drivenElsewhere(state, task);
    if (busy) return busy;
  }
  try {
    deleteTaskOnDisk(state.root, state.configDir, taskId, where);
  } catch (error) {
    return (error as Error).message;
  }
  lobbyFeed.log("LOBBY", `deleted ${taskId}`, "warning");
  return `deleted ${taskId} for good`;
}

/** A task's status box without animations, for a session other than this window's. */
function taskScene(state: Runtime, task: Task, width: number, height: number): string[] {
  const now = Date.now();
  const time = budgetClock(state.root, state.configDir, task.id, now);
  return panelLines(task, persistedRuns(task), now, false, { width, rows: Math.floor(height / 0.75), still: true, theme: state.ctx.ui.theme, ...(time ? { time } : {}) });
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
    maxRounds: () => loadConfig().lobby.maxPlanningRounds,
    classifier: classifier(),
    hints: hintsFor({ cwd: state.ctx.cwd, root: state.root, configDir: state.configDir }),
    effort: effortFor((model, thinking) => checkThinking(modelLookup(state.ctx)(model), thinking).level),
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

/** The questionnaire (pi's own dialogs where it cannot be drawn); tests swap it. */
function panelAsker(state: Runtime): Asker {
  return state.asker ?? askUser;
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
    const asker = panelAsker(state);
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
    tasks: () => peekTasks(state.root, state.configDir),
    plans: () => listPlannedTasks(state.root, state.configDir),
    comments: (taskId) => readPlanComments(state.root, state.configDir, taskId),
    metrics: () => readMetrics(state.root, state.configDir),
    classifierMetrics: () => readClassifierMetrics(state.root, state.configDir),
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
    planningRounds: () => loadConfig().lobby.maxPlanningRounds,
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
    sessionName: () => state.pi.getSessionName(),
    sessions: () => backgroundSessions(),
    startSession: (start) => startSession(state, start),
    answerDialog: (session) => answerDialog(state, session),
    isAuto: (taskId) => autoFor(state, taskId),
    setAuto: (taskId, on) => switchAuto(state, taskId, on),
    sendToTask: (taskId, text) => sendToTask(state, taskId, text),
    sendToSession: (sessionId, text) => sendToSession(state, sessionId, text),
    liveSessions: () => liveSessions(state),
    switchTo: (target) => switchTo(state, target),
    archivedTasks: () => listArchivedTasks(state.root, state.configDir),
    archiveTask: (taskId) => archiveTask(state, taskId),
    restoreTask: (taskId) => restoreTask(state, taskId),
    deleteTask: (taskId, where) => deleteTask(state, taskId, where),
    sessionChat: (sessionId) => chats.chat(sessionId),
    hasOlderChat: (sessionId) => chats.hasOlder(sessionId),
    chatHistory: (sessionId) => chatHistory(state, sessionId),
    taskScene: (task, width, height) => taskScene(state, task, width, height),
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
  setQuickFixHandoff(undefined);
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
  state.view?.showQuickFix(job.id);
  return job.id;
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
    hints: hintsFor({ cwd: ctx.cwd, root, configDir }),
    classifier: classifier(),
    effort: effortFor((model, thinking) => checkThinking(modelLookup(ctx)(model), thinking).level),
  });
  runtime = state;
  setQuickFixHandoff((request, builder, reason) => (runtime === state ? handToQuickFix(state, request, builder, reason) : undefined));
  lobbyFeed.clear();
  // Only the newest messages are kept; the feed learns whether earlier ones exist, and loads them when scrolled to.
  lobbyFeed.seedChat(chatFromEntries(ctx.sessionManager.getBranch(), Number.POSITIVE_INFINITY));
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
  // The owner's clock (pi/owner.ts) delivers comments and messages and drives auto mode; the lobby logs what it did.
  onOwnerEvent((event) => {
    if (event.kind === "comments") lobbyFeed.log("LOBBY", `passed ${event.count} plan comment${event.count === 1 ? "" : "s"} on ${event.taskId} to the oracle`, "info");
    else if (event.kind === "inbox" || event.kind === "messages") lobbyFeed.log("LOBBY", `passed ${event.count} message${event.count === 1 ? "" : "s"} from another session to the oracle`, "info");
    else if (event.kind === "auto") lobbyFeed.log("LOBBY", `auto mode ${event.on ? "on" : "off"} for ${event.taskId}`, event.on ? "success" : "info");
    else if (event.kind === "nudge") lobbyFeed.log("LOBBY", `auto mode: keeping the oracle going on ${event.taskId}`, "info");
    else lobbyFeed.log("LOBBY", `auto mode: no progress on ${event.taskId} — it needs you`, "warning");
    rerender();
  });
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
    if (reopenAfterSwitch) {
      reopenAfterSwitch = false;
      showLobby("lobby");
    } else autoOpenLobby();
  });
  pi.on("session_shutdown", () => shutdown());
  pi.on("ui_prompt_start", () => promptStarted());
  pi.on("ui_prompt_end", () => promptEnded());
  pi.on("agent_start", (_event, ctx) => {
    track(ctx);
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
  });
}
