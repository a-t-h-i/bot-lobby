import type { HarnessRun } from "../schemas/harness.ts";

/** The model, thinking and grants a lobby agent (the planner, a panel seat, a pull request review) runs with, read from settings at start time. */
export interface LobbyRunProfile {
  model?: string;
  thinking: string;
  instructions?: string;
  mcpTools?: string[];
  /** Skill names it may load; absent keeps every skill pi finds. */
  skills?: string[];
  /** False when its settings turn the agent's auto-compaction off. */
  autoCompact?: boolean;
  /** The third-party harness it runs on; absent runs it on pi. */
  harness?: HarnessRun;
  compactAt?: number;
}
