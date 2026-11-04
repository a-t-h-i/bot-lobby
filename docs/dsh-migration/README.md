# Moving Bot Lobby to a DeepSeek Harness (dsh) plugin

Written 2026-11-03, reviewed 2026-11-04. Bot Lobby main at `3c33033` (v0.7.9, pi 1.4). dsh main at `8bd07339`, npm `latest` 0.2.1-rc.5, `alpha` 0.2.2-alpha.3.

Files in this folder:

- `README.md`: this summary and the step-by-step plan
- `mapping.md`: every pi hook Bot Lobby uses and what it becomes in dsh
- `risks.md`: what is missing, what could break, and open questions
- `sources.md`: what was read

## Short answer

It can be done, and dsh now has a home for nearly every piece. The engine (tasks, roles, master, classifier, knowledge, state, web tools) has no pi imports and moves as is. Only the "host layer" changes: about 34 files that talk to pi, mostly `src/pi/`, plus `src/lobby/` and the subagent runner.

The web UI stays. It is served by Bot Lobby's own server today, and in dsh it can be mounted on dsh's web server under `/lobby` (or keep its own port). We do not rebuild it inside dsh's own web client.

Rough size: 5 to 6 weeks of work (about 29 working days, split below) for one agent-heavy thread, most of it in the subagent runner and the Lobby chat driver. Do a 2-day spike first (step 0) to check the risky part before committing.

What you gain: less code to own (dsh already does subagents, Codex/Claude Code/ACP runners, worktrees, compaction, commands, user questions), config hot reload, dsh's desktop app and SDK, and first-class DeepSeek models. What you do not gain: speed. dsh publishes no speed numbers.

Main risk: dsh is still a developer preview. Its README says "THERE WILL BE COMPATIBILITY-BREAKING CHANGES", and the latest alpha alone ships 18 upgrade notes. We should pin an exact dsh version and keep the pi build working until dsh hits 1.0.

## What maps cleanly

| Bot Lobby today (pi) | In dsh |
|---|---|
| `pi.registerTool` (20 tools) | `ctx.tools.register(defineTool(...))` |
| Blocking tool calls (`tool_call`: grants, assignment guard, tool budget) | `tools/pre-execute` decisions, `ctx.tools.guard()` for hard denials, `ctx.tools.restrict()` per agent |
| Prompt injection (`before_agent_start`) | `ctx.systemPrompt.section()` and `agent/pre-step` |
| Request tweaks (`before_provider_request`) | `agent/request` waterfall |
| Streaming events (`message_update`, `tool_execution_*`, `turn_end`, `agent_end`) | `agent/assistant-stream` (live) + `session/event` (saved) + `agent/status` |
| `pi.sendUserMessage` (17 calls) | `agent.followup()` |
| Steering a running agent | `agent.steer()` |
| `registerCommand` (slash commands) | `ctx.commands` |
| Ask tool / questionnaire relay | `dsh-user-questions` (+ `ctx.approval` for permission asks) |
| Compaction hook (`session_before_compact`) | `ctx.compaction` seam; write our own small backend or keep `dsh-compaction-basic` |
| Classifier's model calls (`modelRegistry.streamSimple`) | `ctx.llm`; dsh even ships `dsh-llm-pi-ai` (pi-ai ^1.3, our 1.4 fits) |
| Codex / Claude Code / ACP harness runners (`src/harness`) | `dsh-subagent-codex`, `dsh-subagent-claude-code`, `dsh-subagent-acp` (could delete most of `src/harness`) |
| Role agents (oracle, planner, workers, QA) | agent presets (`dsh-agent-preset-registry`): tools, prompt sections and skills per role |
| Worktrees (off by default) | `ctx.worktrees` (experimental package) |
| Bot Lobby HTTP server | `ctx.webServer` prefix route, or keep our own server |
| npm package with `pi.extensions` | npm "bundle" with `dsh.bundle` + `cordis.patch.yml`, installed with `dsh plugin add` |

## What does not map, or needs real work

