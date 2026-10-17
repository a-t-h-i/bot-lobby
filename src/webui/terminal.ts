/**
 * Terminals in the web lobby: each one a real shell in the project's folder,
 * on a pseudo-terminal so prompts, colours and full-screen programs work.
 * The shell keeps running while no page watches it (a reload reattaches and
 * replays what it printed), and ends when it exits, when the page closes it,
 * or when the server stops.
 *
 * The pseudo-terminal comes from `node-pty` when it is installed (it is not a
 * dependency: it needs a native build), and otherwise from a few lines of
 * Python's standard `pty` module, which macOS and Linux ship. With neither
 * (Windows without node-pty, or no python3) the terminal says why it is off.
 *
 * The page writes with `terminal.input` / `terminal.resize` and reads
 * `GET /api/terminal.stream?id=…`: a `reset` with the scrollback first, then
 * `data` as the shell prints and `exit` when it ends.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { basename } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TerminalInfo, TerminalStreamEvent } from "./protocol.ts";

/** Terminals open at once; one more is refused. */
export const MAX_TERMINALS = 8;
/** What a terminal keeps of its output for a page that attaches later, in characters. */
export const SCROLLBACK_CHARS = 256 * 1024;
/** Largest single write from the page. */
export const MAX_INPUT_CHARS = 64 * 1024;
const HEARTBEAT_MS = 15_000;

/**
 * The Python side: fork a shell on a new pseudo-terminal, copy stdin to it and
 * it to stdout, and read `cols rows` lines on fd 3 to resize it (the kernel
 * then tells the shell). When stdin closes the terminal is hung up; the exit
 * code is the shell's.
 */
const PY_PTY = `
import os, sys, pty, select, struct, fcntl, termios, signal
cols, rows = int(sys.argv[1]), int(sys.argv[2])
argv = sys.argv[3:]
def size(fd, c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
pid, fd = pty.fork()
if pid == 0:
    size(0, cols, rows)
    os.execvp(argv[0], argv)
def write_all(target, data):
    while data:
        try:
            data = data[os.write(target, data):]
        except InterruptedError:
            pass
inputs, control = [0, fd, 3], b""
while True:
    try:
        ready = select.select(inputs, [], [])[0]
    except InterruptedError:
        continue
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b""
        if not data:
            break
        write_all(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:
            os.close(fd)
            try:
                os.killpg(pid, signal.SIGHUP)
            except OSError:
                pass
            break
        write_all(fd, data)
    if 3 in ready:
        data = os.read(3, 1024)
        if not data:
            inputs.remove(3)
        control += data
        while b"\\n" in control:
            line, control = control.split(b"\\n", 1)
            try:
                c, r = (int(part) for part in line.split())
                size(fd, c, r)
            except (ValueError, OSError):
                pass
status = os.waitpid(pid, 0)[1]
sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else status >> 8)
`;

/** A pseudo-terminal with a shell on it, whichever way it was made. */
interface Pty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

interface PtyHandlers {
  onData: (text: string) => void;
  onExit: (code: number | undefined) => void;
}

interface NodePtyModule {
  spawn(file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): {
    onData(listener: (data: string) => void): void;
    onExit(listener: (event: { exitCode: number }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
  };
}

type Backend = { kind: "node-pty"; module: NodePtyModule } | { kind: "python" } | { kind: "none"; reason: string };

let backend: Promise<Backend> | undefined;

/** How this machine gets a pseudo-terminal, found once. */
export function terminalBackend(): Promise<Backend> {
  backend ??= (async (): Promise<Backend> => {
    // Named through a variable so the type checker and bundlers leave the optional module alone.
    const optional = "node-pty";
    try {
      const loaded = (await import(optional)) as NodePtyModule & { default?: NodePtyModule };
      const module = typeof loaded.spawn === "function" ? loaded : loaded.default;
      if (module && typeof module.spawn === "function") return { kind: "node-pty", module };
    } catch {
      // Not installed: fall back to Python's pty.
    }
    if (process.platform === "win32") return { kind: "none", reason: "The terminal needs node-pty on Windows: run `npm install -g node-pty` next to bot-lobby." };
    const probe = spawnSync("python3", ["-c", "import pty, termios, fcntl"], { stdio: "ignore", timeout: 5_000 });
    if (probe.status === 0) return { kind: "python" };
    return { kind: "none", reason: "The terminal needs python3 (or node-pty) on this machine." };
  })();
  return backend;
}

/** The user's shell and its arguments: a login shell where the shell knows the flag. */
export function shellCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") return [env.COMSPEC || "powershell.exe"];
  const shell = env.SHELL?.trim() || "/bin/bash";
  return ["bash", "zsh", "fish", "ksh"].includes(basename(shell)) ? [shell, "-l"] : [shell];
}

function terminalEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "bot-lobby" };
}

