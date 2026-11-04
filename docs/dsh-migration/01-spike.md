# 01. Spike: go / no-go (2 days)

## Goal

Prove, in a throwaway bundle, the four things the whole port depends on. If any one fails, stop the port and write why in `STATUS.md`.

1. A plugin can create an in-process dsh agent with its own tools and its own prompt text.
2. The plugin sees that agent's live tool calls and text, as they happen.
3. The plugin can steer the agent while it runs.
4. The plugin can answer a question the agent asks, from outside dsh's own web client.

Nothing in Bot Lobby's `src/` changes in this phase.

## Read first

- dsh: `docs/user/develop/basic/index.md`, `tool.md`, `publish.md`
- dsh: `docs/agent-lifecycle.md` (event order of one turn)
- dsh: `packages/core/agent/src/index.ts` (`CreateAgentOptions`, `AgentHandle`) and `packages/core/agent/src/runtime-types.ts` (`Agent`, `agent/created`, `agent/status`, `agent/assistant-stream`)
- dsh: `packages/interaction/user-questions/src/types.ts` (`user-questions/request`)
- dsh Creator skill `cordis-plugin-development`: `references/host-plugin.md`, `references/practices.md`

Confirm each API you use with `cordis_inspect_query` (rules, section B).

## Build

Create `spike/` at the Bot Lobby repo root (it is deleted at the end):

```
spike/
├── package.json
├── cordis.patch.yml
├── index.js
├── locale/en.json
└── icon.svg
```

`spike/package.json`:

```json
{
  "name": "@local/bot-lobby-spike",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
  "files": ["index.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`spike/cordis.patch.yml`:

```yaml
- insert:
    - id: bot-lobby-spike
      name: '@local/bot-lobby-spike'
      config: {}
```

`spike/locale/en.json`:

```json
{ "meta": { "title": "Bot Lobby spike", "description": "Throwaway test of in-process agents for the Bot Lobby port." } }
```

`spike/icon.svg`: any small original SVG (a circle is fine).

`spike/index.js` does all of this inside `apply(ctx)`:

```js
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'bot-lobby-spike'
export const inject = ['agents', 'tools', 'systemPrompt', 'webServer', 'userQuestions']

export function apply(ctx) {
  const log = []                         // everything we saw, newest last
  const note = (kind, data) => log.push({ at: Date.now(), kind, data })
  let handle                             // the spike agent

  // 2. Live text and tool calls.
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (agent !== handle?.agent) return
    if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') note('text', frame.chunk.text)
  })
  ctx.on('session/event', (session, event) => {
    if (session !== handle?.agent.session) return
    if (event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'turn/end') note(event.type, event.data)
  })

  // 4. Answer questions from outside dsh's web client.
  ctx.on('user-questions/request', async (request, next) => {
    if (request.agent !== handle?.agent) return next()
    note('question', request.questions)
    return { answers: request.questions.map(q => ({ id: q.id, selected: [q.options?.[0]?.label ?? 'yes'] })) }
  })

  // Tiny HTTP surface to drive and read the spike.
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/lobby-spike',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://x')
      // Reject requests Connection does not trust (rules: never serve unauthenticated routes).
      const rejection = ctx.get('connection')?.requestRejection(req)
      if (rejection !== undefined) { res.statusCode = 401; return res.end() }
      if (url.pathname.endsWith('/start')) await start(url.searchParams.get('task') ?? 'Count the files in this folder, then ask me one yes/no question with the ask tool, then say done.')
      if (url.pathname.endsWith('/steer')) handle?.agent.steer(createUserMessage({ content: [{ type: 'text', text: url.searchParams.get('text') ?? 'Stop and say STEERED.' }], source: { kind: 'user' } }))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(log))
    },
  }))

  // 1. Create the agent with scoped tools and prompt text.
  async function start(task) {
    handle = await ctx.agents.create({
      sessionId: brandString(randomUUID()),
      meta: { cwd: process.cwd() },
      setup(agentCtx) {
        agentCtx.systemPrompt.section({ name: 'bot-lobby:spike', order: 500, text: 'You are a Bot Lobby test worker.' })
        agentCtx.tools.register(defineTool({
          name: 'spike_ping',
          description: 'Returns pong.',
          parameters: {},
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
          async execute() { return 'pong' },
        }))
      },
    })
    ctx.effect(() => () => handle?.dispose())
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: task + ' Call spike_ping first.' }], source: { kind: 'user' } }))
  }
}
```

The exact field names (`frame.chunk.text`, `event.data`, `requestRejection`, the `setup` signature, the answer shape) must be confirmed with `cordis_inspect_query` first. Fix the code to match what you find.

## Run

1. Start dsh's web profile (`dsh web`) with a working model key.
2. Install: `plugin_manager` → `install_bundle`, `target` = absolute path of `spike/`. Read `application` in the result.
3. In a browser tab that is already signed in to dsh's web UI, open `/lobby-spike/start`.
4. Open `/lobby-spike` a few times while it runs, then `/lobby-spike/steer`.

## Done when (all four must be yes)

- [ ] The log shows a `tool/call` for `spike_ping` (proves 1: scoped tool works).
- [ ] The log shows `text` entries arriving while the agent is still running, before `turn/end` (proves 2).
- [ ] After `/steer`, the agent's next text reacts to the steer message (proves 3).
- [ ] The log shows a `question` entry and the agent continued with our answer, without dsh's web client showing the question (proves 4). If dsh's own `ask_user_question` was not in the agent's tool set, add the `@deepseek-ai/dsh-tool-ask-user` row to the spike's patch for this test.

Also write down (in `STATUS.md`) how long `ctx.agents.create` took, and the dsh version used.

## Clean up

Remove the spike bundle with `plugin_manager` → `remove_bundle`. Delete `spike/`. Commit only `docs/dsh-migration/STATUS.md` with the results: `dsh port: phase 01 spike results`.
