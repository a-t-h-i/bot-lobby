/**
 * Transport between the file desk (master process) and the workers' pi
 * processes: newline-delimited JSON requests and responses over a private
 * Unix socket (a named pipe on Windows). One server per parallel batch.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, rmSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type DeskOp = "hello" | "check" | "claim" | "handover" | "mine" | "wait";

export interface DeskRequest {
  id: number;
  worker: string;
  op: DeskOp;
  path?: string;
  intent?: string;
  note?: string;
  timeoutMs?: number;
}

export interface DeskResponse {
  id: number;
  ok: boolean;
  /** Human-readable answer for the worker's tool result or block reason. */
  text: string;
  /** `check` only: whether the worker may edit the file. */
  allowed?: boolean;
}

export type DeskHandler = (request: DeskRequest) => Promise<Omit<DeskResponse, "id">>;

export interface DeskServer {
  address: string;
  close(): Promise<void>;
}

function socketAddress(): string {
  const name = `bl-desk-${process.pid}-${randomBytes(4).toString("hex")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
}

/** Split a byte stream into complete lines, keeping any partial tail. */
function lineReader(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let at = buffer.indexOf("\n");
    while (at >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line) onLine(line);
      at = buffer.indexOf("\n");
    }
  };
}

function serve(socket: Socket, handler: DeskHandler): void {
  socket.setEncoding("utf8");
  socket.on("error", () => socket.destroy());
  socket.on(
    "data",
    lineReader((line) => {
      let request: DeskRequest;
      try {
        request = JSON.parse(line) as DeskRequest;
      } catch {
        return;
      }
      handler(request)
        .catch((error: Error) => ({ ok: false, text: `desk error: ${error.message}` }))
        .then((response) => {
          if (!socket.destroyed) socket.write(`${JSON.stringify({ ...response, id: request.id })}\n`);
        });
    }),
  );
}

/** Start a desk server on a fresh private socket. */
export async function startDeskServer(handler: DeskHandler): Promise<DeskServer> {
  const address = socketAddress();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    serve(socket, handler);
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(address, () => done());
  });
  if (process.platform !== "win32") {
    try {
      chmodSync(address, 0o600);
    } catch {
      // Best effort: the socket already lives in the private temp dir.
    }
  }
  return {
    address,
    close: () =>
      new Promise((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          if (process.platform !== "win32") rmSync(address, { force: true });
          done();
        });
      }),
  };
}

export interface DeskClient {
  request(request: Omit<DeskRequest, "id" | "worker">, timeoutMs?: number): Promise<DeskResponse>;
  close(): void;
}

/** A persistent connection from one worker to the desk; requests fail (never hang) when it is gone. */
export function createDeskClient(address: string, worker: string): DeskClient {
  let socket: Socket | undefined;
  let nextId = 1;
  const pending = new Map<number, { done: (response: DeskResponse) => void; timer: ReturnType<typeof setTimeout> }>();
  const failAll = (text: string) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.done({ id, ok: false, text });
    }
    pending.clear();
  };
  const connect = (): Socket => {
    if (socket && !socket.destroyed) return socket;
    const next = createConnection(address);
    next.setEncoding("utf8");
    next.on(
      "data",
      lineReader((line) => {
        let response: DeskResponse;
        try {
          response = JSON.parse(line) as DeskResponse;
        } catch {
          return;
        }
        const entry = pending.get(response.id);
        if (!entry) return;
        pending.delete(response.id);
        clearTimeout(entry.timer);
        entry.done(response);
      }),
    );
    next.on("error", () => failAll("the file desk is unavailable"));
    next.on("close", () => failAll("the file desk closed"));
    next.unref();
    socket = next;
    return next;
  };
  return {
    request(request, timeoutMs = 10_000) {
      const id = nextId++;
      return new Promise((done) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          done({ id, ok: false, text: "the file desk did not answer" });
        }, timeoutMs);
        pending.set(id, { done, timer });
        try {
          connect().write(`${JSON.stringify({ ...request, id, worker })}\n`);
        } catch {
          failAll("the file desk is unavailable");
        }
      });
    },
    close() {
      socket?.destroy();
      socket = undefined;
    },
  };
}
