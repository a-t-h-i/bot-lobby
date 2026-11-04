/**
 * The daemon's side of Bot Lobby's MCP server. A harness the daemon drives
 * (the Orchestrator, a worker) starts `stdio.mjs`, which connects here; this
 * answers MCP's `initialize`, `tools/list` and `tools/call` for the run its
 * token names, with only the tools that run may use. A call runs the tool in
 * the daemon and answers when it finishes, however long that takes (the
 * harness is launched with a long per-server timeout: see `mcpServerConfig`).
 */
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MCP_SERVER_NAME = "bot-lobby";
/** How harnesses show a Bot Lobby tool: `mcp__bot-lobby__start_task`. */
export const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`;
/** A tool call may wait on the person (ask_user_question): a day. */
export const MCP_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PROTOCOL = "2025-06-18";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError: boolean;
}

/** What one run serves: its tools, and where its calls go. */
export interface McpEndpoint {
  tools(): McpTool[];
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpResult>;
}

/** The stdio server a harness starts for one run. */
export interface McpLaunch {
  name: string;
  command: string;
  args: string[];
}

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

let server: Server | undefined;
let listening: Promise<string> | undefined;
const endpoints = new Map<string, McpEndpoint>();

function socketPath(): string {
  const name = `bot-lobby-mcp-${process.pid}-${randomBytes(4).toString("hex")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
}

function serve(socket: Socket): void {
  socket.setEncoding("utf8");
  let partial = "";
  let endpoint: McpEndpoint | undefined;
  let open = true;
  const calls = new AbortController();
  const closed = () => {
    open = false;
    calls.abort(new Error("the harness closed its MCP connection"));
  };
  socket.on("close", closed);
  socket.on("error", closed);
  const send = (message: Record<string, unknown>) => {
    if (open) socket.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  const handle = (message: RpcMessage) => {
    if (!message.method || message.id === undefined) return;
    const id = message.id;
    switch (message.method) {
      case "initialize":
        return send({ id, result: { protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : DEFAULT_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: MCP_SERVER_NAME, version: "1" } } });
      case "ping":
        return send({ id, result: {} });
      case "tools/list":
        return send({ id, result: { tools: endpoint?.tools() ?? [] } });
      case "tools/call": {
        const name = String(message.params?.name ?? "");
        const args = message.params?.arguments && typeof message.params.arguments === "object" ? (message.params.arguments as Record<string, unknown>) : {};
        if (!endpoint) return send({ id, result: { content: [{ type: "text", text: "This Bot Lobby run has ended." }], isError: true } });
        endpoint.call(name, args, calls.signal).then(
          (result) => send({ id, result }),
          (error: unknown) => send({ id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } }),
        );
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

/** Serve one run's tools; the result is the MCP server its harness starts, and how to stop serving. */
export async function openMcp(endpoint: McpEndpoint): Promise<{ launch: McpLaunch; close(): void }> {
  const path = await listen();
  const token = randomBytes(16).toString("hex");
  endpoints.set(token, endpoint);
  const script = fileURLToPath(new URL("./stdio.mjs", import.meta.url));
  return {
    launch: { name: MCP_SERVER_NAME, command: process.execPath, args: [script, path, token] },
    close: () => endpoints.delete(token),
  };
}

/**
 * The server's entry in Claude Code's `--mcp-config`. The per-server
 * `timeout` is what lets a tool wait on the person: `MCP_TOOL_TIMEOUT` alone
 * still stops a call after 60 s (spike check A3, Claude Code 2.1.318).
 */
export function claudeMcpConfig(launch: McpLaunch): Record<string, unknown> {
  return { mcpServers: { [launch.name]: { command: launch.command, args: launch.args, timeout: MCP_TOOL_TIMEOUT_MS } } };
}

/** A harness tool name without Bot Lobby's MCP prefix (`mcp__bot-lobby__orchestrate` → `orchestrate`). */
export function localToolName(name: string): string {
  return name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name;
}
