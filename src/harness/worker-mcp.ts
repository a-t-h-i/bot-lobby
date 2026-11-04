/**
 * Bot Lobby's worker tools on a harness run: the stdio MCP server
 * (`src/daemon/worker-tools.ts`) the harness starts beside its own tools, and
 * the daemon-side relay its ask_user_question calls come back through.
 */
import { fileURLToPath } from "node:url";
import { ASK_ENV, readRelayRequest, RELAY_TITLE } from "../ask/relay.ts";
import type { AskResult } from "../ask/types.ts";
import { MCP_SERVER_NAME, MCP_TOOL_TIMEOUT_MS, openMcp } from "../daemon/mcp/host.ts";
import { AGENT_ENV } from "../execution/delegation.ts";
import type { PiRunOptions } from "../execution/pi-runner.ts";

/** Env: the daemon's relay for questions (`<socket> <token>`), and the tools this worker may use (JSON list). */
export const RELAY_ENV = "BOT_LOBBY_RELAY";
export const TOOLS_ENV = "BOT_LOBBY_WORKER_TOOLS";

/** The stdio server one worker run starts. */
export interface WorkerMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The worker MCP server for a run, and how to stop serving its relay. */
export async function workerMcp(options: Pick<PiRunOptions, "env" | "tools" | "onAsk" | "onEvent">): Promise<{ server: WorkerMcpServer; close(): void }> {
  const script = fileURLToPath(new URL("../daemon/worker-tools.ts", import.meta.url));
  const env: Record<string, string> = { ...(options.env ?? {}), BOT_LOBBY_SUBAGENT: "1" };
  // A role's tool list, plus what the delegation host added to it (desk tools, delegate). No list: every worker tool.
  if (options.tools) {
    const policy = env[AGENT_ENV] ? ((JSON.parse(env[AGENT_ENV]) as { tools?: string[] }).tools ?? []) : [];
    env[TOOLS_ENV] = JSON.stringify([...new Set([...options.tools, ...policy])]);
  }
  let close = () => {};
  const ask = options.onAsk;
  if (ask) {
    env[ASK_ENV] = "1";
    const relay = await openMcp({
      tools: () => [],
      call: async (name, args, signal) => {
        const questions = name === "relay_ask" ? readRelayRequest(RELAY_TITLE, typeof args.prefill === "string" ? args.prefill : undefined) : undefined;
        if (!questions) return { content: [{ type: "text", text: "Not a question." }], isError: true };
        const started = Date.now();
        options.onEvent?.({ type: "asking", questions: questions.length });
        const result = await ask(questions, signal).catch((): AskResult => ({ answers: [], cancelled: true }));
        options.onEvent?.({ type: "answered", waitedMs: Date.now() - started });
        return { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
      },
    });
    const [, path, token] = relay.launch.args;
    env[RELAY_ENV] = `${path} ${token}`;
    close = relay.close;
  }
  return { server: { name: MCP_SERVER_NAME, command: process.execPath, args: ["--experimental-strip-types", "--no-warnings", script], env }, close };
}

/** Claude Code's `--mcp-config` for the worker server (also the Agent SDK's `mcpServers` entry). */
export function claudeWorkerMcp(server: WorkerMcpServer): Record<string, { type: "stdio"; command: string; args: string[]; env: Record<string, string>; timeout: number }> {
  return { [server.name]: { type: "stdio", command: server.command, args: server.args, env: server.env, timeout: MCP_TOOL_TIMEOUT_MS } };
}

function toml(value: string): string {
  return JSON.stringify(value);
}

/** Codex's `-c` overrides that add the worker server (Codex names it with an underscore). */
export function codexWorkerMcp(server: WorkerMcpServer): string[] {
  const key = `mcp_servers.${server.name.replace(/-/g, "_")}`;
  const env = Object.entries(server.env).map(([name, value]) => `${toml(name)}=${toml(value)}`).join(",");
  return [
    "-c", `${key}.command=${toml(server.command)}`,
    "-c", `${key}.args=[${server.args.map(toml).join(",")}]`,
    "-c", `${key}.env={${env}}`,
    "-c", `${key}.tool_timeout_sec=${Math.round(MCP_TOOL_TIMEOUT_MS / 1000)}`,
  ];
}

/** ACP's `session/new` entry for the worker server. */
export function acpWorkerMcp(server: WorkerMcpServer): { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> } {
  return { name: server.name, command: server.command, args: server.args, env: Object.entries(server.env).map(([name, value]) => ({ name, value })) };
}
