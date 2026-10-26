/** Shared feed-backed fake for the webui server tests. */
import { LobbyFeed } from "../src/lobby/feed.ts";
import type { LobbyService } from "../src/lobby/host.ts";

/** A deterministic fake with every method the web routes read. */
export function fakeWebService(feed = new LobbyFeed()): LobbyService {
  const tasks: Array<Record<string, unknown>> = [];
  const archived: Array<Record<string, unknown>> = [];
  const plans: Array<Record<string, unknown>> = [];
  const auto = new Set<string>();
  return {
    sessionId: () => "session-1",
    sessionName: () => "test session",
    masterBusy: () => false,
    models: () => [{ id: "mock/model", label: "Mock Model", thinkingLevels: ["low", "medium", "high"] }],
    classifierModels: () => [{ id: "openrouter/liquid/d1", label: "Liquid D1" }],
    grants: () => ({ mcpTools: [{ name: "mcp__github__get_issue", server: "github", description: "Read an issue.", readOnly: true }], skills: [{ name: "pdf-tools", description: "Read PDFs.", path: "/skills/pdf-tools/SKILL.md" }] }),
    workspace: () => ({ name: "bot-lobby", branch: "main" }),
    zen: () => ({ runs: [] }),
    feed,
    toOracle: () => undefined,
    askKnowledge: () => {},
    abortMaster: () => {},
    chatHistory: () => [],
    tasks: () => [...tasks],
    plans: () => [...plans],
    metrics: () => [],
    classifierMetrics: () => [],
    knowledge: {
      files: () => [],
      open: (agent: string, file: string) => ({ agent, file, label: file, chars: 0, over: false, notes: 0, content: "", entries: [], attached: [], detached: [] }),
      edit: () => "saved mock/agent/mock.md — the version before is in archive/Mock",
      add: () => "saved mock/agent/mock.md — the version before is in archive/Mock",
      remove: () => "saved mock/agent/mock.md — the version before is in archive/Mock",
      replaceFile: () => "saved mock/agent/mock.md — the version before is in archive/Mock",
      comment: () => "note saved — every agent reads it under this entry",
      unnote: () => "note removed",
    },
    pulls: { pulls: [], details: new Map(), loading: false, loaded: true, error: undefined, refresh: async () => {}, detail: async () => undefined, forget: () => {} },
    reviews: { reviews: new Map(), reads: new Map(), review: () => undefined, running: () => false, cancel: () => false, start: async () => ({}), readWithJev: async () => ({}) },
    issues: { issues: [], details: new Map(), loading: false, loaded: true, error: undefined, notice: undefined, refresh: async () => {}, detail: async () => undefined, create: async () => {} },
    comments: () => [],
    comment: (taskId: string) => `comment saved — ${taskId} has no owning session; it is delivered once a session claims it`,
    startPlanned: (plan: { id: string }) => `starting ${plan.id} here — its agreed plan needs no approval…`,
    discardPlan: (id: string) => {
      const index = plans.findIndex((plan) => plan.id === id);
      if (index >= 0) plans.splice(index, 1);
    },
    archivedTasks: () => [...archived],
    archiveTask: (taskId: string) => `archived ${taskId} — show archived tasks to restore it`,
    restoreTask: (taskId: string) => `restored ${taskId} to the task list`,
    deleteTask: (taskId: string) => `deleted ${taskId} for good`,
    isAuto: (taskId: string) => auto.has(taskId),
    setAuto: (taskId: string, on: boolean) => {
      if (on) auto.add(taskId);
      else auto.delete(taskId);
    },
    sendToTask: (taskId: string) => `sent — the session driving ${taskId} passes it to its oracle`,
    sendToSession: () => "sent — that session passes it to its oracle within a few seconds",
    sessions: () => [],
    startSession: () => "describe the task first",
    liveSessions: () => [],
    sessionChat: () => [],
    hasOlderChat: () => false,
    switchTo: async (target: { name: string }) => `switching this window to ${target.name}…`,
  } as unknown as LobbyService;
}
