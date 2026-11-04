# pi to dsh lookup table

Counts are from `src/` on Bot Lobby main `3c33033`. "Phase" is where the spec builds it. Confirm every dsh name with `cordis_inspect_query` before use (rules, section B).

## Words

| pi | dsh |
|---|---|
| agent run (`agent_start` … `agent_end`) | turn (`turn/start` … `turn/end`) |
| turn (`turn_end`) | step (`step/start` … `step/end`) |
| session entry | session event |
| extension | plugin (in a bundle) |
| `ExtensionAPI` + `ExtensionContext` | Bot Lobby's own `Host` + `HostContext` (phase 02), built around one dsh `Agent` (phase 05) |

## Events (`host.on`)

| Bot Lobby event (pi name) | Uses | dsh source | Phase |
|---|---|---|---|
| `session_start` | 8 | fired by the plugin after `ctx.agents.create` / `resume` | 05 |
| `session_shutdown` | 7 | `agent/disposed` or plugin dispose (once) | 05 |
| `before_agent_start` | 3 | `agent/inbox/claimed` (user message); text served by one `systemPrompt.section` on `agent.ctx` | 05 |
| `agent_start` | 3 | `agent/status` → `running` | 05 |
| `agent_end` | 3 | session event `turn/end` | 05 |
| `agent_settled` | 1 | `agent/status` → `idle` | 05 |
| `turn_end` | 1 | session event `step/end` | 05 |
| `message_update` | 1 | `agent/assistant-stream` text / reasoning deltas | 05 |
| `message_end` | 1 | session event `assistant/message` | 05 |
| `tool_call` (gates) | 5 | `tools/pre-execute` waterfall → `{ kind: "deny" }`; `terminate` → `agent.cancel({ kind: "hook" })`; hard rules also `ctx.tools.guard()` | 04 |
| `tool_execution_start` / `_end` | 4 | session events `tool/call` / `tool/result` | 05 |
| `tool_result` | 1 | `tools/result` | 05 |
| `before_provider_request` | 1 | not needed: its only user filters tools, done by `ctx.tools.restrict()` | 04 |
| `session_before_compact` | 1 | `dsh-compaction-basic` + own `agent/pre-step` trigger at "Compact at"; `compaction/summary` → `learn()` | 07 |
| `ui_prompt_start` / `_end` | 2 | fired by the questionnaire bridge | 08 |

## Calls

| pi call | Uses | dsh | Phase |
|---|---|---|---|
| `registerTool` | 20 | `agent.ctx.tools.register(toDshTool(...))`; errors are thrown | 04 |
| `sendUserMessage` | 17 | `agent.followup()` / `agent.steer()`; text starting with a registered `/command` runs the command | 05 |
| `sendMessage` (chat mark) | 1 | side store + `agent.inject()` (or `followup` when `triggerTurn`) | 05 |
| `appendEntry` | 2 | side store (dsh refuses new session event types) | 05 |
| `registerCommand` | 2 | local map + `ctx.commands.register()` | 05 |
| `registerShortcut`, `registerEntryRenderer`, pi-tui renderers | 5 | none: pi terminal only, stay in `src/host/pi/` | 02 |
| `getSessionName` / `setSessionName` | 9 | side store (+ dsh title if available) | 05 |
| `getActiveTools` / `setActiveTools` / `getAllTools` | 9 | `agent.ctx.tools.restrict({ allow })`; registry listing | 04 |
| `setModel` / `getThinkingLevel` / `setThinkingLevel` | 3 | `agent.model.select()` / `current()`; level table in `thinking.ts` | 05, 07 |
| `getSettings` | 2 | check what is read; most likely Bot Lobby's own config | 05 |
| `ctx.ui.notify` | 77 | `pushNotice()` (`src/webui/notices.ts`) | 05 |
| `ctx.ui.select` / `confirm` / `editor` | 4 | Bot Lobby's web questionnaire (`src/ask/web.ts`) | 08 |
| `ctx.ui.setStatus` | 3 | kept in memory | 05 |
| `ctx.sessionManager.getSessionId` | ~47 | `agent.session.id` | 05 |
| `getBranch` / `getLeafId` / `buildContextEntries` | 5 | built from `agent.session.events` (user + assistant) merged with the side store | 05 |
| `getSessionFile` / `getSessionDir` | 6 | `undefined` / `<data>/dsh-sessions` | 05 |
| `ctx.isIdle()` / `ctx.abort()` | 28 | `agent.status === "idle"` / `agent.cancel({ kind: "user" })` | 05 |
| `ctx.newSession()` / `switchSession()` | 2 | dispose + `ctx.agents.create` / `resume` | 05 |
| `ctx.modelRegistry.*` | 5 | `ctx.llm` (catalog + `stream`) | 07 |
| `CONFIG_DIR_NAME` | many | `host.configDirName`, `".pi"` on both hosts | 02, 08 |
| `process.env.BOT_LOBBY_*` per agent | ~13 | `host.env(name)` (per-agent map on dsh) | 02 |

## Processes

| pi | dsh | Phase |
|---|---|---|
| `spawnPiProcess(args, options)` starts `pi --mode rpc` per subagent | `setProcessRunner(dshProcessRunner)`: reads the same args, runs an in-process agent, streams the same `PiStreamEvent`s, writes the `message_end` lines `parsePiStream` reads | 06 |
| `--append-system-prompt <file>` | `agentCtx.systemPrompt.section({ name: "bot-lobby:worker" })` | 06 |
| `--tools a,b` / `--no-tools` / `--no-mcp` | `agentCtx.tools.restrict({ allow })` | 06 |
| `--skill <file>` | dsh skill service filter, or a gate on the skill tool | 06 |
| `--session <file>` (assigned task conversation) | resume a dsh session whose id is saved next to it | 06 |
| `steer` over stdin | `agent.steer()` | 06 |
| ask relay (`extension_ui_request` editor) | subagent `HostUI.editor` calls `options.onAsk` directly | 06 |
| background session (`SessionLauncher` → pi RPC process) | `setSessionLauncher(dshSessionLauncher)`: pi RPC lines over an in-memory or separate-process `SessionProcess` | 06 |
| third-party harnesses (`src/harness`) | unchanged: they spawn their own CLIs | — |

## Tool names that clash

| Bot Lobby | dsh row left out of Bot Lobby presets |
|---|---|
| `ask_user_question` | `tool-ask-user` |
| `web_search` | `tool-web` |

Also left out (Bot Lobby has its own): `tool-todo`, `planning` / `plan-mode`, `delegation` / `tool-subagent*`, `workflow`, `goal`, `schedule`, `present`, plugin manager / market tools.

## Files

Converted in phase 02 (pi imports today): `src/pi/*` (24 files), `src/index.ts`, `src/lobby/runtime.ts`, `service.ts`, `pi-commands.ts`, `src/execution/delegation.ts`, `src/ask/*`, `src/desk/client-extension.ts`, `board-client.ts`, `src/classifier/instance.ts`, `models.ts`, `tools.ts`, `src/knowledge/catalog-tools.ts`, `src/web/tools.ts`, `src/webui/command.ts`.

Engine edits after phase 02: `setProcessRunner` in `src/execution/pi-runner.ts` (phase 06), the `register.ts` split (phase 06), the host text in Settings (phase 08).

New: `src/host/` (phase 02), `dsh/` bundle (phases 03-09), `test/support/fake-host.ts`.
