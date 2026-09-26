/**
 * Task planning mode: the user describes an idea (or picks a GitHub issue) and
 * the planner model grills them, a few pointed questions per turn, keeping a
 * draft plan up to date until nothing that would change the implementation is
 * open. Each turn is one read-only subagent run over the whole conversation, so
 * a turn can be cancelled or retried without losing the session. The agreed
 * plan is saved as a pending task.
 */
import { loadPrompt } from "../prompts/loader.ts";
import { runPiAgent, spawnPiProcess, type PiStreamEvent, type ProcessRunner } from "../execution/pi-runner.ts";
import { describeToolCall } from "../pi/activity.ts";
import { appendMetrics, type MetricRecord } from "../state/metrics.ts";
import { savePlannedTask, type IssueRef, type PlannedTask } from "../state/backlog.ts";
import { truncate } from "../text.ts";
import type { LobbyFeed } from "./feed.ts";
import type { QuickFixProfile } from "./quickfix.ts";

/** The planner reads the repository to ask informed questions; it never edits. */
export const PLANNER_TOOLS: readonly string[] = ["read", "grep", "find", "ls"];

export const PLANNER_SOURCE = "PLANNER";

export interface PlannerMessage {
  role: "you" | "planner";
  text: string;
  at: number;
}

export interface PlannerReply {
  status: "grilling" | "ready";
  title?: string;
  questions: string[];
  plan?: string;
}

/** An issue the session was seeded from, with its text. */
export interface PlannerSeed {
  issue: IssueRef;
  body: string;
}

export interface PlannerDeps {
  cwd: string;
  root: string;
  configDir: string;
  profile: () => QuickFixProfile;
  stallTimeoutMs?: number;
  toolStallTimeoutMs?: number;
  feed?: LobbyFeed;
  runProcess?: ProcessRunner;
  onChange?: () => void;
}

/** Split a reply into its top-level `## Section` bodies, keyed by lower-case title. */
function sections(text: string): Map<string, string> {
  const found = new Map<string, string>();
  let current: string | undefined;
  let body: string[] = [];
  const flush = () => {
    if (current && !found.has(current)) found.set(current, body.join("\n").trim());
  };
  for (const line of text.split("\n")) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      current = match[1]!.toLowerCase();
      body = [];
    } else if (current) body.push(line);
  }
  flush();
  return found;
}

