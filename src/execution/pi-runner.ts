import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { activityWord } from "../pi/activity.ts";
import { shortDuration } from "../text.ts";

/** Live control over one running subagent: queue a steering message for its next turn. */
export interface RunHandle {
  steer(text: string): void;
}

export interface PiRunOptions {
  cwd: string;
  task: string;
  systemPrompt?: string;
  tools?: readonly string[];
  model?: string;
  thinking?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Reports the current one-word tool activity while the agent works. */
  onActivity?: (activity: string) => void;
  /** Every streamed agent event (tools, turns, thinking/writing, retries, usage). */
  onEvent?: (event: PiStreamEvent) => void;
  /** Extra environment for the subagent process. */
  env?: Record<string, string>;
  /** Kill the agent after this long without any output; 0 disables. */
  stallTimeoutMs?: number;
  /** Silence allowed while one tool call is in flight (tests, builds); 0 disables. */
  toolStallTimeoutMs?: number;
  /** Ask the agent to wrap up and report at this elapsed time; 0 disables. */
  wrapUpAtMs?: number;
  /** Receives the steering handle once the process is running. */
  onStart?: (handle: RunHandle) => void;
}

export interface ProcessOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  killed: boolean;
  timedOut: boolean;
  /** Killed by the watchdog after going silent. */
  stalled?: boolean;
  /** The agent was asked to wrap up before its deadline. */
  wrappedUp?: boolean;
  /** The RPC host rejected the prompt itself. */
  protocolError?: string;
}

/** Streaming agent events forwarded as they arrive on stdout. */
export type PiStreamEvent =
  | { type: "tool_execution_start"; toolName: string; args?: unknown }
  | { type: "tool_execution_end"; toolName: string; isError: boolean }
  | { type: "turn_start" }
  | { type: "thinking" }
  | { type: "writing" }
  | { type: "retry"; attempt: number; maxAttempts: number; delayMs: number; error: string }
  | { type: "retry_end"; success: boolean }
  | { type: "compaction" }
  | { type: "usage"; input: number; output: number; cost: number; model?: string }
  | { type: "wrap_up" }
  | { type: "heartbeat" };

export interface ProcessRunOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
  /** The task message sent to the agent over RPC stdin. */
  prompt?: string;
  /** Optional sink for streaming agent events. */
  onEvent?: (event: PiStreamEvent) => void;
  env?: Record<string, string>;
  stallTimeoutMs?: number;
  toolStallTimeoutMs?: number;
  wrapUpAtMs?: number;
  wrapUpMessage?: string;
  onStart?: (handle: RunHandle) => void;
  /** Grace between the deadline abort and the hard kill. */
  graceMs?: number;
}

export type ProcessRunner = (
  args: string[],
  options: ProcessRunOptions,
) => Promise<ProcessOutcome>;

export interface PiRunResult {
  status: "success" | "failed" | "cancelled" | "timeout";
  output: string;
  error?: string;
  usage: { input: number; output: number; cost: number; turns: number };
  model?: string;
  stalled?: boolean;
  wrappedUp?: boolean;
}