function spawnPython(cwd: string, cols: number, rows: number, handlers: PtyHandlers): Pty {
  const child: ChildProcess = spawn("python3", ["-c", PY_PTY, String(cols), String(rows), ...shellCommand()], {
    cwd,
    env: terminalEnv(),
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });
  const decoder = new StringDecoder("utf8");
  child.stdout!.on("data", (chunk: Buffer) => handlers.onData(decoder.write(chunk)));
  child.stderr!.on("data", (chunk: Buffer) => handlers.onData(decoder.write(chunk)));
  const control = child.stdio[3] as NodeJS.WritableStream;
  for (const stream of [child.stdin!, control]) stream.on("error", () => {});
  child.on("error", () => handlers.onExit(undefined));
  child.on("exit", (code) => handlers.onExit(code ?? undefined));
  return {
    write: (data) => { if (child.stdin!.writable) child.stdin!.write(data); },
    resize: (c, r) => { if (control.writable) control.write(`${c} ${r}\n`); },
    kill: () => { child.stdin!.end(); setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 2_000).unref(); },
  };
}

function spawnNodePty(module: NodePtyModule, cwd: string, cols: number, rows: number, handlers: PtyHandlers): Pty {
  const [file, ...args] = shellCommand();
  const pty = module.spawn(file!, args, { name: "xterm-256color", cols, rows, cwd, env: terminalEnv() });
  pty.onData(handlers.onData);
  pty.onExit((event) => handlers.onExit(event.exitCode));
  return { write: (data) => pty.write(data), resize: (c, r) => pty.resize(c, r), kill: () => pty.kill() };
}

interface Terminal {
  info: TerminalInfo;
  pty: Pty;
  scrollback: string;
  watchers: Set<ServerResponse>;
}

function frame(event: TerminalStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const clampSize = (value: number, max: number) => Math.max(2, Math.min(max, Math.floor(value)));

/** Every terminal this server runs. */
export class TerminalHost {
  private terminals = new Map<string, Terminal>();
  private count = 0;

  list(): TerminalInfo[] {
    return [...this.terminals.values()].map((terminal) => ({ ...terminal.info }));
  }

  /** Open a terminal in `cwd`; refused when the machine has no way to make one, or too many are open. */
  async open(cwd: string, cols: number, rows: number): Promise<TerminalInfo> {
    const found = await terminalBackend();
    if (found.kind === "none") throw new TerminalError(found.reason);
    if (this.terminals.size >= MAX_TERMINALS) throw new TerminalError(`at most ${MAX_TERMINALS} terminals; close one first`);
    const id = `t${++this.count}`;
    const shell = basename(shellCommand()[0]!);
    const info: TerminalInfo = { id, title: `${shell} ${this.count}`, cwd, alive: true, startedAt: Date.now() };
    const handlers: PtyHandlers = {
      onData: (text) => {
        if (!text) return;
        const terminal = this.terminals.get(id);
        if (!terminal) return;
        terminal.scrollback = (terminal.scrollback + text).slice(-SCROLLBACK_CHARS);
        this.send(terminal, { type: "data", data: text });
      },
      onExit: (code) => {
        const terminal = this.terminals.get(id);
        if (!terminal || !terminal.info.alive) return;
        terminal.info.alive = false;
        if (code !== undefined) terminal.info.exitCode = code;
        this.send(terminal, { type: "exit", ...(code !== undefined ? { code } : {}) });
      },
    };
    const c = clampSize(cols, 500);
    const r = clampSize(rows, 300);
    const pty = found.kind === "node-pty" ? spawnNodePty(found.module, cwd, c, r, handlers) : spawnPython(cwd, c, r, handlers);
    this.terminals.set(id, { info, pty, scrollback: "", watchers: new Set() });
    return { ...info };
  }

  input(id: string, data: string): void {
    const terminal = this.need(id);
    if (terminal.info.alive) terminal.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.need(id);
    if (terminal.info.alive) terminal.pty.resize(clampSize(cols, 500), clampSize(rows, 300));
  }

  /** End a terminal's shell (hung up, as when a terminal window closes) and forget it. */
  close(id: string): void {
    const terminal = this.need(id);
    terminal.pty.kill();
    for (const res of terminal.watchers) res.end();
    this.terminals.delete(id);
  }

  /** `GET /api/terminal.stream?id=…`: the scrollback, then what the shell prints. */
  stream(req: IncomingMessage, res: ServerResponse, id: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`retry: 2000\n${frame({ type: "reset", data: terminal.scrollback, alive: terminal.info.alive, ...(terminal.info.exitCode !== undefined ? { code: terminal.info.exitCode } : {}) })}`);
    terminal.watchers.add(res);
    const beat = setInterval(() => res.write(":ping\n\n"), HEARTBEAT_MS);
    beat.unref();
    req.on("close", () => {
      clearInterval(beat);
      terminal.watchers.delete(res);
    });
    return true;
  }

  /** End every shell (the server is stopping). */
  closeAll(): void {
    for (const id of [...this.terminals.keys()]) this.close(id);
  }

  private send(terminal: Terminal, event: TerminalStreamEvent): void {
    const text = frame(event);
    for (const res of terminal.watchers) res.write(text);
  }

  private need(id: string): Terminal {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new TerminalError(`no terminal ${id}`, true);
    return terminal;
  }
}

/** A terminal request that cannot be done: `missing` when the terminal is gone. */
export class TerminalError extends Error {
  readonly missing: boolean;
  constructor(message: string, missing = false) {
    super(message);
    this.missing = missing;
  }
}

/** The server's terminals. */
export const terminals = new TerminalHost();
