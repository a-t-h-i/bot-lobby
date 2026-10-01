/**
 * The lobby's backend, without the terminal: every host member the view
 * needs that does not draw anything. `createLobbyService(state)` builds it
 * from the same state the terminal lobby runs on, so a later web server can
 * drive the lobby through this module without a TUI. Putting a question on
 * screen stays with the terminal; the dialog data and its answer live here.
 */
import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { loadTask, peekTasks } from "../state/persistence.ts";
import { loadConfig } from "../state/project.ts";
import { addPlanComment, readPlanComments } from "../state/comments.ts";
import { isAutoMode } from "../state/auto.ts";
import { sendToInbox, sendToSession as leaveForSession } from "../state/inbox.ts";
import { livePresence } from "../state/presence.ts";
import { archiveTask as archiveTaskOnDisk, deleteTask as deleteTaskOnDisk, listArchivedTasks, restoreTask as restoreTaskOnDisk } from "../state/archive.ts";
import { discardPlannedTask, listPlannedTasks, type PlannedTask } from "../state/backlog.ts";
import { readClassifierMetrics, readMetrics } from "../state/metrics.ts";
import { currentZenTask, isMinimized, taskSnapshot } from "../pi/ui.ts";
import { taskName } from "../text.ts";
import { describeWorkspace } from "../execution/workspace.ts";
import { stripStartFlags } from "../pi/start-flags.ts";
import { checkThinking, modelRef, resolveLobbyProfile, resolvePanelProfile, resolveReviewProfile } from "../pi/model-support.ts";
import { modelLookup } from "../pi/tools.ts";
import { startPlannedTask } from "../pi/start-task.ts";
import { pendingRequest, startRequest } from "../pi/route.ts";
import { deliverComments, setAuto } from "../pi/owner.ts";
import { chatFromEntries, lobbyFeed, type ChatEntry } from "./feed.ts";
import { classifier, effortFor, hintsFor } from "../classifier/instance.ts";
import { launchPi, SessionRegistry, type BackgroundSession, type DialogAnswer, type SessionLauncher } from "./sessions.ts";
import { SessionChats } from "./session-files.ts";
import { answerMessage, askUser, questionnaires, settledQuestions, type Asker } from "./ask.ts";
import { PlanningSession, type PlannerSeed } from "./planner.ts";
import { lobbyTopics } from "./topics.ts";
import { promptHub } from "./prompt-hub.ts";
import { checkSession } from "../excalidraw/check.ts";
import type { LobbyAgentKind, PanelMember } from "../schemas/configuration.ts";
import type { LiveSession, LobbyHost, SwitchTarget } from "./view.ts";
import type { Runtime } from "./runtime.ts";

/**
 * The lobby without its terminal-only members (rows, theme, hide,
 * requestRender, now, keys, panels, savePanels, editText, openSettings).
 */
export type LobbyService = Omit<LobbyHost, "rows" | "theme" | "hide" | "requestRender" | "now" | "keys" | "panels" | "savePanels" | "editText" | "openSettings">;

/** The state background callbacks report to; set while the lobby service runs. */
let serviceState: Runtime | undefined;

/** Remember which lobby state background callbacks report to. */
export function setServiceState(state: Runtime | undefined): void {
  serviceState = state;
}

/** Repaints asked for by what happens in the background come at most this often. */
export const FRAME_MS = 40;
let lastFrame = 0;
let frameTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Repaint the lobby for something that happened in the background. A reply
 * streams dozens of events a second; they share frames, at most one per
 * `FRAME_MS`, instead of each asking for its own. Keys repaint at once
 * through pi.
 */
export function repaintLobby(): void {
  const state = serviceState;
  // Hidden, only the one-line status under the editor changes.
  if (!state || (!state.visible && !miniShown(state)) || frameTimer) return;
  const wait = lastFrame + FRAME_MS - Date.now();
  const paint = () => {
    frameTimer = undefined;
    lastFrame = Date.now();
    const current = serviceState;
    if (current?.visible || (current && miniShown(current))) current.tui?.requestRender();
  };
  if (wait <= 0) return paint();
  frameTimer = setTimeout(paint, wait);
  frameTimer.unref?.();
}

/** The status line shows under the editor while the lobby is hidden (not while bot-lobby is minimized), unless settings turn it off. */
export function miniShown(state: Runtime): boolean {
  return !state.visible && !isMinimized() && loadConfig().lobby.miniLine;
}

function sessionModel(ctx: ExtensionContext): string | undefined {
  return ctx.model ? modelRef(ctx.model) : undefined;
}

export function lobbyProfile(state: Runtime, kind: LobbyAgentKind) {
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
  lobbyTopics.bump("plans");
  if (task.ownerSessionId === sessionId) {
    if (deliverComments() === 0) return `comment saved — it reaches the oracle once ${taskId} is resumed or restored`;
    return `comment sent to the oracle — it will ${task.plan ? "amend the plan" : "revise the proposal"}`;
  }
  if (!task.ownerSessionId) return `comment saved — ${taskId} has no owning session; it is delivered once a session claims it`;
  return `comment saved — the session driving ${taskId} passes it to its oracle`;
}

