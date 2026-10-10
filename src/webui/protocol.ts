/**
 * What crosses the wire between the lobby's loopback server and its page.
 * The page imports this file with `import type` only, so nothing from the
 * server is ever bundled into it.
 */
import type { Delivery, DeliveryAction } from "../delivery/types.ts";
import type { TimingProjection } from "../state/phase-timing.ts";
import type { LobbyTopic } from "../lobby/topics.ts";
import type { WebPrompt } from "../lobby/prompt-hub.ts";
import type { DialogAnswer, SessionDialog } from "../lobby/sessions.ts";
import type { LiveSession } from "../lobby/host.ts";
import type { TaskRow } from "../lobby/task-rows.ts";
import type { PlanComment } from "../state/comments.ts";
import type { BotLobbyConfig, PanelMember } from "../schemas/configuration.ts";
import type { QaRiskAssessment } from "../schemas/task.ts";
import type { MemberState, PanelNote, PanelQuestion, PlannerMessage } from "../lobby/planner.ts";
import type { QuickFixJob } from "../lobby/quickfix.ts";

export interface ProjectInfo { id: string; name: string; cwd: string; port: number }
export interface FolderListing { path: string; parent?: string; folders: Array<{ name: string; path: string }>; truncated: boolean }

export type { WebPrompt };
export type { LobbyTopic };
export type { DialogAnswer, SessionDialog, TaskRow, PlanComment };
export type { LiveSession };
export type { PanelMember, MemberState, PanelNote, PanelQuestion, PlannerMessage, QuickFixJob, BotLobbyConfig };

/** Every API answer: the result, or why not. */
export type ApiReply<T> = { ok: true; result: T } | { ok: false; error: string; code: ErrorCode };

/** Machine codes for API failures, each with its own HTTP status. */
export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "unsupported"
  | "too_large"
  | "conflict"
  | "question_withdrawn"
  | "rate_limited"
  | "failed";

/** HTTP status for an error code. */
export function statusFor(code: ErrorCode): number {
  switch (code) {
    case "bad_request":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
    case "question_withdrawn":
      return 409;
    case "too_large":
      return 413;
    case "unsupported":
      return 415;
    case "rate_limited":
      return 429;
    case "failed":
      return 500;
  }
}

/** One tab as the status call describes it. */
export interface TabInfo {
  id: string;
  label: string;
  key: string;
}

/** One shortcut as the status call describes it. */
export interface KeyInfo {
  action: string;
  key: string;
  label: string;
  help: string;
}

/** `status.get`: everything the page shell needs before it reads a tab. */
/** A colour theme the user saved, kept for every pi session (`themes.json`). */
export interface SavedThemeInfo {
  id: string;
  name: string;
  light?: Record<string, string>;
  dark?: Record<string, string>;
  savedAt: string;
}

/** The saved themes and the chosen one. */
export interface ThemeStoreInfo {
  themes: SavedThemeInfo[];
  active?: string;
}

export interface StatusInfo {
  workspace: { name: string; branch?: string };
  branch?: string;
  sessionId?: string;
  sessionName?: string;
  busy: boolean;
  port: number;
  issuesEnabled: boolean;
  /** Which panes the Lobby tab shows (`lobby.panels`). */
  panels: Record<"conversation" | "activity" | "thinking", boolean>;
  tabs: TabInfo[];
  keys: KeyInfo[];
  windows: Array<{ name: string; url: string }>;
  /** What this window carried on after pi stopped unexpectedly: the page says so once. */
  recovered?: { at: number; text: string };
}

/** Agent work time as of the reply: the page adds the time that passes while `running`. */
export interface WorkClock {
  workedMs: number;
  running: boolean;
}

/** One task header as the lobby snapshot carries it. */
export interface SnapshotTask {
  id: string;
  title: string;
  state: string;
  track?: { path: "fast" | "full"; size: string };
  domains: string[];
  git?: { branch: string; from?: string };
  progress?: { done: number; total: number };
  currentStep?: string;
  /** The steps a worker is on right now, with the worker time on each (ms, as of the snapshot). */
  activeSteps?: Array<{ text: string; workedMs: number; activeAgentCount?: number }>;
  /** How long the task's agents have worked on it, idle time left out. */
  work?: WorkClock;
}

