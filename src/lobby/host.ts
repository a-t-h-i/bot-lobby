/**
 * What the lobby's backend offers: the service interface the web server
 * drives, and the shapes of the sessions it lists. Pure types (the
 * implementation is `service.ts`).
 */
import type { Task } from "../schemas/task.ts";
import type { AgentRun } from "../schemas/findings.ts";
import type { PlannedTask } from "../state/backlog.ts";
import type { PlanComment } from "../state/comments.ts";
import type { MetricRecord } from "../state/metrics.ts";
import type { BotLobbyConfig, LobbyAgentKind, PanelMember } from "../schemas/configuration.ts";
import type { ChatEntry, LobbyFeed } from "./feed.ts";
import type { BackgroundSession } from "./sessions.ts";
import type { QuickFixQueue } from "./quickfix.ts";
import type { PlannerSeed, PlanningSession } from "./planner.ts";
import type { IssuesState } from "./issues.ts";
import type { PullsState } from "./pulls.ts";
import type { PullReviews } from "./pr-review.ts";
import type { KnowledgeBook } from "./knowledge.ts";
import type { ExcalidrawBook, ExcalidrawSession } from "../excalidraw/sessions.ts";
import type { WorkspaceInfo } from "../execution/workspace.ts";

export { TAB_IDS, TAB_LABELS, visibleTabs } from "./prompts.ts";
export type { TabId } from "./prompts.ts";

/** What a checked Excalidraw session reported. */
export interface SessionCheck {
  ok: boolean;
  text: string;
}

/**
 * Which session the Lobby tab shows and talks to: this window, one it started
 * in the background, one running in another terminal, or a task whose
 * session is not running at all.
 */
export type SessionView =
  | { kind: "here" }
  | { kind: "background"; key: string }
  | { kind: "other"; sessionId: string }
  | { kind: "idle"; taskId: string };

export type SessionWhere = "this window" | "background" | "other terminal" | "not running";

/** One row of the session browser. */
export interface SessionEntry {
  view: SessionView;
  name: string;
  where: SessionWhere;
  task?: Task;
  /** What it is doing: working, idle, starting, ended, or its task's state. */
  status: string;
  auto: boolean;
  /** Questions it waits on you for. */
  waiting: number;
  /** The pi session it is (absent for a task no session ever owned). */
  sessionId?: string;
  /** The process running it, for sessions in other terminals. */
  pid?: number;
}

/** A session running in this project, as its heartbeat tells (see state/presence.ts). */
export interface LiveSession {
  sessionId: string;
  pid: number;
  name?: string;
  taskId?: string;
  mode: string;
}

/** What `switchTo` needs: the session to run in this window, and the background process to stop first. */
export interface SwitchTarget {
  name: string;
  sessionId?: string;
  background?: BackgroundSession;
  /** A task no session owns: this window claims it instead. */
  claimTaskId?: string;
}

/** One model Pi offers, for the settings page's picker: `provider/id`, its label and thinking levels. */
export interface ModelChoice {
  id: string;
  label: string;
  thinkingLevels: string[];
}

