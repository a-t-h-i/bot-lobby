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
import type { HarnessStatus } from "../harness/status.ts";
import type { HarnessModel } from "../harness/catalog.ts";

export interface ProjectInfo { id: string; name: string; cwd: string; port: number }
export interface FolderListing { path: string; parent?: string; folders: Array<{ name: string; path: string }>; truncated: boolean }

/** A file changed in the working tree against HEAD (`code.changes`); counts are lines, absent for binary files. */
export interface CodeChange { path: string; status: "modified" | "added" | "deleted" | "renamed" | "untracked"; from?: string; additions?: number; deletions?: number }
export interface CodeChanges { git: boolean; files: CodeChange[]; truncated: boolean }
/** One file for the code viewer (`code.read`): its text unless binary or too large, its change, and HEAD's text when it had one. */
export interface CodeFile { path: string; size: number; mtimeMs: number; exists: boolean; contents?: string; binary?: boolean; tooLarge?: boolean; change?: CodeChange; original?: string }
export interface CodeSaved { path: string; mtimeMs: number; notice: string }

export type { WebPrompt };
export type { LobbyTopic };
export type { DialogAnswer, SessionDialog, TaskRow, PlanComment };
export type { LiveSession };
export type { HarnessStatus, HarnessModel };
export type { PanelMember, MemberState, PanelNote, PanelQuestion, PlannerMessage, BotLobbyConfig };

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
  commands?: import("../lobby/pi-commands.ts").LobbySlashCommand[];
  workspace: { name: string; branch?: string };
  branch?: string;
  sessionId?: string;
  sessionName?: string;
  busy: boolean;
  port: number;
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
  activeSteps?: Array<{ text: string; workedMs: number; activeAgentCount?: number; runIds?: string[] }>;
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
  chat: Array<{ id: number; at: number; role: string; text: string; agent?: string; to?: string }>;
  /** The agent (other than the oracle) answering in the chat now: `DESIGN`, `DEV`, …; absent when none is. */
  answering?: string;
  /** The oracle's reply while it streams; absent between replies. */
  reply?: string;
  /** Newest activity entries (at most 400), oldest first. */
  activity: Array<{ id: number; at: number; source: string; text: string; kind: string; pending: boolean }>;
  /** Newest thoughts (at most 40), oldest first. */
  thoughts: Array<{ id: number; at: number; source: string; text: string; live: boolean }>;
  /** Earlier chat exists in the session (loaded through `lobby.history`). */
  hasOlderChat: boolean;
}

/** A saved session of the project, listed until it is archived or deleted. */
export interface SavedSession {
  sessionId: string;
  name: string;
  /** When it last changed, ms since the epoch. */
  at: number;
  archived?: boolean;
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
  /** Classifier models pi can call with the logins it holds (Jev on each host, Cloudflare's clef, Liquid's d1, …). */
  classifierModels?: SettingsClassifierModel[];
}

/** A classifier model for the classifier's picker: `provider/id` and its name. */
export interface SettingsClassifierModel {
  id: string;
  label: string;
}

/** An MCP tool Settings can grant (`settings.grants`). */
export interface SettingsMcpTool {
  name: string;
  server: string;
  description: string;
  /** The server marks it read-only: read-only agents (scouts, QA, researcher) may call it. */
  readOnly: boolean;
}

/** A skill Settings can grant (`settings.grants`). */
export interface SettingsSkill {
  name: string;
  description: string;
  path: string;
}

/** `settings.grants`: what pi offers to grant agents now. */
export interface SettingsGrants {
  mcpTools: SettingsMcpTool[];
  skills: SettingsSkill[];
}

/** `settings.harnesses`: each third-party harness, whether it is installed, and the models it offers. */
export interface SettingsHarnesses {
  harnesses: HarnessStatus[];
}

/** One message on the event stream (`GET /api/events`, server-sent events). */
export type StreamEvent =
  | { type: "hello"; versions: Partial<Record<LobbyTopic, number>> }
  | { type: "changed"; topic: LobbyTopic; version: number }
  | { type: "feed"; activity: unknown[]; thoughts: unknown[]; chat: unknown[] }
  | { type: "reply"; text: string }
  | { type: "notice"; text: string; level: NoticeLevel };

/** A terminal the server runs (`terminal.*`): a shell in the project's folder. */
export interface TerminalInfo {
  id: string;
  title: string;
  cwd: string;
  alive: boolean;
  /** The shell's exit code, once it ended. */
  exitCode?: number;
  startedAt: number;
}

/** One message on a terminal's stream (`GET /api/terminal.stream?id=…`). */
export type TerminalStreamEvent =
  | { type: "reset"; data: string; alive: boolean; code?: number }
  | { type: "data"; data: string }
  | { type: "exit"; code?: number };

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

