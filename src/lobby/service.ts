/**
 * The lobby's backend: `createLobbyService(state)` builds the service the web
 * server drives from the runtime's state. Questions go to the page through
 * the prompt hub (see ../ask/web.ts).
 */
import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MAX_SKIP_REASON, TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { updateBlockingRequest } from "../state/blocking-requests.ts";
import { randomUUID } from "node:crypto";
import { loadTask, ownedTask, peekOwnedTask, peekTasks, saveTask } from "../state/persistence.ts";
import { taskWork } from "../state/work-time.ts";
import { transition } from "../state/task-state.ts";
import { cancelTaskExecutions } from "../execution/task-cancellation.ts";
import { refreshReview, deferReview } from "../delivery/review.ts";
import { deliver, type DeliveryRequest } from "../delivery/operations.ts";
import { deliveryStore, deliveryTask } from "../delivery/store.ts";
import { execCommand } from "./exec.ts";
import { releaseAttachments } from "../state/attachments.ts";
import { dataRoot, loadConfig, readDataRoots, saveConfig as writeConfig } from "../state/project.ts";
import { choiceValue, recordDesignChoices } from "../knowledge/design-record.ts";
import type { AskResult } from "../ask/types.ts";
import type { PanelQuestion } from "./planner.ts";
import { knowledgeQuestion } from "./knowledge.ts";
import { addPlanComment, editComment, readPlanComments, type PlanComment } from "../state/comments.ts";
import { isAutoMode } from "../state/auto.ts";
import { markInboxDelivered, sendToInbox, sendToSession as leaveForSession } from "../state/inbox.ts";
import { livePresence } from "../state/presence.ts";
import { archiveTask as archiveTaskOnDisk, deleteTask as deleteTaskOnDisk, listArchivedTasks, restoreTask as restoreTaskOnDisk } from "../state/archive.ts";
import { discardPlannedTask, listPlannedTasks, type PlannedTask } from "../state/backlog.ts";
import { readClassifierMetrics, readMetrics } from "../state/metrics.ts";
import { applyStatus, currentZenTask, taskSnapshot } from "../pi/ui.ts";
import { taskName } from "../text.ts";
import { describeWorkspace } from "../execution/workspace.ts";
import { stripStartFlags } from "../pi/start-flags.ts";
import { checkThinking, modelRef, resolveChatProfile, resolveLobbyProfile, resolvePanelProfile, supportedThinking } from "../pi/model-support.ts";
import { modelLookup } from "../pi/tools.ts";
import { startPlannedTask, startTask } from "../pi/start-task.ts";
import { deliverComments, setAuto } from "../pi/owner.ts";
import { CHAT_MARK, chatFromEntries, chatMarkContent, CLEARED_NOTE, lobbyFeed, type ChatEntry, type ChatMarkDetails } from "./feed.ts";
import { CHAT_AGENT_SOURCES, parseLobbyCommand, parseMention, type LobbyCommand } from "./prompts.ts";
import type { ChatJob, ChatWorker } from "./chat-agents.ts";
import { routeChatMessage } from "../classifier/lobby.ts";
import { availableClassifiers, classifier, effortFor, hintsFor } from "../classifier/instance.ts";
import { cleanSessionName, launchPi, SessionRegistry, type BackgroundSession, type SessionLauncher } from "./sessions.ts";
import { askForSession } from "./session-questions.ts";
import { SessionChats } from "./session-files.ts";
import { answerMessage, questionnaires, settledQuestions, styleAnswers } from "./ask.ts";
import { askUser } from "../ask/web.ts";
import type { Asker } from "../ask/types.ts";
import { PlanningSession, type PlannerDeps, type PlannerSeed } from "./planner.ts";
import { settleInterrupted, type Relaunch } from "./recovery.ts";
import { carryOnMessage, resumeRoute, RESUMED_DECISION, type Drivers } from "./resume.ts";
import { archivePlan as archivePlanOnDisk, deletePlan as deletePlanOnDisk, isPlanId, previousPlans, readPlan, type PlanRecord, type PlanSummary } from "../state/plan-history.ts";
import { applyMasterModel } from "../pi/model-settings.ts";
import { grantableSkills, grantableTools } from "../pi/grants.ts";
import { lobbyTopics } from "./topics.ts";
import type { LobbyAgentKind, PanelMember } from "../schemas/configuration.ts";
import type { LiveSession, LobbyService, SwitchTarget } from "./host.ts";
import { pushNotice, type NoticeLevel } from "../webui/notices.ts";
import type { Runtime } from "./runtime.ts";
import { findLinters } from "../execution/lint.ts";
import { handleResolveApproval, lastQaAsks, waiveLint, waiveQa } from "../workflow/workflow.ts";
import { recordDecision } from "../master/decisions.ts";
import { stepViews } from "../webui/api/plan-facts.ts";
import { truncate } from "../text.ts";
import { fail } from "../webui/api/index.ts";

/** The state background callbacks report to; set while the lobby service runs. */
let serviceState: Runtime | undefined;

/** Remember which lobby state background callbacks report to. */
export function setServiceState(state: Runtime | undefined): void {
  serviceState = state;
}

/**
 * Tell the user: a toast in the page, and in pi's own terminal too when it is
 * a warning or an error (the page may not be open).
 */
export function lobbyNotify(state: Runtime, message: string, level: "info" | "warning" | "error" = "info"): void {
  lobbyTopics.bump("notices");
  pushNotice(message, level as NoticeLevel);
  // Work the lobby started may finish after pi replaced the session: its terminal is the new session's then.
  if (level === "info" || state !== serviceState) return;
  try {
    state.ctx.ui.notify(message, level);
  } catch {
    // A replaced session's terminal: the page has the notice.
  }
}

function sessionModel(ctx: ExtensionContext): string | undefined {
  return ctx.model ? modelRef(ctx.model) : undefined;
}