/** A file attached in the composer, as `files.upload` answers (the message names it by its path). */
export interface UploadInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "pdf" | "file";
  /** Where the page shows an image from. */
  url?: string;
}

/** What the Lobby tab shows, read in one call. */
export interface LobbySnapshot {
  task?: SnapshotTask;
  runs: unknown[];
  /** Newest chat messages (at most 100), oldest first. */
  chat: Array<{ id: number; at: number; role: string; text: string }>;
  /** The oracle's reply while it streams; absent between replies. */
  reply?: string;
  /** Newest activity entries (at most 400), oldest first. */
  activity: Array<{ id: number; at: number; source: string; text: string; kind: string; pending: boolean }>;
  /** Newest thoughts (at most 40), oldest first. */
  thoughts: Array<{ id: number; at: number; source: string; text: string; live: boolean }>;
  /** Earlier chat exists in the session (loaded through `lobby.history`). */
  hasOlderChat: boolean;
}

/** One background session as `sessions.list` describes it. */
export interface BackgroundSessionInfo {
  key: string;
  name: string;
  status: string;
  busy: boolean;
  alive: boolean;
  sessionId?: string;
  planId?: string;
  /** Questions it waits on you for. */
  waiting: number;
  dialogs: SessionDialog[];
}

/** How loud a lobby notice is. */
export type NoticeLevel = "info" | "success" | "warning" | "error";

/** One model Pi offers, for the settings page's picker. */
export interface SettingsModelInfo {
  /** `provider/id`, the form settings store. */
  id: string;
  label: string;
  thinkingLevels: string[];
}

/** A linter the project configures (`settings.linters`): which, in which folder, and whether it is installed to run. */
export interface SettingsLinter {
  tool: string;
  /** Repository-relative; "" is the top. */
  folder: string;
  installed: boolean;
}

/** `settings.get`: the effective config (never a secret) and the models Pi offers. */
export interface SettingsInfo {
  config: BotLobbyConfig;
  models: SettingsModelInfo[];
}

/** One message on the event stream (`GET /api/events`, server-sent events). */
export type StreamEvent =
  | { type: "hello"; versions: Partial<Record<LobbyTopic, number>> }
  | { type: "changed"; topic: LobbyTopic; version: number }
  | { type: "feed"; activity: unknown[]; thoughts: unknown[]; chat: unknown[] }
  | { type: "reply"; text: string }
  | { type: "notice"; text: string; level: NoticeLevel };

/** The planning session as `planner.get` describes it. */
export interface PlannerSnapshot {
  /** Seats on the panel next round. */
  seats: PanelMember[];
  /** What each seat of the latest round did. */
  members: MemberState[];
  /** The whole conversation, oldest first. */
  messages: PlannerMessage[];
  /** The oracle's current draft plan, when it wrote one. */
  draft?: string;
  /** The latest round's questions, attributed. */
  questions: PanelQuestion[];
  /** What each seat said the plan must respect. */
  notes: PanelNote[];
  /** Rounds run so far. */
  round: number;
  /** Rounds before the oracle finalizes alone; 0 = unlimited. */
  limit: number;
  /** Whether `planner.retry` has something to redo. */
  retryable: boolean;
  /** Whether the panel is thinking now. */
  busy: boolean;
}

/** A previous plan as a list shows it: a planning session never saved as a task. */
export interface PreviousPlanInfo {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  messages: number;
  rounds: number;
  hasDraft: boolean;
}

/** A previous plan, whole, to read. */
export interface PreviousPlanDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  rounds: number;
  seats: PanelMember[];
  messages: PlannerMessage[];
  draft?: string;
  notes: PanelNote[];
  /** Where it started, when it came from an issue. */
  seed?: string;
}

/** One issue a planning session can start from. */
export interface PlannerSeedInfo {
  issue: { number: number; title: string; url?: string };
  body: string;
}

/** The Metrics tab's KPI row as data: runs, success, average run, cost, tasks. */
export interface MetricsTiles {
  runs: number;
  successes: number;
  stalls: number;
  avgMs: number;
  p90Ms: number;
  cost: number;
  completed: number;
  active: number;
  avgCompleteMs: number;
}