function failed(state: Runtime, what: string, error: Error): void {
  lobbyFeed.log("LOBBY", `${what} — ${error.message}`, "error");
  lobbyTopics.bump("notices");
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
      lobbyTopics.bump("tasks");
      repaintLobby();
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
  const state = serviceState;
  if (!state) return [];
  const dirs = new Map<string, string | undefined>([[state.ctx.cwd, state.ctx.sessionManager.getSessionDir()]]);
  if (!dirs.has(state.root)) dirs.set(state.root, undefined);
  const lists = await Promise.all([...dirs].map(([cwd, dir]) => SessionManager.list(cwd, dir).catch(() => [])));
  return lists.flat();
}, () => {
  lobbyTopics.bump("sessions");
  repaintLobby();
});

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
  lobbyTopics.bump("sessions");
  const state = serviceState;
  for (const session of registry?.sessions ?? []) {
    if (session.sessionId && session.sessionFile) chats.remember(session.sessionId, session.sessionFile);
    const seen = announced.get(session.key) ?? 0;
    announced.set(session.key, session.dialogs.length);
    if (!state || state.visible) continue;
    if (session.dialogs.length > seen) {
      lobbyTopics.bump("notices");
      state.ctx.ui.notify(`bot-lobby: ${session.name} is waiting for you — alt+l opens the lobby`, "info");
    }
    if (!session.alive && !exitsSaid.has(session.key)) {
      exitsSaid.add(session.key);
      if (session.exitCode) {
        lobbyTopics.bump("notices");
        state.ctx.ui.notify(`bot-lobby: ${session.name} exited (${session.exitCode})${session.lastError() ? `: ${session.lastError()}` : ""}`, "warning");
      }
    }
  }
  repaintLobby();
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
  // A request may lead with flags (`--worktree add login`); the session is named after what follows them.
  const name = taskName(plan?.title ?? (stripStartFlags(request!) || request!));
  try {
    const session = sessionRegistry().start(state.ctx.cwd, { name, ...(plan ? { planId: plan.id } : { request: request! }), ...(start.auto ? { auto: true } : {}) }, sessionModel(state.ctx));
    lobbyFeed.log("LOBBY", `started "${name}" in a new session`, "success");
    return session;
  } catch (error) {
    return `could not start a new session — ${(error as Error).message}`;
  }
}

/** The oldest question a background session waits on, if any (data only; the terminal draws it). */
export function peekSessionDialog(session: BackgroundSession) {
  return session.dialogs[0];
}

/** Answer a background session's dialog (data only; the terminal draws it). */
export function answerSessionDialog(session: BackgroundSession, id: string, answer: DialogAnswer): void {
  session.answer(id, answer);
}