/** Everything the web server needs from pi and bot-lobby. */
export interface LobbyService {
  projectRoot?(): string;
  sessionId(): string | undefined;
  /** This session's active task and its runs, as the lobby reads them. */
  zen(): { task?: Task; runs: readonly AgentRun[] };
  feed: LobbyFeed;
  masterBusy(): boolean;
  tasks(): Task[];
  deliveryDeliver?(taskId: string, request: import("../delivery/operations.ts").DeliveryRequest): Promise<import("../delivery/types.ts").Delivery>;
  deliveryReview?(taskId: string): Promise<import("../delivery/types.ts").Delivery>;
  deliveryDefer?(taskId: string, reviewId: string): import("../delivery/types.ts").Delivery;
  plans(): PlannedTask[];
  comments(taskId: string): PlanComment[];
  metrics(): MetricRecord[];
  /** Classifier calls (kind `classifier`), kept out of the agent tables. */
  classifierMetrics?(): MetricRecord[];
  /** Send text to the oracle, or start a task when none is active; returns a notice. */
  toOracle(text: string): string | undefined;
  comment(taskId: string, text: string): string;
  /** Correct a comment this session sent; returns the edited comment. */
  editComment(taskId: string, commentId: string, text: string): PlanComment;
  startPlanned(plan: PlannedTask): string;
  discardPlan(id: string): void;
  abortMaster(): void;
  quickfix: QuickFixQueue;
  planner(): PlanningSession | undefined;
  /** Start a planning session (replacing any other) with these seats on the panel. */
  newPlanner(seed?: PlannerSeed, seats?: readonly PanelMember[]): PlanningSession;
  /** The oracle puts the panel's open questions to the user, one questionnaire at a time; returns a notice. */
  answerPanel(): Promise<string>;
  /** Save the plan as a pending task, offering to split a long one into several first; returns a notice. */
  savePlan(): Promise<string>;
  /** The seats a new session starts with, from settings. */
  defaultPanel(): readonly PanelMember[];
  /** Planning rounds before the oracle finalizes alone (`lobby.maxPlanningRounds`); 0 = unlimited. */
  planningRounds?(): number;
  /** `model · thinking` a panel seat runs on. */
  seatLabel(member: PanelMember): string;
  issues: IssuesState;
  /** The Git tab's pull requests, read through `gh`. */
  pulls: PullsState;
  /** Reviews of pull requests by an agent, and Jev's reads of them. */
  reviews: PullReviews;
  /** Every agent's knowledge files: read, edited, commented on. */
  knowledge: KnowledgeBook;
  /** The shared Excalidraw sessions (five at most) and which agents each is assigned to. */
  excalidraw: ExcalidrawBook;
  /** Join a session's room for a moment and report what is there. */
  checkExcalidraw(session: ExcalidrawSession): Promise<SessionCheck>;
  /** The effective config, never a secret; the web settings page reads it. */
  config?(): BotLobbyConfig;
  /** Save a whole config, the way the settings menu does; the web settings page writes it. */
  saveConfig?(config: BotLobbyConfig): void;
  /** Reload cached config (keys, panes) after a settings change. */
  configChanged?(): void;
  /** The models Pi offers, for the settings page's picker. */
  models?(): ModelChoice[];
  /** The model this window's session runs on (`provider/id`), when it has one. */
  sessionModel?(): string | undefined;
  /** The Issues tab is switched on (`lobby.issues`). */
  issuesEnabled(): boolean;
  /** This window's pi session name, when it has one. */
  sessionName(): string | undefined;
  /** Background sessions this window started, oldest first. */
  sessions(): readonly BackgroundSession[];
  /** Start a task in a new background session, named after the task; the session, or why not. */
  startSession(start: { request?: string; plan?: PlannedTask; auto?: boolean }): BackgroundSession | string;
  /** Auto mode for any task, whichever session drives it. */
  isAuto(taskId: string): boolean;
  setAuto(taskId: string, on: boolean): void;
  /** Leave a message for a task's oracle, delivered by whichever session drives it (now or once one resumes it); returns a notice. */
  sendToTask(taskId: string, text: string): string;
  /** Leave a message for a session running in another terminal; it delivers it within seconds. Returns a notice. */
  sendToSession(sessionId: string, text: string): string;
  /** Sessions running in this project, other than this window's, from their heartbeats. */
  liveSessions(): readonly LiveSession[];
  /** Run another session in this window (stopping its background process first); resolves to a notice. */
  switchTo(target: SwitchTarget): Promise<string>;
  /** Archived tasks, most recently archived first. */
  archivedTasks(): Task[];
  /** Archive, restore or delete a task; each returns a notice. */
  archiveTask(taskId: string): string;
  restoreTask(taskId: string): string;
  deleteTask(taskId: string, where: "list" | "archive"): string;
  /** Another session's conversation, read from its saved session file (its newest messages). */
  sessionChat(sessionId: string): ChatEntry[];
  /** Whether another session has messages earlier than `sessionChat` returns. */
  hasOlderChat(sessionId: string): boolean;
  /** A session's whole conversation, oldest first: this window's (no id) or another's; loaded only while scrolled back to it. */
  chatHistory(sessionId?: string): readonly ChatEntry[];
  profileLabel(kind: LobbyAgentKind): string;
  /** The repository (or folder) and branch the title shows; the folder's name alone until git has answered. */
  workspace?(): WorkspaceInfo;
  /** Ask for the workspace to be read again (the branch may have changed); it arrives through `workspace()`. */
  refreshWorkspace?(): void;
}

