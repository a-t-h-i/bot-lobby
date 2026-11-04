# 06. Subagents and background sessions (7 days)

## Goal

Every agent Bot Lobby starts besides the orchestrator runs on dsh: scouts, researcher, workers, reviewers, QA, planner panel, Lobby chat agents, and background sessions. The engine (`src/master`, `src/execution/agent-runner.ts`, `src/execution/delegation.ts`, `src/lobby/planner.ts`, `src/lobby/chat-agents.ts`, `src/lobby/sessions.ts`) does not change except for two one-line hooks.

## The one idea of this phase: a fake pi

The engine starts every subagent through one function, `spawnPiProcess(args, options)` in `src/execution/pi-runner.ts`. It passes pi command-line arguments that Bot Lobby itself built (`buildPiArgs`), sends the task, reads pi's JSON-lines output (`parsePiStream`) and streams `PiStreamEvent`s to `options.onEvent`.

So on dsh we replace that one function with `dshProcessRunner(args, options)`: it reads the same arguments, runs an in-process dsh agent, calls `options.onEvent` with the same `PiStreamEvent`s, and returns a `ProcessOutcome` whose `stdout` contains the few JSON lines `parsePiStream` reads. To the engine it looks exactly like pi.

Background sessions work the same way through the existing `setSessionLauncher()` hook in `src/lobby/service.ts`.

## Read first

