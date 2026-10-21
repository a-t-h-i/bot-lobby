/**
 * Who answers a lobby chat message: the classifier reads the message (with
 * the last few lines of the conversation) and picks the agent whose area it
 * is, so a frontend question goes to DESIGN, a library question to RESEARCH,
 * "how does this work" to a scout and a question about the project's saved
 * knowledge to the oracle's knowledge lookup. Anything it is unsure of, and
 * every message while it is off, goes to the Master.
 */
import type { ChatAgent } from "../lobby/prompts.ts";
import type { Classifier } from "./classifier.ts";
import { choice, choiceOf } from "./client.ts";
import { clip } from "./limits.ts";

/** Where a lobby message goes: an agent, or the oracle's knowledge lookup. */
export type ChatRoute = ChatAgent | "knowledge";

const ROUTES: Record<ChatRoute, string> = {
  master: "The Master (the oracle): general conversation, the team's tasks and plans, anything across several areas of the project, or anything no single agent below clearly owns",
  designer: "DESIGN: the frontend, meaning pages, components, styling, layout, UX, on-screen copy and browser code, whether a question about it or a change to it",
  backend: "DEV: backend code, meaning APIs, data and databases, server logic, integrations, scripts, build and tooling, whether a question about it or a change to it",
  qa: "QA: tests, meaning writing, running or fixing them, test strategy, how to verify a change, or checking work for bugs",
  researcher: "RESEARCH: facts from outside the repository, meaning libraries, versions, third-party APIs, documentation, standards, or comparing tools",
  scout: "SCOUT: understanding the existing code without changing it, meaning where something lives, how a part works, or tracing a flow through the code",
  knowledge: "KNOWLEDGE: what the project's saved knowledge says, meaning its conventions, standards, past decisions and architecture notes",
};

/** The agent the classifier picks for `message`, when it is on and sure enough; undefined leaves it to the Master. */
export async function routeChatMessage(classifier: Classifier, message: string, recent: readonly string[], options: { at: number; signal?: AbortSignal }): Promise<{ route: ChatRoute; probability: number } | undefined> {
  if (!classifier.enabled("lobby") || !message.trim()) return undefined;
  const result = await classifier.ask("lobby", {
    state: { message: clip(message, 4000), ...(recent.length > 0 ? { recent_conversation: clip(recent.join("\n"), 2000) } : {}) },
    questions: { agent: choice("Which member of a software team should answer `message`, which the user typed into the team's chat? Read `recent_conversation`, when present, for what the message refers to.", ROUTES) },
  }, options.signal ? { signal: options.signal } : {});
  const picked = choiceOf(result?.answers, "agent");
  if (!picked || !(picked.choice in ROUTES) || picked.probability < options.at) return undefined;
  return { route: picked.choice as ChatRoute, probability: picked.probability };
}
