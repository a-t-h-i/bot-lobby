/**
 * The lobby chat's agents: a message the classifier (or an @ mention) gives
 * to DESIGN, DEV, QA, RESEARCH or a scout is answered by that agent itself,
 * on its own model, thinking, prompt and grants, with the conversation so
 * far as context. The builders may change files; RESEARCH and the scout only
 * read. Replies run one at a time in the order they were asked, so two agents
 * never edit the tree at once; each streams plain-words steps into the
 * activity feed, its reply joins the conversation under its name, and every
 * finished reply lands in the metrics log. The Master's own replies are pi's
 * turns, not this queue's.
 */
import { loadPrompt } from "../prompts/loader.ts";
import { compilePrompt } from "../prompts/compiler.ts";
import { runPiAgent, spawnPiProcess, type PiStreamEvent, type ProcessRunner } from "../execution/pi-runner.ts";
import { MAX_CHILDREN } from "../execution/delegation.ts";
import { describeToolCall } from "../pi/activity.ts";
import { appendMetrics, type MetricRecord, type MetricStatus } from "../state/metrics.ts";
import { appendChange, EditLog } from "../state/changes.ts";
import type { FileHinter } from "../classifier/files.ts";
import type { Domain, Role } from "../schemas/agent.ts";
import type { LobbyFeed } from "./feed.ts";
import type { LobbyRunProfile } from "./profile.ts";
import { CHAT_AGENT_SOURCES, type ChatAgent } from "./prompts.ts";
import { PLANNER_TOOLS, RESEARCH_PANEL_TOOLS } from "./planner.ts";

/** The agents this queue runs: every chat agent but the Master. */
export type ChatWorker = Exclude<ChatAgent, "master">;

/** DESIGN, DEV and QA may change files; RESEARCH and the scout only read. */
export const CHAT_BUILDER_TOOLS: readonly string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];

const TOOLS: Record<ChatWorker, readonly string[]> = {
  designer: CHAT_BUILDER_TOOLS,
  backend: CHAT_BUILDER_TOOLS,
  qa: CHAT_BUILDER_TOOLS,
  researcher: RESEARCH_PANEL_TOOLS,
  scout: PLANNER_TOOLS,
};

/** What each agent owns, appended to its prompt. */
const SEATS: Record<ChatWorker, string> = {
  designer: "You are DESIGN: the frontend and the user's experience — pages, components, styling, layout, states, copy on screen, accessibility and everything that runs in the browser.",
  backend: "You are DEV: the backend and the code — APIs, data and migrations, server logic, integrations, errors and edge cases, security, performance, build and tooling.",
  qa: "You are QA: tests and how work is judged — writing, running and fixing tests, the test strategy, edge cases and failure modes, and checking a change for bugs.",
  researcher: "You are RESEARCH: facts outside the repository — libraries and versions, standards, APIs and documentation, known pitfalls and prior art. Use the web tools when you have them and cite a URL for every external claim. You never change files.",
  scout: "You are a SCOUT: you read the repository to answer how it works — where things live, how a part fits together, what calls what — citing paths and symbols. You never change files.",
};

const DOMAIN_OF: Record<ChatWorker, Domain> = { designer: "designer", backend: "backend", qa: "qa", researcher: "backend", scout: "backend" };
const ROLE_OF: Record<ChatWorker, Role> = { designer: "worker", backend: "worker", qa: "worker", researcher: "researcher", scout: "scout" };

/** Lines of conversation an agent is given, newest last. */
export const CHAT_CONTEXT_LINES = 12;
/** Longest line of earlier conversation it is given. */
const CONTEXT_LINE_CHARS = 1200;
export const MAX_CHAT_JOBS = 30;

export type ChatJobStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "timeout";

export interface ChatJob {
  id: string;
  agent: ChatWorker;
  /** The user's message, as they sent it (without the @ mention). */
  text: string;
  /** Why it came to this agent: `you named @design`, `the classifier (0.82)`. */
  why: string;
  status: ChatJobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  model?: string;
  thinking?: string;
  tools: number;
  reply?: string;
  error?: string;
  /** Files it changed, as shown (relative to the project). */
  files?: string[];
  usage?: { input: number; output: number; cost: number; turns: number };
}

