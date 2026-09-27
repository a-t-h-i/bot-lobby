/**
 * Background sessions: a task started "in a new session" from the lobby runs
 * in its own headless pi process (`pi --mode rpc --name <task>`). It is an
 * ordinary saved pi session, named after its task so `/resume` finds it, that
 * this window drives over pi's RPC protocol: the lobby shows its conversation,
 * activity and thoughts live (a feed per session, fed from its events), sends
 * it your messages, and puts the questions it asks to you in this window.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { resolvePiInvocation } from "../execution/pi-runner.ts";
import { describeToolCall } from "../pi/activity.ts";
import { LobbyFeed, narrateEvent, type AgentEventLike } from "./feed.ts";

/** A question a background session is waiting on, as its RPC request carries it. */
export interface SessionDialog {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}

/** An answer to a dialog: the value, a yes/no, or put away. */
export type DialogAnswer = { value: string } | { confirmed: boolean } | { cancelled: true };

/** The child process as the session needs it (a real ChildProcess in pi, a fake in tests). */
export interface SessionProcess {
  stdin: { write(text: string): unknown; end(): unknown; on?(event: "error", listener: (error: Error) => void): unknown } | null;
  stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
  pid?: number;
}

export type SessionStatus = "starting" | "idle" | "working" | "exited";

export interface SessionStart {
  /** The display name: the task's title. */
  name: string;
  /** What to send once it is up: the request, or a planned task to start. */
  request?: string;
  planId?: string;
  auto?: boolean;
}

let counter = 0;

export class BackgroundSession {
  readonly key: string;
  readonly name: string;
  /** The planned task it was started from. */
  readonly planId?: string;
  readonly feed = new LobbyFeed();
  readonly startedAt = Date.now();
  status: SessionStatus = "starting";
  sessionId?: string;
  sessionFile?: string;
  /** The footer status the session sets (bot-lobby's task line), when it sets one. */
  statusText?: string;
  exitCode?: number | null;
  /** Dialogs the session waits on, oldest first. */
  readonly dialogs: SessionDialog[] = [];
  private readonly proc: SessionProcess;
  private buffer = "";
  private stderr = "";
  private nextId = 0;
  private readonly onChange: () => void;

