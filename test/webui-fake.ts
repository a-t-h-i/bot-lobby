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
    issuesEnabled: () => false,
    workspace: () => ({ name: "bot-lobby", branch: "main" }),
    zen: () => ({ runs: [] }),
    feed,
    toOracle: () => undefined,
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
    excalidraw: {
      list: () => [],
      add: (link: string, name?: string) => (link.includes("#room=") ? { notice: "added it", session: { id: "x1", name: name ?? "Session 1", link, agents: [], contribute: true, addedAt: new Date().toISOString() } } : { notice: "that is not an Excalidraw room link" }),
      create: (name?: string) => ({ notice: "added it", session: { id: "x1", name: name ?? "Session 1", link: "https://whiteboard.example/#room=x1,AAAAAAAAAAAAAAAAAAAAAA", agents: [], contribute: true, addedAt: new Date().toISOString() } }),
      remove: () => "no such session",
      rename: () => "no such session",
      toggleAgent: () => "no such session",
      toggleAll: () => "no such session",
      toggleContribute: () => "no such session",
    },
    checkExcalidraw: async () => ({ ok: true, text: "mock check" }),
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
