# DSH API notes for the port

The DSH APIs the port uses, with their shapes, in one place. Sources:
- the type definitions (`lib/types/*.d.ts`) of the `0.2.0-rc.2` packages;
- the vendored READMEs in [dsh/packages/](dsh/packages);
- the verified runs in [VERIFIED-FACTS.md](VERIFIED-FACTS.md).

Each item says whether it is **V** (verified: ran in DSH) or **D** (documented: read in types or README, not yet run).

**This is a snapshot.** DSH is pre-release and APIs move between RCs. The installed version is the authority. To confirm a method or event in a running DSH:
- ask an agent in a DSH session to call `cordis_inspect_query` (`Service`, `Event`, `Tool`, `Slots`, `Theme`, `Config.listConfigs`);
- or read the installed package's `lib/types` (`Config.listConfigs` gives `packageDir`).

This is how `reference/dsh/skills/cordis-plugin-development/SKILL.md` says to discover APIs.

---

## Plugin shape

**Host half** (`lib/index.js`, ESM, runs in the DSH Node process). **V**

```ts
export const name = 'bot-lobby'
export const inject = ['connection', 'webServer', 'tools', 'llm' /*, 'subagents', 'commands', 'userQuestions', 'systemPrompt', 'storageDomain', … */]
export function apply(ctx: Context, config: Config) {
  ctx.effect(() => { /* register something */ return () => { /* dispose it */ } }, 'label')
}
// optional: export const Config = <cordis schema>   (validated at activation; `.volatile()` fields are user-editable, D)
```

- **Registrations are effects.** Register everything inside `ctx.effect(...)` or `ctx.on(...)`, so that unload, HMR and profile changes remove it.
- **`inject`.** The plugin stays inactive while an injected service is missing. Optional services go in `ctx.inject(['x'], (ctx) => …)` instead.

**Client half** (`lib/client.js`, runs in the page). **V**

```js
window.__ModuleLoader__.load({
  id: '<package name>',
  factory(require) {
    const React = require('react')              // from the page's module table; never bundle React
    return { inject: ['slots', 'layout'], apply(ctx) { /* slot registrations */ } }
  },
})
```

The build in `templates/skeleton-ts/scripts/build.mjs` produces this from TSX.

**`package.json`** (**V**):
- `exports`: `.`, `./client`, `./package.json`;
- `dsh.bundle.patch`: `./cordis.patch.yml`;
- `dsh.client`: `{ platform: 'web', inject: [...] }`. `dsh.client.inject` lists client packages to activate after; it orders activation and does not import them.
- Display metadata goes in `locale/en.json` (`{ meta: { title, description } }`), and the icon in the top-level `icon` (**D**, host-plugin.md).

**`cordis.patch.yml`** (**V**):

```yaml
- insert:
    - id: bot-lobby
      name: '@a-t-h-i/dsh-bot-lobby'
      config: {}
```

