/**
 * The lobby inside pi: one runtime per master session. It owns the lobby's
 * state (the quick-fix queue, planner, issues, pulls, knowledge), narrates the
 * Master's own turn into the feed, passes plan comments to the Master that
 * owns a task and records each Master turn in the metrics log. The web server
 * (src/webui) is its only surface.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
import { appendMetrics, type MetricStatus } from "../state/metrics.ts";
import { describeToolCall } from "../pi/activity.ts";
import { currentZenTask, onRunUpdates } from "../pi/ui.ts";
import type { WorkspaceInfo } from "../execution/workspace.ts";
import { basename } from "node:path";
import { isSubagentProcess } from "../pi/quiet.ts";
import { modelRef } from "../pi/model-support.ts";
import { modelLookup } from "../pi/tools.ts";
import { setQuickFixHandoff } from "../pi/route.ts";
import type { Domain } from "../schemas/agent.ts";
import { chatFromEntries, lobbyFeed, narrateEvent, type AgentEventLike } from "./feed.ts";
import { classifier, effortFor, hintsFor } from "../classifier/instance.ts";
import { checkThinking } from "../pi/model-support.ts";
import { jobTitle, QuickFixQueue } from "./quickfix.ts";
import type { Asker } from "../ask/types.ts";
import type { PlanningSession } from "./planner.ts";
import { execCommand, IssuesState } from "./issues.ts";
import { PullsState } from "./pulls.ts";
import { PullReviews } from "./pr-review.ts";
import { KnowledgeBook } from "./knowledge.ts";
import { ExcalidrawBook } from "../excalidraw/sessions.ts";
import type { LobbyService } from "./host.ts";
import { createLobbyService, lobbyNotify, lobbyProfile, reviewProfile, seatProfile, setServiceState, savePlan as serviceSavePlan, answerPanel as serviceAnswerPanel } from "./service.ts";
import { lobbyTopics } from "./topics.ts";
export { backgroundSessions, setSessionLauncher } from "./service.ts";
import { deliverComments, onOwnerEvent } from "../pi/owner.ts";
import { pushNotice } from "../webui/notices.ts";

export { deliverComments };

export interface Runtime {
  pi: ExtensionAPI;
  configDir: string;
  ctx: ExtensionContext;
  root: string;
  quickfix: QuickFixQueue;
  planner?: PlanningSession;
  issues: IssuesState;
  pulls: PullsState;
  reviews: PullReviews;
  knowledge: KnowledgeBook;
  excalidraw: ExcalidrawBook;
  unsubscribeFeed?: () => void;
  /** Puts the panel's questions to the user: the web page's questionnaire unless a test sets another. */
  asker?: Asker;
  /** A questionnaire is open in the page. */
  asking: boolean;
  /** The repository (or folder) and branch the page's title shows, and whether git is being asked now. */
  workspace: WorkspaceInfo;
  readingWorkspace: boolean;
}

let runtime: Runtime | undefined;
let lobbyService: LobbyService | undefined;

/** The lobby's backend, once its service has started. */
export function currentLobbyService(): LobbyService | undefined {
  return lobbyService;
}

/** Save the plan as a pending task; the service holds the implementation. */
export async function savePlan(state: Runtime | undefined = runtime): Promise<string> {
  return serviceSavePlan(state);
}

/** Put the panel's open questions to the user; the service holds the implementation. */
export async function answerPanel(state: Runtime | undefined = runtime): Promise<string> {
  return serviceAnswerPanel(state);
}

function shutdown(): void {
  const state = runtime;
  if (!state) return;
  runtime = undefined;
  lobbyService = undefined;
  setServiceState(undefined);
  setQuickFixHandoff(undefined);
  state.unsubscribeFeed?.();
  state.quickfix.cancelAll();
  state.reviews.cancelAll();
  state.planner?.cancel();
  onRunUpdates(undefined);
}

/**
 * The oracle routed a request to the quick-fix agent: queue it (no "looks like
 * a task" hold, the oracle already decided), on its builder's settings when it
 * is a quick feature, and tell the page where it went.
 */
function handToQuickFix(state: Runtime, request: string, builder: Domain | undefined, reason: string): string {
  const quick = lobbyProfile(state, "quickfix");
  const profile = builder ? { ...seatProfile(state, builder), instructions: quick.instructions } : undefined;
  const job = state.quickfix.submit(request, Date.now(), {
    force: true,
    ...(profile ? { profile } : {}),
    note: `The oracle sent your request here: ${reason.replace(/[.\s]+$/, "")}.${builder ? ` A quick feature: it runs on ${builder === "designer" ? "DESIGN" : "DEV"}'s model, thinking and time limit.` : ""}`,
  });
  lobbyTopics.bump("quickfix");
  pushNotice("The oracle sent your request to the quick-fix agent.", "info");
  return job.id;
}

