# 05. The orchestrator and the Lobby on dsh (5 days)

## Goal

The Lobby chat runs on a real dsh agent. You type in Bot Lobby's web UI, the orchestrator (pi calls it the oracle) answers, uses tools, starts tasks with `start_task`, and the Lobby shows its live activity. Everything reuses `registerBotLobby(host)` from phase 02, unchanged, by giving it a full dsh `Host` for one agent.

## The one idea of this phase

On pi, Bot Lobby runs inside one pi session and reads that session through `ExtensionAPI` + `ExtensionContext`. On dsh, Bot Lobby creates one dsh agent (the orchestrator) and builds a `Host` + `HostContext` around it. Then it calls the same `registerBotLobby(host)` and fires `session_start`. The engine, `createLobbyService` and the web UI do not know the difference.

## Words that mean different things

| pi word | dsh word | Meaning |
|---|---|---|
| agent run (`agent_start` … `agent_end`) | **turn** (`turn/start` … `turn/end`) | everything from one user message until the agent stops |
| turn (`turn_end`) | **step** (`step/start` … `step/end`) | one model reply plus its tool calls |
| session entry | session event | one saved record |
| oracle | orchestrator agent | the agent the user chats with in the Lobby |

Get this wrong and the Lobby's "working" indicator and run summaries break. Map pi `agent_end` to dsh `turn/end`, and pi `turn_end` to dsh `step/end`.

## Read first

- `src/register.ts`, `src/host/types.ts` (phase 02)
- `src/lobby/runtime.ts` (`startLobbyService`, `registerLobbyEvents`, `currentLobbyService`)
- `src/lobby/service.ts` (how `state.host` / `state.ctx` are used, lines with `sendUserMessage`, `getBranch`, `isIdle`, `abort`)
- `src/lobby/` file that defines `chatFromEntries` (find with `grep -rn "export function chatFromEntries" src`): the entry fields it reads
- dsh `docs/agent-lifecycle.md`, `packages/core/agent/src/runtime-types.ts`
- dsh `packages/bundle/web-app/presets/standard.patch.yml` (preset rows to copy)
- dsh `packages/interaction/commands/src/index.ts` (`CommandDefinition`)

## Step 1. A Bot Lobby agent preset

Bot Lobby agents get their dsh built-in tools from a preset. Add to `dsh/cordis.patch.yml`:

```yaml
- insert:
    - id: preset-bot-lobby
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: bot-lobby
        name: Bot Lobby
        description: Orchestrator and workers for Bot Lobby.
        order: 50
        plugins:
          # Copy these rows (and their config) from dsh's standard preset at your pinned version:
          # persona, agent-instructions, time-context, tool-bash, tool-pwsh, tool-fs, tool-fs-search,
          # tool-jobs, skill-filesystem, tool-skill, compaction (with compaction-basic, command-compact, tool-result-pruner).
          # Leave OUT: tool-ask-user, tool-web, tool-todo, planning/plan-mode, delegation/tool-subagent*,
          # workflow, command-goal, tool-goal, tool-schedule, present, tool-plugin-manager, tool-plugin-market.
```

Why left out: Bot Lobby has its own ask tool, web tools, plan checklist, Plan tab and delegation, and two of dsh's tool names clash with Bot Lobby's (phase 04).

Check with `cordis_inspect_query` that `ctx.agents.create({ meta: { agentPreset: "bot-lobby" } })` gives the agent this preset's tools (Service `agentPresets`). If presets are chosen another way at your dsh version, follow that and note it in `STATUS.md`.

## Step 2. Side store for things dsh sessions cannot hold

dsh sessions refuse unknown event types (rules A.5). Bot Lobby writes three kinds of things pi keeps in its session file:

- `appendEntry(customType, data)` records
- `sendMessage({ customType: CHAT_MARK, ... })` chat marks
- the session name

