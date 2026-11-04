# Sources read (2026-11-03 to 2026-11-04)

Bot Lobby (github.com/a-t-h-i/bot-lobby, main `3c33033`):
- `package.json`, `src/index.ts`, `src/execution/pi-runner.ts`
- every `pi.on`, `pi.*`, `ctx.ui.*`, `ctx.sessionManager`, `ctx.modelRegistry` use in `src/` (counted with grep)
- line and import counts per `src/` folder

DeepSeek Harness (github.com/deepseek-ai/deepseek-harness, main `8bd07339`; npm `@deepseek-ai/dsh`):
- `README.md`, `SAFETY.md`, `apps/cli/README.md` (from the npm package)
- `docs/user/develop/basic/index.md`, `tool.md`, `publish.md`
- `docs/user/develop/framework/events.md`
- `docs/agent-lifecycle.md`, `docs/cookbook/extension-cookbook.md`
- `docs/subsystems/`: `web-server`, `client-modules`, `slots`, `subagent`, `agent-team`, `worktrees`, `user-questions`, `commands`, `compaction`
- package READMEs: `llm/llm-pi-ai`, `preset/agent-preset-registry`, `subagent/subagent-dsh-sdk`, `subagent/subagent-spawn-in-process`
- `docs/upgrade-guide/` list (11 releases)
- Review pass 2026-11-04: `packages/web/tool-web`, `web-fetch-http`, `interaction/commands/src/index.ts`, `core/agent/src/runtime-types.ts` (`inject`), `subagent-spawn-in-process` limits, `docs/subsystems/credentials.md`, `packages/mcp`, `packages/skill`, `BENCHMARK.md` (no numbers)
- Bot Lobby: `src/state/project.ts` (data folders), `src/web/fetch.ts`, test imports
- npm dist-tags and release times

Build-spec pass 2026-11-04 (dsh main `8bd07339`):
- Creator mode: `packages/preset/agent-preset/README.md`, skill `cordis-plugin-development` (`SKILL.md`, `references/host-plugin.md`, `references/practices.md`, `templates/decoration/*`), `packages/bundle/web-app/README.md`
- `packages/core/agent/src/index.ts` (`create`, `resume`, `CreateAgentOptions`, `AgentHandle`, `AgentSetup`), `runtime-types.ts` (`Agent`, `AgentOptions`, `AgentStatus`, `agent/*` events, `AssistantStreamFrame`)
- `packages/core/tools/src/contracts.ts` + `index.ts` (`ToolDefinition`, `ToolRunContext`, `PreToolDecision`, `ToolRestriction`, `ToolGuard`, `register`, `restrict`, `guard`)
- `packages/core/system-prompt/src/index.ts` (`PromptSection`, `section()`)
- `packages/core/session/src/types.ts` (`AgentCancelCause`), `session/src/index.ts` (`session/event`)
- `packages/interaction/commands/src/index.ts`, `types.ts`; `interaction/user-questions/src/index.ts`, `types.ts`
- `packages/host/webserver/src/index.ts`, `docs/subsystems/web-server.md` (`ctx.connection`)
- `packages/llm/llm/src/types.ts`, `index.ts` (`GenerateOptions`, `stream`, chunk types)
- `packages/compaction/compaction-basic/README.md`, `src/config.ts`; `docs/subsystems/permission-presets.md`
- `packages/bundle/base/cordis.patch.yml`, `bundle/web-app/presets/standard.patch.yml`
- `packages/preset/agent-preset-registry/src/index.ts`, `subagent/subagent/src/manager.ts`
- Bot Lobby: `src/lobby/host.ts` (`LobbyService`), `src/lobby/service.ts`, `src/lobby/runtime.ts`, `src/lobby/sessions.ts` (pi RPC protocol), `src/execution/pi-runner.ts` (`buildPiArgs`, `spawnPiProcess`, `parsePiStream`, `runPiAgent`), `src/pi/events.ts`, `src/pi/auto-compaction.ts`, `src/pi/quiet.ts`, `src/webui/server.ts`, `src/webui/command.ts`, `src/webui/dev/*`, `src/webui/notices.ts`; env var and module-state greps

Version 2 pass 2026-11-04 (dsh-only, dsh UI):
- dsh client: `packages/client/web/src/platform.ts` (`PLATFORM_MODULES`), `tsdown.client.ts`, `ui-schedule/src/client/index.ts` (panel, `main`, right pane tab, turn tail, session row mark), `ui-goal` (`conversation.input.dock`), `ui-plan`, `ui-approval` (`registerPendingInteraction`, `conversation.composer` chain), `ui-user-questions`, `ui-tool` toolviews (`tool.call.toolview`), `ui-agent-preset` (`settings.section`), `ui-workspace` toasts, `ui-conversation/src/client/apply.ts` (slot kinds), slot inject counts across `packages/client/*`
- dsh host: `host/open-in-app` and `experimental/inspector` (prefix routes, `requestRejection`, `registerUpgrade`), `interaction/user-questions/src/types.ts`, `interaction/tool-ask-user/src/index.ts`, `compaction/command-compact` (`compactNow`), `llm/llm/src/types.ts` (`LlmModelInfo`, `LlmResolvedModelInfo`, `reasoning.efforts`), `core/agent/src/runtime-types.ts` (`AgentOptions`)
- Bot Lobby: `src/webui/api/index.ts` and `protocol.ts` (all API names), `src/webui/events.ts`, `src/lobby/topics.ts`, `src/ask/web.ts`, `src/ask/types.ts`, `src/classifier/models.ts`, `src/classifier/instance.ts`, `src/state/project.ts`, `webui/src/prompts/*`, `webui/src/tabs/*`, `package.json`; pi import greps per folder

Earlier project notes:
- 2026-11-02 verdict "stay on pi" (thread "Assess migrating Bot Lobby to DeepSeek harness")
