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
  "answered-in-terminal",
  "terminal-dialog",
  "issues",
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
    terminalDialog: boolean;
    issuesEnabled: boolean;
  };
  zen: { task?: Partial<SnapshotTask> & { id: string; title: string; state: string; plan?: string }; runs: unknown[] };
  feed: {
    chat: Array<{ role: ChatRole; text: string }>;
    activity: Array<{ source: string; text: string; kind: "info" | "success" | "warning" | "error"; pending: boolean }>;
    thoughts: Array<{ source: string; text: string }>;
    reply: string;
    chatOlder: boolean;
  };
  history: Array<{ role: ChatRole; text: string }>;
  prompts: FixturePrompt[];
  settled: FixtureSettled[];
  /** Streamed back (in deltas) after `lobby.send`. */
  oracleReply: string;
  /** Opened through `promptHub` shortly after a send, if any. */
  questionAfterSend: FixturePrompt | null;
  /** Tasks backing `tasks.list` (absent means none). */
  mockTasks?: Array<Record<string, unknown>>;
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
  if (!hasKeys(parsed.status, ["workspace", "sessionId", "sessionName", "busy", "terminalDialog", "issuesEnabled"])) {
    throw new Error(`fixtures/${scenario}.json status must carry workspace, session, busy, terminalDialog and issuesEnabled`);
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
  };
}