/** One per-model group as `metrics.get` carries it. */
export interface MetricGroupInfo {
  model: string;
  thinking: string;
  kinds: string[];
  runs: number;
  successes: number;
  timeouts: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  avgTurns: number;
  avgTools: number;
  avgTokens: number;
  avgCost: number;
  totalCost: number;
  tokensPerSecond: number;
}

/** One agent's share of all run time. */
export interface MetricsAgentShare {
  agent: string;
  runs: number;
  ms: number;
  share: number;
}

/** Completed tasks' request-to-done time by the oracle's model and thinking. */
export interface MetricsTaskTime {
  model: string;
  thinking: string;
  tasks: number;
  avgMs: number;
}

/** What the classifier did and spared, when it has run. */
export interface MetricsClassifier {
  calls: number;
  ok: number;
  p50Ms: number;
  p90Ms: number;
  input: number;
  byPurpose: Record<string, number>;
  seatRunsSkipped: number;
  questionsAnswered: number;
  quickFixesHeld: number;
  routed: number;
  routedOk: number;
}

/** `metrics.get`: the dashboard figures for one grouping and search. */
export interface MetricsData {
  tiles: MetricsTiles;
  groups: MetricGroupInfo[];
  daily: Array<{ date: string; runs: number; successes: number; cost: number }>;
  timeShare: { byAgent: MetricsAgentShare[]; taskTimes: MetricsTaskTime[] };
  classifier?: MetricsClassifier;
}

/** Who a knowledge file belongs to. */
export type KnowledgeAgentName = "master" | "designer" | "backend" | "qa";

/** One knowledge file with its size and note count, in tab order. */
export interface KnowledgeFileInfo {
  agent: KnowledgeAgentName;
  file: string;
  label: string;
  chars: number;
  over: boolean;
  notes: number;
}

/** One entry of a knowledge file, as the tab picks it. */
export interface KnowledgeEntryInfo {
  text: string;
  kind: "heading" | "bullet" | "text";
  occurrence: number;
}

/** One note on a knowledge entry. */
export interface KnowledgeNoteInfo {
  id: string;
  agent: KnowledgeAgentName;
  file: string;
  entry: string;
  text: string;
  createdAt: string;
  by?: string;
}

/** One file read as entries with their notes. */
export interface KnowledgeViewData extends KnowledgeFileInfo {
  content: string;
  entries: KnowledgeEntryInfo[];
  attached: KnowledgeNoteInfo[];
  detached: KnowledgeNoteInfo[];
}

/** An entry picked in the tab: its text, and which of several identical ones it is. */
export interface EntryRefInfo {
  text: string;
  occurrence: number;
}

/** Who an Excalidraw session can be assigned to. */
export type ExcalidrawAgentName = "master" | "designer" | "backend" | "qa" | "scout" | "researcher" | "quickfix" | "planner";

/** One shared session with its key hidden (`room <id>`). */
export interface ExcalidrawSessionInfo {
  id: string;
  name: string;
  masked: string;
  agents: ExcalidrawAgentName[];
  contribute: boolean;
  addedAt: string;
}

/** What the last check of a session found. */
export interface ExcalidrawCheck {
  ok: boolean;
  text: string;
}

/** `tasks.get`: one task read whole, in the terminal's wording. */
export interface TaskDetail {
  timing?: TimingProjection;
  delivery?: Delivery;
  /** The full request, when it says more than the title. */
  request?: string;
  /** The oracle's proposal, while the task has no approved plan yet. */
  proposal?: string;
  /** The approved plan in Markdown. */
  plan?: string;
  /** The plan after the steps list it opens with (the steps show as the checklist); absent when the plan is read whole. */
  planDetails?: string;
  /**
   * The plan as a checklist, in order; `current` is the step under way, `active` the steps a worker is on right now,
   * each with its worker time (ms, as of the reply).
   */
  steps: Array<{ text: string; status: "done" | "current" | "open"; active?: boolean; workedMs?: number; activeAgentCount?: number }>;
  /** How long the task's agents have worked on it, idle time left out (ms, as of the reply); `running` while they work. */
  work?: WorkClock;
  amendments: string[];
  /** Approvals waiting on you: `kind` plus `for <domain>: <detail>`. */
  waiting: Array<{ kind: string; detail: string }>;
  blockers: Array<{ reason: string; need: string }>;
  /** The last six runs, one line each (`✓ DEV worker · 3m 12s · …`). */
  runs: string[];
  /** Jev's last read of what the built change warrants of QA: level, test budget, focus and evidence. */
  qaRisk?: QaRiskAssessment;
}