export interface ParsedStream {
  text: string;
  usage: { input: number; output: number; cost: number; turns: number };
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

const MAX_STREAM_CHARS = 5_000_000;
const HEARTBEAT_MS = 2000;
const SETTLE_FALLBACK_MS = 3000;
const EXIT_DRAIN_MS = 1500;
const DEADLINE_GRACE_MS = 5000;
const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

/** The steering message sent at the wrap-up point. */
export const WRAP_UP_MESSAGE = [
  "bot-lobby: you are close to your time limit.",
  "Stop exploring now. Finish or revert any half-done edit so every file is consistent,",
  "then write your final report in the required output format.",
  "List anything unfinished under Blockers or Notes.",
].join(" ");

/** RPC protocol lines the process host reacts to (never forwarded to the caller). */
export interface ControlEvent {
  type: string;
  id?: string;
  command?: string;
  success?: boolean;
  error?: string;
  method?: string;
  willRetry?: boolean;
  delayMs?: number;
}

/** Buffers one JSON-mode stream, keeping only lines parsePiStream consumes. */
export interface StreamCollector {
  push(chunk: string): void;
  finish(): string;
}

const INTERESTING = [
  '"tool_execution_start"',
  '"tool_execution_end"',
  '"message_end"',
  '"turn_start"',
  '"auto_retry_',
  '"compaction_start"',
  '"agent_settled"',
  '"agent_end"',
  '"extension_ui_request"',
  '"response"',
];

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

interface RawEvent {
  type?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage?: string;
  success?: boolean;
  message?: MessageLike;
}

/** Map one parsed stream line to the caller-facing event, if it is one. */
function streamEvent(event: RawEvent): PiStreamEvent | undefined {
  switch (event.type) {
    case "tool_execution_start":
      return typeof event.toolName === "string" ? { type: "tool_execution_start", toolName: event.toolName, args: event.args } : undefined;
    case "tool_execution_end":
      return { type: "tool_execution_end", toolName: String(event.toolName ?? ""), isError: event.isError === true };
    case "turn_start":
      return { type: "turn_start" };
    case "auto_retry_start":
      return { type: "retry", attempt: num(event.attempt), maxAttempts: num(event.maxAttempts), delayMs: num(event.delayMs), error: String(event.errorMessage ?? "") };
    case "auto_retry_end":
      return { type: "retry_end", success: event.success === true };
    case "compaction_start":
      return { type: "compaction" };
    case "message_end": {
      const message = event.message;
      if (message?.role !== "assistant") return undefined;
      return { type: "usage", input: num(message.usage?.input), output: num(message.usage?.output), cost: num(message.usage?.cost?.total), model: message.model };
    }
    default:
      return undefined;
  }
}

/**
 * Buffers one JSON-lines stream, keeping only assistant `message_end` lines for
 * parsePiStream and forwarding agent events to `onEvent` and RPC protocol lines
 * to `onControl`. Per-token `message_update` deltas are never parsed: a cheap
 * prefix check reports only thinking/writing phase changes, so a chatty run
 * cannot exhaust memory. Events split across chunks are reassembled; malformed
 * lines are ignored exactly as parsePiStream ignores them.
 */
export function createStreamCollector(
  onEvent?: (event: PiStreamEvent) => void,
  onControl?: (event: ControlEvent) => void,
): StreamCollector {
  const partial: string[] = [];
  const kept: string[] = [];
  let phase: "thinking" | "writing" | undefined;
  let lastBeat = 0;
  const deltaPhase = (line: string) => {
    if (!line.startsWith('{"type":"message_update"')) return;
    const next = line.includes('"thinking_delta"') ? "thinking" : line.includes('"text_delta"') ? "writing" : undefined;
    if (next && next !== phase) {
      phase = next;
      onEvent?.({ type: next });
    }
  };
  const keep = (line: string) => {
    deltaPhase(line);
    if (!INTERESTING.some((marker) => line.includes(marker))) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return; // Malformed lines never parse; drop them.
    }
    if (raw === null || typeof raw !== "object") return;
    const event = raw as RawEvent;
    if (event.type === "tool_execution_start" || event.type === "turn_start") phase = undefined;
    const forwarded = streamEvent(event);
    if (forwarded) onEvent?.(forwarded);
    onControl?.(event as ControlEvent);
    if (event.type === "message_end" && event.message?.role === "assistant") kept.push(line);
  };
  const beat = () => {
    const now = Date.now();
    if (now - lastBeat < HEARTBEAT_MS) return;
    lastBeat = now;
    onEvent?.({ type: "heartbeat" });
  };
  return {
    // Scan only the new chunk for line breaks; a long line split over many
    // chunks is joined once, when its newline finally arrives.
    push(chunk) {
      let start = 0;
      let newline = chunk.indexOf("\n");
      while (newline >= 0) {
        const tail = chunk.slice(start, newline);
        keep(partial.length > 0 ? partial.splice(0).join("") + tail : tail);
        start = newline + 1;
        newline = chunk.indexOf("\n", start);
      }
      if (start < chunk.length) partial.push(chunk.slice(start));
      beat();
    },
    finish() {
      if (partial.length > 0) keep(partial.splice(0).join(""));
      return kept.join("\n");
    },
  };
}

