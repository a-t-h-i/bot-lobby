/**
 * Host half of the probe: a JSON endpoint for the plugin's own page (behind DSH's
 * login), a model-facing tool, and a read of the models the user configured.
 *
 * DSH 0.2.0-rc.2: `ctx.connection.rpc.handle()` cannot be used from a plugin
 * (it resolves `webServer` on the connection service's own Context), so the
 * endpoint is a plain web route that applies the connection's own admission.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'bot-lobby-probe'
export const inject = ['connection', 'webServer', 'tools', 'llm']

const BASE = '/bot-lobby-probe/rpc/'

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

export function apply(ctx) {
  const endpoints = {
    ping: async (payload) => ({ at: Date.now(), echo: payload ?? null }),
    // The tools an agent sees; the probe's own tool is among them once registered.
    tools: async () => ({ names: ctx.tools.schemas().map((schema) => schema.name) }),
    models: async () => {
      // A provider route as DSH lists it is { id, name }; its models come from listModels(route.id).
      const routes = ctx.llm.listProviders()
      const providers = []
      for (const route of routes) {
        let models
        try { models = await ctx.llm.listModels(route.id) } catch (error) { models = { error: error.message } }
        providers.push({ route, models })
      }
      return { providers }
    },
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/bot-lobby-probe',
    handler: async (req, res) => {
      // The same login fence as DSH's own /api: the browser that opened the printed URL is admitted.
      const admission = ctx.connection.admit(req)
      if ('rejection' in admission) return send(res, admission.rejection, { ok: false, error: 'unauthorized' })
      const url = new URL(req.url ?? '/', 'http://dsh')
      const endpoint = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : ''
      if (req.method !== 'POST' || !Object.hasOwn(endpoints, endpoint)) return send(res, 404, { ok: false, error: 'not found' })
      try {
        send(res, 200, { ok: true, result: await endpoints[endpoint](await readJson(req)) })
      } catch (error) {
        send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'bot-lobby-probe: web route')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'bot_lobby_probe',
    description: 'Probe tool from the bot-lobby port: returns a greeting with the given name.',
    parameters: { name: { type: 'string', required: true, description: 'Who to greet' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return `hello ${args.name}, from the bot-lobby probe` },
  })), 'bot-lobby-probe: tool')
}
