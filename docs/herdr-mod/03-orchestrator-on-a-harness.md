# 03. The Orchestrator on an installed harness

Goal: the Orchestrator (today pi's main session) becomes a session of an installed harness (Claude Code, Codex CLI, Gemini CLI, OpenCode, Antigravity, any ACP agent), driven by the daemon. Bot Lobby's tools reach it over MCP. The Lobby chat shows its replies, tool steps and thinking as today.

## Read first

- `src/harness/*` (all): `catalog.ts` (the six harnesses), `runner.ts` (`runHarnessAgent`, `HarnessAccess`), `claude.ts`, `claude-sdk.ts`, `codex.ts`, `acp.ts`, `process.ts`, `status.ts` (installed / signed in).
- The removed **oracle bridge**: commit `b72c8c3` (`src/harness/bridge/mcp-host.ts`, `mcp-stdio.mjs`, `provider.ts`, `transcript.ts`), removed in `36ea826`. Read them with `gh api "repos/a-t-h-i/bot-lobby/contents/src/harness/bridge/<file>?ref=b72c8c3" --jq .content | base64 -d`. `mcp-host.ts` + `mcp-stdio.mjs` are the reusable part: a local socket MCP server that serves Bot Lobby's tools to a harness. `provider.ts` / `transcript.ts` wrapped the harness as a pi model; that part is not needed now.
- Every tool the Orchestrator has today: `src/pi/tools.ts`, `src/pi/start-task-tool.ts`, `src/pi/delegation.ts`, `src/ask/tool.ts`, `src/web/tools.ts`, `src/knowledge/catalog-tools.ts`, `src/classifier/tools.ts`, `src/desk/*`.
- `src/lobby/feed.ts` (chat, activity, thoughts, reply), `src/lobby/service.ts`.

## Step 1. Bot Lobby MCP server (`src/daemon/mcp/`)

- Bring back `mcp-host.ts` and `mcp-stdio.mjs` from `b72c8c3`, renamed to `src/daemon/mcp/host.ts` and `src/daemon/mcp/stdio.mjs`. Change the host side: tools come from `DaemonHost.registerTool` (phase 02), and a `tools/call` runs the tool directly in the daemon (no pi turn to wait for).
- One MCP server per run, named `bot-lobby`. Each run gets a token; the stdio shim passes it, so a worker's harness only sees the tools its role allows.
- Long calls: `ask_user_question` waits for the person. Harnesses time MCP calls out (Claude Code: `MCP_TOOL_TIMEOUT`, default is short; Codex: `tool_timeout_sec` in its MCP config). Set them high for the Orchestrator (e.g. 24 h) when launching. If a harness cannot raise it, the tool returns "asked; the answer will come as your next message" at once and the daemon sends the answer as a follow-up message. Write which harness needs which in `STATUS.md`.
- Tool names: harnesses show them as `mcp__bot-lobby__<name>`. Prompts that name tools (`prompts/*`, `src/pi/tools.ts` descriptions) must say the prefixed name or a neutral wording.

## Step 2. Launching each harness with the MCP server

| Harness | Session | MCP config | Notes |
|---|---|---|---|
| Claude Code | Agent SDK `query({ resume: sessionId })` (already used in `claude-sdk.ts`), or `claude -p --resume <id> --output-format stream-json --input-format stream-json` | SDK `mcpServers: { "bot-lobby": { command: "node", args: [stdio.mjs, socket, token] } }`; CLI `--mcp-config <file>` + `--strict-mcp-config` | Drop `--no-session-persistence` for the Orchestrator so it can resume. See the billing risk in `gaps.md` |
| Codex CLI | `codex exec --json` then `codex exec resume <thread_id> --json` (`collector.session` already holds `thread_id`) | `-c 'mcp_servers.bot-lobby.command="node"' -c 'mcp_servers.bot-lobby.args=[...]'` | Check the exact `-c` syntax in `codex --help` of the installed version |
| Gemini CLI, OpenCode, Antigravity, ACP | ACP `session/new` once, `session/prompt` per turn, `session/load` after a daemon restart if the agent supports it | `session/new { cwd, mcpServers: [{ name: "bot-lobby", command: "node", args: [...] }] }` (today passes `[]`) | Check `agentCapabilities.loadSession` |

- Turn the harness's **own** built-in tools down to what the Orchestrator may use today (it delegates, it does not edit): reuse `accessOf(tools)` with the Orchestrator's allowlist.
- System prompt: the master prompt the pi extension builds in `before_agent_start` (`src/pi/events.ts`) becomes the harness's instructions: Claude `appendSystemPrompt` / `--append-system-prompt`, Codex `-c instructions=...` or a prompt prefix (as `codexArgs` does), ACP `acpPromptWithInstructions`. Rebuild it every turn (it carries live task state); for harnesses that only take it at session start, send the live part as a short preamble on each user message.

## Step 3. `OrchestratorSession` (`src/daemon/orchestrator.ts`)

Implements the `Host` methods `sendToOrchestrator`, `abortOrchestrator` and the `turnStart`/`turnEnd`/`toolStart`/`toolEnd` events.

- Keeps `{ harness, sessionId }` per Lobby session in `<project>/.bot-lobby/sessions/<id>.json`, so `sessions.new` / `sessions.switch` map to harness sessions.
- `send(text)`: if idle, start a turn (resume the session with the message); if busy, steer: Claude SDK streaming input / stream-json input accepts a new user message mid-turn; ACP has no steer, so queue it as the next turn; Codex `exec` has no steer, so queue. Say which in `STATUS.md`.
- Map the harness stream to the feed: assistant text deltas → `feed.reply`; final text → a chat message from the Master; tool calls → activity steps (`toolStart` / `toolEnd`); thinking → thoughts. The harness drivers already turn each stream into pi-shaped events for workers; reuse that mapping.
- `abort`: Claude `interrupt()`, ACP `session/cancel`, Codex kill the process.
- Compaction: the harness compacts its own session (Claude Code and Codex do). Bot Lobby's "Compact at" setting maps to the harness option where one exists (`claudeCompactSettings`); else it is ignored for the Orchestrator.

## Step 4. Pick the Orchestrator's harness

- Settings → Agents → Orchestrator gets a **Harness** picker listing installed and signed-in harnesses (`src/harness/status.ts`). Default: the first installed in this order: Claude Code, Codex CLI, Gemini CLI, OpenCode, Antigravity.
- None installed: the daemon starts, the Lobby shows "No coding agent found. Install Claude Code, Codex, Gemini CLI or OpenCode." bot-herdr can also read herdr's own `knownAgents()` and show which are installed.

## Done when

- With Claude Code installed: `bot-lobby serve`, then `lobby.send "start a task to add a README line"` → the Orchestrator answers in the Lobby feed, calls `mcp__bot-lobby__start_task`, the task appears in `tasks.list`.
- `ask_user_question` from the Orchestrator waits for `prompts.answer` and the answer reaches it.
- Same with Codex and with one ACP harness (Gemini CLI or OpenCode).
- Restart the daemon: the next message resumes the same harness session.
- `npm run typecheck`, `npm test` pass; new tests for the MCP host (list, call, token scoping) and the session store.