/** Build the `pi` argv for one isolated, headless RPC agent run; the task goes over stdin. */
export function buildPiArgs(options: Omit<PiRunOptions, "task"> & { systemPromptFile?: string }): string[] {
  const args = ["--mode", "rpc", "--no-session", "--no-prompt-templates", "--no-themes"];
  if (options.model && options.model !== "inherit") args.push("--model", options.model);
  if (options.thinking) args.push("--thinking", options.thinking);
  if (options.tools && options.tools.length > 0) args.push("--tools", options.tools.join(","));
  if (options.systemPromptFile) args.push("--append-system-prompt", options.systemPromptFile);
  return args;
}

interface MessageLike {
  role?: string;
  content?: unknown;
  usage?: { input?: number; output?: number; cost?: { total?: number } };
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } =>
      typeof part === "object" && part !== null && (part as { type?: string }).type === "text",
    )
    .map((part) => part.text)
    .join("");
}

/** Parse the JSON-lines stream defensively; malformed lines are ignored. */
export function parsePiStream(stdout: string): ParsedStream {
  const parsed: ParsedStream = { text: "", usage: { input: 0, output: 0, cost: 0, turns: 0 } };
  for (const line of stdout.split("\n")) {
    let event: { type?: string; message?: MessageLike };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    if (event?.type !== "message_end" || event.message?.role !== "assistant") continue;
    const message = event.message;
    parsed.usage.turns += 1;
    parsed.usage.input += message.usage?.input ?? 0;
    parsed.usage.output += message.usage?.output ?? 0;
    parsed.usage.cost += message.usage?.cost?.total ?? 0;
    if (message.model) parsed.model = message.model;
    if (message.stopReason) parsed.stopReason = message.stopReason;
    if (message.errorMessage) parsed.errorMessage = message.errorMessage;
    const text = messageText(message.content);
    if (text.trim()) parsed.text = text;
  }
  return parsed;
}

/**
 * Prefer the pi launcher that started this session so subagents use the same
 * build; otherwise fall back to `pi` on PATH (or BOT_LOBBY_PI_BIN). We match
 * on the launcher filename, not PI_SESSION_ID: that variable is inherited by
 * every child process, including test runners and scripts, where argv[1] is
 * not pi at all.
 */
function resolvePiInvocation(args: string[]): { command: string; args: string[] } {
  const launcher = process.argv[1];
  if (launcher && existsSync(launcher) && isPiLauncher(launcher)) {
    return { command: launcher, args };
  }
  return { command: process.env.BOT_LOBBY_PI_BIN ?? "pi", args };
}

/** Exported for tests: mis-detecting a non-pi script re-runs it as an agent. */
export function isPiLauncher(script: string): boolean {
  const base = basename(script);
  return base === "pi" || base === "pi.js" || script.includes("pi-coding-agent");
}

const POSIX = process.platform !== "win32";

/** Signal the child's whole process group (POSIX), so grandchildren go too. */
function signalGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (proc.pid === undefined) return;
  if (POSIX) {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch {
      // The group is already gone; fall through to the child itself.
    }
  }
  try {
    proc.kill(signal);
  } catch {
    // Already exited.
  }
}

function terminate(proc: ChildProcess, graceMs = 5000): void {
  signalGroup(proc, "SIGTERM");
  const escalation = setTimeout(() => signalGroup(proc, "SIGKILL"), graceMs);
  escalation.unref();
}

/** Line-oriented stdin writer for RPC commands; a closed pipe silently drops writes. */
function rpcInput(proc: ChildProcess): { send(command: object): void; close(): void } {
  let open = true;
  proc.stdin?.on("error", () => {
    open = false;
  });
  return {
    send(command) {
      if (!open || !proc.stdin?.writable) return;
      try {
        proc.stdin.write(`${JSON.stringify(command)}\n`);
      } catch {
        open = false;
      }
    },
    close() {
      if (!open) return;
      open = false;
      try {
        proc.stdin?.end();
      } catch {
        // Already closed.
      }
    },
  };
}

interface RunState {
  killed: boolean;
  timedOut: boolean;
  stalled: boolean;
  wrappedUp: boolean;
  settled: boolean;
  protocolError?: string;
}

