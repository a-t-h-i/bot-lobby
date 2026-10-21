/**
 * Strings the server and the page share: tab metadata, the short line shown
 * when a question was answered elsewhere, and the lobby chat's agents, @
 * mentions and slash commands. Pure on purpose (no
 * `node:*`): the web page imports this file directly.
 */

export const TAB_IDS = ["lobby", "tasks", "plan", "git", "knowledge"] as const;
export type TabId = (typeof TAB_IDS)[number];

export const TAB_LABELS: Record<TabId, string> = {
  lobby: "Lobby",
  tasks: "Tasks",
  plan: "Plan",
  git: "Git",
  knowledge: "Knowledge",
};

/** The tabs on show; issues are available inside Git. */
export function visibleTabs(_issues: boolean): TabId[] {
  return [...TAB_IDS];
}

/** A question answered in another window of the page (or put away) before this one's answer arrived. */
export const ANSWERED_ELSEWHERE = "already answered in another window";

/** Opens the list of files a message carries (see src/webui/uploads.ts); the page shows them as thumbnails and chips. */
export const ATTACHMENTS_MARK = "Attached files:";

/* ------------------------------------------------------------ the lobby chat */

/** Who can answer in the lobby chat: the oracle (MASTER) or one of the agents, on its own settings. */
export const CHAT_AGENTS = ["master", "designer", "backend", "qa", "researcher", "scout"] as const;
export type ChatAgent = (typeof CHAT_AGENTS)[number];

/** Each one's name as the feeds and the chat show it. */
export const CHAT_AGENT_SOURCES: Record<ChatAgent, string> = {
  master: "MASTER",
  designer: "DESIGN",
  backend: "DEV",
  qa: "QA",
  researcher: "RESEARCH",
  scout: "SCOUT",
};

/** The @ names the composer offers, in its menu's order, with what each one is for. */
export const CHAT_MENTIONS: ReadonlyArray<{ name: string; agent: ChatAgent; hint: string }> = [
  { name: "master", agent: "master", hint: "The oracle: anything, and changes across the project" },
  { name: "design", agent: "designer", hint: "Frontend: pages, components, styling and UX" },
  { name: "dev", agent: "backend", hint: "Backend: APIs, data and server code" },
  { name: "qa", agent: "qa", hint: "Tests, and how to check a change" },
  { name: "research", agent: "researcher", hint: "Facts from the web: libraries, versions, docs" },
  { name: "scout", agent: "scout", hint: "Reads the code and explains how something works" },
];

/** Other spellings an @ mention may use. */
const MENTION_ALIASES: Record<string, ChatAgent> = { oracle: "master", designer: "designer", frontend: "designer", backend: "backend", researcher: "researcher" };

/** A message that opens with `@name`: who it is for and the rest of it; undefined for any other message. */
export function parseMention(text: string): { agent: ChatAgent; rest: string } | undefined {
  const match = /^\s*@([a-z]+)(?=\s|$)\s*/i.exec(text);
  if (!match) return undefined;
  const name = match[1]!.toLowerCase();
  const agent = CHAT_MENTIONS.find((entry) => entry.name === name)?.agent ?? MENTION_ALIASES[name];
  return agent ? { agent, rest: text.slice(match[0].length) } : undefined;
}

/** The lobby's slash commands: the chat does the work until you ask for a plan or a task. */
export const LOBBY_COMMANDS = [
  { name: "plan", args: "what to plan", hint: "Plan it with the panel on the Plan tab" },
  { name: "task", args: "what to do", hint: "Start it as a task for the team" },
] as const;
export type LobbyCommand = (typeof LOBBY_COMMANDS)[number]["name"];

/** A message that opens with one of the lobby's commands: which, and the rest of it; undefined for anything else. */
export function parseLobbyCommand(text: string): { command: LobbyCommand; rest: string } | undefined {
  const match = /^\s*\/([a-z]+)(?=\s|$)\s*/i.exec(text);
  const command = LOBBY_COMMANDS.find((entry) => entry.name === match?.[1]?.toLowerCase())?.name;
  return match && command ? { command, rest: text.slice(match[0].length) } : undefined;
}