Create `dsh/src/host/side-store.ts`: one JSON-lines file per session at `<Bot Lobby data dir>/dsh-sessions/<sessionId>.jsonl` (use the data dir function from `src/state/project.ts`). Methods: `append(entry: HostEntry)`, `entries(): HostEntry[]`, `name()`, `setName(name)`. Write atomically (append one line, `fsync` not needed).

## Step 3. `dsh/src/host/adapter.ts`: Host and HostContext for one agent

```ts
export interface DshHostOptions {
  plugin: Context;            // the bot-lobby plugin's ctx
  agent: Agent;               // the dsh agent this Host speaks for
  env: Record<string, string>;// per-agent settings (phase 02 step 4b)
  subagent: boolean;
  side: SideStore;
  notify(message: string, level: NotifyLevel): void;
}
export function dshHost(options: DshHostOptions): { host: Host; context: () => HostContext; emit: Emitter }
```

Build it with these rules. Each row is one method or event.

### Methods

| Host member | dsh implementation |
|---|---|
| `kind` | `"dsh"` |
| `configDirName` | `".pi"` for now (keeps the existing data where pi users have it; phase 08 decides the final name) |
| `env(name)` / `subagent` | from options |
| `registerTool(tool)` | `options.plugin.effect(() => agent.ctx.tools.register(toDshTool(tool, context)))` (phase 04) |
| `registerCommand(name, cmd)` | keep it in a local `Map` (for step 4) and also `ctx.commands?.register({ name, description: cmd.description, handler: async (inv) => { await cmd.handler(inv.rawInput, context()); return { kind: "success" } } })` |
| `sendUserMessage(text, { deliverAs })` | if `text` starts with `/` and the first word names a command in the local Map, call that command's handler with the rest of the text and return. Else build `createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } })`; `deliverAs === "steer"` → `agent.steer(msg)`; otherwise `agent.followup(msg)` |
| `sendMessage(message, { triggerTurn })` | `side.append({ type: "custom_message", customType: message.customType, ... })`; if `message.display` also push it to the Lobby feed the way pi's UI would. If `triggerTurn` is true, `agent.followup` with `message.content`; if false, `agent.inject` |
| `appendEntry(type, data)` | `side.append({ type: "custom", customType: type, data, id, timestamp })` |
| `getSessionName()` / `setSessionName(n)` | `side.name()` / `side.setName(n)`; also set dsh's session title if a title service exists (inspect `Service` list for `sessionTitle`) |
| `getActiveTools` / `setActiveTools` / `getAllTools` | phase 04 `active-tools.ts` on `agent.ctx` |
| `setModel(model)` | `agent.model.select({ provider: model.provider, model: model.id, reasoningEffort: current?.reasoningEffort })`, return `true` |
| `getThinkingLevel()` / `setThinkingLevel(l)` | read / write `reasoningEffort` through `agent.model.current()` / `agent.model.select()`. Map Bot Lobby levels to dsh `ReasoningEffortId` values (inspect `llm` for the list) in one table in `dsh/src/host/thinking.ts` |
| `thinkingLevels(model)` / `clampThinking` | from the model catalog in `ctx.llm` (inspect), same table |
| `skills()` | phase 08 |

### HostContext (rebuilt on each call of `context()`)

| HostContext member | dsh implementation |
|---|---|
| `cwd` | the agent's working directory: inspect `Service workingDirectory` (or `agent.session` meta `cwd`) |
| `hasUI` | `true` (the web UI) |
| `ui.notify` | `options.notify` → `pushNotice(text, level)` from `src/webui/notices.ts` |
| `ui.setStatus` | keep the last value per key in memory; the Lobby already shows status from its own state |
| `ui.select` / `ui.confirm` | phase 08 (questionnaire bridge). Until then: `select` returns the first option, `confirm` returns `false`, and log a warning |
| `sessionManager.getSessionId()` | `String(agent.session.id)` |
| `sessionManager.getSessionFile()` | `undefined` (callers already handle it; `?.` is used) |
| `sessionManager.getSessionDir()` | `<data dir>/dsh-sessions` |
| `sessionManager.getBranch()` | build pi-shaped entries from `agent.session.events` (see below), merged with `side.entries()` by time |
| `sessionManager.getLeafId()` | id of the last entry from `getBranch()`, or `null` |
| `model` | from `agent.model.current()`: `{ provider, id: model }` |
| `isIdle()` | `agent.status === "idle"` |
| `abort()` | `agent.cancel({ kind: "user" })` |