/** `plans.get`: one saved plan. */
export interface PlanDetail {
  id: string;
  title: string;
  status: "pending" | "started";
  createdAt: string;
  /** The agreed plan in Markdown. */
  brief: string;
  issue?: { number: number; title: string; url?: string };
  /** Set when the plan was split: this is `part` of `of`, with every part's title. */
  split?: { part: number; of: number; titles: string[]; after: number[] };
  startedTaskId?: string;
}

/** The checks of a pull request as one state. */
export type PullChecks = "passing" | "failing" | "pending";

/** How a pull request's review stands, for the list's marks. */
export interface PullReviewMark {
  status: "running" | "done" | "failed" | "cancelled" | "timeout";
  verdict?: "approve" | "changes" | "comment";
  /** The pull request has commits the review did not see. */
  stale: boolean;
}

/** One open pull request in the Git list. */
export interface PullInfo {
  number: number;
  title: string;
  author?: string;
  headRef: string;
  baseRef: string;
  draft: boolean;
  updatedAt?: string;
  url?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  decision?: string;
  checks?: PullChecks;
  checkCount: number;
  labels: string[];
  review?: PullReviewMark;
}

/** One changed file. */
export interface PullFileInfo {
  path: string;
  additions: number;
  deletions: number;
}

/** A review or a comment on a pull request. */
export interface PullNoteInfo {
  author?: string;
  body: string;
  at?: string;
  state?: string;
}

/** A pull request with its description, files and discussion. */
export interface PullDetailInfo extends PullInfo {
  body: string;
  state?: string;
  mergeable?: string;
  files: PullFileInfo[];
  notes: PullNoteInfo[];
}

/** The agent's review of a pull request (never posted to GitHub). */
export interface PullReviewInfo {
  number: number;
  status: "running" | "done" | "failed" | "cancelled" | "timeout";
  focus?: string;
  startedAt: number;
  finishedAt?: number;
  steps: string[];
  text?: string;
  verdict?: "approve" | "changes" | "comment";
  error?: string;
  model?: string;
  thinking?: string;
  stale: boolean;
  /** Kept from an earlier session rather than run now. */
  saved?: boolean;
}

/** Jev's quick read of a pull request. */
export interface PullReadInfo {
  number: number;
  status: "running" | "done" | "failed";
  line?: string;
  error?: string;
  read?: {
    size: string;
    sizeConfidence: number;
    risky: number;
    breaking: number;
    security: number;
    testsMissing: number;
    kind?: string;
    kindProbability?: number;
    model: string;
    ms: number;
  };
}

/** `git.pulls`: the open pull requests, or why they could not be read. */
export interface GitPulls {
  pulls: PullInfo[];
  loading: boolean;
  loaded: boolean;
  error?: string;
}

/** `git.pull`: one pull request with our review and Jev's read of it. */
export interface GitPull {
  pull: PullDetailInfo;
  review?: PullReviewInfo;
  read?: PullReadInfo;
}

/** One open issue in the Issues list. */
export interface IssueInfo {
  number: number;
  title: string;
  labels: string[];
  author?: string;
  updatedAt?: string;
  url?: string;
}

/** An issue with its description and comments. */
export interface IssueDetailInfo extends IssueInfo {
  body: string;
  state?: string;
  comments: Array<{ author?: string; body: string; createdAt?: string }>;
}

/** `issues.list`: the open issues, or why they could not be read. */
export interface IssuesList {
  issues: IssueInfo[];
  loading: boolean;
  loaded: boolean;
  error?: string;
}