export function lobbyProfile(state: Runtime, kind: LobbyAgentKind) {
  return resolveLobbyProfile(loadConfig(), kind, {
    lookup: modelLookup(state.ctx),
    sessionModel: sessionModel(state.ctx),
    warn: (message) => lobbyNotify(state, message, "warning"),
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
  lobbyTopics.bump("tasks");
  return deliverComment(task, sessionId);
}

function deliverComment(task: Task, sessionId: string): string {
  const taskId = task.id;
  if (task.ownerSessionId === sessionId) {
    if (deliverComments() === 0) return `comment saved — it reaches the oracle once ${taskId} is resumed or restored`;
    return `comment sent to the oracle — it will ${task.plan ? "amend the plan" : "revise the proposal"}`;
  }
  if (!task.ownerSessionId) return `comment saved — ${taskId} has no owning session; it is delivered once a session claims it`;
  return `comment saved — the session driving ${taskId} passes it to its oracle`;
}

/**
 * Correct a comment this session sent. Ownership is checked again here, not
 * only at the API boundary: the session that wrote the comment is the only one
 * that may change its words.
 */
function editOwnComment(state: Runtime, taskId: string, commentId: string, text: string): PlanComment {
  const task = loadTask(state.root, state.configDir, taskId);
  if (!task) throw new Error(`no task ${taskId}`);
  const sessionId = state.ctx.sessionManager.getSessionId();
  const comment = readPlanComments(state.root, state.configDir, taskId).find((entry) => entry.id === commentId);
  if (!comment) throw new Error(`no comment ${commentId} on ${taskId}`);
  if (!comment.by || comment.by !== sessionId) throw new Error(`only the session that wrote ${commentId} can edit it`);
  const edited = editComment(state.root, state.configDir, taskId, commentId, text);
  lobbyFeed.log("LOBBY", `comment ${commentId} on ${taskId}'s plan edited`, "info");
  lobbyTopics.bump("plans");
  lobbyTopics.bump("tasks");
  deliverComment(task, sessionId);
  return edited;
}

function failed(state: Runtime, what: string, error: Error): void {
  lobbyFeed.log("LOBBY", `${what} — ${error.message}`, "error");
  lobbyNotify(state, `bot-lobby: ${what} — ${error.message}`, "error");
}

/** What sending to the lobby chat did: nothing to say, a notice, or a notice and the tab to open. */
export type LobbySendResult = string | { notice: string; open: "plan" } | undefined;

function toOracle(state: Runtime, text: string): LobbySendResult {
  const busy = !state.ctx.isIdle();
  const command = parseLobbyCommand(text);
  if (command) return lobbyCommand(state, command.command, command.rest);
  if (text.startsWith("/")) {
    state.pi.sendUserMessage(text, { expandPromptTemplates: true, ...(busy ? { deliverAs: "followUp" as const } : {}) });
    return `sent ${text.split(/\s+/)[0]} to pi`;
  }
  // A task in this session: the oracle drives it, and what you say goes to it.
  if (currentZenTask()) return toMaster(state, text);
  const mention = parseMention(text);
  if (mention?.agent === "master") return toMaster(state, mention.rest.trim() || text);
  if (mention) {
    const body = mention.rest.trim();
    if (!body) return `say what you want ${CHAT_AGENT_SOURCES[mention.agent]} to do after @${mention.agent === "designer" ? "design" : mention.agent === "backend" ? "dev" : mention.agent === "researcher" ? "research" : mention.agent}`;
    toAgent(state, mention.agent, body, `you named ${CHAT_AGENT_SOURCES[mention.agent]}`);
    return undefined;
  }
  // While the oracle is mid-turn, what you say steers it, as it always has.
  if (busy) return toMaster(state, text);
  lobbyFeed.sayQueued(text);
  void routeChat(state, text).catch((error: Error) => failed(state, "could not pass your message on", error));
  return undefined;
}

/** The oracle answers: a pi turn, or a steer while it is mid-turn. */
function toMaster(state: Runtime, text: string): undefined {
  const busy = !state.ctx.isIdle();
  state.pi.sendUserMessage(text, busy ? { deliverAs: "steer" } : undefined);
  // A steer reaches the oracle only when its turn lets it in; the conversation shows it now.
  if (busy) lobbyFeed.sayQueued(text);
  return undefined;
}

/** One line of the conversation as an agent reads it. */
function chatLine(entry: ChatEntry): string {
  if (entry.role === "you") return `You${entry.to ? ` (to ${entry.to})` : ""}: ${entry.text}`;
  if (entry.role === "note") return `(${entry.text})`;
  return `${entry.agent ?? "MASTER"}: ${entry.text}`;
}

/** The conversation since the oracle's context was last cleared, as lines. */
export function chatHistoryLines(): string[] {
  const chat = lobbyFeed.chat;
  const cleared = chat.map((entry) => entry.text).lastIndexOf(CLEARED_NOTE);
  return chat.slice(cleared + 1).map(chatLine);
}

/** Who answers a message nobody was named in: the classifier's pick when it is sure, else the Master. */
async function routeChat(state: Runtime, text: string): Promise<void> {
  const jev = classifier();
  const lines = chatHistoryLines();
  const picked = jev ? await routeChatMessage(jev, text, lines.slice(-7, -1), { at: loadConfig().classifier.thresholds.lobbyAgentAt }).catch(() => undefined) : undefined;
  if (state !== serviceState) return;
  if (!picked || picked.route === "master") {
    toMaster(state, text);
    return;
  }
  if (picked.route === "knowledge") {
    lobbyFeed.log("LOBBY", `a knowledge question (${picked.probability.toFixed(2)}): the oracle reads the project's knowledge`, "info");
    state.pi.sendUserMessage(knowledgeQuestion(text, readDataRoots(state.root, state.configDir)), state.ctx.isIdle() ? undefined : { deliverAs: "followUp" });
    return;
  }
  toAgent(state, picked.route, text, `the classifier picked ${CHAT_AGENT_SOURCES[picked.route]} (${picked.probability.toFixed(2)})`, true);
}

/** An agent other than the oracle answers: the message joins the conversation (and the session) under its name, and its reply follows. */
function toAgent(state: Runtime, agent: ChatWorker, text: string, why: string, shown = false): void {
  const source = CHAT_AGENT_SOURCES[agent];
  if (shown) {
    lobbyFeed.takeQueued(text);
    lobbyFeed.addressed(text, source);
  } else lobbyFeed.say("you", text, Date.now(), { to: source });
  keepChatLine(state, { role: "you", agent: source, text });
  lobbyFeed.log("LOBBY", `${source} answers: ${why}`, "info");
  state.chat.submit(agent, text, why);
}

/** Keep a line the oracle did not take part in, in its session: it reads it as context, and the conversation shows it again later. */
function keepChatLine(state: Runtime, details: ChatMarkDetails): void {
  try {
    state.pi.sendMessage({ customType: CHAT_MARK, content: chatMarkContent(details), display: true, details }, { triggerTurn: false });
  } catch {
    // A session that cannot take it keeps the conversation in the page alone.
  }
}

/** A chat agent finished: its reply joins the conversation and the session. */
export function chatReplied(state: Runtime, job: ChatJob): void {
  const source = CHAT_AGENT_SOURCES[job.agent];
  const text = job.reply ?? (job.status === "success" ? "(no reply)" : "");
  if (text) {
    lobbyFeed.say("oracle", text, job.finishedAt ?? Date.now(), { agent: source });
    keepChatLine(state, { role: "agent", agent: source, text });
  }
  if (job.status !== "success" && job.status !== "cancelled") lobbyFeed.say("note", `✗ ${source}'s reply ${job.status}${job.error ? `: ${job.error.split("\n")[0]}` : ""}`);
}

/** The model, thinking and grants a chat agent answers with. */
export function chatProfile(state: Runtime, agent: ChatWorker) {
  return resolveChatProfile(loadConfig(), agent, {
    lookup: modelLookup(state.ctx),
    sessionModel: sessionModel(state.ctx),
    warn: (message) => lobbyNotify(state, message, "warning"),
  });
}

/** The work a bare `/plan` or `/task` is about: the conversation so far. */
function fromConversation(): string | undefined {
  const lines = chatHistoryLines().filter((line) => !line.startsWith("("));
  if (!lines.some((line) => line.startsWith("You"))) return undefined;
  return `From the lobby chat:\n\n${lines.slice(-12).join("\n\n")}`;
}

/** `/plan` and `/task`: plan the work with the panel on the Plan tab, or start it as a task. */
function lobbyCommand(state: Runtime, command: LobbyCommand, rest: string): LobbySendResult {
  const request = rest.trim() || fromConversation();
  if (!request) return `type what to ${command === "plan" ? "plan" : "do"} after /${command}`;
  if (command === "task") {
    const current = currentZenTask();
    if (current) return `this session already drives ${current.id}; finish or cancel it first, or start the task from another session`;
    startTask(state.pi, state.ctx, state.configDir, request)
      .then(() => lobbyTopics.bump("tasks"))
      .catch((error: Error) => failed(state, "could not start the task", error));
    return "starting a task — the oracle takes it from here";
  }
  if (state.planner?.busy) return "the panel is still thinking — wait for the round to finish";
  // A plan under way stays among the project's previous plans; this one starts afresh.
  const fresh = state.planner && state.planner.messages.length > 0;
  const session = fresh || !state.planner ? newPlanner(state, undefined, loadConfig().lobby.planningPanel) : state.planner;
  session.send(request).catch((error: Error) => failed(state, "could not start planning", error));
  lobbyTopics.bump("planner");
  return { notice: fresh ? "planning on the Plan tab — your earlier plan is under Previous plans" : "planning on the Plan tab", open: "plan" };
}

function startPlanned(state: Runtime, plan: PlannedTask): string {
  const current = currentZenTask();
  if (current) return `this session already drives ${current.id}; finish or cancel it first, or start ${plan.id} from another session`;
  startPlannedTask(state.pi, state.ctx, state.configDir, plan.id)
    .then((task) => {
      if (typeof task === "string") return failed(state, `could not start ${plan.id}`, new Error(task));
      lobbyTopics.bump("tasks");
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
}, () => lobbyTopics.bump("sessions"));

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

/** Rename this window's session (no key) or one of its background sessions. */
function renameSession(state: Runtime, key: string | undefined, name: string): string {
  const clean = cleanSessionName(name);
  if (!key) {
    state.pi.setSessionName(clean);
    lobbyTopics.bump("status");
    lobbyTopics.bump("sessions");
    return `renamed this window to ${clean}`;
  }
  const session = backgroundSessions().find((entry) => entry.key === key && entry.projectRoot === state.root);
  if (!session) throw new Error(`no session ${key}`);
  session.rename(clean);
  return `renamed ${key} to ${clean}`;
}

/** Put an ended background session away from the sidebar, or bring it back. */
function archiveSession(state: Runtime, key: string, archived: boolean): string {
  const list = registry ? (archived ? registry.sessions : registry.archived) : [];
  const session = list.find((entry) => entry.key === key && entry.projectRoot === state.root);
  if (!session) throw new Error(archived ? `no session ${key} to archive` : `no archived session ${key}`);
  if (session.alive) throw new Error(`${session.name} is still running: stop it before archiving it`);
  registry!.archive(key, archived);
  return archived ? `archived ${session.name}` : `brought back ${session.name}`;
}

/** A background session changed: say so when one asks something or fails. */
function sessionsChanged(): void {
  lobbyTopics.bump("sessions");
  const state = serviceState;
  state?.keeper?.window.schedule();
  for (const session of registry?.sessions ?? []) {
    if (session.sessionId && session.sessionFile) chats.remember(session.sessionId, session.sessionFile);
    const seen = announced.get(session.key) ?? 0;
    announced.set(session.key, session.dialogs.length);
    if (!state) continue;
    syncTaskName(state, session);
    if (session.dialogs.length > seen) lobbyNotify(state, `bot-lobby: ${session.name} is waiting for you — see the Sessions page`, "info");
    if (!session.alive && !exitsSaid.has(session.key)) {
      exitsSaid.add(session.key);
      if (session.exitCode) lobbyNotify(state, `bot-lobby: ${session.name} exited (${session.exitCode})${session.lastError() ? `: ${session.lastError()}` : ""}`, "warning");
    }
  }
}

function syncTaskName(state: Runtime, session: BackgroundSession): void {
  if (!session.sessionId) return;
  const task = peekOwnedTask(state.root, state.configDir, session.sessionId);
  if (task) session.name = task.id;
}

function dialogTracker(state: Runtime): (id: string, pending: boolean, sessionId?: string) => void {
  const requests = new Map<string, { taskId: string; sessionId: string; requestId: string }>();
  const prefix = `dialog:${randomUUID()}`;
  return (id, pending, sessionId) => {
    if (!sessionId) return;
    const task = pending ? ownedTask(state.root, state.configDir, sessionId) : undefined;
    if (task && !requests.has(id)) requests.set(id, { taskId: task.id, sessionId, requestId: `${prefix}:${id}` });
    const request = requests.get(id);
    if (!request) return;
    updateBlockingRequest({ root: state.root, configDir: state.configDir, ...request }, request.requestId, pending);
    if (!pending) requests.delete(id);
  };
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
    const session = sessionRegistry().start(state.ctx.cwd, { name, projectRoot: state.root, onDialog: dialogTracker(state), ask: askForSession, ...(plan ? { planId: plan.id } : { request: request! }), ...(start.auto ? { auto: true } : {}) }, sessionModel(state.ctx));
    lobbyFeed.log("LOBBY", `started "${name}" in a new session`, "success");
    return session;
  } catch (error) {
    return `could not start a new session — ${(error as Error).message}`;
  }
}

/** Start again, in the background, a session a stopped window drove; the session, or why not. */
export function resumeSession(state: Runtime, start: Relaunch): BackgroundSession | string {
  try {
    const session = sessionRegistry().start(state.ctx.cwd, {
      name: start.name,
      projectRoot: state.root,
      onDialog: dialogTracker(state), ask: askForSession,
      sessionFile: start.sessionFile,
      ...(start.message ? { message: start.message } : {}),
    });
    lobbyFeed.log("LOBBY", `carried "${start.name}" (${start.taskId}) on in the background`, "success");
    return session;
  } catch (error) {
    return `could not carry ${start.taskId} on — ${(error as Error).message}`;
  }
}

/** The sessions that could drive a task, as this window sees them. */
function taskDrivers(state: Runtime): Drivers {
  const mine = backgroundSessions().filter((session) => session.alive && session.projectRoot === state.root);
  return {
    me: state.ctx.sessionManager.getSessionId(),
    background: new Set(mine.flatMap((session) => (session.sessionId ? [session.sessionId] : []))),
    carrying: new Set(mine.flatMap((session) => (session.taskId ? [session.taskId] : []))),
    live: new Set(liveSessions(state).map((session) => session.sessionId)),
  };
}

/** Tasks between a Resume click and their background session starting, so a second click starts nothing. */
const resuming = new Set<string>();

function unpause(state: Runtime, taskId: string): void {
  const task = loadTask(state.root, state.configDir, taskId);
  if (!task?.paused) return;
  task.paused = false;
  task.updatedAt = new Date().toISOString();
  saveTask(state.root, state.configDir, task);
}

/**
 * Resume a task from the Tasks screen, leaving this window where it is. A
 * paused task is unpaused where it runs and its oracle told to carry on; one
 * no running session drives carries on in a background session: its own
 * session started again from its file when there is one, else a fresh one
 * that takes it over.
 */
async function resumeTask(state: Runtime, taskId: string): Promise<{ notice: string; key?: string }> {
  const task = loadTask(state.root, state.configDir, taskId);
  if (!task) return { notice: `no task ${taskId}` };
  if (resuming.has(taskId)) return { notice: `${taskId} is already being resumed` };
  const route = resumeRoute(task, taskDrivers(state));
  const background = () => backgroundSessions().find((session) => session.alive && session.projectRoot === state.root && ((task.ownerSessionId && session.sessionId === task.ownerSessionId) || session.taskId === taskId));
  switch (route.kind) {
    case "finished":
      return { notice: `${taskId} is ${task.state}; there is nothing to resume` };
    case "running": {
      const session = route.where === "background" ? background() : undefined;
      const where = route.where === "here" ? "in this window" : session ? `in ${session.name}` : "in another terminal";
      return { notice: `${taskId} is already under way ${where}`, ...(session ? { key: session.key } : {}) };
    }
    case "paused": {
      unpause(state, taskId);
      lobbyTopics.bump("tasks");
      const message = carryOnMessage(task, "paused");
      if (route.where === "here") {
        state.pi.sendUserMessage(message, state.ctx.isIdle() ? undefined : { deliverAs: "followUp" });
        try { applyStatus(state.ctx, state.root, state.configDir); } catch {}
        lobbyFeed.log("LOBBY", `resumed ${taskId}`, "success");
        return { notice: `resumed ${taskId} in this window` };
      }
      const session = route.where === "background" ? background() : undefined;
      if (session) {
        session.send(message);
        lobbyFeed.log("LOBBY", `resumed ${taskId} in ${session.name}`, "success");
        return { notice: `resumed ${taskId} in ${session.name}`, key: session.key };
      }
      try {
        sendToInbox(state.root, state.configDir, taskId, message, state.ctx.sessionManager.getSessionId());
      } catch (error) {
        return { notice: `unpaused ${taskId}, but could not tell its oracle — ${(error as Error).message}` };
      }
      lobbyFeed.log("LOBBY", `resumed ${taskId} in another terminal`, "success");
      return { notice: `resumed ${taskId} — the session driving it in another terminal carries on` };
    }
    case "stopped":
      break;
  }
  resuming.add(taskId);
  try {
    const file = task.ownerSessionId ? await chats.locate(task.ownerSessionId) : undefined;
    settleInterrupted(state.root, state.configDir, taskId, new Date(), RESUMED_DECISION);
    // `/bot-lobby carry-on` unpauses it too; done here as well, the Tasks screen shows it at once.
    unpause(state, taskId);
    const session = sessionRegistry().start(state.ctx.cwd, {
      name: task.title,
      projectRoot: state.root,
      onDialog: dialogTracker(state), ask: askForSession,
      taskId,
      ...(file ? { sessionFile: file } : {}),
      message: `/bot-lobby carry-on ${taskId}`,
    }, file ? undefined : sessionModel(state.ctx));
    lobbyFeed.log("LOBBY", `resumed "${task.title}" (${taskId}) in the background`, "success");
    lobbyTopics.bump("tasks");
    return { notice: `resumed ${taskId} in a background session`, key: session.key };
  } catch (error) {
    return { notice: `could not resume ${taskId} — ${(error as Error).message}` };
  } finally {
    resuming.delete(taskId);
  }
}

function mutableTask(state: Runtime, taskId: string): Task {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(taskId)) fail(400, "bad_request", "invalid task ID");
  const task = loadTask(state.root, state.configDir, taskId);
  if (!task) fail(404, "not_found", "task not found in this project");
  if (TERMINAL_STATES.includes(task.state)) fail(400, "bad_request", "task is terminal");
  return task;
}

async function wakeTask(state: Runtime, task: Task, message: string): Promise<string> {
  if (!tellOracle(state, task, message)) return (await resumeTask(state, task.id)).notice;
  return "the owning oracle has been notified";
}

/**
 * Leave a message in the task's inbox and hand it to its oracle now when a
 * session here runs the task; false when the task is paused or stopped, so the
 * oracle reads it once the task carries on.
 */
function tellOracle(state: Runtime, task: Task, message: string): boolean {
  const inbox = sendToInbox(state.root, state.configDir, task.id, message, state.ctx.sessionManager.getSessionId());
  const route = resumeRoute(task, taskDrivers(state));
  if (route.kind === "stopped" || route.kind === "paused") return false;
  if (task.ownerSessionId === state.ctx.sessionManager.getSessionId()) {
    state.pi.sendUserMessage(message, state.ctx.isIdle() ? undefined : { deliverAs: "followUp" });
    markInboxDelivered(state.root, state.configDir, task.id, [inbox.id]);
  } else {
    const session = backgroundSessions().find((entry) => entry.alive && entry.projectRoot === state.root && entry.sessionId === task.ownerSessionId);
    if (session) {
      session.send(message);
      markInboxDelivered(state.root, state.configDir, task.id, [inbox.id]);
    }
  }
  return true;
}

function canForceCloseTask(state: Runtime, taskId: string): boolean {
  const task = loadTask(state.root, state.configDir, taskId);
  return Boolean(task && !TERMINAL_STATES.includes(task.state) && (!task.ownerSessionId || task.ownerSessionId === state.ctx.sessionManager.getSessionId()));
}

async function forceCloseTask(state: Runtime, taskId: string, title: string): Promise<{ notice: string }> {
  const task = mutableTask(state, taskId);
  if (title !== task.title) fail(400, "bad_request", "the title must match exactly");
  if (!canForceCloseTask(state, taskId)) fail(400, "bad_request", "cancel this task in its owning session; remote cancellation is unavailable");
  recordDecision(task, "The user force-closed the task from the Tasks screen; work abandoned, code and worktree retained.");
  transition(task, "abandoned");
  saveTask(state.root, state.configDir, task);
  cancelTaskExecutions(state.root, state.configDir, task.id);
  if (task.ownerSessionId === state.ctx.sessionManager.getSessionId()) state.ctx.abort();
  lobbyTopics.bump("tasks");
  return { notice: `${task.id} abandoned; code, worktree and history retained` };
}

async function acceptTask(state: Runtime, taskId: string): Promise<{ notice: string }> {
  const task = mutableTask(state, taskId);
  if (!["implementing", "reviewing", "blocked"].includes(task.state)) fail(400, "bad_request", "there is no work to accept yet");
  const asks = lastQaAsks(task);
  if (task.qaVerdict !== "pass" && !task.qaWaiver) waiveQa(task, asks, "from the Tasks screen");
  if (task.lint?.state === "failing") waiveLint(task, "from the Tasks screen");
  recordDecision(task, "The user accepted the work as it is from the Tasks screen; the oracle was asked to complete it.");
  saveTask(state.root, state.configDir, task);
  lobbyTopics.bump("tasks");
  const wake = await wakeTask(state, task, `The user accepted ${task.id}'s work as it is. Call orchestrate action=complete now with a short summary naming outstanding QA/lint asks: ${asks.join("; ") || "none recorded"}. Read the persisted gate waivers first. Do not merge automatically.`);
  return { notice: `${task.id} accepted as it is; ${wake}` };
}

/**
 * Skip a plan step on the user's word, with their reason: kept on the task
 * (the checklist shows it skipped, the reason under it), recorded as a
 * decision, and passed to the task's oracle so it carries on without it. A
 * paused or stopped task is not resumed: its oracle reads it when it carries on.
 */
async function skipTaskStep(state: Runtime, taskId: string, step: number, text: string, reason: string): Promise<{ notice: string }> {
  const task = mutableTask(state, taskId);
  const why = reason.trim().replace(/\s+/g, " ");
  if (!why) fail(400, "bad_request", "say why you are skipping this step");
  if (why.length > MAX_SKIP_REASON) fail(400, "bad_request", `keep the reason under ${MAX_SKIP_REASON} characters`);
  if (!task.plan) fail(400, "bad_request", "this task has no plan yet");
  const steps = stepViews(task, taskWork(state.root, state.configDir, task.id));
  const found = steps[step];
  if (!found || found.text !== text) fail(409, "conflict", "the plan changed; refresh the task");
  if (found.status === "done") fail(409, "conflict", "that step is already done");
  if (found.status === "skipped") fail(409, "conflict", "that step is already skipped");
  task.skippedSteps = [...(task.skippedSteps ?? []), { text, reason: why, at: new Date().toISOString() }];
  recordDecision(task, `The user skipped step ${step + 1} ("${truncate(text, 200)}") from the Tasks screen. Reason: ${why}`);
  saveTask(state.root, state.configDir, task);
  lobbyTopics.bump("tasks");
  lobbyTopics.bump("lobby");
  const message = `The user skipped step ${step + 1} of ${task.id}'s plan: "${text}". Their reason: ${why}. Do not delegate, build or review that step; if an agent is on it now, let it stop there or tell it to. Carry on with the next open step.`;
  if (!tellOracle(state, task, message)) return { notice: `step ${step + 1} skipped; the oracle reads why when the task carries on` };
  return { notice: `step ${step + 1} skipped; the oracle has been told` };
}

async function resolveTaskApproval(state: Runtime, taskId: string, approvalId: string, decision: "approved" | "rejected", note?: string): Promise<{ notice: string }> {
  const task = mutableTask(state, taskId);
  if (!task.approvals.some((entry) => entry.id === approvalId && entry.status === "pending")) fail(409, "conflict", "approval is no longer pending");
  let message: string;
  try { message = handleResolveApproval(task, { action: "resolve_approval", approvalId, decision, note }); }
  catch (error) { return fail(400, "bad_request", (error as Error).message); }
  saveTask(state.root, state.configDir, task);
  lobbyTopics.bump("tasks");
  return { notice: `${message}; ${await wakeTask(state, task, message)}` };
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
  return chatFromEntries(state.ctx.sessionManager.getBranch(), Number.POSITIVE_INFINITY).map((line, index) => ({ ...line, id: -(index + 1), at: line.at ?? 0 }));
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

/**
 * Run another session in this window through `/bot-lobby switch`, which pi
 * runs with a command context (the only one that may replace the session).
 * A background session is stopped first, so one process writes its file; a
 * task no session owns is claimed instead.
 */
async function switchTo(state: Runtime, target: SwitchTarget): Promise<string> {
  if (target.claimTaskId) {
    if (!state.ctx.isIdle()) return "this window's oracle is working — stop it, then take the task over here";
    state.pi.sendUserMessage(`/bot-lobby claim ${target.claimTaskId}`, { expandPromptTemplates: true });
    return `taking ${target.claimTaskId} over in this window`;
  }
  // A window at work hands its session to the background (it carries on there) and then switches.
  const leaving = state.ctx.isIdle() ? undefined : await stepAside(state);
  if (typeof leaving === "string") return leaving;
  let file = target.background?.sessionFile;
  if (target.background) {
    target.background.stop();
    await target.background.whenExited();
  }
  file ??= target.sessionId ? await chats.locate(target.sessionId) : undefined;
  if (!file) {
    if (leaving) handOff = undefined;
    return `could not find ${target.name}'s session file — /resume lists every saved session`;
  }
  state.pi.sendUserMessage(`/bot-lobby switch ${file}`, { expandPromptTemplates: true });
  return leaving ? `${leaving.name} carries on in the background; switching this window to ${target.name}…` : `switching this window to ${target.name}…`;
}

/** The session this window was working in when it switched away, started in the background once the switch lands. */
let handOff: { file: string; name: string; message: string } | undefined;

/** How long a stopped turn gets to wind down before the switch gives up. */
const STEP_ASIDE_MS = 10_000;

/** Stop this window's turn and keep its session to carry on in the background; the hand-off, or why not. */
async function stepAside(state: Runtime): Promise<{ name: string } | string> {
  const file = state.ctx.sessionManager.getSessionFile?.();
  if (!file) return "this window's session is not saved yet — stop the oracle, then switch";
  const name = state.pi.getSessionName() ?? "this window's session";
  const task = ownedTask(state.root, state.configDir, state.ctx.sessionManager.getSessionId());
  state.ctx.abort();
  const deadline = Date.now() + STEP_ASIDE_MS;
  while (!state.ctx.isIdle()) {
    if (Date.now() > deadline) return "the oracle did not stop in time — try the switch again";
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const message = task && !TERMINAL_STATES.includes(task.state) && !task.paused
    ? `bot-lobby: you were moved to the background while you worked on ${task.id}; your last turn was cut off. Read where the task stands with the orchestrate tool (action=status), run again any step that was cut off, and carry on.`
    : "bot-lobby: you were moved to the background while you worked, and your last turn was cut off. Carry on where you left off.";
  handOff = { file, name, message };
  return { name };
}

/** Once this window runs its new session, carry the one it left on in the background (see `stepAside`). */
export function carryHandOff(state: Runtime): void {
  const pending = handOff;
  handOff = undefined;
  if (!pending) return;
  if (state.ctx.sessionManager.getSessionFile?.() === pending.file) {
    lobbyFeed.log("LOBBY", "the switch did not happen; the oracle was stopped — send a message to carry on", "warning");
    return;
  }
  try {
    sessionRegistry().start(state.ctx.cwd, { name: pending.name, projectRoot: state.root, onDialog: dialogTracker(state), ask: askForSession, sessionFile: pending.file, message: pending.message });
    lobbyFeed.log("LOBBY", `${pending.name} carries on in the background`, "success");
  } catch (error) {
    lobbyFeed.log("LOBBY", `could not carry ${pending.name} on in the background — ${(error as Error).message}; /resume finds it`, "warning");
  }
}

/** Why a task cannot be archived or deleted now: a running session drives it. */
function drivenElsewhere(state: Runtime, task: Task): string | undefined {
  if (TERMINAL_STATES.includes(task.state) || !task.ownerSessionId) return undefined;
  if (task.ownerSessionId === state.ctx.sessionManager.getSessionId()) return `this window drives ${task.id} — cancel it first (/bot-lobby cancel ${task.id})`;
  const background = backgroundSessions().find((session) => session.alive && session.sessionId === task.ownerSessionId);
  if (background) return `${background.name} is driving ${task.id} in the background — stop it first`;
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
    releaseAttachments(taskId, state.root);
  } catch (error) {
    return (error as Error).message;
  }
  lobbyFeed.log("LOBBY", `archived ${taskId}`, "info");
  lobbyTopics.bump("tasks");
  return `archived ${taskId}${TERMINAL_STATES.includes(task.state) ? "" : " (abandoned first)"} — show archived tasks to restore it`;
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
    releaseAttachments(taskId, state.root);
  } catch (error) {
    return (error as Error).message;
  }
  lobbyFeed.log("LOBBY", `deleted ${taskId}`, "warning");
  lobbyTopics.bump("tasks");
  return `deleted ${taskId} for good`;
}

export function seatProfile(state: Runtime, member: PanelMember) {
  return resolvePanelProfile(loadConfig(), member, {
    lookup: modelLookup(state.ctx),
    sessionModel: sessionModel(state.ctx),
    warn: (message) => lobbyNotify(state, message, "warning"),
  });
}

function newPlanner(state: Runtime, seed?: PlannerSeed, seats?: readonly PanelMember[]): PlanningSession {
  // The session left behind stays among the project's previous plans, as it stood.
  state.keeper?.planner.flush();
  state.planner?.cancel();
  state.planner = new PlanningSession(plannerDeps(state, seats ?? loadConfig().lobby.planningPanel), seed);
  state.keeper?.planner.schedule();
  return state.planner;
}

/** Previous plans: the project's planning sessions never saved as a task, other than the one on screen. */
function plansBefore(state: Runtime, archived: boolean): PlanSummary[] {
  return previousPlans(state.root, state.configDir, { archived, except: state.planner?.id });
}

/** A previous plan to read: never the one on screen, and never one saved as a task. */
function previousPlan(state: Runtime, id: string): PlanRecord {
  const record = isPlanId(id) ? readPlan(state.root, state.configDir, id) : undefined;
  if (!record) throw new Error(`no plan ${id}`);
  if (record.savedAs?.length) throw new Error(`${id} was saved as ${record.savedAs.join(", ")}`);
  return record;
}

function onScreen(state: Runtime, id: string): void {
  if (state.planner?.id === id) throw new Error("that is the plan on screen — start a new plan first");
}

function archivePrevious(state: Runtime, id: string, archived: boolean): string {
  onScreen(state, id);
  const record = archivePlanOnDisk(state.root, state.configDir, id, archived);
  lobbyTopics.bump("planner");
  return archived ? `archived "${record.title}" — show archived plans to bring it back` : `"${record.title}" is back among the previous plans`;
}

function deletePrevious(state: Runtime, id: string): string {
  onScreen(state, id);
  const record = previousPlan(state, id);
  deletePlanOnDisk(state.root, state.configDir, id);
  lobbyTopics.bump("planner");
  return `deleted "${record.title}" for good`;
}

/** Carry a previous plan on: it becomes the plan on screen, and the one there joins the previous plans. */
function reopenPlan(state: Runtime, id: string): string {
  if (state.planner?.busy) return "the panel is still thinking — wait for the round to finish";
  onScreen(state, id);
  const record = previousPlan(state, id);
  state.keeper?.planner.flush();
  state.planner?.cancel();
  state.planner = PlanningSession.restore(plannerDeps(state, record.snapshot.seats), { ...record.snapshot, id: record.id, running: false });
  if (record.archivedAt) archivePlanOnDisk(state.root, state.configDir, id, false);
  state.keeper?.planner.schedule();
  lobbyTopics.bump("planner");
  return `carrying on "${record.title}"`;
}

/** What a planning session in this window runs with; every change is kept on disk, so it carries on after a crash. */
export function plannerDeps(state: Runtime, seats: readonly PanelMember[]): PlannerDeps {
  const workflow = loadConfig().workflow;
  const changed = () => {
    lobbyTopics.bump("planner");
    state.keeper?.planner.schedule();
  };
  return {
    cwd: state.ctx.cwd,
    root: state.root,
    configDir: state.configDir,
    profile: () => lobbyProfile(state, "planner"),
    memberProfile: (member) => seatProfile(state, member),
    panel: seats,
    maxRounds: () => loadConfig().lobby.maxPlanningRounds,
    classifier: classifier(),
    hints: hintsFor({ cwd: state.ctx.cwd, root: state.root, configDir: state.configDir }),
    effort: effortFor((model, thinking) => checkThinking(modelLookup(state.ctx)(model), thinking).level),
    stallTimeoutMs: workflow.stallTimeoutMs,
    toolStallTimeoutMs: workflow.toolStallTimeoutMs,
    feed: lobbyFeed,
    onChange: changed,
    onRound: changed,
  };
}

/** The questionnaire in the page; tests swap it. */
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
  try {
    return session.savePlan();
  } finally {
    lobbyTopics.bump("planner");
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
      const result = await asker(questions, state.ctx, undefined, "planner");
      if (result.cancelled) {
        return session.answered.length > 0 ? `answers kept — ${chunks.length - session.answered.length} questionnaire${chunks.length - session.answered.length === 1 ? "" : "s"} left; answer again to resume` : "questions put away — answer again to bring them back";
      }
      session.answered = [...session.answered, result];
    }
    const message = answerMessage(session.questions, session.answered);
    if (!message) {
      session.answered = [];
      return "nothing was answered — the questions stay open";
    }
    const recorded = recordStyleAnswers(state, session.questions, session.answered);
    void session.send(message, settledQuestions(session.questions, session.answered));
    return `answers sent — the panel is on the next round${recorded > 0 ? ` · ${recorded} design choice${recorded === 1 ? "" : "s"} recorded` : ""}`;
  } catch (error) {
    return `could not put the questions: ${(error as Error).message}`;
  } finally {
    state.asking = false;
    lobbyTopics.bump("planner");
  }
}