  constructor(proc: SessionProcess, start: SessionStart, onChange: () => void = () => {}) {
    counter += 1;
    this.key = `S${counter}`;
    this.name = start.name;
    if (start.planId) this.planId = start.planId;
    this.proc = proc;
    this.onChange = onChange;
    proc.stdout?.on("data", (chunk) => this.receive(String(chunk)));
    proc.stderr?.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-4000);
    });
    // A write to a session that just ended must not take this pi down with it.
    proc.stdin?.on?.("error", () => {});
    proc.on("exit", (code) => this.ended(code, code === 0 || code === null ? "the session ended" : `the session exited (${code})${this.lastError() ? `: ${this.lastError()}` : ""}`));
    proc.on("error", (error) => {
      this.stderr = `${this.stderr}\n${error.message}`;
      this.ended(1, `the session could not run: ${error.message}`);
    });
    this.write({ type: "get_state" });
    if (start.planId) this.prompt(`/bot-lobby start-plan ${start.planId}${start.auto ? " auto" : ""}`);
    else if (start.request) this.prompt(`/bot-lobby --task ${start.auto ? "--auto " : ""}${start.request}`);
  }

  private ended(code: number | null, reason: string): void {
    if (this.status === "exited") return;
    this.status = "exited";
    this.exitCode = code;
    this.dialogs.length = 0;
    this.feed.say("note", reason);
    this.onChange();
  }

  get alive(): boolean {
    return this.status !== "exited";
  }

  get busy(): boolean {
    return this.status === "working";
  }

  /** The last line the process wrote to stderr, for a failure message. */
  lastError(): string {
    // Attention pings (OSC 9) a session writes to stderr are not errors.
    return this.stderr.replace(/\x1b\][^\x07]*\x07|\x07/g, "").trim().split("\n").at(-1)?.trim() ?? "";
  }

  private write(command: Record<string, unknown>): void {
    if (!this.alive || !this.proc.stdin) return;
    this.nextId += 1;
    this.proc.stdin.write(`${JSON.stringify({ id: `${this.key}-${this.nextId}`, ...command })}\n`);
  }

  private prompt(message: string): void {
    this.write({ type: "prompt", message, ...(this.busy ? { streamingBehavior: "steer" } : {}) });
  }

  /** Send the session's oracle a message, steering its running turn when it works. */
  send(text: string): void {
    const body = text.trim();
    if (!body) return;
    this.prompt(body);
  }

  /** Stop the oracle's running turn (the session stays up). */
  abort(): void {
    if (this.busy) this.write({ type: "abort" });
  }

  /** Answer the oldest dialog it waits on. */
  answer(id: string, answer: DialogAnswer): void {
    const index = this.dialogs.findIndex((dialog) => dialog.id === id);
    if (index < 0) return;
    this.dialogs.splice(index, 1);
    if (this.alive && this.proc.stdin) this.proc.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id, ...answer })}\n`);
    this.onChange();
  }

  /** Stop the session: its process ends (its task keeps its state and can be resumed or claimed later). */
  stop(): void {
    if (!this.alive) return;
    try {
      this.proc.stdin?.end();
    } catch {
      // Already closed.
    }
    try {
      this.proc.kill("SIGTERM");
    } catch {
      // Already gone.
    }
  }

  /** Split stdout into JSON lines (LF only, as pi's RPC framing requires) and handle each. */
  private receive(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) this.handle(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private handle(line: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = event.type;
    if (type === "response") {
      const data = event.data as { sessionId?: string; sessionFile?: string } | undefined;
      if (event.command === "get_state" && data) {
        this.sessionId = data.sessionId;
        this.sessionFile = data.sessionFile;
        if (this.status === "starting") this.status = "idle";
      } else if (event.success === false && typeof event.error === "string") {
        this.feed.log("LOBBY", `the session refused a request: ${event.error}`, "warning");
      }
      this.onChange();
      return;
    }
    if (type === "extension_ui_request") return this.uiRequest(event);
    if (type === "agent_start") this.status = "working";
    else if (type === "agent_end") this.status = "idle";
    narrateEvent(this.feed, event as unknown as AgentEventLike, describeToolCall);
    this.onChange();
  }

  private uiRequest(event: Record<string, unknown>): void {
    const id = String(event.id ?? "");
    const method = String(event.method ?? "");
    if (method === "select" || method === "confirm" || method === "input" || method === "editor") {
      this.dialogs.push({
        id,
        method,
        title: String(event.title ?? ""),
        ...(typeof event.message === "string" ? { message: event.message } : {}),
        ...(Array.isArray(event.options) ? { options: event.options.map(String) } : {}),
        ...(typeof event.placeholder === "string" ? { placeholder: event.placeholder } : {}),
        ...(typeof event.prefill === "string" ? { prefill: event.prefill } : {}),
      });
      this.feed.log("LOBBY", `waiting for you: ${String(event.title ?? "a question").split("\n")[0]}`, "warning");
    } else if (method === "notify") {
      const level = event.notifyType === "error" ? "error" : event.notifyType === "warning" ? "warning" : "info";
      this.feed.log("LOBBY", String(event.message ?? "").split("\n")[0]!.replace(/^bot-lobby:?\s+/, ""), level);
    } else if (method === "setStatus" && event.statusKey === "bot-lobby") {
      this.statusText = typeof event.statusText === "string" ? event.statusText : undefined;
    }
    this.onChange();
  }
}

/** Launch a headless pi for a new session: `pi --mode rpc --name <name>`, loading bot-lobby as this pi did. */
export type SessionLauncher = (args: string[], cwd: string) => SessionProcess;

/** `-e`/`--extension` arguments this pi was started with, so a session started from it loads the same extensions. */
export function extensionArgs(argv: readonly string[] = process.argv): string[] {
  const forwarded: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if ((arg === "-e" || arg === "--extension") && argv[index + 1]) forwarded.push(arg, argv[++index]!);
    else if (arg.startsWith("--extension=")) forwarded.push(arg);
  }
  return forwarded;
}

export function sessionArgs(name: string, model?: string, argv: readonly string[] = process.argv): string[] {
  return ["--mode", "rpc", "--name", name, ...(model ? ["--model", model] : []), ...extensionArgs(argv)];
}

const POSIX = process.platform !== "win32";

/** The real launcher: the same pi build as this session, in its own process group, without subagent markers. */
export const launchPi: SessionLauncher = (args, cwd) => {
  const invocation = resolvePiInvocation(args);
  const env: NodeJS.ProcessEnv = { ...process.env, PI_SKIP_VERSION_CHECK: "1" };
  delete env.BOT_LOBBY_SUBAGENT;
  const proc: ChildProcess = spawn(invocation.command, invocation.args, { cwd, env, shell: false, detached: POSIX, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  return proc as unknown as SessionProcess;
};

/** Every background session this window started, oldest first. */
export class SessionRegistry {
  readonly sessions: BackgroundSession[] = [];
  private readonly launcher: SessionLauncher;
  private readonly onChange: () => void;

  constructor(launcher: SessionLauncher = launchPi, onChange: () => void = () => {}) {
    this.launcher = launcher;
    this.onChange = onChange;
  }

  start(cwd: string, start: SessionStart, model?: string): BackgroundSession {
    const proc = this.launcher(sessionArgs(start.name, model), cwd);
    const session = new BackgroundSession(proc, start, this.onChange);
    this.sessions.push(session);
    this.onChange();
    return session;
  }

  get(key: string): BackgroundSession | undefined {
    return this.sessions.find((session) => session.key === key);
  }

  /** The background session running a pi session id, if this window started it. */
  bySessionId(sessionId: string | undefined): BackgroundSession | undefined {
    return sessionId ? this.sessions.find((session) => session.sessionId === sessionId) : undefined;
  }

  stopAll(): void {
    for (const session of this.sessions) session.stop();
  }
}
