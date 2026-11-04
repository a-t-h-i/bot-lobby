# Lookup tables: what replaces what

Checked on Bot Lobby main `3c33033` and dsh main `8bd07339`. "Phase" is where the spec builds it. Confirm every dsh name with `cordis_inspect_query` before use (builder rules, section B).

## Words

| pi / Bot Lobby | dsh |
|---|---|
| agent run (`agent_start` … `agent_end`) | turn (`turn/start` … `turn/end`) |
| turn (`turn_end`) | step (`step/start` … `step/end`) |
| session entry | session event |
| extension | plugin (in a bundle) |
| oracle | orchestrator (a session with the `bot-lobby` preset) |
| subagent process (`pi --mode rpc`) | subagent (`ctx.subagents`, `spawn` backend) |
| `BOT_LOBBY_*` env vars per child | `RunSettings` per child session id (phase 03) |

## pi hooks and calls

| pi | Bot Lobby use | dsh | Phase |
|---|---|---|---|
| `pi.extensions` entry | load Bot Lobby | bundle `cordis.patch.yml` row + `apply(ctx)` | 02 |
| `session_start` | turn on, status, owner loop | agent setup in `agent/created` | 03, 04 |
| `session_shutdown` | cancel runs, stop loops | `agent/disposed` | 04 |
| `before_agent_start` | master prompt, tool list | `agent.ctx.systemPrompt.section(...)`, `agent.ctx.tools.restrict(...)` | 03 |
| `agent_start` / `agent_end` | task clocks, busy flags | `agent/status` running; session event `turn/end` | 04 |
| `turn_end` | step bookkeeping | session event `step/end` | 04 |
| `tool_call` | gates | `tools/pre-execute` → deny; terminate → `agent.cancel({ kind: "hook" })` | 03 |
| `tool_execution_start` / `_end` | clocks, activity | session events `tool/call` / `tool/result` | 04, 05 |
| `message_update` / `message_end` | narration | dropped: dsh shows the orchestrator natively | 04 |
| `pi.registerTool` | Bot Lobby tools | `agent.ctx.tools.register(dshTool(...))` | 03 |
| `pi.registerCommand` | `/bot-lobby` | `ctx.commands.register(...)` | 03 |
| `pi.sendUserMessage` | queue work for the orchestrator | `agent.steer(...)` running / `agent.followup(...)` idle | 04 |
| `ctx.ui.notify` | notices | `notify()` → dsh toast | 03, 08 |
| `ctx.ui.setStatus` | status line | in-memory status → task dock | 04, 08 |
| `ctx.ui.select` / `editor` / `confirm` | engine prompts | Bot Lobby `promptHub` → questionnaire | 08 |
| `ctx.modelRegistry` | models, keys, classifier calls | `ctx.llm` (`listProviders`, `listModels`, `resolveModelInfo`, `stream`) | 06 |
| thinking levels | effort | `AgentOptions.reasoningEffort` from the model's `reasoning.efforts` | 06 |
| auto compaction at "Compact at" | compaction, knowledge | `dsh-compaction-basic` + `agent/pre-step` → `ctx.compaction.compactNow`; `compaction/summary` → digest | 06 |
| `runPiAgent` / `spawnPiProcess` | start a subagent | `launchAgent` → `dshLauncher` → `ctx.subagents.startActivation` | 05 |
| RPC steer | steer a worker | `ctx.subagents.prompt({ delivery: "steer" })` | 05 |
| `src/ask/relay.ts` | child questions | gone: one process, `promptHub` with owner session | 05, 08 |
| `src/harness/*` | Codex, Claude Code, ACP | `dsh-subagent-codex`, `-claude-code`, `-acp` backends | 05 |
| `~/.pi/bot-lobby`, `<project>/.pi/bot-lobby` | data | `~/.bot-lobby`, `<project>/.bot-lobby` (copied once) | 09 |

## Screens

| Bot Lobby screen | After the port | Slot / source | Phase |
|---|---|---|---|
| Lobby chat feed and composer | dsh conversation of a `bot-lobby` session | dsh | 04 |
| Slash command tray | dsh command tray with `/bot-lobby` | `ctx.commands` | 03 |
| `@mention` tray | dropped; chat agents reached through the orchestrator or commands | phase 03 command list | 03 |
| Sessions sidebar, new / switch / rename / archive / delete | dsh sessions | dsh | none |
| Background sessions | dsh sessions (each runs on its own) | dsh | none |
| Tasks tab | Tasks panel | `sidebar.panellist` + `main` | 08 A |
| Plan tab | Plans panel | `sidebar.panellist` + `main` | 08 B |
| Plan sheet | right pane tab | `sidebar.right.pane.tab` | 08 B |
| Knowledge tab | Knowledge panel | `sidebar.panellist` + `main` | 08 C |
| Task card in the Lobby | task dock | `conversation.input.dock` | 08 D1 |
| Session files card | second fold of the task dock | `conversation.input.dock` | 08 D1 |
| Tool rows for `start_task`, `orchestrate`, `delegate_subtasks` | Bot Lobby tool cards | `tool.call.toolview` | 08 D2 |
| Live agent lines (role word, activity, thought) | **kept design**: turn tail, tool cards, Tasks rows | `conversation.chat.turnTail` | 07, 08 D3 |
| Working mark on session rows | **kept design** on dsh session rows | `sidebar.session.row.leading` | 08 D4 |
| Questionnaire drawer with mockups | **kept design** in place of the composer | `conversation.composer` chain + `registerPendingInteraction` | 08 E |
| Settings tab | Bot Lobby settings sections | `settings.section` | 08 F |
| Toasts (goo bubble) | dsh toasts | `workspace.toast` | 08 G |
| Code viewer | dsh files / changes pane | dsh | none |
| Terminal drawer and pop-out | dsh terminal pane | dsh | none |
| Project picker | dsh workspaces | dsh | none |
| Theme picker, themes, fonts, 90% scale | dsh theme | dsh | none |
| Login page, PWA, icons | dsh | dsh | none |
| Lightbox | dsh image view | dsh | none |

## Host API calls (`/api/<name>` → `/bot-lobby/api/<name>`)

Kept: `status.get`, `tasks.*`, `plans.*`, `planner.*`, `knowledge.*`, `settings.get|set|linters|lintSetup|lintRule|lintCreate|grants|harnesses`, `prompts.list|answer|dismiss`. New: `GET events` (SSE), `GET prompt-image`.

Dropped (dsh has them): `lobby.*`, `sessions.*`, `terminal.*`, `code.*`, `projects.*`, `themes.*`, `files.upload`. See phase 07 step 1.
