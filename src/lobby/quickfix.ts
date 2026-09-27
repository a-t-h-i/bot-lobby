/**
 * Quick fixes: a direct prompt from the lobby goes straight to one coding
 * subagent — no scouting, proposal, plan or QA gate — while any bot-lobby task
 * keeps running. Jobs run one at a time in submission order so two quick fixes
 * never edit the tree at once; each streams plain-words steps into its own log
 * and the lobby feed, and every finished job lands in the metrics log.
 */
import { loadPrompt } from "../prompts/loader.ts";
import { runPiAgent, spawnPiProcess, type PiStreamEvent, type ProcessRunner } from "../execution/pi-runner.ts";
import { describeToolCall } from "../pi/activity.ts";
import { appendMetrics, type MetricRecord } from "../state/metrics.ts";
import type { LobbyFeed } from "./feed.ts";
import type { FileHinter } from "../classifier/files.ts";

/** A quick fix edits code, so it gets the full coding tool set. */
export const QUICK_FIX_TOOLS: readonly string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export const QUICK_FIX_SOURCE = "QUICK FIX";

export type QuickFixStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "timeout";

export interface QuickFixStep {
  at: number;
  text: string;
  pending: boolean;
}

export interface QuickFixJob {
  id: string;
  prompt: string;
  status: QuickFixStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  model?: string;
  thinking?: string;
  steps: QuickFixStep[];
  tools: number;
  turns: number;
  report?: string;
  error?: string;
  usage?: { input: number; output: number; cost: number; turns: number };
}

export interface QuickFixProfile {
  model?: string;
  thinking: string;
  timeoutMs: number;
  instructions?: string;
}

export interface QuickFixDeps {
  cwd: string;
  root: string;
  configDir: string;
  /** Model, thinking and time limit for the next job, read from settings at start time. */
  profile: () => QuickFixProfile;
  stallTimeoutMs?: number;
  toolStallTimeoutMs?: number;
  feed?: LobbyFeed;
  runProcess?: ProcessRunner;
  /** Called after every change so the lobby can repaint. */
  onChange?: () => void;
  notify?: (message: string, level: "info" | "warning" | "error") => void;
  /** Likely files for the prompt, and the lookup tool, while the classifier's file hints are on. */
  hints?: FileHinter;
}

export const MAX_JOBS = 30;
export const MAX_STEPS = 200;

function isActive(job: QuickFixJob): boolean {
  return job.status === "queued" || job.status === "running";
}

/** The system prompt a quick fix runs with: the quick-fix role plus the user's custom instructions. */
export function quickFixPrompt(instructions?: string): string {
  const custom = instructions?.trim();
  return custom ? `${loadPrompt("quickfix.md")}\n\n## Custom Instructions\n\n${custom}` : loadPrompt("quickfix.md");
}

/** First line of a prompt, for lists. */
export function jobTitle(job: Pick<QuickFixJob, "prompt">): string {
  return job.prompt.split("\n").find((line) => line.trim())?.trim() ?? "(empty)";
}

export class QuickFixQueue {
  jobs: QuickFixJob[] = [];
  private readonly deps: QuickFixDeps;
  private readonly controllers = new Map<string, AbortController>();
  private counter = 0;

  constructor(deps: QuickFixDeps) {
    this.deps = deps;
  }

  get running(): QuickFixJob | undefined {
    return this.jobs.find((job) => job.status === "running");
  }

  /** Queue a quick fix; it starts at once when nothing else is running. */
  submit(prompt: string, now = Date.now()): QuickFixJob {
    const text = prompt.trim();
    if (!text) throw new Error("a quick fix needs a prompt");
    const job: QuickFixJob = { id: `QF-${++this.counter}`, prompt: text, status: "queued", createdAt: now, steps: [], tools: 0, turns: 0 };
    this.jobs = [...this.jobs, job].filter((entry, index, all) => isActive(entry) || index >= all.length - MAX_JOBS);
    this.changed();
    this.pump();
    return job;
  }

