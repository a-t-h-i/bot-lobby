/**
 * The Excalidraw sessions a project shares with its agents: at most five, each
 * a room link the user added (or had made), the agents it is assigned to, and
 * whether those agents may draw in it or only look. The Excalidraw tab edits
 * the list; the agent runner reads it to decide which agents get the
 * Excalidraw tools, and hands each of them just the sessions assigned to it.
 *
 * A room link carries the room's key, which is all it takes to read and draw
 * in the room. So the list is kept with the user's own bot-lobby settings (one
 * file for each project, so every pi session in the project sees the same
 * list) and never in the project, where a commit could publish it.
 */
import { createHash, randomBytes } from "node:crypto";
import { basename, join, resolve } from "node:path";
import type { Domain, Role } from "../schemas/agent.ts";
import { readFileOr, writeFileEnsured } from "../knowledge/store.ts";
import { globalConfigDir } from "../state/project.ts";
import { newRoomLink, parseRoomLink } from "./room.ts";

/** The most sessions a project keeps. */
export const MAX_SESSIONS = 5;

/** Who a session can be assigned to: the oracle and every kind of agent with its own settings. */
export const EXCALIDRAW_AGENTS = ["master", "designer", "backend", "qa", "scout", "researcher", "quickfix", "planner"] as const;
export type ExcalidrawAgent = (typeof EXCALIDRAW_AGENTS)[number];

export const AGENT_LABELS: Record<ExcalidrawAgent, string> = {
  master: "Master (oracle)",
  designer: "Designer",
  backend: "Backend",
  qa: "QA",
  scout: "Scouts",
  researcher: "Researcher",
  quickfix: "Quick fix",
  planner: "Planner",
};

export function isExcalidrawAgent(value: unknown): value is ExcalidrawAgent {
  return typeof value === "string" && (EXCALIDRAW_AGENTS as readonly string[]).includes(value);
}

/** Which assignable agent a workflow run is: a scout or a researcher by its role, a worker or reviewer by its domain. */
export function agentOfRun(domain: Domain, role: Role): ExcalidrawAgent {
  return role === "scout" || role === "researcher" ? role : domain;
}

export interface ExcalidrawSession {
  id: string;
  name: string;
  /** The room link, with its key. */
  link: string;
  agents: ExcalidrawAgent[];
  /** Whether the agents may draw in it (otherwise they only read). */
  contribute: boolean;
  addedAt: string;
}

const NAME_MAX = 40;

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

/** A stored entry read defensively: the file may have been edited by hand. */
function parseSession(value: unknown): ExcalidrawSession | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  const link = typeof entry.link === "string" ? parseRoomLink(entry.link) : undefined;
  if (!link || typeof entry.id !== "string" || !entry.id) return undefined;
  const name = typeof entry.name === "string" ? cleanName(entry.name) : "";
  return {
    id: entry.id,
    name: name || `Session ${link.roomId.slice(0, 6)}`,
    link: link.url,
    agents: Array.isArray(entry.agents) ? EXCALIDRAW_AGENTS.filter((agent) => (entry.agents as unknown[]).includes(agent)) : [],
    contribute: entry.contribute !== false,
    addedAt: typeof entry.addedAt === "string" ? entry.addedAt : "",
  };
}

export interface BookDeps {
  /** The project the sessions belong to. */
  root: string;
  /** Where the lists are kept (the user's bot-lobby settings folder unless a test says otherwise). */
  dir?: string;
  now?: () => Date;
}

/** One project's file name: its folder's name, and a hash of the full path so two folders of one name stay apart. */
function projectFile(root: string): string {
  const name = basename(resolve(root)).replace(/[^\w.-]+/g, "-").slice(0, 40) || "project";
  return `${name}-${createHash("sha1").update(resolve(root)).digest("hex").slice(0, 10)}.json`;
}

/** What an agent is handed: the sessions assigned to it, and which agent it is (its cursor's name). */
export interface Grant {
  agent: ExcalidrawAgent;
  sessions: Array<{ id: string; name: string; link: string; contribute: boolean }>;
}

export const EXCALIDRAW_READ = "excalidraw_read";
export const EXCALIDRAW_DRAW = "excalidraw_draw";
/** Both tools; an agent whose sessions are all look-only gets the first alone. */
export const EXCALIDRAW_TOOLS: readonly string[] = [EXCALIDRAW_READ, EXCALIDRAW_DRAW];