/** A pinned note: it loads first for its agent. */
export interface KnowledgePinInfo {
  agent: KnowledgeAgentName;
  file: string;
  entry: string;
  at: string;
}

/** One thing that happened to a note: who, in words, and the text before an edit (restorable). */
export interface KnowledgeEventInfo {
  id: string;
  agent: KnowledgeAgentName;
  file: string;
  entry: string;
  by: string;
  what: string;
  source?: string;
  before?: string;
  at: string;
}

/** A note finished work proposed, waiting in the Inbox. */
export interface KnowledgeProposalInfo {
  id: string;
  agent: KnowledgeAgentName;
  kind: "knowledge" | "standard" | "decision";
  text: string;
  source: string;
  confidence?: number;
  replaces?: string;
  taskId?: string;
  at: string;
}

/** Pins, history, the Inbox and each agent's recent runs (every run loads the agent's knowledge). */
export interface KnowledgeLedgerData {
  pins: KnowledgePinInfo[];
  events: KnowledgeEventInfo[];
  proposals: KnowledgeProposalInfo[];
  runs: Partial<Record<KnowledgeAgentName, { recent: Array<{ at: string; taskId?: string }>; lastAt?: string }>>;
}

/** An entry picked in the tab: its text, and which of several identical ones it is. */
export interface EntryRefInfo {
  text: string;
  occurrence: number;
}

