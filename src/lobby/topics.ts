/**
 * Every lobby change routed through one versioned emitter. Each topic carries
 * a version that only grows; a later web server follows them over SSE, while
 * the terminal subscribes to everything and repaints, exactly as before.
 * Dependency-free on purpose: sources bump without importing the terminal.
 */

export const LOBBY_TOPICS = [
  "lobby",
  "tasks",
  "plans",
  "planner",
  "quickfix",
  "sessions",
  "metrics",
  "git",
  "issues",
  "knowledge",
  "excalidraw",
  "prompts",
  "notices",
  "status",
] as const;

export type LobbyTopic = (typeof LOBBY_TOPICS)[number];

/** A change on `topic`, now at `version`. */
export type LobbyTopicListener = (topic: LobbyTopic, version: number) => void;

function isTopic(value: string): value is LobbyTopic {
  return (LOBBY_TOPICS as readonly string[]).includes(value);
}

/** One version per topic; listeners hear every bump in order. */
export class LobbyTopics {
  private readonly versionsByTopic = new Map<LobbyTopic, number>();
  private readonly listeners = new Set<LobbyTopicListener>();

  /** The current version of `topic` (0 when nothing bumped it yet). */
  version(topic: LobbyTopic): number {
    return this.versionsByTopic.get(topic) ?? 0;
  }

  /** Every topic with its current version. */
  versions(): Record<LobbyTopic, number> {
    const snapshot = {} as Record<LobbyTopic, number>;
    for (const topic of LOBBY_TOPICS) snapshot[topic] = this.version(topic);
    return snapshot;
  }

  /** Record a change on `topic` and tell every listener. */
  bump(topic: LobbyTopic): number {
    if (!isTopic(topic)) return 0;
    const version = this.version(topic) + 1;
    this.versionsByTopic.set(topic, version);
    for (const listener of [...this.listeners]) listener(topic, version);
    return version;
  }

  /** Hear every bump; returns the unsubscribe function. */
  subscribe(listener: LobbyTopicListener): () => void {
    this.listeners.add(listener);
    return () => this.unsubscribe(listener);
  }

  /** Stop hearing bumps. */
  unsubscribe(listener: LobbyTopicListener): void {
    this.listeners.delete(listener);
  }

  /** The terminal's subscription: every topic repaints, as before. */
  onChange(listener: () => void): () => void {
    return this.subscribe(() => listener());
  }
}

/** The process-wide topics; every lobby source bumps these. */
export const lobbyTopics = new LobbyTopics();