  /** Cancel a queued or running job; finished jobs are left alone. */
  cancel(id: string): boolean {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || !isActive(job)) return false;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.finishedAt = Date.now();
      this.changed();
      return true;
    }
    this.controllers.get(id)?.abort();
    return true;
  }

  /** Abort everything (session shutdown). */
  cancelAll(): void {
    for (const job of this.jobs) if (job.status === "queued") job.status = "cancelled";
    for (const controller of this.controllers.values()) controller.abort();
  }

  private changed(): void {
    this.deps.onChange?.();
  }

  private pump(): void {
    if (this.running) return;
    const next = this.jobs.find((job) => job.status === "queued");
    if (next) void this.run(next);
  }

  private addStep(job: QuickFixJob, text: string, at: number): void {
    for (const step of job.steps) step.pending = false;
    job.steps = [...job.steps, { at, text, pending: true }].slice(-MAX_STEPS);
    this.deps.feed?.step(QUICK_FIX_SOURCE, text, job.id, at);
  }

  private onEvent(job: QuickFixJob, event: PiStreamEvent): void {
    const now = Date.now();
    if (event.type === "tool_execution_start") {
      job.tools += 1;
      this.addStep(job, describeToolCall(event.toolName, event.args), now);
    } else if (event.type === "turn_start") job.turns += 1;
    else if (event.type === "thought") this.deps.feed?.thought(QUICK_FIX_SOURCE, event.text, now);
    else if (event.type === "retry") this.addStep(job, `provider retry ${event.attempt}/${event.maxAttempts}`, now);
    else return;
    this.changed();
  }

  private async run(job: QuickFixJob): Promise<void> {
    const profile = this.deps.profile();
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    job.status = "running";
    job.startedAt = Date.now();
    job.thinking = profile.thinking;
    if (profile.model) job.model = profile.model;
    this.deps.feed?.log(QUICK_FIX_SOURCE, `started: ${jobTitle(job)}`, "info", job.startedAt);
    this.changed();
    try {
      const likely = await this.likely(job.prompt, controller.signal);
      const result = await runPiAgent(
        {
          cwd: this.deps.cwd,
          task: likely ? `${job.prompt}\n\n${likely}` : job.prompt,
          systemPrompt: quickFixPrompt(profile.instructions),
          tools: [...QUICK_FIX_TOOLS, ...(this.deps.hints?.tools() ?? [])],
          model: profile.model,
          thinking: profile.thinking,
          timeoutMs: profile.timeoutMs,
          signal: controller.signal,
          stallTimeoutMs: this.deps.stallTimeoutMs,
          toolStallTimeoutMs: this.deps.toolStallTimeoutMs,
          onEvent: (event) => this.onEvent(job, event),
        },
        this.deps.runProcess ?? spawnPiProcess,
      );
      job.status = result.status;
      job.report = result.output.trim() || undefined;
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

  /** The Likely files block for a prompt, or "" (no hints, nothing stands out, out of time). */
  private async likely(prompt: string, signal: AbortSignal): Promise<string> {
    try {
      return (await this.deps.hints?.block(prompt, signal)) ?? "";
    } catch {
      return "";
    }
  }

  private finish(job: QuickFixJob): void {
    job.finishedAt = Date.now();
    for (const step of job.steps) step.pending = false;
    this.deps.feed?.end(job.id, job.status !== "success");
    const ok = job.status === "success";
    const outcome = ok ? "done" : `${job.status}${job.error ? ` — ${job.error.split("\n")[0]}` : ""}`;
    this.deps.feed?.log(QUICK_FIX_SOURCE, `${outcome}: ${jobTitle(job)}`, ok ? "success" : job.status === "cancelled" ? "warning" : "error", job.finishedAt);
    appendMetrics(this.deps.root, this.deps.configDir, [quickFixMetric(job)]);
    this.deps.notify?.(`bot-lobby quick fix ${outcome}: ${jobTitle(job)}`, ok ? "info" : "warning");
    this.changed();
    this.pump();
  }
}

export function quickFixMetric(job: QuickFixJob): MetricRecord {
  const started = job.startedAt ?? job.createdAt;
  return {
    id: `${job.id}-${started}`,
    kind: "quickfix",
    agent: QUICK_FIX_SOURCE,
    ...(job.model ? { model: job.model } : {}),
    ...(job.thinking ? { thinking: job.thinking } : {}),
    status: job.status === "queued" || job.status === "running" ? "failed" : job.status,
    startedAt: new Date(started).toISOString(),
    durationMs: Math.max(0, (job.finishedAt ?? started) - started),
    turns: job.usage?.turns || job.turns || undefined,
    tools: job.tools,
    ...(job.usage ? { input: job.usage.input, output: job.usage.output, cost: job.usage.cost } : {}),
  };
}