/** `tasks.get`: one task read whole, in the terminal's wording. */
export interface TaskDetail {
  canAccept: boolean;
  /** Open steps can be skipped (the user gives a reason). */
  canSkip: boolean;
  canForceClose: boolean;
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
   * each with its worker time (ms, as of the reply); `skip` carries the reason the user gave for skipping a step.
   */
  steps: Array<{ text: string; status: "done" | "current" | "open" | "skipped"; skip?: { reason: string; at: string }; active?: boolean; workedMs?: number; activeAgentCount?: number; agents?: StepAgentInfo[] }>;
  /** How long the task's agents have worked on it, idle time left out (ms, as of the reply); `running` while they work. */
  work?: WorkClock;
  amendments: string[];
  /** Approvals waiting on you: `kind` plus `for <domain>: <detail>`. */
  waiting: Array<{ id: string; domain: string; kind: string; detail: string }>;
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

/** The calls the server answers: `POST /api/<name>` with the request as the JSON body. */
export interface Api {
  "status.get": { request: Record<string, never>; result: StatusInfo };
  "lobby.snapshot": { request: Record<string, never>; result: LobbySnapshot };
  "lobby.history": { request: { before?: number }; result: { entries: unknown[]; hasOlder: boolean } };
  "lobby.send": { request: { text: string; attachments?: string[] }; result: { notice?: string; open?: "plan" } };
  "lobby.abort": { request: Record<string, never>; result: Record<string, never> };
  "lobby.retention": { request: Record<string, never>; result: { enabled: boolean } };
  "lobby.setRetention": { request: { enabled: boolean }; result: { enabled: boolean } };
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
  "tasks.accept": { request: { taskId: string }; result: { notice: string } };
  "tasks.skipStep": { request: { taskId: string; step: number; text: string; reason: string }; result: { notice: string } };
  "tasks.forceClose": { request: { taskId: string; title: string }; result: { notice: string } };
  "tasks.resolveApproval": { request: { taskId: string; approvalId: string; decision: "approved" | "rejected"; note?: string }; result: { notice: string } };
  "tasks.deliveryReview": { request: { taskId: string }; result: { delivery: Delivery } };
  "tasks.deliveryDefer": { request: { taskId: string; reviewId: string }; result: { delivery: Delivery } };
  "tasks.deliver": { request: { taskId: string; reviewId: string; action: DeliveryAction; confirmMain?: boolean }; result: { delivery: Delivery } };
  "plans.get": { request: { planId: string }; result: PlanDetail };
  "plans.start": { request: { planId: string; where: "here" | "session"; auto?: boolean }; result: { notice: string; key?: string } };
  "plans.discard": { request: { planId: string }; result: { notice: string } };
  "sessions.list": { request: Record<string, never>; result: { background: BackgroundSessionInfo[]; live: LiveSession[]; saved?: SavedSession[] } };
  "sessions.chat": { request: { key?: string; sessionId?: string; before?: number }; result: { entries: unknown[]; hasOlder: boolean } };
  "sessions.start": { request: { request?: string; planId?: string; auto?: boolean; attachments?: string[] }; result: { notice: string; key?: string } };
  "sessions.stop": { request: { key: string }; result: { notice: string } };
  "sessions.message": { request: { key?: string; sessionId?: string; text: string; attachments?: string[] }; result: { notice?: string } };
  "sessions.switch": { request: { key?: string; sessionId?: string; claimTaskId?: string }; result: { notice: string } };
  "sessions.answer": { request: { key: string; dialogId: string; answer: DialogAnswer }; result: { notice: string } };
  "sessions.rename": { request: { key?: string; name: string }; result: { notice: string } };
  "sessions.archive": { request: { key?: string; sessionId?: string; archived?: boolean }; result: { notice: string } };
  "sessions.delete": { request: { sessionId: string }; result: { notice: string } };
  "terminal.list": { request: Record<string, never>; result: { available: boolean; reason?: string; terminals: TerminalInfo[] } };
  "terminal.open": { request: { cols: number; rows: number }; result: TerminalInfo };
  "terminal.input": { request: { id: string; data: string }; result: Record<string, never> };
  "terminal.resize": { request: { id: string; cols: number; rows: number }; result: Record<string, never> };
  "terminal.close": { request: { id: string }; result: Record<string, never> };
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
  "code.changes": { request: Record<string, never>; result: CodeChanges };
  "code.read": { request: { path: string }; result: CodeFile };
  "code.save": { request: { path: string; contents: string; mtimeMs?: number; force?: boolean }; result: CodeSaved };
  "projects.browse": { request: { path?: string }; result: FolderListing };
  "projects.open": { request: { path: string }; result: { project: ProjectInfo } };
  "knowledge.files": { request: Record<string, never>; result: { files: KnowledgeFileInfo[]; models?: Partial<Record<KnowledgeAgentName, string>>; threshold?: number } };
  "knowledge.ask": { request: { text: string; attachments?: string[] }; result: { notice: string } };
  "knowledge.open": { request: { agent: KnowledgeAgentName; file: string }; result: { view: KnowledgeViewData } };
  "knowledge.edit": { request: { agent: KnowledgeAgentName; file: string; ref: EntryRefInfo; text: string }; result: { notice: string } };
  "knowledge.add": { request: { agent: KnowledgeAgentName; file: string; ref?: EntryRefInfo; text: string }; result: { notice: string } };
  "knowledge.remove": { request: { agent: KnowledgeAgentName; file: string; ref: EntryRefInfo }; result: { notice: string } };
  "knowledge.replaceFile": { request: { agent: KnowledgeAgentName; file: string; text: string }; result: { notice: string } };
  "knowledge.comment": { request: { agent: KnowledgeAgentName; file: string; ref: EntryRefInfo; text: string }; result: { notice: string } };
  "knowledge.ledger": { request: Record<string, never>; result: KnowledgeLedgerData };
  "knowledge.pin": { request: { agent: KnowledgeAgentName; file: string; ref: EntryRefInfo; on: boolean }; result: { notice: string } };
  "knowledge.restore": { request: { agent: KnowledgeAgentName; file: string; ref: EntryRefInfo; event: string }; result: { notice: string } };
  "knowledge.move": { request: { agent: KnowledgeAgentName; file: string; ref: EntryRefInfo; to: KnowledgeAgentName; toFile: string }; result: { notice: string } };
  "knowledge.accept": { request: { id: string; text?: string }; result: { notice: string } };
  "knowledge.dismiss": { request: { id: string }; result: { notice: string } };
  "knowledge.unnote": { request: { id: string }; result: { notice: string } };
  "settings.get": { request: Record<string, never>; result: SettingsInfo };
  "settings.set": { request: { patch: Record<string, unknown> }; result: { config: BotLobbyConfig } };
  "settings.linters": { request: Record<string, never>; result: { linters: SettingsLinter[] } };
  "settings.grants": { request: Record<string, never>; result: SettingsGrants };
  "settings.harnesses": { request: Record<string, never>; result: SettingsHarnesses };
  "themes.get": { request: Record<string, never>; result: ThemeStoreInfo };
  "themes.save": { request: { name: string; light?: Record<string, string>; dark?: Record<string, string> }; result: ThemeStoreInfo & { id: string } };
  "themes.rename": { request: { id: string; name: string }; result: ThemeStoreInfo };
  "themes.remove": { request: { id: string }; result: ThemeStoreInfo };
  "themes.choose": { request: { id: string }; result: ThemeStoreInfo };
}

export type ApiName = keyof Api;

/** An agent on a step right now: its domain, what it was told (first line), since when; a child names its parent. */
export interface StepAgentInfo {
  runId: string;
  parentRunId?: string;
  domain: string;
  instruction: string;
  startedAt: string;
}