`getBranch()` conversion. Read `chatFromEntries` and list the fields it reads. Then:

- dsh `user/message` event → `{ type: "message", id: String(event.seq), timestamp, message: { role: "user", content: [...text blocks], timestamp: ms } }`
- dsh `assistant/message` event → `{ type: "message", ..., message: { role: "assistant", content: [...text blocks] } }`. Use `expandAssistantStream` from `@deepseek-ai/dsh-llm` to get the text (see dsh `docs/cookbook/extension-cookbook.md`, "external protocol driver").
- skip every other event type.

Put the conversion in `dsh/src/host/entries.ts` with its own test.

### Events (`emit` drives `host.on` handlers)

`host.on(name, handler)` stores handlers in a Map. The adapter fires them from dsh events, filtered to this agent:

| Bot Lobby event | Fire it when (dsh) | Payload |
|---|---|---|
| `session_start` | right after the agent is created or resumed (the plugin calls `emit("session_start", { reason })`) | `{ reason: "startup" \| "resume" }` |
| `session_shutdown` | `agent/disposed` for this agent, or the plugin's own dispose, whichever is first (fire once) | `{ reason: "quit" }` |
| `before_agent_start` | `agent/inbox/claimed` with a user message, before the step's prompt assembly | `{ prompt, messageType: "user", systemPromptOptions: { sections } }`: a fresh `sections` object; keep it as `lastSections` |
| (prompt text) | one `agent.ctx.systemPrompt.section({ name: "bot-lobby", order: 900, interpolate: false, text: () => lastSections["bot-lobby"] ?? "" })` registered at setup | |
| `agent_start` | `agent/status` → `running` | `{}` |
| `agent_end` | session event `turn/end` | `{ messages: [] }` (fill only if a handler reads it) |
| `agent_settled` | `agent/status` → `idle` | `{}` |
| `turn_end` | session event `step/end` | `{ message: lastAssistant, toolResults }` |
| `message_update` | `agent/assistant-stream` frame with a `text-delta` or `reasoning-delta` chunk | shape the handler reads |
| `message_end` | session event `assistant/message` | `{ message }` |
| `tool_call` | not an event: `installGates` (phase 04) runs these handlers | |
| `tool_execution_start` | session event `tool/call` | `{ toolCallId, toolName, args }` |
| `tool_execution_end` | session event `tool/result` | `{ toolCallId, toolName, result, isError }` |
| `tool_result` | `tools/result` for this agent | `{ toolCallId, toolName, input, content, isError }` |
| `before_provider_request` | not used on dsh: the only user (`assignment-guard.ts`) filters tools, which `setActiveTools` already does on dsh. Log once if a handler is registered |
| `session_before_compact` | phase 07 | |
| `ui_prompt_start` / `ui_prompt_end` | the questionnaire bridge opens / closes a question (phase 08) | `{}` |

Before writing each row, confirm the dsh event name and payload with `cordis_inspect_query` (`Event`). Session events arrive on `session/event` as `(session, event)`; filter with `session === agent.session`.

Handlers may return values (pi uses returns in `tool_call`, `before_agent_start`). Only `tool_call` returns matter on dsh (phase 04). For `before_agent_start`, handlers write into `systemPromptOptions.sections`; that is why the payload object is kept.

## Step 4. Start the orchestrator in `dsh/src/index.ts`

Replace the phase 03 fixture with:

```ts
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    let disposed = false;
    let handle: AgentHandle | undefined;
    (async () => {
      const lastId = readLastOrchestratorId();            // side store: <data>/dsh-sessions/last.json
      handle = lastId
        ? await ctx.agents.resume({ resumeSessionId: lastId, setup: (agentCtx) => setup(agentCtx) })
        : await ctx.agents.create({ sessionId: brandString(randomUUID()), meta: { cwd: process.cwd(), agentPreset: "bot-lobby" }, setup: (agentCtx) => setup(agentCtx) });
      if (disposed) return handle.dispose();
      writeLastOrchestratorId(handle.agent.session.id);
      const { host, emit } = dshHost({ plugin: ctx, agent: handle.agent, env: {}, subagent: false, side: sideStore(handle.agent.session.id), notify: pushNotice });
      registerBotLobby(host);
      emit("session_start", { reason: lastId ? "resume" : "startup" });
      const service = currentLobbyService();
      if (service) mountWeb(ctx, service, config.webPort);
    })().catch((error) => ctx.logger?.error?.(error));    // check the logger API with inspect
    return () => { disposed = true; void handle?.dispose(); };
  });
}
```

Notes:
- `setup` registers the `bot-lobby` prompt section (table above) on `agentCtx`. Tools registered later through `host.registerTool` go on `agent.ctx`, which is the same scope.
- On pi, the Lobby is off until the user turns Bot Lobby on (`isMinimized()`, `src/pi/switch.ts`). On dsh the bundle exists to run the Lobby, so make the dsh host start with Bot Lobby on: check how `isMinimized()` reads its state and set it on for dsh at start.
- The model: pass `agentOptions: { provider, model }` from Bot Lobby's saved Lobby model (`loadConfig()`), if set.

## Step 5. New session, switch session, saved sessions

`src/lobby/service.ts` switches sessions by sending `/bot-lobby new` and `/bot-lobby switch <file>` as user text. Step 3's `sendUserMessage` sends those to the registered `bot-lobby` command. That command calls `ctx.newSession()` / `ctx.switchSession(path)` on pi. Add to `HostContext` (phase 02, pi adapter passes pi's own):

- `newSession(): Promise<void>`
- `switchSession(sessionId: string): Promise<void>`

On dsh, both: fire `session_shutdown` on the current Host, dispose the current orchestrator handle, create or resume another agent, build a new Host, call `registerBotLobby` again **only if** it is safe to call twice (check `registerLobbyEvents` for module-level "registered once" guards; if not safe, keep the first Host and swap the agent inside it instead, which is the safer default), then fire `session_start`.

Saved sessions list (`sessionFiles(state)` in `service.ts`) reads pi session files from disk. On dsh, list orchestrator sessions from the side store folder (`dsh-sessions/*.jsonl`), newest first.

## Tests (`dsh/test/`)

- `entries.test.ts`: dsh events → pi-shaped entries, in order, user and assistant only.
- `adapter.test.ts`: with a fake agent (`followup`, `steer`, `inject`, `cancel`, `status`, `model`, `ctx` with `on`), check each Methods row and that `/bot-lobby new` goes to the command, not to `followup`.
- `events.test.ts`: firing fake dsh events calls the right Bot Lobby handlers with the right payloads (`turn/end` → `agent_end`, `step/end` → `turn_end`).

## Done when

- [ ] Tests pass; `npx tsc --noEmit -p dsh` passes.
- [ ] Reinstall the bundle. Open `/lobby`. Type "hi": the orchestrator replies in the Lobby, the working indicator shows while it runs.
- [ ] Type a request big enough for `start_task`: a task appears in the Tasks tab (workers will fail until phase 06; that is expected, write it in `STATUS.md`).
- [ ] Reload the page: chat history is still there (from `getBranch()`).
- [ ] Restart dsh: the orchestrator resumes the same session.
- [ ] pi still passes `npm run typecheck` and `npm test`.

Commit: `dsh port: phase 05 orchestrator and lobby`.
