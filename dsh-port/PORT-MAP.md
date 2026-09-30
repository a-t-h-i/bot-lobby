# Port map

Two tables:
1. Every **Pi concept** bot-lobby uses, and the DSH mechanism that replaces it.
2. Every **source file** in bot-lobby, and what happens to it.

## Actions

| Action | Meaning |
| --- | --- |
| **COPY** | Copy into `src/core/…` unchanged, apart from import paths. It has no Pi imports and no Pi behaviour. |
| **ADAPT** | Copy into `src/core/…` and apply the listed small changes, such as paths, the `.bot-lobby` data root or the backend seam. |
| **REWRITE** | The behaviour is kept, but the code is new against DSH (`src/host/…`) or React (`src/client/…`). Use the old file as the specification. |
| **REPLACE** | A DSH mechanism takes over. The file is not ported; the named decision explains what replaces it. |
| **DROP** | Not needed in DSH. The reason is given. |

Import paths: bot-lobby uses `.ts` extensions in imports (`allowImportingTsExtensions`); keep that convention. Tests move from `test/<name>.test.ts` to `test/core/<name>.test.ts`, or `test/host/…`.

---

## 1. Pi concept → DSH mechanism

In the tables below:
- `ctx` = the plugin's Cordis context (`apply(ctx)`).
- `agent` = a DSH `Agent`.
- **V** = verified in DSH 0.2.0-rc.2; **D** = documented, not yet run.

### Extension entry and lifecycle

| Pi (bot-lobby) | DSH | |
| --- | --- | --- |
| `export default function (pi: ExtensionAPI)` in `src/index.ts` | `export const name`, `export const inject = [...]`, `export function apply(ctx, config)` | V |
| `pi.on("session_start" / "session_shutdown")` | `agent/created` / `agent/disposed` events (`ctx.on('agent/created', …)`); session lifecycle events in `dsh-session` | D |
| `pi.on("before_agent_start")`: adds master context each turn | `agent.inject(message)` when task state changes (D-07); prompt text with `agent.ctx.systemPrompt.section({ name, order, text })` | D |
| `pi.on("agent_start" / "agent_end" / "agent_settled")` | `agent/status` transitions; durable `turn/end`; `agent.whenIdle()` | D |
| `pi.on("tool_call")` (block or modify) | `ctx.tools.guard(fn)` (deny), or the `tools/pre-execute` waterfall (allow/deny/ask; always return `next()` when not deciding) | D |
| `pi.on("tool_execution_start/end")` | `tools/result` (observe the final outcome); child activity: see ARCHITECTURE §4 | D |
| `pi.on("message_update" / "message_end")` | `agent/assistant-stream` (live), `assistant/message` (durable) | D |
| `pi.on("context")` (filter messages: fresh context) | **Replaced** by one session per task (D-08) | — |
| `pi.on("session_before_compact")` | DSH compaction is its own feature; drop bot-lobby's hook unless a need appears | — |
| `pi.on("ui_prompt_start/end")` | Dialog time is not counted against budgets: `ctx.userQuestions` waits are awaited inside our own code, so we know when they start and end | D |
| `pi.appendEntry(...)` (custom session entries) | **Not allowed** (D-20). Keep the data in `.bot-lobby/` files, or derive it from existing events | — |
| `pi.registerEntryRenderer` | `ctx.uiConversation.events.register()` + `conversation.chat.node` slot, **only** for existing event kinds | D |

### Tools, commands, prompts

