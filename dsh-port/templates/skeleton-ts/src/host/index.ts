/**
 * Host half: runs in the DSH process. Serves the plugin's page a JSON API
 * behind DSH's own login, and registers the model-facing tools.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "dsh-bot-lobby";
export const inject = ["connection", "webServer", "tools", "llm"];

/** The minimum of the Cordis Context this half uses; replace with the real types when the SDK packages are added. */
interface HostContext {
  effect(register: () => () => void, label?: string): void;
  webServer: { register(route: { kind: "exact" | "prefix"; path: string; handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void | Promise<void> }): () => void };
  connection: { admit(req: import("node:http").IncomingMessage): { peer: unknown } | { rejection: number } };
  tools: { register(tool: unknown): () => void };
  llm: { listProviders(): Array<{ id: string; name: string }>; listModels(provider: string): Promise<Array<{ provider: string; id: string; name: string }>> };
}

export const API_BASE = "/bot-lobby/api/";

type Endpoint = (payload: Record<string, unknown>) => Promise<unknown>;

function send(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export function apply(ctx: HostContext): void {
  const endpoints: Record<string, Endpoint> = {
    // Every model the user added to DSH, by provider route: what per-agent model pickers offer.
    models: async () => {
      const routes = ctx.llm.listProviders();
      return Promise.all(routes.map(async (route) => ({ route, models: await ctx.llm.listModels(route.id).catch(() => []) })));
    },
  };

  // DSH 0.2.0-rc.2: ctx.connection.rpc.handle() fails from a plugin, so the API is a web route behind the connection's admission.
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/bot-lobby",
    handler: async (req, res) => {
      const admission = ctx.connection.admit(req);
      if ("rejection" in admission) return send(res, admission.rejection, { ok: false, error: "unauthorized" });
      const path = new URL(req.url ?? "/", "http://dsh").pathname;
      const endpoint = path.startsWith(API_BASE) ? path.slice(API_BASE.length) : "";
      const run = Object.hasOwn(endpoints, endpoint) ? endpoints[endpoint] : undefined;
      if (req.method !== "POST" || !run) return send(res, 404, { ok: false, error: "not found" });
      try {
        send(res, 200, { ok: true, result: await run(await readJson(req)) });
      } catch (error) {
        send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  }), "bot-lobby: api route");

  ctx.effect(() => ctx.tools.register(defineTool({
    name: "bot_lobby_hello",
    description: "Says hello from bot-lobby (skeleton tool; replace with the real tools).",
    parameters: { name: { type: "string", required: true, description: "Who to greet" } },
    output: { schema: { type: "string" }, render: (_args: unknown, value: string) => [{ type: "text", text: value }] },
    async execute(args: { name: string }) {
      return `hello ${args.name}, from bot-lobby`;
    },
  })), "bot-lobby: tools");
}
