# bot-herdr build status

Branch `herdr-port` (from main `94b436a`). Owner changes since the spec: no backup web app; the herdr mod is the only UI (2026-11-04).

## Phase 01: spike

Run 2026-11-04 in a Linux cloud container: Claude Code 2.1.318, Node 22. Codex, Gemini CLI, OpenCode not installed there. herdr-app can't run there (no desktop or Vulkan), so part B checks that need the app are left for the owner's machine.

### Part A (harness as Orchestrator), `spike/mcp-orchestrator.mjs`

| # | Result | What I saw |
|---|---|---|
| A1 | pass | `claude -p --input-format stream-json --output-format stream-json --verbose --mcp-config <file> --strict-mcp-config --allowedTools mcp__bot-lobby__ping,mcp__bot-lobby__ask --tools ""`: calls `mcp__bot-lobby__ping`, result and reply arrive in the stream (1.5 s) |
| A2 | pass | `--resume <session_id>` with a new message: "The secret word is MARMALADE" (remembered) |
| A3 | pass, with a setting | `MCP_TOOL_TIMEOUT=86400000` alone does **not** help: the call fails at 60 s ("timed out after 60s"), same with `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=0`. What works: a per-server `"timeout": 86400000` (ms) in the MCP config entry. The 180 s `ask` then returned normally. Also: when `CLAUDE_AUTO_BACKGROUND_TASKS` is set, Claude Code moves a call still running after 120 s to the background and ends the turn; the daemon must not set it (it was inherited from the container) |
| A4 | pass (Claude Code) | A second stream-json user message written to stdin 5 s into a turn (while `ask` waited) was taken into the same turn: the final reply ended with "STEERED". Codex `exec` and ACP: queue only (per spec, not tested here) |
| A5 | not run | Codex, Gemini CLI, OpenCode not installed in the container |
| A6 | plan, not extra usage (here) | Both `claude -p` and the Agent SDK `query()` reported `apiKeySource: none` and a `rate_limit_event` with `rateLimitType: five_hour`, `isUsingOverage: false`, `overageStatus: rejected` (`out_of_credits`): turns drew from the plan's 5-hour / 7-day windows, and extra usage was off. Caveat: this is the cloud container's sign-in. Owner should confirm on their own machine (command below) |

Owner check for A6 on your computer: `claude -p "say hi" --output-format stream-json --verbose | grep -o '"isUsingOverage":[a-z]*'` should print `false`.

### Part B (mod reads the API), `herdr/mods/bot-herdr/lib/` + `test/herdr-client.test.ts`

| # | Result | What I saw |
|---|---|---|
| 1 | owner | Needs herdr (`spaces()`) |
| 2 | pass (Node) | Pure-JS HMAC-SHA256 over `createHash` (`lib/hmac.js`) equals the server's `sessionValue` for 20 random secrets. herdr's `crypto` (0.1.13 typings) has `createHash`, `randomBytes`, `webcrypto`; no `createHmac` |
| 3 | owner | Needs herdr `fetch` |
| 4 | pass (Node) | `lib/sse.js` reads a chunked Node `text/event-stream` fed 7 bytes at a time (head, chunk sizes, split frames, `:ping`, UTF-8). herdr's `net` (0.1.13) is promise-based: `connect(host, port): Promise<Socket>`, `socket.read(): Promise<Uint8Array \| null>`, `socket.write(text): Promise<void>` (spec phase 01 assumed callbacks) |
| 5-7 | owner | Need the app (markdown, textarea, copies) |
| 8-10 | owner | nice-to-have |

## Phase 02: engine daemon (done)

- Baseline: main `94b436a` already had 12 failing tests (13 names, listed by `node --test`); they are not from this work.
- `src/host/api.ts` is the Host interface: pi's extension API shape (events, tools, commands, session entries), so engine logic is unchanged. Final list: `on`, `registerTool`, `registerCommand`, `registerShortcut` (no-op), `sendUserMessage`, `sendMessage`, `appendEntry`, session name, active tools, `getAllTools`, `getCommands`, model and thinking; context: `cwd`, `ui` (notify, questions through the Lobby's prompt hub), `sessionManager`, `isIdle`, `abort`, `newSession`, `switchSession`, `complete` (one-shot model call).
- Step 1 (PiHost) was skipped: pi is removed outright (owner), so the engine went straight to the daemon host.
- `bot-lobby serve [--project] [--port]` (`src/daemon/main.ts`, `npm run serve`): lock `<project>/.bot-lobby/daemon.lock`; a second serve prints the first one's port.
- Data: `~/.bot-lobby` and `<project>/.bot-lobby`, copied once from `~/.pi/bot-lobby` and `<project>/.pi/bot-lobby`. Lobby chats: `<project>/.bot-lobby/chats/*.jsonl` (pi's session format).
- OSC 7501 status (`src/daemon/herdr-status.ts`): not checked in a real herdr tab yet (no herdr here). `HC_TERMINAL_ID` assumed from the spec.

## Phase 03: Orchestrator on a harness (Claude Code done)

- `src/daemon/mcp/` serves Bot Lobby's tools over MCP (revived bridge). Claude Code needs the per-server `"timeout"` for long calls.
- Found: Claude Code silently drops an MCP tool whose schema is not JSON Schema 2020-12. `orchestrate` used draft-07 tuples (`items: [...]`); `mcpSchema()` converts them to `prefixItems`.
- Checked in the container (Claude Code 2.1.318): `lobby.send` → reply in the feed; second message remembers the first (resume); `start_task` → task in `tasks.list`; `/task … fast track, auto mode` → Orchestrator delegates to DEV (a Claude Code worker, haiku) → README edited → task completed. No pi anywhere.
- Steering: Claude Code takes a message mid-turn (stdin stays open). Codex and ACP orchestrators: not built yet (only Claude Code can host the Orchestrator; the others still run workers).
- `master.harness` / `master.harnessModel` and the planner's are now kept by the config (were pi-only).