| Pi | DSH | |
| --- | --- | --- |
| `pi.registerTool({ name, parameters: Type.Object(…), execute })` (TypeBox) | `ctx.tools.register(defineTool({ name, description, parameters: { x: { type: 'string', required: true } }, output: { schema, render }, execute(args, exec) }))` from `@deepseek-ai/dsh-tools` | V |
| `StringEnum([...])` (pi-ai) | `{ type: 'string', enum: [...] }` in the parameter DSL (`dsh-tools` types: string params take `enum?: readonly string[]`) | D |
| Tool knows its caller through the Pi process | `exec.agent` (`ToolExecutionInput.agent`), then `agent.session.id` | D |
| `pi.setActiveTools` / `pi.getActiveTools` (hide web tools from the oracle) | `agent.ctx.tools.restrict({ deny: [...] })` on that agent; the disposer lifts it | D |
| `--tools a,b,c` for a subagent | `toolFilter: { allow: [...] }` in `ctx.subagents.start` | D |
| `pi.registerCommand("bot-lobby", …)` | `ctx.commands.register({ name: 'bot-lobby', description, input: { hint }, handler: ({ agent, rawInput }) => ({ kind: 'success', text }) })` | D |
| `pi.registerShortcut("alt+l" …)` | No global shortcuts. Use the sidebar entry, buttons, and (P5) page-local keys | — |
| `pi.sendUserMessage(text)` (drive the oracle) | `agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'bot-lobby' } }))` (`createUserMessage` from `@deepseek-ai/dsh-llm`) | D |
| Master prompt as extension instructions | `agent.ctx.systemPrompt.section({ name: 'bot-lobby:master', order: …, text })` | D |
| `pi.getSessionName` / `pi.setSessionName` | Session title in DSH (check `dsh-session` / `dsh-workspace`); P4-01 | D |

### Models

| Pi | DSH | |
| --- | --- | --- |
| `ctx.modelRegistry.getAvailable()`, `find(ref)` | `ctx.llm.listProviders()` → `[{ id, name }]`; `ctx.llm.listModels(route.id)` → `[{ provider, id, name, description?, inputModalities? }]` | V |
| `getSupportedThinkingLevels(model)` (pi-ai) | `ctx.llm.resolveModel(provider, model)` → `.reasoning.efforts[{ id, name }]`, `.reasoning.defaultEffort` | D |
| `pi.setModel(model)` / `pi.setThinkingLevel` (master fallback) | the session agent's options (`agent.options`); switching a live session's route is P0-05's question | D |
| `ctx.modelRegistry.getApiKeyForProvider` (Jev keys) | `dsh-credentials` or env (D-14) | D |
| `--model provider/id --thinking level` per subagent | `agentOptions: { provider, model, reasoningEffort, maxTokens? }` | D |

### Subagents

| Pi | DSH | |
| --- | --- | --- |
| `spawn("pi", ["--mode", "rpc", …])` + JSON stream on stdout (`execution/pi-runner.ts`) | `ctx.subagents.start('spawn', SubagentStartRequest)` → `SubagentRun { id, localAgent, result, dispose }` | D |
| system prompt file (`--append-system-prompt`) | `persona` | D |
| RPC `steer` on stdin (wrap-up, time-up) | `run.localAgent.steer(message)` | D |
| process kill (timeout, stall, Esc) | `AbortController` passed as `signal`, then `await run.dispose()` | D |
| exit code, `stopReason`, usage from the stream | `result.stopReason`, `result.diagnostic`; usage is P0-04's question | D |
| relayed `ask_user_question` from a child (`ask/relay.ts`) | Not possible: a child cannot ask the user. The question goes in the report and the oracle asks (D-09) | D |
| env vars into the child (`BOT_LOBBY_DESK`, `BOT_LOBBY_EXCALIDRAW`, `BOT_LOBBY_ASK`) | Not needed. Children are in-process: keep a map from child session id to its grant and desk worker id | — |
| desk IPC server + client extension in each child | in-process `FileDesk`; tools resolve the worker by `exec.agent.session.id` | — |

### UI

