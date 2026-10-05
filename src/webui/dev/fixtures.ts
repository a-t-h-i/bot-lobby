/**
 * Fixture sets for `npm run web:dev`: one JSON file per scenario under
 * `webui/fixtures/`. Dev-only; the production server never reads these.
 * Unknown scenario names fall back to `full`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatRole } from "../../lobby/feed.ts";
import type { PromptKind } from "../../lobby/prompt-hub.ts";
import type { SnapshotTask } from "../protocol.ts";

/** Every scenario the mock serves; `?scenario=` picks one. */
export const SCENARIOS = [
  "full",
  "empty",
  "loading",
  "error",
  "reconnecting",
  "question",
  "questions3",
  "issues",
  "mockups",
] as const;

export type ScenarioName = (typeof SCENARIOS)[number];

export interface FixturePrompt {
  kind: PromptKind;
  from: string;
  payload: unknown;
}

export interface FixtureSettled extends FixturePrompt {
  answer: unknown;
}

/** One scenario file: what every protocol call answers from. */
export interface ScenarioFixture {
  status: {
    workspace: { name: string; branch?: string };
    sessionId: string;
    sessionName: string;
    busy: boolean;
    issuesEnabled: boolean;
  };
  zen: { task?: Partial<SnapshotTask> & { id: string; title: string; state: string; plan?: string }; runs: unknown[] };
  feed: {
    chat: Array<{ role: ChatRole; text: string }>;
    activity: Array<{ source: string; text: string; kind: "info" | "success" | "warning" | "error"; pending: boolean }>;
    /** `live` thoughts are still streaming, as an agent thinking now. */
    thoughts: Array<{ source: string; text: string; live?: boolean }>;
    reply: string;
    chatOlder: boolean;
  };
  history: Array<{ role: ChatRole; text: string }>;
  prompts: FixturePrompt[];
  settled: FixtureSettled[];
  /** Streamed back (in deltas) after `lobby.send`. */
  oracleReply: string;
  /** The Settings page's mock: a partial config merged over the defaults, and the models Pi offers. */
  settings?: { config?: Record<string, unknown>; models?: Array<{ id: string; label: string; thinkingLevels: string[] }>; linters?: Array<{ tool: string; folder: string; installed: boolean }> };
  /** Opened through `promptHub` shortly after a send, if any. */
  questionAfterSend: FixturePrompt | null;
  /** Tasks backing `tasks.list` (absent means none). */
  mockTasks?: Array<Record<string, unknown>>;
  /** Work clocks by task id (`work.json` as the owner keeps it); a run's start is given as how long ago, so it reads live. */
  mockWork?: Record<string, { workedMs: number; running: boolean; active?: Array<{ runId: string; instruction: string; startedAgoMs: number }> }>;
  /** Saved plans backing `plans.start`/`plans.discard` and the pending rows. */
  mockPlans?: Array<{ id: string; title: string; brief: string }>;
  /** Archived tasks backing `tasks.archived`. */
  mockArchived?: Array<Record<string, unknown>>;
  /** Task ids with auto mode on. */
  autoTasks?: string[];
  /** Comments by task id for `tasks.comments`. */
  taskComments?: Record<string, Array<Record<string, unknown>>>;
  /** Background sessions for `sessions.list` (plain data, made live below). */
  backgroundSessions?: Array<{ key: string; name: string; status: string; sessionId?: string; planId?: string; dialogs?: Array<Record<string, unknown>> }>;
  /** Live sessions in other terminals for `sessions.list`. */
  liveSessions?: Array<{ sessionId: string; pid: number; name?: string; taskId?: string; mode: string }>;
  /** The planning session for the `planner.*` calls (absent means none started). */
  mockPlanner?: {
    seats: string[];
    members: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
    draft?: string;
    questions: Array<Record<string, unknown>>;
    notes: Array<Record<string, unknown>>;
    round: number;
    retryable: boolean;
  };
  /** Quick-fix jobs for the `quickfix.*` calls, oldest first (absent means none). */
  mockQuickfix?: Array<Record<string, unknown>>;
  /** Metric records for `metrics.get` (absent means none). */
  mockMetrics?: Array<Record<string, unknown>>;
  /** Classifier records for `metrics.get` (absent means none). */
  mockClassifierMetrics?: Array<Record<string, unknown>>;
  /** Knowledge files for `knowledge.files` (absent means none). */
  mockKnowledge?: Array<{ agent: string; file: string; label: string; chars: number; over: boolean; notes: number }>;
  /** One open knowledge file for `knowledge.open` (absent means an empty file). */
  mockKnowledgeView?: { agent: string; file: string; label: string; chars: number; over: boolean; notes: number; content: string; entries: Array<Record<string, unknown>>; attached: Array<Record<string, unknown>>; detached: Array<Record<string, unknown>> };
  /** Excalidraw sessions for `excalidraw.list` (masked links only; absent means none). */
  mockExcalidraw?: Array<{ id: string; name: string; masked: string; agents: string[]; contribute: boolean; addedAt: string }>;
  /** The full link `excalidraw.reveal` returns (absent means none). */
  mockExcalidrawLink?: string;
  /** Open pull requests for the `git.*` calls, each with its detail fields (absent means none). */
  mockPulls?: Array<Record<string, unknown>>;
  /** Saved reviews of those pull requests, by number. */
  mockReviews?: Array<Record<string, unknown>>;
  /** Jev's reads of those pull requests, by number. */
  mockReads?: Array<Record<string, unknown>>;
  /** Open issues for the `issues.*` calls, each with its detail fields (absent means none). */
  mockIssues?: Array<Record<string, unknown>>;
}