export interface ChatAgentsDeps {
  cwd: string;
  root: string;
  configDir: string;
  /** Model, thinking and grants for an agent, read from settings when its reply starts. */
  profile: (agent: ChatWorker) => LobbyRunProfile;
  /** The conversation so far, oldest first, as lines (`You: …`, `DESIGN: …`). */
  history: () => readonly string[];
  /** A reply is done: put it in the conversation (and the session, so the Master reads it too). */
  onReply?: (job: ChatJob) => void;
  onChange?: () => void;
  feed?: LobbyFeed;
  /** Likely files for the message, and the lookup tool, while the classifier's file hints are on. */
  hints?: FileHinter;
  stallTimeoutMs?: number;
  toolStallTimeoutMs?: number;
  runProcess?: ProcessRunner;
}

/** An agent's system prompt: its domain's layers (the global one for RESEARCH and scouts), the lobby chat role and its seat. */
export function chatAgentPrompt(agent: ChatWorker, instructions?: string): string {
  const custom = instructions?.trim();
  const base = agent === "researcher" || agent === "scout"
    ? [loadPrompt("global.md"), custom ? `## Custom Instructions\n\n${custom}` : ""].filter(Boolean).join("\n\n---\n\n")
    : compilePrompt({ domain: agent, task: "", ...(custom ? { instructions: custom } : {}) });
  return [base, loadPrompt("lobby-chat.md"), `## Your seat\n\n${SEATS[agent]}`].join("\n\n---\n\n");
}

/** What the agent is asked: the conversation so far, then the message. */
export function chatAgentTask(text: string, history: readonly string[], likely = ""): string {
  const lines = history.slice(-CHAT_CONTEXT_LINES).map((line) => (line.length > CONTEXT_LINE_CHARS ? `${line.slice(0, CONTEXT_LINE_CHARS - 1)}…` : line));
  return [
    lines.length > 0 ? `## Conversation so far\n\n${lines.join("\n\n")}` : "",
    `## Message\n\n${text.trim()}`,
    likely,
  ].filter(Boolean).join("\n\n");
}

function isActive(job: ChatJob): boolean {
  return job.status === "queued" || job.status === "running";
}

export class ChatAgents {
  jobs: ChatJob[] = [];
  private readonly deps: ChatAgentsDeps;
  private readonly controllers = new Map<string, AbortController>();
  private readonly edits = new Map<string, EditLog>();
  private counter = 0;

  constructor(deps: ChatAgentsDeps) {
    this.deps = deps;
  }

  get running(): ChatJob | undefined {
    return this.jobs.find((job) => job.status === "running");
  }

  /** Any reply under way or waiting. */
  get busy(): boolean {
    return this.jobs.some(isActive);
  }

  /** Ask an agent; it answers at once when no other reply is under way, else after the ones before it. */
  submit(agent: ChatWorker, text: string, why: string, now = Date.now()): ChatJob {
    const body = text.trim();
    if (!body) throw new Error("a message needs some text");
    const job: ChatJob = { id: `CHAT-${++this.counter}`, agent, text: body, why, status: "queued", createdAt: now, tools: 0 };
    this.jobs = [...this.jobs, job].filter((entry, index, all) => isActive(entry) || index >= all.length - MAX_CHAT_JOBS);
    this.changed();
    this.pump();
    return job;
  }

  /** Stop the reply under way and drop the waiting ones. */
  cancelAll(): void {
    const now = Date.now();
    for (const job of this.jobs) {
      if (job.status !== "queued") continue;
      job.status = "cancelled";
      job.finishedAt = now;
    }
    for (const controller of this.controllers.values()) controller.abort();
    this.changed();
  }

  private changed(): void {
    this.deps.onChange?.();
  }

  private pump(): void {
    if (this.running) return;
    const next = this.jobs.find((job) => job.status === "queued");
    if (next) void this.run(next);
  }

  private onEvent(job: ChatJob, event: PiStreamEvent): void {
    const source = CHAT_AGENT_SOURCES[job.agent];
    const now = Date.now();
    if (event.type === "tool_execution_start") {
      job.tools += 1;
      const edits = this.edits.get(job.id);
      if (edits?.note(event.toolName, event.args)) job.files = edits.shown();
      this.deps.feed?.step(source, describeToolCall(event.toolName, event.args), job.id, now);
    } else if (event.type === "thought") this.deps.feed?.liveThought(source, event.text, job.id, now);
    else if (event.type === "retry") this.deps.feed?.step(source, `provider retry ${event.attempt}/${event.maxAttempts}`, job.id, now);
    else return;
    this.changed();
  }

