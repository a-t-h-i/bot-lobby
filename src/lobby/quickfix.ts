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
import { appendChange, EditLog } from "../state/changes.ts";
import type { LobbyFeed } from "./feed.ts";
import type { FileHinter } from "../classifier/files.ts";
import type { Classifier } from "../classifier/classifier.ts";
import { quickFixSize } from "../classifier/triage.ts";
import { fellShort, profileLabel, routeLabel, type EffortRoute, type EffortRouter } from "../classifier/effort.ts";

/** A quick fix edits code, so it gets the full coding tool set. */
export const QUICK_FIX_TOOLS: readonly string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export const QUICK_FIX_SOURCE = "QUICK FIX";

/** `held`: the classifier judged the request a task, not a quick fix; it waits for you (r runs it anyway, t makes it a task). */
export type QuickFixStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "timeout" | "held";

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
  /** Why the job was held, or what became of it. */
  note?: string;
  /** Run even if the classifier judges it large (r on a held job). */
  force?: boolean;
  /** The classifier routed it down (`trivial 0.88: p/big · low → p/cheap · low`); cleared when it re-ran on the configured profile. */
  route?: string;
  routedFrom?: string;
  /** Files it changed with `edit`/`write`, as shown (relative to the project); the change ledger lets a running task's QA gate tell them from its own. */
  files?: string[];
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
  /** Holds a request it judges large (a task, not a quick fix) instead of spending a run on it. */
  classifier?: Classifier;
  /** Lowers thinking or the model for a request the classifier judges simple or trivial. */
  effort?: EffortRouter;
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
  private readonly edits = new Map<string, EditLog>();
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

  /** Run a held job anyway: it goes back in the queue and is not sized again. */
  runAnyway(id: string): boolean {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || job.status !== "held") return false;
    job.status = "queued";
    job.force = true;
    delete job.note;
    delete job.startedAt;
    delete job.finishedAt;
    this.changed();
    this.pump();
    return true;
  }

  /** A held job that became a task: it leaves the queue with a note. */
  movedToTask(id: string): boolean {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || job.status !== "held") return false;
    job.status = "cancelled";
    job.note = "started as a task in a new session";
    this.changed();
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
      const edits = this.edits.get(job.id);
      if (edits?.note(event.toolName, event.args)) job.files = edits.shown();
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
    this.changed();
    const held = job.force ? undefined : await this.tooLarge(job, controller.signal);
    if (held) {
      this.controllers.delete(job.id);
      return this.hold(job, held);
    }
    this.deps.feed?.log(QUICK_FIX_SOURCE, `started: ${jobTitle(job)}`, "info", job.startedAt);
    this.edits.set(job.id, new EditLog(this.deps.cwd));
    try {
      const [likely, route] = await Promise.all([this.likely(job.prompt, controller.signal), this.route(job.prompt, profile, controller.signal)]);
      const attempt = (model: string | undefined, thinking: string) => runPiAgent(
        {
          cwd: this.deps.cwd,
          task: likely ? `${job.prompt}\n\n${likely}` : job.prompt,
          systemPrompt: quickFixPrompt(profile.instructions),
          tools: [...QUICK_FIX_TOOLS, ...(this.deps.hints?.tools() ?? [])],
          model,
          thinking,
          timeoutMs: profile.timeoutMs,
          signal: controller.signal,
          stallTimeoutMs: this.deps.stallTimeoutMs,
          toolStallTimeoutMs: this.deps.toolStallTimeoutMs,
          onEvent: (event) => this.onEvent(job, event),
        },
        this.deps.runProcess ?? spawnPiProcess,
      );
      let result;
      if (route) {
        job.route = routeLabel(route);
        job.routedFrom = profileLabel(route.from);
        job.thinking = route.thinking;
        if (route.model) job.model = route.model;
        this.changed();
        result = await attempt(route.model, route.thinking);
        if (fellShort(result) && !controller.signal.aborted) {
          // The routed attempt counts in the metrics on its own; the job re-runs on the configured profile.
          appendMetrics(this.deps.root, this.deps.configDir, [{ ...quickFixMetric({ ...job, status: result.status, finishedAt: Date.now(), usage: result.usage, ...(result.model ? { model: result.model } : {}) }), id: `${job.id}-routed-${job.startedAt}` }]);
          this.addStep(job, "the routed attempt fell short; running again on the configured model and thinking", Date.now());
          delete job.route;
          delete job.routedFrom;
          job.thinking = profile.thinking;
          if (profile.model) job.model = profile.model;
          result = await attempt(profile.model, profile.thinking);
        }
      } else {
        result = await attempt(profile.model, profile.thinking);
      }
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

  /** Where the classifier routes this request, or undefined. */
  private async route(prompt: string, profile: QuickFixProfile, signal: AbortSignal): Promise<EffortRoute | undefined> {
    try {
      return await this.deps.effort?.route(prompt, { ...(profile.model ? { model: profile.model } : {}), thinking: profile.thinking }, { signal });
    } catch {
      return undefined;
    }
  }

  /** Why a request is too large for a quick fix, when the classifier is sure; undefined runs it. */
  private async tooLarge(job: QuickFixJob, signal: AbortSignal): Promise<string | undefined> {
    const jev = this.deps.classifier;
    if (!jev?.enabled("triage")) return undefined;
    try {
      const sized = await quickFixSize(jev, job.prompt, signal);
      if (!sized || sized.size !== "large" || sized.confidence < jev.config.thresholds.quickFixLargeAt) return undefined;
      return `looks like a task (large, ${sized.confidence.toFixed(2)})`;
    } catch {
      return undefined;
    }
  }

  /** Hold a job instead of running it; nothing ran, so nothing lands in the metrics. */
  private hold(job: QuickFixJob, note: string): void {
    job.status = "held";
    job.note = note;
    job.finishedAt = Date.now();
    this.deps.feed?.log(QUICK_FIX_SOURCE, `held: ${jobTitle(job)} — ${note}; r runs it anyway, t makes it a task`, "warning", job.finishedAt);
    this.deps.notify?.(`bot-lobby quick fix held: ${jobTitle(job)} ${note}`, "warning");
    this.changed();
    this.pump();
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
    const edited = this.edits.get(job.id)?.list() ?? [];
    this.edits.delete(job.id);
    // Whatever it edited, even when it failed, is on record for a task's QA gate as the user's own request.
    if (edited.length > 0) {
      appendChange(this.deps.root, this.deps.configDir, {
        source: "quickfix",
        id: job.id,
        what: jobTitle(job),
        files: edited,
        startedAt: new Date(job.startedAt ?? job.createdAt).toISOString(),
        finishedAt: new Date(job.finishedAt).toISOString(),
        status: job.status,
      });
    }
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
    status: job.status === "queued" || job.status === "running" ? "failed" : job.status === "held" ? "cancelled" : job.status,
    startedAt: new Date(started).toISOString(),
    durationMs: Math.max(0, (job.finishedAt ?? started) - started),
    turns: job.usage?.turns || job.turns || undefined,
    tools: job.tools,
    ...(job.usage ? { input: job.usage.input, output: job.usage.output, cost: job.usage.cost } : {}),
    ...(job.routedFrom ? { routedFrom: job.routedFrom } : {}),
  };
}