/** Put the oldest question a background session waits on to the user, with pi's own dialogs; escape cancels it as it would there. */
async function answerDialog(state: Runtime, session: BackgroundSession): Promise<void> {
  const dialog = peekSessionDialog(session);
  if (!dialog) return;
  const title = `${session.name} — ${dialog.title}`;
  const ui = state.ctx.ui;
  try {
    await promptHub.run("sessionDialog", session.name, { dialog }, async () => {
      if (dialog.method === "select") {
        const value = await ui.select(title, dialog.options ?? []);
        answerSessionDialog(session, dialog.id, value === undefined ? { cancelled: true } : { value });
      } else if (dialog.method === "confirm") {
        answerSessionDialog(session, dialog.id, { confirmed: await ui.confirm(title, dialog.message ?? "") });
      } else {
        const value = dialog.method === "input" ? await ui.input(title, dialog.placeholder) : await ui.editor(title, dialog.prefill);
        answerSessionDialog(session, dialog.id, value === undefined ? { cancelled: true } : { value });
      }
    });
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
  lobbyTopics.bump("tasks");
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

/** Whether a switch asked for from the lobby is still owed its reopen; clears the flag. */
export function takeReopenAfterSwitch(): boolean {
  const value = reopenAfterSwitch;
  reopenAfterSwitch = false;
  return value;
}

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
  lobbyTopics.bump("tasks");
  return `archived ${taskId}${TERMINAL_STATES.includes(task.state) ? "" : " (abandoned first)"} — v shows archived tasks, a restores one`;
}

function restoreTask(state: Runtime, taskId: string): string {
  try {
    restoreTaskOnDisk(state.root, state.configDir, taskId);
  } catch (error) {
    return (error as Error).message;
  }
  lobbyFeed.log("LOBBY", `restored ${taskId}`, "info");
  lobbyTopics.bump("tasks");
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
  lobbyTopics.bump("tasks");
  return `deleted ${taskId} for good`;
}

/** What a pull request review runs on: QA's model, thinking and time limit. */
export function reviewProfile(state: Runtime) {
  return resolveReviewProfile(loadConfig(), {
    lookup: modelLookup(state.ctx),
    sessionModel: sessionModel(state.ctx),
    warn: (message) => state.ctx.ui.notify(message, "warning"),
  });
}

export function seatProfile(state: Runtime, member: PanelMember) {
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
    onChange: () => {
      lobbyTopics.bump("planner");
      repaintLobby();
    },
    onRound: (session) => {
      lobbyTopics.bump("planner");
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
 * Save the plan as a pending task. A plan with many steps is first split by
 * the oracle into up to five tasks, which the user takes, changes or declines
 * in a questionnaire; the split's questions open over the lobby like the
 * panel's. Returns a notice for the lobby.
 */
export async function savePlan(state: Runtime | undefined): Promise<string> {
  const session = state?.planner;
  if (!state || !session) return "no planning session";
  if (state.asking) return "a questionnaire is already open";
  state.asking = true;
  try {
    const asker = panelAsker(state);
    return await session.saveWithSplit((questions, signal) => promptHub.run("questionnaire", "planner", { questions }, () => asker(questions, state.ctx, signal), { signal }), { splitAbove: loadConfig().lobby.splitPlanAbove });
  } finally {
    state.asking = false;
    repaintLobby();
  }
}

/**
 * The oracle puts the round's questions to the user, one at a time; answered
 * questionnaires are kept if the user stops, so the next call resumes there.
 * Once every questionnaire is done, the answers (and any line comments) start
 * the next round. Returns a notice for the lobby.
 */
export async function answerPanel(state: Runtime | undefined): Promise<string> {
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
      const questions = chunks[index]!;
      const result = await promptHub.run("questionnaire", "planner", { questions }, () => asker(questions, state.ctx));
      if (result.cancelled) {
        repaintLobby();
        return session.answered.length > 0 ? `answers kept — ${chunks.length - session.answered.length} questionnaire${chunks.length - session.answered.length === 1 ? "" : "s"} left; enter resumes` : "questions put away — enter brings them back";
      }
      session.answered = [...session.answered, result];
    }
    const message = answerMessage(session.questions, session.answered);
    if (!message) {
      session.answered = [];
      return "nothing was answered — the questions stay open";
    }
    void session.send(message, settledQuestions(session.questions, session.answered));
    return "answers sent — the panel is on the next round";
  } catch (error) {
    return `could not put the questions: ${(error as Error).message}`;
  } finally {
    state.asking = false;
    repaintLobby();
  }
}

/** Read the repository name and branch again, off the render path; the title repaints when they changed. */
function refreshWorkspace(state: Runtime): void {
  if (state.readingWorkspace) return;
  state.readingWorkspace = true;
  describeWorkspace(state.ctx.cwd)
    .then((info) => {
      if (serviceState !== state || (info.name === state.workspace.name && info.branch === state.workspace.branch)) return;
      state.workspace = info;
      lobbyTopics.bump("status");
      repaintLobby();
    })
    .catch(() => {})
    .finally(() => {
      state.readingWorkspace = false;
    });
}

/** The lobby's backend for `state`: every host member that draws nothing. */
export function createLobbyService(state: Runtime): LobbyService {
  return {
    sessionId: () => state.ctx.sessionManager.getSessionId(),
    zen: () => {
      const snapshot = taskSnapshot();
      return { ...(snapshot.task ? { task: snapshot.task } : {}), runs: snapshot.runs };
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
    discardPlan: (id) => {
      discardPlannedTask(state.root, state.configDir, id);
      lobbyTopics.bump("plans");
    },
    abortMaster: () => state.ctx.abort(),
    quickfix: state.quickfix,
    planner: () => state.planner,
    newPlanner: (seed, seats) => newPlanner(state, seed, seats),
    answerPanel: () => answerPanel(state),
    savePlan: () => savePlan(state),
    defaultPanel: () => loadConfig().lobby.planningPanel,
    planningRounds: () => loadConfig().lobby.maxPlanningRounds,
    issuesEnabled: () => loadConfig().lobby.issues,
    seatLabel: (member) => {
      const profile = seatProfile(state, member);
      return `${profile.model ?? "session model"} · ${profile.thinking}`;
    },
    issues: state.issues,
    pulls: state.pulls,
    reviews: state.reviews,
    knowledge: state.knowledge,
    excalidraw: state.excalidraw,
    checkExcalidraw: (session) => {
      lobbyTopics.bump("excalidraw");
      return checkSession(session.link, session.name);
    },
    profileLabel: (kind) => {
      const profile = lobbyProfile(state, kind);
      return `${profile.model ?? "session model"} · ${profile.thinking}`;
    },
    workspace: () => state.workspace,
    refreshWorkspace: () => refreshWorkspace(state),
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
  };
}
