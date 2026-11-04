# 01. Spike: go / no-go (2 days)

## Goal

Prove, in a throwaway bundle, the five things the port depends on. If one fails, stop and write why in `STATUS.md`.

1. A bundle can declare an agent preset, and a session using it gets that preset's tools and prompt text.
2. The plugin can start a dsh subagent (`ctx.subagents.startActivation`, `spawn` backend) with its own tools and prompt, and await its result without injecting a message into the parent.
3. The plugin sees the subagent's live tool calls and text as they happen (`session/event`, `agent/assistant-stream`).
4. The plugin can steer the running subagent.
5. A client plugin can add a left sidebar panel with its own main page (like dsh's Schedule panel) that calls a host HTTP route and shows the answer.

Nothing in Bot Lobby's `src/` changes in this phase.

## Read first

- dsh `docs/user/develop/basic/index.md`, `tool.md`, `publish.md`
- dsh Creator skill `cordis-plugin-development`: `SKILL.md`, `references/host-plugin.md`, `references/ui-plugin.md`, `references/practices.md`, `templates/decoration/*`
- dsh `packages/subagent/subagent/src/types.ts` (`SubagentActivationSpec`, `SubagentStartRequest`, `SubagentActivation`), `src/index.ts` (`startActivation`, `prompt`, `interrupt`)
- dsh `packages/core/agent/src/runtime-types.ts` (`agent/created`, `agent/assistant-stream`)
- dsh `packages/client/ui-schedule/src/client/index.ts`: the reference for a sidebar panel (`sidebar.panellist`) with a keyed `main` page
- dsh `packages/bundle/web-app/presets/standard.patch.yml`: preset rows

Confirm each API with `cordis_inspect_query` (rules, section B) before writing code.

## Build

Create `spike/` at the repo root (deleted at the end):

```
spike/
├── package.json
├── cordis.patch.yml
├── index.js          # host plugin
├── client.js         # browser plugin (hand-written module format, no build)
├── locale/en.json
└── icon.svg
```

`spike/package.json` (copy the shape of the Creator `decoration` template):

```json
{
  "name": "@local/bot-lobby-spike",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js", "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-workspace"] }
  }
}
```

Check the right `dsh.client.inject` package for the sidebar with `Slots.listSubTree` (which package declares `sidebar.panellist` and `main`).

`spike/cordis.patch.yml`:

```yaml
- insert:
    - id: bot-lobby-spike
      name: '@local/bot-lobby-spike'
    - id: preset-bot-lobby-spike
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: bot-lobby-spike
        name: Bot Lobby spike
        plugins:
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
```

`spike/index.js` (host). In `apply(ctx)`:

1. On `agent/created`, if the agent's preset is `bot-lobby-spike` (find how to read it: `ctx.agentPresets` or the event's agent meta), register on `agent.ctx`:
   - a prompt section `{ name: 'bot-lobby:spike', order: 900, text: 'You are the Bot Lobby spike orchestrator. When asked to delegate, call spike_delegate.' }`
   - a tool `spike_delegate` (use `defineTool` from `@deepseek-ai/dsh-tools`) whose `execute(args, run)` calls:
     ```js
     const activation = await ctx.subagents.startActivation({
       provider: 'spawn', label: 'spike worker', delivery: 'caller',
       parent: run.agent, signal: run.signal, agentPreset: 'bot-lobby-spike',
       prompt: [{ type: 'text', text: args.task + ' Call spike_ping first.' }],
     })
     const result = await activation.result
     return { childId: String(activation.childId), result }
     ```
2. On `agent/created` for a subagent whose parent is a spike agent (check `meta.origin === 'subagent'`), register a tool `spike_ping` that returns `pong`.
3. Record into an in-memory `log` array: `session/event` `tool/call`, `tool/result`, `turn/end` for subagent sessions, and `agent/assistant-stream` text deltas for them.
4. Register `ctx.webServer.register({ kind: 'prefix', path: '/bot-lobby-spike', handler })`. The handler first calls `ctx.get('connection')?.admit(req)` (or `requestRejection`) and answers 401 when rejected. `/bot-lobby-spike/log` returns the log as JSON. `/bot-lobby-spike/steer?text=...` calls `ctx.subagents.prompt({ childSessionId, delivery: 'steer', content: [...] , requestId })` for the last child (check the exact request shape).

`spike/client.js` (browser): copy the module format from the Creator template (`window.__ModuleLoader__.load({ id, factory(require) {...} })`). In `apply(ctx)`:

- register a `sidebar.panellist` entry `{ id: 'bot-lobby-spike', order: 50 }` and a keyed `main` page with the same key, copying how `ui-schedule` registers `PANEL_ID`;
- the page component fetches `/bot-lobby-spike/log` every 2 seconds and shows the entries in a list. (Polling is fine for the spike only.)

## Run

1. `dsh web` with a working model key.
2. `plugin_manager` → `install_bundle`, `target` = absolute path of `spike/`. Read `application`.
3. Start a session with the `bot-lobby-spike` preset. Ask: "Delegate: list the files here."
4. Open the Bot Lobby spike panel in the left sidebar. Call `/bot-lobby-spike/steer?text=Stop+and+say+STEERED` while the worker runs.

## Done when (all five yes)

- [ ] The session has `spike_delegate` and the spike prompt text (proves 1).
- [ ] `spike_delegate` returns the worker's result into the parent's tool result, and the parent got no extra injected message (proves 2).
- [ ] The log shows the worker's `spike_ping` tool call and text deltas before its `turn/end` (proves 3).
- [ ] After steering, the worker's next text reacts (proves 4).
- [ ] The panel shows in the left sidebar, opens a main page, and lists the log (proves 5).

Write in `STATUS.md`: the dsh version, how long `startActivation` took, and any API differences from this spec.

## Clean up

`plugin_manager` → `remove_bundle`. Delete `spike/`. Commit only `STATUS.md`: `dsh port: phase 01 spike results`.
