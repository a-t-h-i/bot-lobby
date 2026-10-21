/**
 * Runs one third-party harness process: spawns it in its own process group,
 * feeds its stdout to the protocol driver line by line, and watches it the
 * way `spawnPiProcess` watches pi (a stall kills it, a cancel aborts it, and
 * the run ends when the process exits). There is no time limit.
 */
import { spawn } from "node:child_process";
import { POSIX, signalGroup, terminate, watchInterval, type PiStreamEvent, type RunHandle } from "../execution/pi-runner.ts";

/** What a driver can do with its process. */
export interface HarnessIO {
  /** Write one line to the process's stdin. */
  write(line: string): void;
  closeInput(): void;
  /** Forward an agent event to the caller (and to the stall watchdog). */
  emit(event: PiStreamEvent): void;
  /** The turn is over: close stdin and let the process go (killing it after a short grace). */
  done(): void;
}

/** One protocol: what it sends first, how it reads each stdout line, and how it is cancelled or steered. */
export interface HarnessDriver {
  start(): void;
  line(text: string): void;
  /** Called on cancel before the process is killed (ACP's `session/cancel`). */
  abort?(): void;
  /** A steering message for the running agent; absent when the protocol cannot take one mid-run. */
  steer?(text: string): void;
}

export interface HarnessSpawn {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface HarnessProcessOptions {
  signal?: AbortSignal;
  stallTimeoutMs?: number;
  toolStallTimeoutMs?: number;
  onEvent?: (event: PiStreamEvent) => void;
  onStart?: (handle: RunHandle) => void;
}

export interface HarnessOutcome {
  exitCode: number;
  stderr: string;
  killed: boolean;
  stalled: boolean;
  /** The command could not be started at all (not installed, not executable). */
  spawnError?: string;
}

const MAX_STDERR = 64_000;
const EXIT_DRAIN_MS = 1500;
const DONE_GRACE_MS = 2000;

export function runHarnessProcess(spec: HarnessSpawn, options: HarnessProcessOptions, makeDriver: (io: HarnessIO) => HarnessDriver): Promise<HarnessOutcome> {
  return new Promise((resolve) => {
    const proc = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env as NodeJS.ProcessEnv,
      shell: false,
      detached: POSIX,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdinOpen = true;
    let stderr = "";
    let partial = "";
    let lastOutput = Date.now();
    let toolsInFlight = 0;
    let killed = false;
    let stalled = false;
    let finished = false;
    let exitCode: number | undefined;
    let spawnError: string | undefined;
    let doneTimer: ReturnType<typeof setTimeout> | undefined;
    proc.stdin?.on("error", () => {
      stdinOpen = false;
    });

    const io: HarnessIO = {
      write(line) {
        if (!stdinOpen || !proc.stdin?.writable) return;
        try {
          proc.stdin.write(`${line}\n`);
        } catch {
          stdinOpen = false;
        }
      },
      closeInput() {
        if (!stdinOpen) return;
        stdinOpen = false;
        try {
          proc.stdin?.end();
        } catch {
          // Already closed.
        }
      },
      emit(event) {
        if (event.type === "tool_execution_start") toolsInFlight += 1;
        if (event.type === "tool_execution_end") toolsInFlight = Math.max(0, toolsInFlight - 1);
        options.onEvent?.(event);
      },
      done() {
        io.closeInput();
        // An ACP agent is a server and stays up after its turn: give it a moment, then end it.
        doneTimer ??= setTimeout(() => terminate(proc, 2000), DONE_GRACE_MS);
        doneTimer.unref();
      },
    };
    const driver = makeDriver(io);

    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      clearInterval(watch);
      clearTimeout(doneTimer);
      options.signal?.removeEventListener("abort", onAbort);
      if (partial) {
        const rest = partial;
        partial = "";
        driver.line(rest);
      }
      io.closeInput();
      if (POSIX) signalGroup(proc, "SIGTERM");
      resolve({ exitCode: code, stderr, killed, stalled, ...(spawnError ? { spawnError } : {}) });
    };
    const onAbort = () => {
      killed = true;
      driver.abort?.();
      io.closeInput();
      terminate(proc, 3000);
    };
    const watch = setInterval(() => {
      if (killed || finished) return;
      const limit = toolsInFlight > 0 ? options.toolStallTimeoutMs : options.stallTimeoutMs;
      if (limit && limit > 0 && Date.now() - lastOutput >= limit) {
        killed = true;
        stalled = true;
        io.closeInput();
        terminate(proc, 3000);
      }
    }, watchInterval(options.stallTimeoutMs, options.toolStallTimeoutMs));
    watch.unref();

    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      lastOutput = Date.now();
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) driver.line(line);
    });
    proc.stderr?.on("data", (chunk: string) => {
      lastOutput = Date.now();
      if (stderr.length < MAX_STDERR) stderr += chunk;
    });
    proc.on("exit", (code, signal) => {
      exitCode = code ?? (signal ? 1 : 0);
      setTimeout(() => finish(exitCode ?? 0), EXIT_DRAIN_MS);
    });
    proc.on("close", (code) => finish(exitCode ?? code ?? 0));
    proc.on("error", (error: NodeJS.ErrnoException) => {
      spawnError = error.code === "ENOENT" ? `${spec.command} was not found; install it or set its path in Settings > Harnesses` : error.message;
      finish(1);
    });
    driver.start();
    options.onStart?.({ steer: (text) => driver.steer?.(text) });
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}