  private async run(job: ChatJob): Promise<void> {
    const profile = this.deps.profile(job.agent);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    job.status = "running";
    job.startedAt = Date.now();
    job.thinking = profile.thinking;
    if (profile.model) job.model = profile.model;
    this.edits.set(job.id, new EditLog(this.deps.cwd));
    this.changed();
    // The message itself is the last line of the history; the task names it on its own.
    const history = this.deps.history();
    const earlier = history.at(-1)?.endsWith(job.text) ? history.slice(0, -1) : history;
    try {
      const likely = await this.likely(job.text, controller.signal);
      const result = await runPiAgent(
        {
          cwd: this.deps.cwd,
          task: chatAgentTask(job.text, earlier, likely),
          systemPrompt: chatAgentPrompt(job.agent, profile.instructions),
          tools: [...TOOLS[job.agent], ...(this.deps.hints?.tools() ?? [])],
          model: profile.model,
          thinking: profile.thinking,
          mcpTools: profile.mcpTools,
          ...(profile.autoCompact === false ? { autoCompact: false } : {}),
          ...(profile.compactAt ? { compactAt: profile.compactAt } : {}),
          ...(profile.harness ? { harness: profile.harness } : {}),
          ...(profile.skills ? { skills: profile.skills } : {}),
          delegationQuota: { used: MAX_CHILDREN },
          agent: { runId: job.id, taskId: job.id, domain: DOMAIN_OF[job.agent], role: ROLE_OF[job.agent] },
          signal: controller.signal,
          stallTimeoutMs: this.deps.stallTimeoutMs,
          toolStallTimeoutMs: this.deps.toolStallTimeoutMs,
          onEvent: (event) => this.onEvent(job, event),
        },
        this.deps.runProcess ?? spawnPiProcess,
      );
      job.status = result.status;
      job.reply = result.output.trim() || undefined;
      job.error = result.error;
      job.usage = result.usage;
      if (result.model) job.model = result.model;
    } catch (error) {
      job.status = "failed";
      job.error = (error as Error).message;
    } finally {
      this.controllers.delete(job.id);
      this.finish(job);
    }
  }

  /** The Likely files block for a message, or "" (no hints, nothing stands out, out of time). */
  private async likely(text: string, signal: AbortSignal): Promise<string> {
    try {
      return (await this.deps.hints?.block(text, signal)) ?? "";
    } catch {
      return "";
    }
  }

  private finish(job: ChatJob): void {
    job.finishedAt = Date.now();
    const source = CHAT_AGENT_SOURCES[job.agent];
    const edited = this.edits.get(job.id)?.list() ?? [];
    this.edits.delete(job.id);
    // What it edited, even when it failed, is on record for a task's QA gate as the user's own request.
    if (edited.length > 0) {
      appendChange(this.deps.root, this.deps.configDir, {
        source: "chat",
        id: job.id,
        what: `${source}: ${job.text.split("\n").find((line) => line.trim())?.trim() ?? ""}`,
        files: edited,
        startedAt: new Date(job.startedAt ?? job.createdAt).toISOString(),
        finishedAt: new Date(job.finishedAt).toISOString(),
        status: job.status,
      });
    }
    this.deps.feed?.end(job.id, job.status !== "success");
    this.deps.feed?.settleThought(job.id);
    if (job.status !== "success") this.deps.feed?.log(source, `reply ${job.status}${job.error ? ` — ${job.error.split("\n")[0]}` : ""}`, job.status === "cancelled" ? "warning" : "error", job.finishedAt);
    appendMetrics(this.deps.root, this.deps.configDir, [chatMetric(job)]);
    this.deps.onReply?.(job);
    this.changed();
    this.pump();
  }
}

export function chatMetric(job: ChatJob): MetricRecord {
  const started = job.startedAt ?? job.createdAt;
  const status: MetricStatus = job.status === "queued" || job.status === "running" ? "failed" : job.status;
  return {
    id: `${job.id}-${started}`,
    kind: "chat",
    agent: CHAT_AGENT_SOURCES[job.agent],
    ...(job.model ? { model: job.model } : {}),
    ...(job.thinking ? { thinking: job.thinking } : {}),
    status,
    startedAt: new Date(started).toISOString(),
    durationMs: Math.max(0, (job.finishedAt ?? started) - started),
    ...(job.usage?.turns ? { turns: job.usage.turns } : {}),
    tools: job.tools,
    ...(job.usage ? { input: job.usage.input, output: job.usage.output, cost: job.usage.cost } : {}),
  };
}