- `src/execution/pi-runner.ts`: `buildPiArgs` (lines ~332-354), `spawnPiProcess` (~499-660), `parsePiStream` (~377-406), `ProcessRunOptions`, `ProcessOutcome`, `PiStreamEvent`, `RunHandle`, `MAX_THOUGHT_CHARS`
- `src/execution/assigned-session.ts` (how a task conversation is reused across revisions)
- `src/ask/relay.ts` (`readRelayRequest`: how a subagent's question reaches the parent)
- `src/lobby/sessions.ts`: `SessionProcess`, `SessionLauncher`, `BackgroundSession` (the pi RPC commands and events it uses)
- `src/register.ts` from phase 02 (which registrations run when `host.subagent` is true)
- dsh `packages/core/agent/src/index.ts` (`create`, `resume`, `CreateAgentOptions.meta.origin`, `parentSession`, `delegationDepth`)

## Step 1. Two hooks in the engine

These are the only engine edits in this phase.

`src/execution/pi-runner.ts`:

```ts
let processRunnerOverride: ProcessRunner | undefined;
/** Another host runs subagents in its own way (the dsh bundle). Undefined restores pi. */
export function setProcessRunner(next: ProcessRunner | undefined): void { processRunnerOverride = next; }

export function spawnPiProcess(args: string[], options: ProcessRunOptions): Promise<ProcessOutcome> {
  if (processRunnerOverride) return processRunnerOverride(args, options);
  // ...existing body unchanged...
}
```

`src/lobby/service.ts` already exports `setSessionLauncher(next)`. No change needed.

Add a test in `test/` that `setProcessRunner(fake)` routes `spawnPiProcess` to `fake`, and `setProcessRunner(undefined)` restores the real one.

## Step 2. Split `registerBotLobby`

In-process subagents must not run the orchestrator's registrations again (they add global listeners such as `onTransition` once per call). Split `src/register.ts` into:

- `registerOrchestrator(host)`: everything in the old `src/index.ts` that is not guarded by `isSubagentProcess()`, plus `onTransition(...)`.
- `registerSubagent(host)`: exactly the registrations a pi subagent process gets today. On `3c33033` that is: `registerAgentPermissions`, `registerDelegation`, `registerAskTool`, `registerWebTools`, `registerDeskClient`, `registerBoardClient`, `registerClassifierTools`, `registerKnowledgeTools`, `registerToolBudget`, `registerAssignmentGuard` (auto-compaction is phase 07).
- `registerBotLobby(host)` = `host.subagent ? registerSubagent(host) : registerOrchestrator(host)`. pi keeps calling `registerBotLobby`.

Check by reading the old `src/index.ts` line by line: every call must land in exactly the same group it ran in before. `npm test` must stay green.

## Step 3. `dsh/src/subagents/args.ts`: read Bot Lobby's pi arguments

Write `parsePiArgs(args: string[]): SubagentSpec`. It only needs to understand what `buildPiArgs` writes:

| pi argument | `SubagentSpec` field |
|---|---|
| `--mode rpc`, `--no-prompt-templates`, `--no-themes`, `--extension <file>` | ignored |
| `--no-session` | `session: undefined` |
| `--session <file> --session-dir <dir>` | `session: { file, dir }` (assigned task conversation) |
| `--model <provider/id or id>` | `model` |
| `--thinking <level>` | `thinking` |
| `--no-skills` + repeated `--skill <file>` | `skills: string[]` (files) |
| `--tools a,b,c` | `tools: string[]` |
| `--no-tools` | `tools: []` |
| `--no-mcp` | `mcp: false` |
| `--append-system-prompt <file>` | `systemPrompt`: read the file's text now (the engine deletes it after the run) |

Unknown arguments: throw `Error("unsupported pi argument: <arg>")` so a future `buildPiArgs` change fails loudly.

Test: for each case in `buildPiArgs`'s own tests (`grep -l buildPiArgs test/*.ts`), `parsePiArgs(buildPiArgs(x))` gives back the same fields.

## Step 4. `dsh/src/subagents/runner.ts`: the fake pi

```ts
export function dshProcessRunner(plugin: Context, parent: () => Agent | undefined): ProcessRunner {
  return async (args, options) => { /* steps below */ };
}
```

Inside, in this order:

1. `const spec = parsePiArgs(args)`.
2. Session id: if `spec.session`, look for `<spec.session.dir>/dsh-session-id`; resume that dsh session if it exists, else create one and write its id there. Otherwise a fresh `brandString(randomUUID())`.
3. Create (or resume) the agent:
   ```ts
   const handle = await plugin.agents.create({
     sessionId,
     meta: { cwd: options.cwd, agentPreset: "bot-lobby", origin: "subagent", parentSession: parent()?.session.id, delegationDepth: depthFrom(options.env) },
     agentOptions: modelOptions(spec.model, spec.thinking),   // same table as phase 05
     setup(agentCtx, agent) {
       if (spec.systemPrompt) agentCtx.systemPrompt.section({ name: "bot-lobby:worker", order: 900, interpolate: false, text: spec.systemPrompt });
       if (spec.tools) agentCtx.tools.restrict({ allow: [...spec.tools, ...botLobbyToolNames(options.env)] });
       // skills: see step 6
     },
   });
   ```
   `botLobbyToolNames` = the Bot Lobby tools `registerSubagent` adds that pi would have loaded through `--extension` (desk, board, classifier, knowledge, ask, web, delegation) and that the engine's grant allows. Read `delegationHost` in `src/execution/delegation.ts`: the `--tools` list it builds already names them when granted, so usually `spec.tools` alone is right. Check and keep the smaller list.
4. Build the subagent Host: `dshHost({ plugin, agent: handle.agent, env: options.env ?? {}, subagent: true, side, notify })`, then `registerSubagent(host)`, then `emit("session_start", { reason: "startup" })`.
5. Questions from the subagent: the ask tool on a subagent calls `ctx.ui.editor(title, prefill)` with a relay payload. In this Host's `ui.editor`: if `readRelayRequest(title, prefill)` returns questions and `options.onAsk` is set, emit `{ type: "asking", questions: n }`, `await options.onAsk(questions, signal)`, emit `{ type: "answered", waitedMs }`, return `JSON.stringify(result)`. Otherwise return `undefined` (cancelled), like pi does.
6. Skills: if `spec.skills` is set, the agent may only load those skill files. Find the dsh skill service (`cordis_inspect_query`, Service list, look for `skills`) and its per-agent filter. If there is none at your dsh version, register a `tools/pre-execute` gate on the skill tool that denies skills not in the list, and note it in `STATUS.md`.
7. Steering: `options.onStart?.({ steer: (text) => handle.agent.steer(userText(text)) })`.
8. Events → `options.onEvent` (filter to this agent). Same dsh sources as phase 05's table:

   | dsh | `PiStreamEvent` |
   |---|---|
   | session event `step/start` | `{ type: "turn_start" }` |
   | `agent/assistant-stream` first `reasoning-delta` of a block | `{ type: "thinking" }` |
   | `agent/assistant-stream` first `text-delta` of a block | `{ type: "writing" }` |
   | end of a reasoning block (`block-end`) | `{ type: "thought", text }`, text cut to `MAX_THOUGHT_CHARS` |
   | session event `tool/call` | `{ type: "tool_execution_start", toolName, args }` |
   | session event `tool/result` | `{ type: "tool_execution_end", toolName, isError }` |
   | `usage` chunk or `assistant/message` usage | `{ type: "usage", input, output, cost, model }` (cost 0 if dsh gives none; check `token-meter`) |
   | session events `compaction/start`, `compaction/end` | `{ type: "compaction" }`, `{ type: "compaction_end", error? }` |
   | `agent/request-error` retry | `{ type: "retry", attempt, maxAttempts, delayMs, error }` then `{ type: "retry_end", success }` |
   | every 15 s while running and nothing else was sent | `{ type: "heartbeat" }` |

9. Fake pi output: for every `assistant/message`, append one line to `stdout`:
   ```json
   {"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"..."}],"usage":{"input":0,"output":0,"cost":{"total":0}},"model":"provider/id","stopReason":"stop"}}
   ```
   These are exactly the fields `parsePiStream` reads.
10. Start: `handle.agent.followup(userText(options.prompt ?? ""))`. Then wait for the session event `turn/end` of that turn (not `agent/status`; rules A.7).
11. Watchdog: if no event for `options.stallTimeoutMs` (while no tool runs) or `options.toolStallTimeoutMs` (while a tool runs), cancel with `{ kind: "hook", reason: "stalled" }` and return `stalled: true`. `0` or undefined disables, like pi.
12. Cancel: `options.signal` abort → `handle.agent.cancel({ kind: "parent" })`, return `killed: true`.
13. Return `{ exitCode: 0, stdout, stderr: "", killed, stalled }`. On a thrown error: `exitCode: 1`, `stderr` = message. Always `emit("session_shutdown")` and `await handle.dispose()` in `finally`.

## Step 5. Background sessions: `dsh/src/subagents/session-process.ts`

`BackgroundSession` talks pi RPC to a `SessionProcess` (stdin/stdout JSON lines). Implement `dshSessionLauncher(plugin): SessionLauncher` that returns an in-memory `SessionProcess`:

- It creates a full orchestrator agent (phase 05) with its own Host, side store and `env: { BOT_LOBBY_BACKGROUND: "1" }`.
- **Module state warning:** a background session on pi is a whole separate Bot Lobby. In one process it would share every module-level variable with the foreground Lobby. Before turning this on, list module-level state in `src/lobby/*.ts`, `src/pi/events.ts`, `src/execution/agent-runner.ts` (`grep -nE "^(let |const [a-zA-Z]+ = new (Map|Set))"`). If anything there is per-session, background sessions must run in a separate process: spawn `dsh --profile bot-lobby-background` (a profile with this bundle and `config.mode: "background"`), and have the plugin in that mode speak the pi RPC lines below on stdio. Choose the separate process unless the list is empty. Write the choice in `STATUS.md`.
- Commands to accept on stdin (one JSON object per line), from `src/lobby/sessions.ts`:
  - `{ type: "get_state", id }` → write `{ type: "response", command: "get_state", id, success: true, data: { sessionId, sessionName, isStreaming } }` (check the fields `BackgroundSession` reads).
  - `{ type: "prompt", message, streamingBehavior? }` → `followup`, or `steer` when `streamingBehavior === "steer"`.
  - `{ type: "abort" }` → `agent.cancel({ kind: "user" })`.
  - `{ type: "set_session_name", name }` → `host.setSessionName(name)`.
  - `{ type: "extension_ui_response", id, value | confirmed | cancelled }` → resolve the pending `ui.select/confirm/input/editor` with that id.
- Events to write on stdout:
  - `{ type: "agent_start" }` / `{ type: "agent_end" }` (dsh `turn/start` / `turn/end`).
  - `{ type: "extension_ui_request", id, method, title, options?, message?, placeholder?, prefill? }` for every `ui.select/confirm/input/editor` call, and `method: "notify"` / `"setStatus"` for those.
- `on("exit")` fires after dispose; `kill()` disposes.

## Step 6. Wire it in `dsh/src/index.ts`

After the orchestrator starts (phase 05 step 4):

```ts
setProcessRunner(dshProcessRunner(ctx, () => orchestrator?.agent));
setSessionLauncher(dshSessionLauncher(ctx));
ctx.effect(() => () => { setProcessRunner(undefined); setSessionLauncher(undefined); });
```

## Third-party harnesses

`PiRunOptions.harness` (Codex, Claude Code, Gemini, OpenCode, Antigravity, ACP) runs through `src/harness/runner.ts`, which spawns those CLIs itself and never calls `spawnPiProcess`. It works on dsh unchanged. Do not port it to dsh's `dsh-subagent-codex` / `-claude-code` / `-acp` in this phase. That is optional later work (`risks.md`).

## Tests (`dsh/test/`)

- `args.test.ts` (step 3).
- `runner.test.ts` with a fake `plugin.agents` whose agent emits a scripted set of dsh events: check the `PiStreamEvent` order, that `parsePiStream(outcome.stdout)` returns the last assistant text and summed usage, the stall watchdog, abort, and that `dispose` always runs.
- `relay.test.ts`: an `ui.editor` call with a relay payload calls `onAsk` and returns its JSON.
- `session-process.test.ts`: `get_state` → response; `prompt` → followup; `abort` → cancel.

## Done when

- [ ] All tests pass; `npx tsc --noEmit -p dsh`; pi `npm run typecheck` and `npm test` pass.
- [ ] On dsh: a small task (for example "add a README line") runs scout → worker → review → QA to done. The Tasks tab shows each agent's live activity and thoughts.
- [ ] Steering a running worker from the Tasks tab changes what it does.
- [ ] A worker's question shows in the Lobby questionnaire and its answer reaches the worker.
- [ ] Cancelling a task stops its workers within a few seconds.
- [ ] A background session started from the sidebar runs and shows working / idle.
- [ ] A task with a third-party harness agent (if one is installed) still runs.

Commit: `dsh port: phase 06 subagents and background sessions`.