export function toolsOf(grant: Grant): string[] {
  return grant.sessions.some((session) => session.contribute) ? [...EXCALIDRAW_TOOLS] : [EXCALIDRAW_READ];
}

/** The environment variable a subagent process reads its grant from. */
export const GRANT_ENV = "BOT_LOBBY_EXCALIDRAW";

export function grantEnv(grant: Grant): Record<string, string> {
  return { [GRANT_ENV]: JSON.stringify(grant) };
}

/** The grant a subagent process was started with, if any and well formed. */
export function readGrant(env: NodeJS.ProcessEnv = process.env): Grant | undefined {
  const raw = env[GRANT_ENV];
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as { agent?: unknown; sessions?: unknown };
    if (!isExcalidrawAgent(value.agent) || !Array.isArray(value.sessions)) return undefined;
    const sessions = value.sessions.flatMap((entry: Record<string, unknown>) => {
      const link = typeof entry?.link === "string" ? parseRoomLink(entry.link) : undefined;
      if (!link || typeof entry.id !== "string") return [];
      return [{ id: entry.id, name: typeof entry.name === "string" && entry.name ? entry.name : entry.id, link: link.url, contribute: entry.contribute !== false }];
    });
    return sessions.length > 0 ? { agent: value.agent, sessions } : undefined;
  } catch {
    return undefined;
  }
}

/** A note on the sessions an agent has, for the end of its instructions. */
export function grantNote(grant: Grant): string {
  const list = grant.sessions.map((session) => `"${session.name}"${session.contribute ? "" : " (look only)"}`).join(", ");
  const draw = grant.sessions.some((session) => session.contribute);
  return [
    `Shared Excalidraw whiteboard${grant.sessions.length === 1 ? "" : "s"} assigned to you: ${list}.`,
    `Use ${EXCALIDRAW_READ} to see what the user has drawn there — diagrams, wireframes, flows and notes often say more than the request does.`,
    draw ? `Use ${EXCALIDRAW_DRAW} to add to it (a diagram of what you found or built, a wireframe, a flow); the user watches it appear. Keep what others drew; change only what your task is about.` : "",
  ].filter(Boolean).join(" ");
}

/** The project's Excalidraw sessions, on disk. */
export class ExcalidrawBook {
  private readonly deps: BookDeps;

  constructor(deps: BookDeps) {
    this.deps = deps;
  }

  /** The file this project's sessions are kept in. */
  get path(): string {
    return join(this.deps.dir ?? join(globalConfigDir(), "excalidraw"), projectFile(this.deps.root));
  }

  /** The sessions, oldest first; a missing or damaged file is an empty list. */
  list(): ExcalidrawSession[] {
    try {
      const value = JSON.parse(readFileOr(this.path, "{}")) as { sessions?: unknown };
      const seen = new Set<string>();
      const sessions: ExcalidrawSession[] = [];
      for (const entry of Array.isArray(value.sessions) ? value.sessions : []) {
        const session = parseSession(entry);
        if (!session || seen.has(session.id)) continue;
        seen.add(session.id);
        sessions.push(session);
        if (sessions.length === MAX_SESSIONS) break;
      }
      return sessions;
    } catch {
      return [];
    }
  }

  private save(sessions: readonly ExcalidrawSession[]): void {
    writeFileEnsured(this.path, `${JSON.stringify({ sessions }, null, 2)}\n`);
  }

  /** Edit the stored list in place: what went wrong, or an empty string once it is saved. */
  private change(update: (sessions: ExcalidrawSession[]) => string | undefined): string {
    const sessions = this.list();
    const problem = update(sessions);
    if (problem) return problem;
    this.save(sessions);
    return "";
  }

  /** Add a session from a link the user pasted, named `name` (or after its room). */
  add(link: string, name?: string): { notice: string; session?: ExcalidrawSession } {
    const parsed = parseRoomLink(link);
    if (!parsed) return { notice: "that is not an Excalidraw room link — it looks like https://excalidraw.com/#room=<id>,<key> (Share → Live collaboration → Start session)" };
    return this.insert(parsed.url, parsed.roomId, name);
  }

