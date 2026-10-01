/** Shared feed-backed fake for the webui server tests. */
import { LobbyFeed } from "../src/lobby/feed.ts";
import type { LobbyService } from "../src/lobby/service.ts";

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
    issuesEnabled: () => false,
    workspace: () => ({ name: "bot-lobby", branch: "main" }),
    zen: () => ({ runs: [] }),
    feed,
    toOracle: () => undefined,
    abortMaster: () => {},
    chatHistory: () => [],
    tasks: () => [...tasks],
    plans: () => [...plans],
    comments: () => [],
    comment: (taskId: string) => `comment saved — ${taskId} has no owning session; it is delivered once a session claims it`,
    startPlanned: (plan: { id: string }) => `starting ${plan.id} here — its agreed plan needs no approval…`,
    discardPlan: (id: string) => {
      const index = plans.findIndex((plan) => plan.id === id);
      if (index >= 0) plans.splice(index, 1);
    },
    archivedTasks: () => [...archived],
    archiveTask: (taskId: string) => `archived ${taskId} — v shows archived tasks, a restores one`,
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