/** The calls the server answers: `POST /api/<name>` with the request as the JSON body. */
export interface Api {
  "status.get": { request: Record<string, never>; result: StatusInfo };
  "lobby.snapshot": { request: Record<string, never>; result: LobbySnapshot };
  "lobby.history": { request: { before?: number }; result: { entries: unknown[]; hasOlder: boolean } };
  "lobby.send": { request: { text: string; attachments?: string[] }; result: { notice?: string } };
  "lobby.abort": { request: Record<string, never>; result: Record<string, never> };
  "tasks.list": { request: Record<string, never>; result: { rows: TaskRow[] } };
  "tasks.archived": { request: Record<string, never>; result: { rows: TaskRow[] } };
  "tasks.comments": { request: { taskId: string }; result: { comments: PlanComment[] } };
  "tasks.comment": { request: { taskId: string; text: string; attachments?: string[] }; result: { notice?: string } };
  "tasks.editComment": { request: { taskId: string; commentId: string; text: string }; result: { comment: PlanComment } };
  "tasks.archive": { request: { taskId: string }; result: { notice: string } };
  "tasks.restore": { request: { taskId: string }; result: { notice: string } };
  "tasks.delete": { request: { taskId: string; where: "list" | "archive" }; result: { notice: string } };
  "tasks.auto": { request: { taskId: string; on: boolean }; result: { notice: string; on: boolean } };
  "tasks.message": { request: { taskId: string; text: string; attachments?: string[] }; result: { notice: string } };
  "tasks.get": { request: { taskId: string }; result: TaskDetail };
  "tasks.open": { request: { taskId: string }; result: { sessionId?: string; key?: string; notice?: string } };
  "tasks.resume": { request: { taskId: string }; result: { notice: string; key?: string } };
  "tasks.deliveryReview": { request: { taskId: string }; result: { delivery: Delivery } };
  "tasks.deliveryDefer": { request: { taskId: string; reviewId: string }; result: { delivery: Delivery } };
  "tasks.deliver": { request: { taskId: string; reviewId: string; action: DeliveryAction; confirmMain?: boolean }; result: { delivery: Delivery } };
  "plans.get": { request: { planId: string }; result: PlanDetail };
  "plans.start": { request: { planId: string; where: "here" | "session"; auto?: boolean }; result: { notice: string; key?: string } };
  "plans.discard": { request: { planId: string }; result: { notice: string } };
  "sessions.list": { request: Record<string, never>; result: { background: BackgroundSessionInfo[]; live: LiveSession[] } };
  "sessions.chat": { request: { key?: string; sessionId?: string; before?: number }; result: { entries: unknown[]; hasOlder: boolean } };
  "sessions.start": { request: { request?: string; planId?: string; auto?: boolean; attachments?: string[] }; result: { notice: string; key?: string } };
  "sessions.stop": { request: { key: string }; result: { notice: string } };
  "sessions.message": { request: { key?: string; sessionId?: string; text: string; attachments?: string[] }; result: { notice?: string } };
  "sessions.switch": { request: { key?: string; sessionId?: string; claimTaskId?: string }; result: { notice: string } };
  "sessions.answer": { request: { key: string; dialogId: string; answer: DialogAnswer }; result: { notice: string } };
  "prompts.list": { request: Record<string, never>; result: { prompts: WebPrompt[] } };
  "prompts.answer": { request: { id: string; answer: unknown }; result: { notice?: string } };
  "prompts.dismiss": { request: { id: string }; result: Record<string, never> };
  "planner.get": { request: Record<string, never>; result: PlannerSnapshot };
  "planner.new": { request: { seed?: PlannerSeedInfo; seats?: PanelMember[] }; result: { notice: string } };
  "planner.send": { request: { text: string; attachments?: string[] }; result: { notice: string } };
  "planner.editMessage": { request: { messageIndex: number; at: number; text: string }; result: { message: PlannerMessage; notice: string } };
  "planner.toggleSeat": { request: { member: PanelMember }; result: { notice: string; seated: boolean } };
  "planner.retry": { request: Record<string, never>; result: { notice: string } };
  "planner.commentLine": { request: { line: string; text: string }; result: { notice: string } };
  "planner.answer": { request: Record<string, never>; result: { notice: string } };
  "planner.previous": { request: { archived?: boolean }; result: { plans: PreviousPlanInfo[] } };
  "planner.previousGet": { request: { id: string }; result: PreviousPlanDetail };
  "planner.previousArchive": { request: { id: string; archived: boolean }; result: { notice: string } };
  "planner.previousDelete": { request: { id: string }; result: { notice: string } };
  "planner.previousOpen": { request: { id: string }; result: { notice: string } };
  "planner.save": { request: Record<string, never>; result: { notice: string } };
  "quickfix.list": { request: Record<string, never>; result: { jobs: QuickFixJob[] } };
  "quickfix.submit": { request: { text: string; attachments?: string[] }; result: { notice: string; id: string } };
  "quickfix.cancel": { request: { id: string }; result: { notice: string } };
  "quickfix.runAnyway": { request: { id: string }; result: { notice: string } };
  "quickfix.movedToTask": { request: { id: string }; result: { notice: string; key?: string } };
  "metrics.get": { request: { groupBy: "model" | "model-kind"; query?: string; from?: string; to?: string; timeZone?: string }; result: MetricsData };
  "projects.browse": { request: { path?: string }; result: FolderListing };
  "projects.open": { request: { path: string }; result: { project: ProjectInfo } };
  "knowledge.files": { request: Record<string, never>; result: { files: KnowledgeFileInfo[]; models?: Partial<Record<KnowledgeAgentName, string>> } };
  "knowledge.ask": { request: { text: string; attachments?: string[] }; result: { notice: string } };
  "knowledge.open": { request: { agent: KnowledgeAgentName; file: string }; result: { view: KnowledgeViewData } };
  "knowledge.edit": { request: { agent: KnowledgeAgentName; file: string; ref: EntryRefInfo; text: string }; result: { notice: string } };
  "knowledge.add": { request: { agent: KnowledgeAgentName; file: string; ref?: EntryRefInfo; text: string }; result: { notice: string } };
  "knowledge.remove": { request: { agent: KnowledgeAgentName; file: string; ref: EntryRefInfo }; result: { notice: string } };
  "knowledge.replaceFile": { request: { agent: KnowledgeAgentName; file: string; text: string }; result: { notice: string } };
  "knowledge.comment": { request: { agent: KnowledgeAgentName; file: string; ref: EntryRefInfo; text: string }; result: { notice: string } };
  "knowledge.unnote": { request: { id: string }; result: { notice: string } };
  "excalidraw.list": { request: Record<string, never>; result: { sessions: ExcalidrawSessionInfo[] } };
  "excalidraw.add": { request: { link: string; name?: string }; result: { notice: string; id?: string } };
  "excalidraw.create": { request: { name?: string }; result: { notice: string; id?: string } };
  "excalidraw.remove": { request: { id: string }; result: { notice: string } };
  "excalidraw.rename": { request: { id: string; name: string }; result: { notice: string } };
  "excalidraw.toggleAgent": { request: { id: string; agent: ExcalidrawAgentName }; result: { notice: string } };
  "excalidraw.toggleAll": { request: { id: string }; result: { notice: string } };
  "excalidraw.toggleContribute": { request: { id: string }; result: { notice: string } };
  "excalidraw.check": { request: { id: string }; result: ExcalidrawCheck };
  "excalidraw.reveal": { request: { id: string }; result: { link: string } };
  "git.pulls": { request: { refresh?: boolean }; result: GitPulls };
  "git.pull": { request: { number: number }; result: GitPull };
  "git.review": { request: { number: number; focus?: string }; result: { notice: string } };
  "git.cancelReview": { request: { number: number }; result: { notice: string } };
  "git.jev": { request: { number: number }; result: { notice: string } };
  "issues.list": { request: { refresh?: boolean }; result: IssuesList };
  "issues.get": { request: { number: number }; result: { issue: IssueDetailInfo } };
  "issues.create": { request: { text: string }; result: { notice: string } };
  "settings.get": { request: Record<string, never>; result: SettingsInfo };
  "settings.set": { request: { patch: Record<string, unknown> }; result: { config: BotLobbyConfig } };
  "settings.linters": { request: Record<string, never>; result: { linters: SettingsLinter[] } };
  "themes.get": { request: Record<string, never>; result: ThemeStoreInfo };
  "themes.save": { request: { name: string; light?: Record<string, string>; dark?: Record<string, string> }; result: ThemeStoreInfo & { id: string } };
  "themes.rename": { request: { id: string; name: string }; result: ThemeStoreInfo };
  "themes.remove": { request: { id: string }; result: ThemeStoreInfo };
  "themes.choose": { request: { id: string }; result: ThemeStoreInfo };
}

export type ApiName = keyof Api;