  /** Make a new room: its link is the session, for the user to open in Excalidraw. */
  create(name?: string): { notice: string; session?: ExcalidrawSession } {
    const made = newRoomLink();
    return this.insert(made.url, made.roomId, name);
  }

  private insert(url: string, roomId: string, name?: string): { notice: string; session?: ExcalidrawSession } {
    const sessions = this.list();
    if (sessions.length >= MAX_SESSIONS) return { notice: `all ${MAX_SESSIONS} sessions are in use — remove one first (d d)` };
    if (sessions.some((session) => parseRoomLink(session.link)?.roomId === roomId)) return { notice: "that session is already added" };
    const session: ExcalidrawSession = {
      id: randomBytes(3).toString("hex"),
      name: cleanName(name ?? "") || `Session ${sessions.length + 1}`,
      link: url,
      agents: [],
      contribute: true,
      addedAt: (this.deps.now?.() ?? new Date()).toISOString(),
    };
    this.save([...sessions, session]);
    return { notice: `added “${session.name}” (${sessions.length + 1} of ${MAX_SESSIONS}) — assign it to agents with enter`, session };
  }

  remove(id: string): string {
    const sessions = this.list();
    const session = sessions.find((entry) => entry.id === id);
    if (!session) return "no such session";
    this.save(sessions.filter((entry) => entry.id !== id));
    return `removed “${session.name}”`;
  }

  rename(id: string, name: string): string {
    const clean = cleanName(name);
    if (!clean) return "a session needs a name";
    return this.change((sessions) => {
      const session = sessions.find((entry) => entry.id === id);
      if (!session) return "no such session";
      session.name = clean;
      return undefined;
    }) || `renamed to “${clean}”`;
  }

  /** Assign a session to an agent, or take it back; the notice says which. */
  toggleAgent(id: string, agent: ExcalidrawAgent): string {
    let now = false;
    const problem = this.change((sessions) => {
      const session = sessions.find((entry) => entry.id === id);
      if (!session) return "no such session";
      now = !session.agents.includes(agent);
      session.agents = EXCALIDRAW_AGENTS.filter((candidate) => (candidate === agent ? now : session.agents.includes(candidate)));
      return undefined;
    });
    return problem || `${AGENT_LABELS[agent]} ${now ? "has this session now" : "no longer has this session"}`;
  }

  /** Assign a session to every agent, or (when they all have it) to none. */
  toggleAll(id: string): string {
    let all = false;
    const problem = this.change((sessions) => {
      const session = sessions.find((entry) => entry.id === id);
      if (!session) return "no such session";
      all = session.agents.length < EXCALIDRAW_AGENTS.length;
      session.agents = all ? [...EXCALIDRAW_AGENTS] : [];
      return undefined;
    });
    return problem || (all ? "assigned to every agent" : "taken back from every agent");
  }

  /** Let the agents draw in a session, or only look at it. */
  toggleContribute(id: string): string {
    let draw = false;
    const problem = this.change((sessions) => {
      const session = sessions.find((entry) => entry.id === id);
      if (!session) return "no such session";
      session.contribute = !session.contribute;
      draw = session.contribute;
      return undefined;
    });
    return problem || (draw ? "agents may draw in this session" : "agents may only look at this session");
  }

  /** What an agent is handed at launch; undefined when no session is assigned to it. */
  grantFor(agent: ExcalidrawAgent): Grant | undefined {
    const sessions = this.list().filter((session) => session.agents.includes(agent));
    if (sessions.length === 0) return undefined;
    return { agent, sessions: sessions.map(({ id, name, link, contribute }) => ({ id, name, link, contribute })) };
  }
}

let bound: ExcalidrawBook | undefined;

/** The book this process's agents are launched from (bound when a session starts). */
export function bindExcalidraw(book: ExcalidrawBook | undefined): void {
  bound = book;
}

/** The grant for an agent about to be launched from this process; undefined when none. */
export function excalidrawGrant(agent: ExcalidrawAgent): Grant | undefined {
  return bound?.grantFor(agent);
}

/** `{ excalidraw: grant }` to spread into a run's options, or nothing when no session is assigned to the agent. */
export function grantOption(agent: ExcalidrawAgent): { excalidraw?: Grant } {
  const grant = excalidrawGrant(agent);
  return grant ? { excalidraw: grant } : {};
}
