# Sources read (2026-11-03)

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

Earlier project notes:
- 2026-11-02 verdict "stay on pi" (thread "Assess migrating Bot Lobby to DeepSeek harness")