1. **Subagents as separate pi processes.** Today each worker is a `pi --mode rpc` child with our extension loaded, its own tool list, steering over stdin, and file desk/board tools. In dsh the closest fits are in-process children (`spawn` backend, fast, share one Node process) or `dsh-sdk` children (separate process, but the parent only gets the final text, not the live tool stream our Tasks page shows). Biggest rewrite: `src/execution/pi-runner.ts` and friends.
2. **Live activity for the UI.** Our Lobby and Tasks pages read pi's RPC event stream. In-process children give us `session/event` directly, which is good, but every event name and shape changes, so `lobby/runtime.ts`, `pi/activity.ts` and `pi/run-summary.ts` need new adapters.
3. **Terminal UI bits.** `registerShortcut`, `registerEntryRenderer`, pi-tui tool renderers and `ctx.ui.setStatus` have no dsh match. They only serve pi's terminal view, so drop them.
4. **Session control.** `sessionManager.getBranch()`, `buildContextEntries()`, `switchSession`, `newSession` become `ctx.sessions` / `ctx.agents` create and resume, plus the session-query service. dsh sessions are an event log and I found no branch API to match pi's, so session switching needs a rethink.
5. **Model and effort picker.** `pi.setModel` / `setThinkingLevel` become per-agent model selection and reasoning options. The effort slider still works but needs rewiring.
6. **Web tools.** dsh now ships `web_search` and `web_fetch` (`dsh-tool-web` + `dsh-web-fetch-http`). Its fetch keeps redirects on the same site but does not block local or private addresses. Ours does (`src/web/fetch.ts`, `isPrivateAddress`), so keep ours.
7. **Saved data.** Bot Lobby keeps its data under `~/.pi/bot-lobby` and each project's `.pi/` folder. On dsh that path should move (for example `~/.bot-lobby` and `.bot-lobby/`). Existing tasks, plans, knowledge and settings need a one-time copy, and the pi build must still find them.
8. **Sign-in and API keys.** Today the classifier and compaction read pi's stored keys (`modelRegistry.getApiKeyForProvider`). dsh keeps keys in its own credentials service and refers to them by env-var name. Settings needs a new "where your keys live" path, and users sign in again once.
9. **MCP tools and skills grants.** Settings lists the session's MCP tools and skills from pi (`bindGrants`). On dsh these come from `dsh-mcp-manager` and `dsh-skill`. Grants keep working, but the list source changes.
10. **Questions in our UI, not dsh's.** dsh's question flow goes to whatever UI listens. Bot Lobby's web UI must register as that listener so the questionnaire still shows in the Lobby, and dsh's own web client should not also answer it.
11. **Web server login.** dsh's web server checks a connection token before serving pages. If the Lobby mounts at `/lobby`, our UI and its event stream must pass that check (or we keep our own port and our own `auth.ts`).
12. **Tests.** 31 of 156 test files import pi directly. They need a fake host so the engine tests run on both hosts.

## Plan, step by step

Each step ends in something that runs.

0. **Two-day spike (go / no-go).** Before anything else, prove the riskiest bit in a throwaway folder: start one in-process dsh child with a custom preset and tools, show its live tool calls and text in Bot Lobby's Tasks page, steer it mid-run, and answer one question from it in our questionnaire. If any of that fails, stop and stay on pi. Nothing in the main code changes.
1. **Split host from engine (stays on pi).** Add a small `host` interface (send message, steer, register tool, gate tool, add prompt section, stream events, ask user, run subagent) and move every pi call behind it in `src/host/pi/`. No behaviour change. This step is worth doing even if we never ship on dsh.
2. **Bare dsh bundle.** New package folder (for example `dsh/`) with `dsh.bundle`, a `cordis.patch.yml`, and one plugin that loads the engine and mounts the web UI at `/lobby` on `ctx.webServer`. Pin one exact dsh version.
3. **Tools and gates.** Port the 20 tools with `defineTool`, then grants, assignment guard and tool budget on `tools/pre-execute` / `ctx.tools.guard()`.
4. **Lobby chat driver.** Orchestrator becomes a dsh agent with a Bot Lobby preset. `followup` / `steer` replace `sendUserMessage`. Map `session/event` + `agent/assistant-stream` to the events the web UI already understands, so the UI does not change.
5. **Subagents.** Roles become presets. Start with the in-process `spawn` backend and its live events; keep `dsh-sdk` as an option for isolation. Port desk, board and the ask relay. Swap `src/harness` for dsh's Codex, Claude Code and ACP backends where they match.
6. **Classifier, compaction, model picker.** Classifier on `ctx.llm`; compaction on `ctx.compaction` (keep our per-agent "Compact at"); model and effort through agent model selection.
7. **Parity pass.** Run a real task end to end on both hosts, compare Lobby, Tasks, Plan, Knowledge, Settings. Fix gaps.
8. **Ship side by side.** Publish the dsh bundle next to the pi extension. Keep pi as default until dsh is 1.0 and has been stable for a few releases.

Steps 1 to 3 are low risk. Steps 4 and 5 are where most of the time goes.

Rough split: spike 2 days; step 1 about 4 days; steps 2-3 about 4 days; step 4 about 5 days; step 5 about 7 days; step 6 about 3 days; steps 7-8 about 4 days.

## Suggestions

- **Do step 1 now, whatever you decide.** The host interface makes Bot Lobby easier to test and keeps the door open to dsh (or any other host) without a big-bang rewrite.
- **Pin and watch.** Pin one exact dsh version in the bundle. Before each dsh upgrade, read its `docs/upgrade-guide/<version>/` notes and run the parity task from step 7.
- **Keep the switch reversible.** Same engine, same data folder layout, same web UI on both hosts. If dsh breaks, users go back to pi with no data loss.
- **Don't port terminal-only features.** They were for pi's TUI; the web UI already covers them.
- **Revisit at dsh 1.0.** If dsh ships 1.0 with a stable plugin API, make it the default host then.
