/** Shared feed-backed fake for the webui server tests. */
import { LobbyFeed } from "../src/lobby/feed.ts";
import type { LobbyService } from "../src/lobby/service.ts";

/** A deterministic fake with every method the web routes read. */
export function fakeWebService(feed = new LobbyFeed()): LobbyService {
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
  } as unknown as LobbyService;
}