/** The user's answers to style questions go into the design record, so no agent asks them again. Returns how many. */
function recordStyleAnswers(state: Runtime, questions: readonly PanelQuestion[], results: readonly AskResult[]): number {
  const date = new Date().toISOString().slice(0, 10);
  const choices = styleAnswers(questions, results).map(({ field, answer }) => ({ field, value: choiceValue(field, answer), by: "you" as const, date }));
  if (choices.length === 0) return 0;
  try {
    recordDesignChoices(dataRoot(state.root, state.configDir), choices);
    lobbyTopics.bump("knowledge");
    return choices.length;
  } catch (error) {
    lobbyFeed.log("DESIGN", `could not record the design choices — ${(error as Error).message}`, "error");
    return 0;
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
    })
    .catch(() => {})
    .finally(() => {
      state.readingWorkspace = false;
    });
}

/** The lobby's backend for `state`: every host member that draws nothing. */
export function createLobbyService(state: Runtime): LobbyService {
  const masterKey = () => {
    const { master } = loadConfig();
    return `${master.model}|${master.thinking}`;
  };
  let appliedMaster = masterKey();
  return {
    projectRoot: () => state.root,
    linters: () => findLinters(state.root),
    sessionId: () => state.ctx.sessionManager.getSessionId(),
    zen: () => {
      const snapshot = taskSnapshot();
      return { ...(snapshot.task ? { task: snapshot.task } : {}), runs: snapshot.runs };
    },
    feed: lobbyFeed,
    masterBusy: () => !state.ctx.isIdle() || state.chat.busy,
    answering: () => {
      const job = state.chat.running;
      return job ? CHAT_AGENT_SOURCES[job.agent] : undefined;
    },
    tasks: () => peekTasks(state.root, state.configDir),
    work: (taskId) => taskWork(state.root, state.configDir, taskId),
    deliveryDeliver: (taskId, request: DeliveryRequest) => deliver(request, { cwd: state.root, exec: execCommand }, deliveryStore(state.root, state.configDir, taskId)),
    deliveryReview: async (taskId) => {
      const task = deliveryTask(state.root, state.configDir, taskId);
      const baseline = JSON.stringify(task.delivery);
      const delivery = await refreshReview(task, { cwd: state.root, exec: execCommand });
      // An async lookup must not overwrite intervening deferrals or operations.
      const latest = deliveryTask(state.root, state.configDir, taskId);
      if (JSON.stringify(latest.delivery) !== baseline) throw new Error("Review changed during lookup; refresh again.");
      latest.delivery = delivery;
      saveTask(state.root, state.configDir, latest);
      lobbyTopics.bump("tasks");
      return delivery;
    },
    deliveryDefer: (taskId, reviewId) => {
      const task = deliveryTask(state.root, state.configDir, taskId);
      const delivery = deferReview(task, reviewId);
      saveTask(state.root, state.configDir, task);
      lobbyTopics.bump("tasks");
      return delivery;
    },
    plans: () => listPlannedTasks(state.root, state.configDir),
    comments: (taskId) => readPlanComments(state.root, state.configDir, taskId),
    metrics: () => readMetrics(state.root, state.configDir),
    classifierMetrics: () => readClassifierMetrics(state.root, state.configDir),
    toOracle: (text) => toOracle(state, text),
    askKnowledge: (text) => {
      state.pi.sendUserMessage(knowledgeQuestion(text, readDataRoots(state.root, state.configDir)), state.ctx.isIdle() ? undefined : { deliverAs: "followUp" });
    },
    comment: (taskId, text) => addComment(state, taskId, text),
    editComment: (taskId, commentId, text) => editOwnComment(state, taskId, commentId, text),
    startPlanned: (plan) => startPlanned(state, plan),
    discardPlan: (id) => {
      discardPlannedTask(state.root, state.configDir, id);
      lobbyTopics.bump("plans");
    },
    abortMaster: () => {
      state.chat.cancelAll();
      if (!state.ctx.isIdle()) state.ctx.abort();
    },
    planner: () => state.planner,
    newPlanner: (seed, seats) => newPlanner(state, seed, seats),
    previousPlans: (archived) => plansBefore(state, archived),
    previousPlan: (id) => previousPlan(state, id),
    archivePlan: (id, archived) => archivePrevious(state, id, archived),
    deletePlan: (id) => deletePrevious(state, id),
    reopenPlan: (id) => reopenPlan(state, id),
    answerPanel: () => answerPanel(state),
    savePlan: () => savePlan(state),
    defaultPanel: () => loadConfig().lobby.planningPanel,
    planningRounds: () => loadConfig().lobby.maxPlanningRounds,
    config: () => loadConfig(),
    saveConfig: (next) => writeConfig(next),
    configChanged: () => {
      lobbyTopics.bump("status");
      // A new master model or effort takes hold in this session at once.
      const next = masterKey();
      if (next === appliedMaster) return;
      appliedMaster = next;
      void applyMasterModel(state.pi, state.ctx, loadConfig()).catch((error: Error) => lobbyNotify(state, `bot-lobby: could not apply the master model — ${error.message}`, "warning"));
    },
    sessionModel: () => sessionModel(state.ctx),    models: () => {
      try {
        const scoped = state.ctx.scopedModels;
        const usable = scoped.length > 0 ? scoped.map((entry) => entry.model) : state.ctx.modelRegistry.getAvailable();
        return usable.map((model) => {
          const id = modelRef(model);
          return { id, label: model.name && model.name !== id ? model.name : id, thinkingLevels: supportedThinking(model) };
        });
      } catch {
        // No model registry in this process (tests): the page falls back to custom ids.
        return [];
      }
    },
    classifierModels: () => availableClassifiers().map((model) => ({ id: model.id, label: model.label })),
    grants: () => ({ mcpTools: grantableTools(state.pi), skills: grantableSkills(state.root, state.pi) }),
    recovered: () => state.recovered,
    seatLabel: (member) => {
      const profile = seatProfile(state, member);
      return `${profile.model ?? "session model"} · ${profile.thinking}`;
    },
    knowledge: state.knowledge,
    profileLabel: (kind) => {
      const profile = lobbyProfile(state, kind);
      return `${profile.model ?? "session model"} · ${profile.thinking}`;
    },
    workspace: () => state.workspace,
    refreshWorkspace: () => refreshWorkspace(state),
    sessionName: () => state.pi.getSessionName(),
    sessions: () => backgroundSessions().filter((session) => session.projectRoot === state.root),
    renameSession: (key, name) => renameSession(state, key, name),
    archiveSession: (key, archived) => archiveSession(state, key, archived),
    startSession: (start) => startSession(state, start),
    isAuto: (taskId) => autoFor(state, taskId),
    setAuto: (taskId, on) => switchAuto(state, taskId, on),
    sendToTask: (taskId, text) => sendToTask(state, taskId, text),
    resumeTask: (taskId) => resumeTask(state, taskId),
    acceptTask: (taskId) => acceptTask(state, taskId),
    skipTaskStep: (taskId, step, text, reason) => skipTaskStep(state, taskId, step, text, reason),
    forceCloseTask: (taskId, title) => forceCloseTask(state, taskId, title),
    canForceCloseTask: (taskId) => canForceCloseTask(state, taskId),
    resolveTaskApproval: (taskId, approvalId, decision, note) => resolveTaskApproval(state, taskId, approvalId, decision, note),
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
