/**
 * pi's side of the oracle bridge's MCP server. A harness pi drives as a model
 * starts `mcp-stdio.mjs`, which connects here; this answers MCP's
 * `initialize`, `tools/list` and `tools/call` for the run it names, with the
 * tools of pi's current turn. A tool call waits until pi has run the tool.
 */
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessMcp } from "../runner.ts";

export const BRIDGE_SERVER_NAME = "bot-lobby";
const DEFAULT_PROTOCOL = "2025-06-18";

export interface BridgeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BridgeResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError: boolean;
}

/** One `tools/call`, answered once pi has run the tool. */
export interface BridgeCall {
  name: string;
  arguments: Record<string, unknown>;
  respond(result: BridgeResult): void;
}

/** What one harness run serves: the current tools, and where its calls go. */
export interface BridgeEndpoint {
  tools(): BridgeTool[];
  onCall(call: BridgeCall): void;
}

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

let server: Server | undefined;
let listening: Promise<string> | undefined;
const endpoints = new Map<string, BridgeEndpoint>();

function socketPath(): string {
  const name = `bot-lobby-bridge-${process.pid}-${randomBytes(4).toString("hex")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
}

function serve(socket: Socket): void {
  socket.setEncoding("utf8");
  let partial = "";
  let endpoint: BridgeEndpoint | undefined;
  let open = true;
  socket.on("close", () => { open = false; });
  socket.on("error", () => { open = false; });
  const send = (message: Record<string, unknown>) => {
    if (open) socket.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  const handle = (message: RpcMessage) => {
    if (!message.method || message.id === undefined) return;
    const id = message.id;
    switch (message.method) {
      case "initialize":
        return send({ id, result: { protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : DEFAULT_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: BRIDGE_SERVER_NAME, version: "1" } } });
      case "ping":
        return send({ id, result: {} });
      case "tools/list":
        return send({ id, result: { tools: endpoint?.tools() ?? [] } });
      case "tools/call": {
        const name = String(message.params?.name ?? "");
        const args = message.params?.arguments && typeof message.params.arguments === "object" ? message.params.arguments as Record<string, unknown> : {};
        if (!endpoint) return send({ id, result: { content: [{ type: "text", text: "This Bot Lobby run has ended." }], isError: true } });
        let answered = false;
        endpoint.onCall({ name, arguments: args, respond: (result) => {
          if (answered) return;
          answered = true;
          send({ id, result });
        } });
        return;
      }
      default:
        return send({ id, error: { code: -32601, message: `Method not found: ${message.method}` } });
    }
  };
  socket.on("data", (chunk: string) => {
    const lines = (partial + chunk).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: RpcMessage & { bridge?: string };
      try {
        message = JSON.parse(line) as RpcMessage & { bridge?: string };
      } catch {
        continue;
      }
      if (typeof message.bridge === "string") endpoint = endpoints.get(message.bridge);
      else handle(message);
    }
  });
}

function listen(): Promise<string> {
  listening ??= new Promise((resolve, reject) => {
    const path = socketPath();
    server = createServer(serve);
    server.unref();
    server.once("error", (error) => {
      listening = undefined;
      reject(error);
    });
    server.listen(path, () => resolve(path));
    if (process.platform !== "win32") process.once("exit", () => rmSync(path, { force: true }));
  });
  return listening;
}

/** Serve one run's tools; the result is the MCP server its harness starts. */
export async function openBridge(endpoint: BridgeEndpoint): Promise<{ mcp: HarnessMcp; close(): void }> {
  const path = await listen();
  const token = randomBytes(16).toString("hex");
  endpoints.set(token, endpoint);
  const script = fileURLToPath(new URL("./mcp-stdio.mjs", import.meta.url));
  return {
    mcp: { name: BRIDGE_SERVER_NAME, command: process.execPath, args: [script, path, token] },
    close: () => endpoints.delete(token),
  };
}