## Tools: `ctx.tools` (`@deepseek-ai/dsh-tools`)

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'              // V (resolves from DSH at runtime)
const dispose = ctx.tools.register(defineTool({                   // V
  name: 'orchestrate',
  description: '…',
  parameters: {                                                   // DSL: string number integer boolean null array object json oneOf
    action: { type: 'string', required: true, enum: ['clarify', 'scout' /* … */], description: '…' },   // enum: D
    domains: { type: 'array', items: { type: 'string' } },        // array/items shape: D, check types
  },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },    // V
  async execute(args, exec) { /* exec: ToolRunContext */ return '…' },                                  // V
}))
```

- **`exec`** (`ToolRunContext extends ToolExecution`, **D**):
  - `callId`, `name`, `arguments` and `signal`;
  - **`agent?: Agent`**: the calling agent, which tells us the session, and whether the caller is the oracle or a child;
  - `deferContext(userMessage)`: extra context delivered after the result;
  - `concludeTurn()`.
- **`ctx.tools.restrict({ allow?: string[], deny?: string[] })`** returns a disposer (**D**). Apply it to one agent through `agent.ctx.tools.restrict(...)`; masks intersect, and scoped registrations stay visible.
- **`ctx.tools.guard((execution) => reason | undefined)`** returns a disposer (**D**). It is synchronous and monotonic, and runs after every `tools/pre-execute` listener. A returned string denies the call. `execution.agent` identifies the caller.
- **`ctx.tools.schemas(scope?)`** (**V** for root scope): the visible schemas. From the plugin's root context it lists only **global** registrations; DSH's built-in tools are agent-scoped.
- **Waterfall events** (**D**): `tools/pre-execute` (allow/deny/ask), `tools/execute` (wrap dispatch), `tools/post-execute` (replace the result). **A listener that doesn't own the decision must return `next()`.** `tools/result` is observe-only.
- **Chat card for a tool:** the client `tool.call.toolview` renderer (**D**, dsh-tools README "Host presentation descriptors").

## Models: `ctx.llm` (`@deepseek-ai/dsh-llm`)

```ts
ctx.llm.listProviders(): Array<{ id: string; name: string }>                       // V → [{id:'deepseek-official',name:'DeepSeek'},{id:'deepseek-account',name:'DeepSeek Account'}]
await ctx.llm.listModels(providerId): Array<{ provider, id, name, description?, inputModalities? }>   // V: pass route.id; the name fails with 'no adapter registered for provider "DeepSeek"'
await ctx.llm.resolveModel(provider, model, signal?): LlmResolvedModelInfo          // D
//   .context?.contextWindow, .defaultMaxTokens?, .reasoning?: { efforts: [{ id, name, description? }], defaultEffort? }
ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>               // D: direct model calls (e.g. the split planner could use it; prefer subagents for agent work)
```

The verified model list for `deepseek-official` was:
- `deepseek-flash` (name "DeepSeek-V41-Flash", text + image);
- `deepseek-v4-pro` ("DeepSeek-V4-Pro", text).

The user's own providers appear the same way.

## Agents: `Agent` (`@deepseek-ai/dsh-agent`)

- **`agent.options`:** `{ provider?, model?, reasoningEffort?, maxTokens? }` (`AgentOptions`).
- **`agent.session`:** the live session. `session.id`; `session.header.cwd` (used by `dsh-system-prompt`'s `cwd` variable).
- **`agent.ctx`:** the agent-scoped context. Registrations on it apply to this agent only and unwind when it is disposed. Also keep the disposer in the plugin's own effect ("two owners").
- **`agent.status`**, and **`agent.inbox`** (`nextTurn`, `nextStep`, `clear()`).
- **Input methods.** `message` is a `UserMessage`: `{ id, role: 'user', content: ContentBlock[], source }`. Build one with `createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'bot-lobby' } })` from `@deepseek-ai/dsh-llm`, which assigns the id and role.

| Method | Effect |
| --- | --- |
| `agent.followup(message)` | queues an ordinary next turn **and wakes** the agent |
| `agent.steer(message)` | input for the nearest step; wakes an idle agent |
| `agent.inject(message)` | model-facing context for the next step, **no wake-up**; logged as `agent/inbox/spliced` |
| `agent.send(message, target, wakeup)` | the general form |

- **`agent.cancel(cause, { keepInbox? })`** and **`await agent.whenIdle()`.**
- **Events** on the agent's scope (**D**): `agent/created`, `agent/disposed`, `agent/status`, `agent/pre-step` (waterfall: spread the decision `{ ...decision, messages }`), `agent/request`, `agent/assistant-stream`.
- **`ctx.agents`** (`AgentRegistry`, **D**): `ctx.agents.create({ sessionId, agentOptions, setup? })` returns a handle `{ agent, dispose() }`. It is used for a session per task; P0-07 checks whether such a session shows in the UI.

## Subagents: `ctx.subagents` (`@deepseek-ai/dsh-subagent`)

```ts
const run = await ctx.subagents.start('spawn', {         // D; 'spawn' = @deepseek-ai/dsh-subagent-spawn-in-process's default provider name
  label?: string,
  prompt: ContentBlock[],                                // [{ type: 'text', text }]
  parent: Agent,                                         // the spawning agent (exec.agent)
  signal: AbortSignal,                                   // cancels before and after start
  agentOptions?: { provider?, model?, reasoningEffort?, maxTokens? },
  outputSchema?: ObjectJsonSchema,                       // → result.structured
  maxDepth?: number,                                     // 0: the child cannot delegate
  toolFilter?: { allow?: string[], deny?: string[] },    // unknown names fail loudly
  persona?: string,                                      // scoped persona prefix for this child
})
run.id; run.localAgent /* Agent | undefined */; await run.result; await run.dispose()
// result: { output: ContentBlock[], structured?, diagnostic?: string (≤ 4 KiB), stopReason: 'completed'|'aborted'|'error'|'max-tokens'|'refusal' }
```

- **Failures.** `run.result` does **not** reject on a child failure: it resolves with a non-`completed` `stopReason`. It rejects only on an infrastructure fault.
- **Capabilities.** A request needing a capability the provider lacks fails at start. Both in-process providers support `agentOptions`.
- **Continuable children** (Phase 4): `ctx.subagents.startContinuable({ provider, label, request, signal, childId? })` returns `{ childId, messageId }`.
  - `ctx.subagents.sendMessage(senderAgent, childId, content, { signal })` continues it.
  - `interrupt(childId, authority)` and `listChildren(parentSessionId)` manage it.
  - `maxActiveSubagents` (default 8) limits live continuable children.
- **Lifecycle events** (observe-only): `subagent/start` (`SubagentRunInfo`) and `subagent/end` (`SubagentRunEndInfo`: `stopReason`, `lastAssistantMessage`).
- **Children cannot ask the user.** `ask_user_question` fails for a child with *"human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result"*.

## Asking the user: `ctx.userQuestions` (`@deepseek-ai/dsh-user-questions`)

```ts
const { answers } = await ctx.userQuestions.ask({       // D
  agent: oracleAgent,                                    // must be the exact live ROOT agent (a child is refused)
  signal,
  wait: { callId: exec.callId },                         // ties the question to the calling tool call (the durable projection)
  questions: [{
    id: 'approval',
    header: 'Proposal',                                  // short group label
    question: 'Approve the proposal?',
    detail: proposalMarkdown,                            // shown with the question, not in the options
    options: [{ label: 'Approve' }, { label: 'Amend', description: '…' }, { label: 'Decline' }],   // omit options for free text
    multiSelect: false,
    intent: { kind: 'plan-review', approve: 'Approve' }, // optional: a UI that knows the tag presents a plan review
  }],
})
// answers: [{ id, selected: string[], custom?: string }]  (single-select: custom overrides, selected empty)
```

- **`askTimed(...)`** may release the agent at a deadline while the question stays answerable.
- **Errors:** `BAD_INTENT` (`approve` not among the options, or an intent without `detail`); `NO_PROVIDER` (agentless and nobody answered).

**Mapping from bot-lobby's `AskQuestion`** (P0-09 confirms):

| bot-lobby | DSH |
| --- | --- |
| `question` | `question` |
| `header` | `header` |
| `options[].label` / `.description` | the same |
| `multiSelect` | `multiSelect` |
| `options[].preview` (Markdown) | → the question's `detail` |
| `options[].image` | no field: link it from `detail`, or show it in our page |
| the "type your own" row | `custom` |

## Commands: `ctx.commands` (`@deepseek-ai/dsh-commands`)

```ts
ctx.commands.register({                                  // D
  name: 'bot-lobby',                                     // lowercase letters, digits, _ or -
  description: 'Multi-agent tasks: /bot-lobby <request> | status | tasks | …',
  input: { hint: '<request> | status | approve | …' },
  handler: async ({ agent, rawInput }) => ({ kind: 'success', text: '…' }),   // or { kind: 'error', text }
})
```

- **Where it runs.** The handler runs against the receiving agent. No model message is created, and `recordInput` defaults to true.
- **Parsing.** `rawInput` is everything after the name, including the separating whitespace. The command owns its own grammar, so reuse `parseCommand`.

## System prompt: `ctx.systemPrompt` (`@deepseek-ai/dsh-system-prompt`)

```ts
agent.ctx.systemPrompt.section({ name: 'bot-lobby:master', order: 5000, text: masterPrompt, interpolate: false })   // D
ctx.systemPrompt.variable('name', ({ agent }) => value)                                                                // D
```

- **Order.** Sections are concatenated by `order`, then by name. `interpolate: false` keeps `{{…}}` literal, which bot-lobby's prompts may contain.
- **Don't use `system-prompt/assemble`** to add text or tools (practices.md).

## Storage: `ctx.storageDomain` (`@deepseek-ai/dsh-storage-domain`)

```ts
const spec = defineDomain({ name: 'bot-lobby-excalidraw', version: 1, tables: { sessions: domainTable(zodSchema) } })   // D
const domain = await ctx.storageDomain.open(spec)
domain.table('sessions').get(key)            // synchronous, from memory
await domain.table('sessions').put(key, value)   // durable before it resolves; emits domain/changed
domain.table('sessions').update(key, (r) => ({ ...r }))
await domain.close()                          // in the plugin's effect disposer
```

- **Files.** Records live under `$DSH_HOME/storages/` (the web profile had `storages/workspace.json`).
- **Error codes:** `already-open`, `invalid-record`, `missing-key` and `closed`.

## Per-session derived state: `ctx.sessionProjections` (`@deepseek-ai/dsh-session-projection`)

```ts
ctx.sessionProjections.register({            // D
  key: 'botLobby', stateSchema, stateVersion: 1,
  init: (header, inheritedEventCount) => initialState,
  apply: (state, event) => /* pure, sync; return the SAME state for events you ignore */ state,
  wire: { viewSchema, view: (state) => viewValue },   // omit wire for host-only
})
ctx.sessionProjections.stateOf(session, 'botLobby'); ctx.sessionProjections.snapshot(session)
```

- **Only existing events.** Fold only events DSH already writes, such as tool calls and results; never add event types (D-20).
- **Where to use it.** A candidate for the Agents view: fold `subagent/catalog` facts and the `orchestrate` tool results of a session.

## Settings: `ctx.settings` (`@deepseek-ai/dsh-settings`)

**D.**
- **What it edits.** Plugin `Config` fields declared `.volatile()` are editable through Settings forms. They persist into the active profile's patch, and home patches or CLI overlays can override them.
- **Our own page.** A plugin with its own settings page registers `configure({ auto: false }, ctx.fiber)` inside an optional `ctx.inject(['settings'], …)`.
- **Open question.** How our page writes those fields is P0-08's question.

## Credentials: `dsh-credentials`

**D.** It stores secrets by key name (e.g. `OPENCODE_API_KEY`), keeps per-plugin credential records, and reports whether a key is set without exposing its value. Jev's keys and any search provider keys belong here (D-14).

## Web server and connection (host)

```ts
ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/bot-lobby', handler: async (req, res) => {   // V
  const admission = ctx.connection.admit(req)                   // V: { peer } | { rejection: <HTTP status> }
  if ('rejection' in admission) { res.writeHead(admission.rejection); return res.end() }   // → 401 when not logged in
  // …route by path; JSON body; write the response
}}), 'bot-lobby: api')
```

- **Route matching:** an exact match first, then the longest prefix, then the fallback. Our prefix must not shadow DSH's `/api`.
- **`ctx.connection.rpc.handle(...)`** fails from a plugin in rc.2 (VERIFIED-FACTS §Transport).
- **Desktop:** *"Electron loads dist over file:// and carries fetch over an IPC bridge"*. Reachability of plugin routes there is unverified (R-02).

## Client: slots, layout, locale

```js
ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'bot-lobby' }, Page))                                   // V
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'bot-lobby', order: 90, label: () => t('title') }, Icon))   // V
ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'bot-lobby', order: 90 }, Dock))       // registration accepted and nothing on the home page (V); in-session rendering not yet seen (D)
ctx.layout.selectPanel('bot-lobby')                                                                                             // V
ctx.locale.register('bot-lobby', { en: {...}, zh: {...} }); const t = ctx.locale.bind('bot-lobby')                              // D: both shipped locales (en, zh) expected
```

**Slot kinds.** Slots come in four kinds: single, list, keyed and chain.

**Other slots from the client READMEs:**

| Slot | Documented in |
| --- | --- |
| `sidebar.right.pane.tab` (keyed by a tab definition id; the body reads `useTabInfo()`) | `dsh-client-ui-sidebar-right.md` |
| `sidebar.right.tab.menu.item`, `sidebar.right.tab.guide` | `dsh-client-ui-sidebar-right.md` |
| `conversation.view` (tabs next to Chat/Trajectory; the community plugin `dsh-agent-canvas` uses it) | `dsh-client-ui-conversation.md` |
| `conversation.chat.node` (with `ctx.uiConversation.events.register()`) | `dsh-client-ui-conversation.md` |
| `conversation.header`, `conversation.session.header.corner` | `dsh-client-ui-conversation.md` |
| `sidebar.settings`, `sidebar.workspaces` | `dsh-client-ui-sidebar.md` |
| `tool.call.toolview` | `dsh-tools.md`, `dsh-client-ui-conversation.md` |

**Discovering slots.** Use `cordis_inspect_query` → `Slots.listSubTree` for the live slot tree and each slot's registration options and props, and `Theme` for the `--dsw-alias-*` tokens.

## Events cheat sheet

| Event | Kind | Use |
| --- | --- | --- |
| `agent/created`, `agent/disposed` | notify | attach/detach per-agent registrations (`agent.ctx`) |
| `agent/status` | notify | UI "working/idle"; don't poll it |
| `agent/assistant-stream` | notify | live tokens and thoughts (child activity) |
| `agent/pre-step` | waterfall | rarely; spread the decision |
| `tools/pre-execute` | waterfall | allow/deny/ask; return `next()` when not deciding |
| `tools/result` | notify | observe final tool outcomes (edit log, activity) |
| `subagent/start`, `subagent/end` | notify | run lifecycle for the Agents view |
| `user-questions/request` | waterfall | (answerers only; we don't implement one) |
| `domain/changed` | notify | a storage-domain write happened |