/** Whether `value` names a scenario. */
export function isScenario(value: string): value is ScenarioName {
  return (SCENARIOS as readonly string[]).includes(value);
}

/** The scenario to serve; unknown or missing names mean `full`. */
export function resolveScenario(value: string | undefined): ScenarioName {
  return value !== undefined && isScenario(value) ? value : "full";
}

/** Where `webui/fixtures/<name>.json` lives. */
export function fixturePath(name: ScenarioName): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  return join(root, "webui", "fixtures", `${name}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && keys.every((key) => key in value);
}

/** The parsed file, or throws when it does not cover every protocol call. */
export function loadScenario(name: string | undefined): ScenarioFixture {
  const scenario = resolveScenario(name);
  const parsed: unknown = JSON.parse(readFileSync(fixturePath(scenario), "utf8"));
  if (!hasKeys(parsed, ["status", "zen", "feed", "history", "prompts", "oracleReply"])) {
    throw new Error(`fixtures/${scenario}.json must cover status, zen, feed, history, prompts and oracleReply`);
  }
  if (!hasKeys(parsed.status, ["workspace", "sessionId", "sessionName", "busy", "issuesEnabled"])) {
    throw new Error(`fixtures/${scenario}.json status must carry workspace, session, busy and issuesEnabled`);
  }
  if (!hasKeys(parsed.zen, ["runs"]) || !hasKeys(parsed.feed, ["chat", "activity", "thoughts", "reply", "chatOlder"])) {
    throw new Error(`fixtures/${scenario}.json zen/feed are missing their fields`);
  }
  if (!Array.isArray(parsed.history) || !Array.isArray(parsed.prompts) || typeof parsed.oracleReply !== "string") {
    throw new Error(`fixtures/${scenario}.json history/prompts/oracleReply have the wrong shape`);
  }
  return {
    ...(parsed as unknown as ScenarioFixture),
    settled: Array.isArray(parsed.settled) ? (parsed.settled as ScenarioFixture["settled"]) : [],
    questionAfterSend: isRecord(parsed.questionAfterSend) ? (parsed.questionAfterSend as unknown as FixturePrompt) : null,
    taskComments: isRecord(parsed.taskComments) ? (parsed.taskComments as ScenarioFixture["taskComments"]) : {},
    mockTasks: Array.isArray(parsed.mockTasks) ? (parsed.mockTasks as ScenarioFixture["mockTasks"]) : [],
    mockPlans: Array.isArray(parsed.mockPlans) ? (parsed.mockPlans as ScenarioFixture["mockPlans"]) : [],
    mockArchived: Array.isArray(parsed.mockArchived) ? (parsed.mockArchived as ScenarioFixture["mockArchived"]) : [],
    autoTasks: Array.isArray(parsed.autoTasks) ? (parsed.autoTasks as string[]) : [],
    backgroundSessions: Array.isArray(parsed.backgroundSessions) ? (parsed.backgroundSessions as ScenarioFixture["backgroundSessions"]) : [],
    liveSessions: Array.isArray(parsed.liveSessions) ? (parsed.liveSessions as ScenarioFixture["liveSessions"]) : [],
    mockPlanner: isRecord(parsed.mockPlanner) ? (parsed.mockPlanner as unknown as ScenarioFixture["mockPlanner"]) : undefined,
    mockQuickfix: Array.isArray(parsed.mockQuickfix) ? (parsed.mockQuickfix as ScenarioFixture["mockQuickfix"]) : [],
    mockMetrics: Array.isArray(parsed.mockMetrics) ? (parsed.mockMetrics as ScenarioFixture["mockMetrics"]) : [],
    mockClassifierMetrics: Array.isArray(parsed.mockClassifierMetrics) ? (parsed.mockClassifierMetrics as ScenarioFixture["mockClassifierMetrics"]) : [],
    mockKnowledge: Array.isArray(parsed.mockKnowledge) ? (parsed.mockKnowledge as ScenarioFixture["mockKnowledge"]) : [],
    mockKnowledgeView: isRecord(parsed.mockKnowledgeView) ? (parsed.mockKnowledgeView as unknown as ScenarioFixture["mockKnowledgeView"]) : undefined,
    mockExcalidraw: Array.isArray(parsed.mockExcalidraw) ? (parsed.mockExcalidraw as ScenarioFixture["mockExcalidraw"]) : [],
    mockExcalidrawLink: typeof parsed.mockExcalidrawLink === "string" ? (parsed.mockExcalidrawLink as string) : undefined,
    mockPulls: Array.isArray(parsed.mockPulls) ? (parsed.mockPulls as ScenarioFixture["mockPulls"]) : [],
    mockReviews: Array.isArray(parsed.mockReviews) ? (parsed.mockReviews as ScenarioFixture["mockReviews"]) : [],
    mockReads: Array.isArray(parsed.mockReads) ? (parsed.mockReads as ScenarioFixture["mockReads"]) : [],
    mockIssues: Array.isArray(parsed.mockIssues) ? (parsed.mockIssues as ScenarioFixture["mockIssues"]) : [],
    settings: isRecord(parsed.settings) ? (parsed.settings as ScenarioFixture["settings"]) : undefined,
  };
}