/** Smallest positive limit, used to pick a watchdog cadence that can see it. */
function watchInterval(...limits: Array<number | undefined>): number {
  const positive = limits.filter((limit): limit is number => typeof limit === "number" && limit > 0);
  const smallest = positive.length > 0 ? Math.min(...positive) : 4000;
  return Math.max(25, Math.min(1000, Math.floor(smallest / 4)));
}

/**
 * Default runner: spawn pi in RPC mode, send the task over stdin, and watch it.
 * The child leads its own process group so a stall, deadline or cancel takes
 * its grandchildren (dev servers, watch-mode tests) with it, and the run ends
 * on process exit rather than waiting for a pipe a grandchild may hold open.
 * Near the deadline the agent is steered to wrap up and report; at the
 * deadline it is aborted; after prolonged silence it is killed as stalled.
 */
export function spawnPiProcess(args: string[], options: ProcessRunOptions): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const invocation = resolvePiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      // Marks subagent processes so bot-lobby skips master-only wiring, and
      // skips pi's startup network work (update checks, package refresh).
      env: { ...process.env, BOT_LOBBY_SUBAGENT: "1", PI_SKIP_VERSION_CHECK: "1", PI_OFFLINE: "1", ...options.env },
      shell: false,
      detached: POSIX,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const state: RunState = { killed: false, timedOut: false, stalled: false, wrappedUp: false, settled: false };
    const input = rpcInput(proc);
    const started = Date.now();
    let lastOutput = started;
    let quietGraceUntil = 0;
    let toolsInFlight = 0;
    let stderr = "";
    let exitCode: number | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    const onEvent = (event: PiStreamEvent) => {
      if (event.type === "tool_execution_start") toolsInFlight += 1;
      if (event.type === "tool_execution_end") toolsInFlight = Math.max(0, toolsInFlight - 1);
      if (event.type === "retry") quietGraceUntil = Date.now() + event.delayMs;
      options.onEvent?.(event);
    };
    const onControl = (event: ControlEvent) => {
      if (event.type === "response" && event.command === "prompt" && event.success === false) {
        state.protocolError = event.error ?? "the prompt was rejected";
        input.close();
      } else if (event.type === "extension_ui_request" && event.method && DIALOG_METHODS.has(event.method)) {
        // Nobody can answer a dialog inside a subagent; cancel it instead of blocking forever.
        input.send({ type: "extension_ui_response", id: event.id, cancelled: true });
      } else if (event.type === "agent_settled") {
        state.settled = true;
        input.close();
      } else if (event.type === "agent_end" && event.willRetry !== true && !settleTimer) {
        settleTimer = setTimeout(() => input.close(), SETTLE_FALLBACK_MS);
      }
    };
    const collector = createStreamCollector(onEvent, onControl);
    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      lastOutput = Date.now();
      collector.push(chunk);
    });
    proc.stderr?.on("data", (chunk: string) => {
      // Keep stderr head-bounded: it only feeds exit-code error messages.
      if (stderr.length < MAX_STREAM_CHARS) stderr += chunk;
    });

    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      clearTimeout(settleTimer);
      clearInterval(watch);
      options.signal?.removeEventListener("abort", onAbort);
      input.close();
      // Reap anything the agent left running in its group.
      if (POSIX) signalGroup(proc, "SIGTERM");
      const { killed, timedOut, stalled, wrappedUp, protocolError } = state;
      resolve({ exitCode: code, stdout: collector.finish(), stderr, killed, timedOut, stalled, wrappedUp, protocolError });
    };
    const onAbort = () => {
      state.killed = true;
      input.send({ type: "abort" });
      input.close();
      terminate(proc, 3000);
    };
    const deadline = setTimeout(() => {
      state.killed = true;
      state.timedOut = true;
      input.send({ type: "abort" });
      input.close();
      setTimeout(() => terminate(proc), options.graceMs ?? DEADLINE_GRACE_MS).unref();
    }, options.timeoutMs);
    const watch = setInterval(() => {
      if (state.killed || done) return;
      const now = Date.now();
      if (!state.wrappedUp && !state.settled && options.wrapUpAtMs && options.wrapUpAtMs > 0 && now - started >= options.wrapUpAtMs) {
        state.wrappedUp = true;
        input.send({ type: "steer", message: options.wrapUpMessage ?? WRAP_UP_MESSAGE });
        options.onEvent?.({ type: "wrap_up" });
      }
      const limit = toolsInFlight > 0 ? options.toolStallTimeoutMs : options.stallTimeoutMs;
      if (limit && limit > 0 && now - Math.max(lastOutput, quietGraceUntil) >= limit) {
        state.killed = true;
        state.stalled = true;
        input.close();
        terminate(proc, 3000);
      }
    }, watchInterval(options.stallTimeoutMs, options.toolStallTimeoutMs, options.wrapUpAtMs));
    watch.unref();

    proc.on("exit", (code, signal) => {
      exitCode = code ?? (signal ? 1 : 0);
      // A grandchild may hold stdout open forever; give the pipe a moment to drain, then move on.
      setTimeout(() => finish(exitCode ?? 0), EXIT_DRAIN_MS);
    });
    proc.on("close", (code) => finish(exitCode ?? code ?? 0));
    proc.on("error", (error: Error) => {
      stderr += error.message;
      finish(1);
    });
    if (options.prompt !== undefined) input.send({ id: "task", type: "prompt", message: options.prompt });
    options.onStart?.({ steer: (text) => input.send({ type: "steer", message: text }) });
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toResult(parsed: ParsedStream, outcome: ProcessOutcome, aborted: boolean, options: PiRunOptions): PiRunResult {
  const base = { output: parsed.text, usage: parsed.usage, model: parsed.model, wrappedUp: outcome.wrappedUp === true };
  if (outcome.stalled) {
    const quiet = shortDuration(options.stallTimeoutMs ?? 0);
    return { ...base, status: "timeout", stalled: true, error: `stalled: no output for ${quiet}` };
  }
  if (outcome.timedOut) {
    const note = outcome.wrappedUp ? " after a wrap-up request" : "";
    return { ...base, status: "timeout", error: `hit the ${shortDuration(options.timeoutMs)} time limit${note}` };
  }
  if (outcome.killed || aborted || parsed.stopReason === "aborted") {
    return { ...base, status: "cancelled", error: "agent was cancelled" };
  }
  if (outcome.protocolError) return { ...base, status: "failed", error: outcome.protocolError };
  if (outcome.exitCode !== 0) {
    const detail = parsed.errorMessage ?? outcome.stderr.trim();
    return { ...base, status: "failed", error: detail || `pi exited with code ${outcome.exitCode}` };
  }
  if (parsed.stopReason === "error") {
    return { ...base, status: "failed", error: parsed.errorMessage ?? "agent reported an error" };
  }
  if (!parsed.text.trim()) return { ...base, status: "failed", error: "agent produced no usable output" };
  return { ...base, status: "success" };
}

function writePromptFile(prompt: string): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "bot-lobby-prompt-"));
  const file = join(dir, "system.md");
  writeFileSync(file, prompt, { encoding: "utf8", mode: 0o600 });
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Run one isolated subagent and normalise its outcome. */
export async function runPiAgent(options: PiRunOptions, run: ProcessRunner = spawnPiProcess): Promise<PiRunResult> {
  const prompt = options.systemPrompt ? writePromptFile(options.systemPrompt) : undefined;
  try {
    const args = buildPiArgs({ ...options, systemPromptFile: prompt?.file });
    const outcome = await run(args, {
      cwd: options.cwd,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      prompt: `Task: ${options.task}`,
      env: options.env,
      stallTimeoutMs: options.stallTimeoutMs,
      toolStallTimeoutMs: options.toolStallTimeoutMs,
      wrapUpAtMs: options.wrapUpAtMs,
      onStart: options.onStart,
      onEvent: (event) => {
        if (event.type === "tool_execution_start") options.onActivity?.(activityWord(event.toolName));
        options.onEvent?.(event);
      },
    });
    return toResult(parsePiStream(outcome.stdout), outcome, options.signal?.aborted === true, options);
  } finally {
    prompt?.cleanup();
  }
}