function listItems(body: string | undefined): string[] {
  if (!body) return [];
  const items: string[] = [];
  for (const line of body.split("\n")) {
    const match = /^\s*(?:\d+[.)]|[-*])\s+(.*\S)\s*$/.exec(line);
    if (match) items.push(match[1]!);
    else if (line.trim() && items.length > 0 && /^\s+/.test(line)) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

/**
 * Read the planner's reply. Missing sections degrade gracefully: no status
 * reads as grilling, and a reply with no sections at all becomes one question
 * so the user always sees what the planner said.
 */
export function parsePlannerReply(text: string): PlannerReply {
  const parts = sections(text);
  const status = /\bready\b/i.test(parts.get("status") ?? "") ? "ready" : "grilling";
  const title = parts.get("title")?.split("\n").find((line) => line.trim())?.replace(/^[#*\s]+|[*\s]+$/g, "");
  const plan = parts.get("plan") ?? parts.get("draft plan");
  let questions = listItems(parts.get("questions"));
  if (parts.size === 0 && text.trim()) questions = [text.trim()];
  return { status, questions, ...(title ? { title } : {}), ...(plan ? { plan } : {}) };
}

/** Everything the planner sees for one turn: the source issue, the conversation and the current draft. */
export function plannerTranscript(messages: readonly PlannerMessage[], seed?: PlannerSeed, draft?: string): string {
  const lines: string[] = [];
  if (seed) {
    lines.push(`## Source: GitHub issue #${seed.issue.number} — ${seed.issue.title}`, "", truncate(seed.body.trim() || "(no description)", 6000), "");
  }
  lines.push("## Conversation so far (oldest first)", "");
  for (const message of messages) {
    lines.push(message.role === "you" ? "### User" : "### Planner", "", message.text.trim(), "");
  }
  if (draft) lines.push("## Your current draft plan", "", truncate(draft, 8000), "");
  lines.push("Continue: grill the user on what is still open, or declare the plan READY. Reply in the required output format.");
  return lines.join("\n");
}

/** What the planner said in a turn, as the conversation shows it: the questions, or a ready note. */
export function plannerSays(reply: PlannerReply): string {
  if (reply.status === "ready") return "The plan is clear. Press s to save it as a pending task, or keep refining.";
  if (reply.questions.length === 0) return "No open questions. Press s to save the draft, or add detail.";
  return reply.questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
}

export function plannerPrompt(instructions?: string): string {
  const custom = instructions?.trim();
  return custom ? `${loadPrompt("planner.md")}\n\n## Custom Instructions\n\n${custom}` : loadPrompt("planner.md");
}

export class PlanningSession {
  messages: PlannerMessage[] = [];
  seed?: PlannerSeed;
  /** The latest parsed reply; its plan is the current draft. */
  reply?: PlannerReply;
  status: "idle" | "thinking" = "idle";
  step?: string;
  error?: string;
  turns = 0;
  saved?: PlannedTask;
  private controller?: AbortController;
  private readonly deps: PlannerDeps;

  constructor(deps: PlannerDeps, seed?: PlannerSeed) {
    this.deps = deps;
    if (seed) this.seed = seed;
  }

  get title(): string | undefined {
    return this.reply?.title ?? this.seed?.issue.title;
  }

  get busy(): boolean {
    return this.status === "thinking";
  }

  /** Add the user's message (the idea, or answers) and run a planner turn. */
  async send(text: string): Promise<void> {
    const body = text.trim();
    if (!body) return;
    if (this.busy) throw new Error("the planner is still thinking");
    this.messages = [...this.messages, { role: "you", text: body, at: Date.now() }];
    await this.turn();
  }

  /** Start from the seed alone (an issue) without a user message. */
  async open(): Promise<void> {
    if (this.busy || this.messages.length > 0) return;
    await this.turn();
  }

  /** Run the last turn again after it failed or was stopped, without a new message. */
  async retry(): Promise<void> {
    if (this.busy || this.messages.at(-1)?.role !== "you") return;
    await this.turn();
  }

  cancel(): void {
    this.controller?.abort();
  }

  /** Save the latest draft as a pending task. */
  save(now = new Date()): PlannedTask {
    const plan = this.reply?.plan;
    if (!plan) throw new Error("there is no draft plan to save yet");
    this.saved = savePlannedTask(this.deps.root, this.deps.configDir, {
      title: this.title ?? this.messages[0]?.text.split("\n")[0] ?? "planned task",
      brief: plan,
      ...(this.seed ? { issue: this.seed.issue } : {}),
    }, now);
    this.deps.feed?.log(PLANNER_SOURCE, `saved ${this.saved.id} to pending tasks`, "success");
    this.deps.onChange?.();
    return this.saved;
  }

  private onEvent(event: PiStreamEvent): void {
    if (event.type === "tool_execution_start") {
      this.step = describeToolCall(event.toolName, event.args);
      this.deps.feed?.step(PLANNER_SOURCE, this.step, `planner-${this.turns}`);
    } else if (event.type === "thought") this.deps.feed?.thought(PLANNER_SOURCE, event.text);
    else if (event.type === "thinking") this.step = "thinking";
    else if (event.type === "writing") this.step = "writing";
    else return;
    this.deps.onChange?.();
  }

  private async turn(): Promise<void> {
    const profile = this.deps.profile();
    this.controller = new AbortController();
    this.status = "thinking";
    this.error = undefined;
    this.step = "reading the conversation";
    this.turns += 1;
    const startedAt = Date.now();
    this.deps.onChange?.();
    let metric: MetricRecord | undefined;
    try {
      const result = await runPiAgent(
        {
          cwd: this.deps.cwd,
          task: plannerTranscript(this.messages, this.seed, this.reply?.plan),
          systemPrompt: plannerPrompt(profile.instructions),
          tools: PLANNER_TOOLS,
          model: profile.model,
          thinking: profile.thinking,
          timeoutMs: profile.timeoutMs,
          signal: this.controller.signal,
          stallTimeoutMs: this.deps.stallTimeoutMs,
          toolStallTimeoutMs: this.deps.toolStallTimeoutMs,
          onEvent: (event) => this.onEvent(event),
        },
        this.deps.runProcess ?? spawnPiProcess,
      );
      metric = plannerMetric(this.turns, startedAt, result.status, profile, result.model, result.usage);
      if (result.status === "success") {
        const reply = parsePlannerReply(result.output);
        // A turn without a plan keeps the previous draft.
        this.reply = { ...reply, ...(reply.plan ? {} : this.reply?.plan ? { plan: this.reply.plan } : {}) };
        this.messages = [...this.messages, { role: "planner", text: plannerSays(this.reply), at: Date.now() }];
      } else {
        this.error = result.error ?? result.status;
      }
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.status = "idle";
      this.step = undefined;
      this.controller = undefined;
      this.deps.feed?.end(`planner-${this.turns}`, Boolean(this.error));
      if (metric) appendMetrics(this.deps.root, this.deps.configDir, [metric]);
      if (this.error) this.deps.feed?.log(PLANNER_SOURCE, `turn failed — ${this.error.split("\n")[0]}`, "error");
      this.deps.onChange?.();
    }
  }
}

export function plannerMetric(
  turn: number,
  startedAt: number,
  status: MetricRecord["status"],
  profile: QuickFixProfile,
  model: string | undefined,
  usage: { input: number; output: number; cost: number; turns: number },
  now = Date.now(),
): MetricRecord {
  const served = model ?? profile.model;
  return {
    id: `planner-${startedAt}-${turn}`,
    kind: "planner",
    agent: PLANNER_SOURCE,
    ...(served ? { model: served } : {}),
    thinking: profile.thinking,
    status,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Math.max(0, now - startedAt),
    ...(usage.turns ? { turns: usage.turns } : {}),
    input: usage.input,
    output: usage.output,
    cost: usage.cost,
  };
}
