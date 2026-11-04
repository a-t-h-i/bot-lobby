# pi hook to dsh mapping

Counts are from `src/` on Bot Lobby main `3c33033`.

## Events (`pi.on`)

| pi event | Uses | Where | dsh replacement |
|---|---|---|---|
| `session_start` | 8 | index, lifecycle, lobby, classifier, owner | `agent/created`, plugin `apply`, `session/event` |
| `session_shutdown` | 7 | many | `ctx.effect()` disposer, `AgentHandle.dispose()` |
| `before_agent_start` | 3 | prompts, delegation | `ctx.systemPrompt.section()`; `agent/pre-step` for per-turn context |
| `agent_start` / `agent_end` / `agent_settled` | 7 | lifecycle, lobby | `agent/status` (running / idle), `turn/end` session event |
| `turn_end` | 1 | lifecycle | `turn/end` via `session/event` |
| `message_update` / `message_end` | 2 | lobby live text | `agent/assistant-stream` chunks; `assistant/message` event |
| `tool_call` | 5 | grants, guard, budget, delegation | `tools/pre-execute` (deny / ask), `ctx.tools.guard()` |
| `tool_execution_start` / `_end` | 4 | activity words | `tool/call` and `tool/result` session events |
| `tool_result` | 1 | knowledge | `tools/result` (observe) or `tools/post-execute` (change) |
| `before_provider_request` | 1 | model settings | `agent/request` waterfall |
| `session_before_compact` | 1 | auto-compaction | `ctx.compaction` backend; `agent/pre-step` pressure check |
| `ui_prompt_start` / `_end` | 2 | ask relay | `dsh-user-questions` waterfall |

## API calls

| pi call | Uses | dsh replacement |
|---|---|---|
| `pi.registerTool` | 20 | `ctx.tools.register(defineTool(...))` |
| `pi.sendUserMessage` | 17 | `agent.followup(createUserMessage(...))` |
| `pi.sendMessage` | 1 | `agent.inject()` |
| `pi.appendEntry` | 2 | own durable records via `session/event` declaration merge, or Bot Lobby's state files |
| `pi.registerCommand` | 2 | `ctx.commands` |
| `pi.registerShortcut` | 3 | none (terminal only, drop) |
| `pi.registerEntryRenderer` | 1 | none (terminal only, drop) |
| `pi.setModel` / `setThinkingLevel` / `getThinkingLevel` | 3 | agent model selection + reasoning options |
| `ctx.ui.notify` | 77 | Bot Lobby web UI toasts (already exist) |
| `ctx.ui.select` / `confirm` | 2 | `dsh-user-questions` |
| `ctx.ui.setStatus` | 3 | drop, or web UI status |
| `ctx.sessionManager.getSessionId` | ~47 | `SessionId` from the agent handle |
| `getBranch` / `buildContextEntries` / `getLeafId` | 4 | session projection / session-query (no matching branch API found) |
| `switchSession` / `newSession` | 2 | `ctx.agents` create / resume |
| `ctx.modelRegistry.*` | 5 | `ctx.llm` + credentials service (keys move; users sign in again) |
| `CONFIG_DIR_NAME` | many | our own constant (`.bot-lobby`) |

## Processes

| Today | dsh |
|---|---|
| `pi --mode rpc --extension src/index.ts` child per worker | in-process `spawn` child with a role preset (live events via `session/event`, to confirm in the spike), or `dsh-sdk` child (separate process, final text only) |
| `steer` over RPC stdin | `agent.steer()` |
| `BOT_LOBBY_*` env vars to mark a subagent | preset id / agent options instead of env |
| `src/harness/*` (codex, claude, claude-sdk, acp) | `dsh-subagent-codex`, `-claude-code`, `-acp` |

## Files that change

Host layer (rewrite): `src/pi/*` (24 files), `src/index.ts`, `src/lobby/runtime.ts`, `service.ts`, `pi-commands.ts`, `src/execution/pi-runner.ts`, `delegation.ts`, `src/ask/*`, `src/desk/client-extension.ts`, `board-client.ts`, `src/classifier/instance.ts`, `models.ts`, `tools.ts`, `src/knowledge/catalog-tools.ts`, `src/web/tools.ts`, `src/webui/command.ts`.

Unchanged (no pi imports): `state`, `schemas`, `workflow`, `master`, `roles`, `delivery`, `agents`, `scripts`, most of `classifier`, `knowledge`, `execution`, `webui`, and the whole React app in `webui/src` (~20k lines).

## Other services

| Bot Lobby today | dsh |
|---|---|
| `bindGrants` lists pi's MCP tools and skills | `dsh-mcp-manager`, `dsh-skill` |
| `src/web/fetch.ts` (blocks private addresses) | keep ours; `dsh-web-fetch-http` has no private-address block |
| data in `~/.pi/bot-lobby` and project `.pi/` | own folder (for example `~/.bot-lobby`), one-time copy |
| `src/webui/auth.ts` token | dsh web server connection check if mounted at `/lobby` |
| ask relay to our questionnaire | Bot Lobby UI registers as the `dsh-user-questions` listener |