/**
 * Start the lobby's backend: state, service and background wiring. Runs for
 * every interactive master session, not a subagent.
 */
export function startLobbyService(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string): Runtime | undefined {
  shutdown();
  if (isSubagentProcess() || !servesPage(ctx)) return undefined;
  const root = detectProjectRoot(ctx.cwd, configDir);
  const workflow = loadConfig().workflow;
  const state: Runtime = {
    pi,
    configDir,
    ctx,
    root,
    asking: false,
    workspace: { name: basename(ctx.cwd) || ctx.cwd },
    readingWorkspace: false,
    quickfix: undefined as unknown as QuickFixQueue,
    issues: new IssuesState(execCommand, ctx.cwd, () => lobbyTopics.bump("issues")),
    pulls: new PullsState(execCommand, ctx.cwd, () => lobbyTopics.bump("git")),
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
    onChange: () => lobbyTopics.bump("git"),
    notify: (message, level) => lobbyNotify(state, message, level),
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
    onChange: () => lobbyTopics.bump("quickfix"),
    notify: (message, level) => lobbyNotify(state, message, level),
    hints: hintsFor({ cwd: ctx.cwd, root, configDir }),
    classifier: classifier(),
    effort: effortFor((model, thinking) => checkThinking(modelLookup(ctx)(model), thinking).level),
  });
  runtime = state;
  lobbyService = createLobbyService(state);
  setServiceState(state);
  // Topic routing (src/lobby/topics.ts): sources bump a topic when their data
  // changes and the web page rereads it. lobbyFeed (lobby), run updates (tasks),
  // quick fix (quickfix), planner (planner), background sessions (sessions),
  // metrics (metrics), pulls/reviews (git), issues (issues), the prompt hub
  // (prompts), owner/notify events (notices), busy/workspace (status), link
  // checks (excalidraw).
  setQuickFixHandoff((request, builder, reason) => (runtime === state ? handToQuickFix(state, request, builder, reason) : undefined));
  lobbyFeed.clear();
  // Only the newest messages are kept; the feed learns whether earlier ones exist, and loads them when scrolled to.
  lobbyFeed.seedChat(chatFromEntries(ctx.sessionManager.getBranch(), Number.POSITIVE_INFINITY));
  state.unsubscribeFeed = lobbyFeed.onChange(() => lobbyTopics.bump("lobby"));
  onRunUpdates((runs) => {
    lobbyFeed.runs(runs);
    lobbyTopics.bump("tasks");
  });
  // The owner's clock (pi/owner.ts) delivers comments and messages and drives auto mode; the lobby logs what it did.
  onOwnerEvent((event) => {
    lobbyTopics.bump("notices");
    if (event.kind === "comments") lobbyFeed.log("LOBBY", `passed ${event.count} plan comment${event.count === 1 ? "" : "s"} on ${event.taskId} to the oracle`, "info");
    else if (event.kind === "inbox" || event.kind === "messages") lobbyFeed.log("LOBBY", `passed ${event.count} message${event.count === 1 ? "" : "s"} from another session to the oracle`, "info");
    else if (event.kind === "auto") lobbyFeed.log("LOBBY", `auto mode ${event.on ? "on" : "off"} for ${event.taskId}`, event.on ? "success" : "info");
    else if (event.kind === "nudge") lobbyFeed.log("LOBBY", `auto mode: keeping the oracle going on ${event.taskId}`, "info");
    else lobbyFeed.log("LOBBY", `auto mode: no progress on ${event.taskId} — it needs you`, "warning");
  });
  return state;
}

/**
 * Whether this pi process serves the web page: an interactive session. A
 * one-shot run has nobody to answer, and the background sessions the lobby
 * starts (RPC) are shown by the page of the window that started them.
 */
export function servesPage(ctx: ExtensionContext): boolean {
  return ctx.mode === "tui";
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

/** Narrate the Master's own turn into the feed and record it as a metric. */
export function registerLobbyEvents(pi: ExtensionAPI, configDir: string): void {
  if (isSubagentProcess()) return;
  let turn: MasterTurn | undefined;
  const track = (ctx: ExtensionContext) => {
    if (runtime) runtime.ctx = ctx;
  };
  pi.on("session_start", (_event, ctx) => {
    startLobbyService(pi, ctx, configDir);
  });
  pi.on("session_shutdown", () => shutdown());
  pi.on("ui_prompt_start", () => {
    lobbyTopics.bump("status");
  });
  pi.on("ui_prompt_end", () => {
    lobbyTopics.bump("status");
  });
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