| Pi TUI | DSH web | |
| --- | --- | --- |
| `ctx.ui.custom(component)`: the full-screen lobby | `main` slot keyed page + `sidebar.panellist` entry | V |
| `ctx.ui.setWidget` / `setStatus`: status line | `conversation.composer.dock` | D (registration accepted and absent from the home page, V; in-session rendering not yet seen) |
| `ctx.ui.notify(text, level)` | page notices; DSH notifications if available (P3-12) | — |
| `ctx.ui.select / input / editor` | `ctx.userQuestions.ask()` from the root agent (D-09), or forms in our page | D |
| `ctx.ui.theme`, pi-tui `Text`, `Container`, `Markdown`, `SelectList`, `Editor` | React + our own components styled with `--dsw-alias-*` tokens (D-11) | — |
| `matchesKey`, `getKeybindings`, mouse events | DOM events inside our components | — |
| `renderImage` / Kitty graphics (`ask/image.ts`) | `<img>` in the page, if still needed after D-09 | — |
| `getMarkdownTheme()` + `lobby/markdown.ts` | A Markdown renderer in the page (bundle a small one, or render text); check whether DSH exposes one through the module table before bundling | — |

### Storage and paths

| Pi | DSH |
| --- | --- |
| `CONFIG_DIR_NAME` (`.pi`) → `<project>/.pi/bot-lobby/` | `<project>/.bot-lobby/` (D-10) |
| `~/.pi/bot-lobby/config.json` | plugin `Config` (volatile fields) or a storage domain (P0-08) |
| `~/.pi/bot-lobby/excalidraw/<project>.json` | `ctx.storageDomain.open(defineDomain({ name: 'bot-lobby-excalidraw', version: 1, tables: { sessions: … } }))` (D) |
| `ctx.cwd` | the session's cwd: `agent.session.header.cwd` (`dsh-system-prompt` variables use it) (D) |
| `ctx.sessionManager.getSessionId()` | `agent.session.id` |
| `ctx.sessionManager.getSessionFile/getBranch` (reading other sessions' chats) | Not needed: DSH shows every session itself |

---

## 2. File by file

Line counts are from bot-lobby v0.6.8. The "Pi" column counts imports of `@earendil-works/*` or `typebox`.

### `src/schemas/`, `src/text.ts`, `src/width.ts`

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `schemas/agent.ts` | 39 | 0 | COPY | `core/schemas/agent.ts` | |
| `schemas/task.ts` | 250 | 0 | COPY | `core/schemas/task.ts` | |
| `schemas/findings.ts` | 156 | 0 | COPY | `core/schemas/findings.ts` | `AgentRun` feeds the Agents view DTO |
| `schemas/configuration.ts` | 513 | 0 | ADAPT | `core/schemas/configuration.ts` | Thinking levels become effort ids (D-03). Keep the `ThinkingLevelName` type for Jev's "one level lower" logic, mapped to the efforts list. Model refs become `provider/model` with DSH route ids. Remove Pi-specific defaults. |
| `text.ts` | 124 | 0 | COPY | `core/text.ts` | `taskName` etc. |
| `width.ts` | 102 | 1 | DROP | — | Terminal cell widths |

### `src/workflow/` (the engine)

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `workflow/transitions.ts` | 41 | 0 | COPY | `core/workflow/` | |
| `workflow/approvals.ts` | 45 | 0 | COPY | `core/workflow/` | |
| `workflow/brief.ts` | 59 | 0 | ADAPT | `core/workflow/` | Module-level `briefs` memory: key by task id and clear on task end (P2-01) |
| `workflow/track.ts` | 436 | 0 | COPY | `core/workflow/` | |
| `workflow/workflow.ts` | 1728 | 0 | ADAPT | `core/workflow/` | `WorkflowDeps.runProcess` becomes `backend: AgentBackend` (ARCHITECTURE §4). Worktree paths via `execution/workspace.ts`. Keep `runWorkflowAction`. |

### `src/state/`

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `state/project.ts` | 108 | 0 | ADAPT | `core/state/` | `dataRoot = <root>/.bot-lobby`; no legacy roots; `detectProjectRoot` looks for `.bot-lobby` or `.git`; config I/O behind `ConfigStore` (P1-01) |
| `state/persistence.ts` | 266 | 0 | ADAPT | `core/state/` | Only the `configDir` → data dir change (P1-01) |
| `state/task-state.ts` | 22 | 0 | COPY | `core/state/` | `onTransition` listener is process-wide; fine in one host |
| `state/archive.ts` | 108 | 0 | ADAPT | `core/state/` | paths |
| `state/auto.ts` | 40 | 0 | ADAPT | `core/state/` | paths |
| `state/backlog.ts` | 139 | 0 | ADAPT | `core/state/` | paths |
| `state/budget.ts` | 274 | 0 | ADAPT | `core/state/` | paths |
| `state/changes.ts` | 231 | 0 | ADAPT | `core/state/` | `editedFile(toolName, args)` must know the DSH edit tool names and argument shapes (P0-03) |
| `state/comments.ts` | 136 | 0 | ADAPT | `core/state/` | paths |
| `state/file-cache.ts` | 62 | 0 | COPY | `core/state/` | |
| `state/inbox.ts` | 124 | 0 | ADAPT | `core/state/` | Keep task inboxes; drop session inboxes (DSH sessions) |
| `state/metrics.ts` | 428 | 0 | ADAPT | `core/state/` | paths; `model` values are `provider/model` from DSH |
| `state/presence.ts` | 99 | 0 | DROP (P4 may revive) | — | Pi process heartbeats; DSH has one host per profile |

### `src/knowledge/`

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `knowledge/paths.ts` | 43 | 0 | ADAPT | `core/knowledge/` | paths |
| `knowledge/store.ts` | 125 | 0 | COPY | `core/knowledge/` | |
| `knowledge/selector.ts` | 82 | 0 | COPY | `core/knowledge/` | |
| `knowledge/compactor.ts` | 135 | 0 | COPY | `core/knowledge/` | |
| `knowledge/edit.ts` | 109 | 0 | COPY | `core/knowledge/` | |
| `knowledge/notes.ts` | 143 | 0 | COPY | `core/knowledge/` | |

### `src/master/`, `src/roles/`, `src/agents/`, `src/prompts/`, `prompts/`

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `master/master.ts` | 431 | 0 | ADAPT | `core/master/` | `run: ProcessRunner` becomes `backend` |
| `master/research.ts` | 103 | 0 | ADAPT | `core/master/` | same |
| `master/synthesis.ts` | 57 | 0 | COPY | `core/master/` | |
| `master/decisions.ts` | 61 | 0 | COPY | `core/master/` | |
| `roles/*.ts` | 454 | 0 | ADAPT | `core/roles/` | `WORKER_TOOLS` and each role's tool list become DSH tool names (P0-03). Parsers are unchanged. |
| `agents/*.ts` | 44 | 0 | COPY | `core/agents/` | |
| `prompts/compiler.ts`, `prompts/loader.ts` | 70 | 0 | ADAPT | `core/prompts/` | `loadPrompt` resolves `prompts/` next to the built `lib/`: `new URL('../prompts/', import.meta.url)` from `lib/index.js`. Ship `prompts/` in `files`. |
| `prompts/*.md` (repo root) | 1,317 | — | ADAPT | `prompts/` | Replace Pi tool names with DSH ones, drop mentions of Pi, `.pi`, `alt+…` keys, TUI tabs and the relay. Keep every rule. P1-10 |

### `src/execution/`

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `execution/pi-runner.ts` | 774 | 0 | REPLACE | `core/agents/backend.ts` (types) + `host/backend.ts` | Keep the types and messages: `PiRunOptions` → `AgentRunOptions`, `PiRunResult` → `AgentRunResult`, `TimeLimit`, `WRAP_UP_MESSAGE`, `MAX_THOUGHT_CHARS`. Move `buildPiArgs`, `parsePiStream` and `toResult` into `test/helpers/legacy-runner.ts` (TESTING.md §3). |
| `execution/agent-runner.ts` | 422 | 0 | ADAPT | `core/agents/agent-runner.ts` | `runAgent(request, backend)`; retries, fallback and `AgentTime` unchanged. `extraTools` (desk) stays. `env` goes. `onAsk` goes (D-09). `cancelAllRuns` keeps a registry of live controllers. |
| `execution/fallback.ts` | 75 | 0 | ADAPT | `core/agents/` | `looksUnavailable` must match DSH diagnostics (collect in P0-04) |
| `execution/git.ts` | 139 | 0 | COPY | `core/git/` | |
| `execution/workspace.ts` | 185 | 0 | ADAPT | `core/git/` | `worktreesRoot = <root>/.bot-lobby/worktrees` |

### `src/desk/`

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `desk/desk.ts` | 249 | 0 | COPY | `core/desk/` | `FileDesk` |
| `desk/session.ts` | 214 | 0 | ADAPT | `core/desk/` | `DeskSession`: in-process, no IPC; `isEditTool` → DSH edit tool names |
| `desk/ipc.ts` | 178 | 0 | DROP | — | Children are in-process |
| `desk/client-extension.ts` | 101 | 2 | REWRITE | `host/tools/desk.ts` + `host/guard.ts` | Tool definitions with `defineTool`; gating with `ctx.tools.guard` |

### `src/classifier/` (Jev)

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `classifier/client.ts`, `classifier.ts`, `limits.ts`, `answers.ts`, `seats.ts`, `triage.ts`, `knowledge.ts`, `effort.ts`, `review.ts` | 1,326 | 0 | COPY | `core/classifier/` | `effort.ts stepDown` works on effort lists (D-03) |
| `classifier/files.ts` | 427 | 0 | ADAPT | `core/classifier/` | cache path `.bot-lobby/cache/files.json` |
| `classifier/hosts.ts` | 157 | 1 | ADAPT | `core/classifier/` | Drop Pi provider names; key source injected (DSH credentials or env) |
| `classifier/instance.ts` | 104 | 1 | REWRITE | `host/classifier.ts` | One instance per host; scope per session cwd |
| `classifier/tools.ts` | 58 | 2 | REWRITE | `host/tools/find-files.ts` | `defineTool` |

### `src/excalidraw/`

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `excalidraw/room.ts`, `scene.ts`, `client.ts`, `check.ts` | 1,161 | 0 | COPY | `core/excalidraw/` | Needs `socket.io-client` (the only runtime dependency) and Node's `crypto.subtle` |
| `excalidraw/sessions.ts` | 302 | 0 | ADAPT | `core/excalidraw/` | `ExcalidrawBook` storage behind an interface (file for tests, DSH storage domain in the host). `GRANT_ENV` goes; grants are passed in-process. |
| `excalidraw/tools.ts` | 223 | 3 | REWRITE | `host/tools/excalidraw.ts` | Same tool contracts; the grant is looked up from `exec.agent`: the oracle's grant, or the child's grant by session id |

### `src/web/`

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `web/*.ts` (search, fetch, read, extract, html) | 1,062 | 0 | DROP for now | — | DSH `web_search` / `web_fetch` (D-13). Keep the code in the old repo; `read.ts checkSource` may come back as `source_check` (P4-06). |
| `web/tools.ts` | 279 | 3 | DROP | — | same |

### `src/ask/`

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `ask/types.ts` | 55 | 0 | ADAPT | `core/ask/types.ts` | Keep the question shape as the engine's internal type. The host maps it to `ctx.userQuestions` (P2-03). |
| `ask/tool.ts`, `dialog.ts`, `view.ts`, `state.ts`, `image.ts`, `png.ts`, `relay.ts` | 1,134 | 7 | REPLACE | — | DSH `ask_user_question` + its UI (D-09) |

### `src/lobby/`: models (logic)

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `lobby/feed.ts` | 389 | 0 | ADAPT | `core/lobby/feed.ts` | `LobbyFeed`: one per session (a map), not a singleton. Chat entries become activity/thoughts only (the chat is DSH's). |
| `lobby/planner.ts` | 1074 | 0 | ADAPT | `core/lobby/planner.ts` | `PlanningSession`; `runPiAgent` → backend; tools → DSH names; question answering via the host (P0-09) |
| `lobby/split.ts` | 230 | 0 | COPY | `core/lobby/split.ts` | |
| `lobby/quickfix.ts` | 402 | 0 | ADAPT | `core/lobby/quickfix.ts` | `QuickFixQueue`; `runPiAgent` → backend; tools → DSH names |
| `lobby/pr-review.ts` | 360 | 0 | ADAPT | `core/lobby/pr-review.ts` | backend; `saveReview` path `.bot-lobby/reviews` |
| `lobby/pulls.ts` | 250 | 0 | COPY | `core/lobby/pulls.ts` | `gh` via `Exec` |
| `lobby/issues.ts` | 227 | 0 | COPY | `core/lobby/issues.ts` | |
| `lobby/knowledge.ts` | 179 | 0 | ADAPT | `core/lobby/knowledge-book.ts` | `KnowledgeBook` paths |
| `lobby/ask.ts` | 137 | 1 | ADAPT | `core/lobby/ask.ts` | Panel questions → the engine question type; the asker is injected |
| `lobby/mini.ts` | 159 | 1 | ADAPT | `core/lobby/status.ts` | Keep `workingAgents`, `stageBar` and `stepBar` as data. Drop ANSI painting; the dock renders them. |
| `lobby/session-files.ts` | 275 | 0 | DROP | — | Read Pi session files |
| `lobby/sessions.ts` | 328 | 0 | DROP | — | Launched background `pi` processes; DSH sessions replace them (F-53) |
| `lobby/runtime.ts` | 1006 | 3 | REWRITE | `host/lobby.ts` + `host/api/*` | The glue: which state each session has, `savePlan`, `answerPanel`, starting planned tasks. Keep the logic; the TUI parts go. |
| `lobby/view.ts` | 3013 | 1 | REWRITE | `client/pages/*` | The TUI; `LobbyHost` is the list of data the page needs (ARCHITECTURE §6) |
| `lobby/layout.ts`, `keys.ts`, `markdown.ts`, `theme.ts` | 701 | 5 | DROP | — | Terminal rendering |
| `lobby/tabs/*.ts` | 2,121 | 1 | REWRITE | `client/pages/*` | Each tab becomes a React page. Read its render function for what it shows, the order and the empty states. |

### `src/pi/`

| File | Lines | Pi | Action | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| `pi/activity.ts` | 196 | 0 | ADAPT | `core/lobby/activity.ts` | Tool name → word ("editing"), mapped to DSH tool names |
| `pi/plan-checklist.ts` | 347 | 0 | COPY | `core/workflow/plan-checklist.ts` | |
| `pi/run-summary.ts` | 183 | 0 | COPY | `core/lobby/run-summary.ts` | |
| `pi/notify.ts` | 60 | 0 | ADAPT | `core/lobby/notify.ts` | Message texts stay; delivery by the host |
| `pi/start-flags.ts` | 14 | 0 | COPY | `core/commands/start-flags.ts` | |
| `pi/quiet.ts` | 64 | 0 | ADAPT | `core/…` | `webToolsFor` → the deny list for the oracle; `isSubagentProcess` goes |
| `pi/commands.ts` | 403 | 1 | ADAPT + REWRITE | `core/commands/parse.ts` + `host/commands.ts` | `parseCommand`, `runsReport` are pure (ADAPT); registration is REWRITE |
| `pi/start-task.ts` | 204 | 1 | REWRITE | `host/start-task.ts` | `kickoff()` text is pure (keep); starting drives `agent.followup` |
| `pi/route.ts` | 181 | 4 | REWRITE | `host/tools/route.ts` | `route_request` on the oracle's `agent.ctx` |
| `pi/tools.ts` | 232 | 4 | REWRITE | `host/tools/orchestrate.ts` + `host/deps.ts` | `workflowDeps(...)` becomes the DSH `WorkflowDeps` |
| `pi/events.ts` | 143 | 1 | REWRITE | `host/oracle.ts` | `masterTaskContext`, `masterWorkflowContext` and `budgetContext` are pure (move to core); registration is new |
| `pi/owner.ts` | 274 | 2 | REWRITE | `host/oracle.ts` | `autoStep`, `autoNudge`, `taskFingerprint` pure (core); timers and delivery via `agent.followup` |
| `pi/fresh-context.ts` | 134 | 1 | REPLACE | — | One session per task (D-08); keep `previousTaskNote` text if useful |
| `pi/master-fallback.ts` | 61 | 1 | REWRITE | `host/oracle.ts` | `usageFailure`, `switchedMessage` pure; switching the session's route is P0-05 |
| `pi/model-support.ts` | 159 | 1 | REWRITE | `host/models.ts` | `createProfileResolver` logic kept; model lookup over `ctx.llm` |
| `pi/settings-ui.ts` | 657 | 2 | REWRITE | `client/pages/settings/*` + `host/api/settings.ts` | `patchEntry`, `prefillModels`, `LOBBY_SWITCHES` are pure (move to core) |
| `pi/tool-renderers.ts` | 121 | 3 | REWRITE | `client/toolviews/*` | `tool.call.toolview` |
| `pi/ui.ts` | 179 | 2 | ADAPT + DROP | `core/lobby/runs.ts` | `mergeRuns`, `persistedRuns`, `summarizeRun`, `statusText` pure; minimize and status bar dropped |
| `index.ts` | 43 | 1 | REWRITE | `host/index.ts` | `apply(ctx)` |

### Tests (`test/`)

| Group | Action |
| --- | --- |
| Pure-logic tests: `transitions`, `task`, `task-state`, `brief`, `track`, `text`, `selector`, `knowledge-edit`, `knowledge-book`, `compactor`, `excalidraw-scene`, `excalidraw-room`, `excalidraw-tools`\*, `excalidraw-sessions`\*, `git`, `workspace`, `plan-checklist`, `run-summary`, `mini`, `notify`, `split`, `scout`, `prompts`, `classifier*` | COPY into `test/core/`. Fix paths. \* = storage/grant adjustments |
| Engine tests with fake runners: `workflow`, `master`, `worker`, `reviewer`, `qa`, `researcher`, `budget`, `changes`, `knowledge`, `reliability`, `agent-runner`, `fallback`, `desk`, `e2e`, `track`, `route`, `isolation`, `auto-mode`, `lobby-runners`, `lobby-state`, `classifier-*` | ADAPT: `runProcess: fake` → `backend: backendFromProcessRunner(fake)` (TESTING.md §3); later simplify |
| Pi/TUI tests: `lobby-view`, `lobby-layout`, `ask`, `ask-image`, `relay`, `width`, `chat-markdown`, `quiet`, `ui`, `settings-ui`, `lobby-sessions`, `presence`, `fresh-context`, `pi-runner`, `model-support`, `package`, `lobby-runtime` | DROP, or turn their assertions into the page's acceptance criteria. Mine them for behaviours ("a stale knowledge entry is refused", "the tab bar shows ● waiting") before deleting. `package.test.ts` becomes a DSH packaging test. |
| `hourglass.test.ts` | Not part of the port (it tests `examples/hourglass.html`) |
| `excalidraw-server.ts` | COPY: a local collab server for tests (dev dependency `socket.io`) |
