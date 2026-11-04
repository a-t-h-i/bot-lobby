# 05. Subagents on dsh (size: large)

## Goal

Every agent Bot Lobby starts besides the orchestrator is a dsh subagent: scouts, researcher, workers, reviewers, QA, design, planner seats, Lobby chat agents (`@mention`). Third-party agents (Codex, Claude Code, Gemini, OpenCode, Antigravity, custom ACP) run through dsh's subagent backends. The master and workflow logic do not change.

## Read first

- `src/execution/pi-runner.ts`: `PiRunOptions`, `PiRunResult`, `PiStreamEvent`, `RunHandle`, `RelayAsk`, `runPiAgent`, `runAssignedAgent`, `MAX_THOUGHT_CHARS`
- `src/execution/agent-runner.ts` (`runAgent`, `runParallel`, `cancelAllRuns`), `src/execution/delegation.ts` (`delegationHost`: tools, env, note, nested children)
- callers that pass a `ProcessRunner`: `grep -rn "ProcessRunner\|spawnPiProcess\|runPiAgent" src` (master, research, planner, chat-agents, pi/tools)
- `src/execution/assigned-session.ts` (one task conversation reused across assignment revisions)
- `src/harness/runner.ts`, `src/harness/catalog.ts` (which harnesses exist and their settings)
- dsh `packages/subagent/subagent/src/types.ts` (`SubagentActivationSpec`, `SubagentStartRequest`, `SubagentActivation`, `SubagentResult`), `src/index.ts` (`startActivation`, `prompt`, `interrupt`, `registerProvider`)
- dsh READMEs: `subagent-spawn-in-process`, `subagent-codex`, `subagent-claude-code`, `subagent-acp`

## Step 1. Rename the run types (no pi in the names)

In `src/execution/`: create `agent-run.ts` and move these types there with new names. Keep old names as `type` aliases until phase 09 so the diff stays small.

| Old (`pi-runner.ts`) | New (`agent-run.ts`) |
|---|---|
| `PiRunOptions` | `AgentRunOptions` |
| `PiRunResult` | `AgentRunResult` |
| `PiStreamEvent` | `AgentStreamEvent` (same union, same `type` strings) |
| `RunHandle`, `RelayAsk`, `MAX_THOUGHT_CHARS` | same names |

## Step 2. One launch point

Create `src/execution/launcher.ts`:

```ts
export type AgentLauncher = (options: AgentRunOptions) => Promise<AgentRunResult>;
let launcher: AgentLauncher | undefined;
export function setAgentLauncher(next: AgentLauncher | undefined): void { launcher = next; }
export function launchAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  if (!launcher) throw new Error("Bot Lobby: no agent launcher (is the dsh plugin loaded?)");
  return launcher(options);
}
```

Change every caller of `runPiAgent(options, run)` to `launchAgent(options)`. Where a function takes a `run: ProcessRunner` parameter only to pass it down, remove the parameter. Tests that passed a fake `run` now call `setAgentLauncher(fake)` in `beforeEach` and `setAgentLauncher(undefined)` after. The old `runPiAgent` and `spawnPiProcess` stay in `pi-runner.ts`, unused, until phase 09.

## Step 3. The dsh launcher: `src/plugin/launcher.ts`

`dshLauncher(ctx): AgentLauncher`. For one `AgentRunOptions`:

1. **Third-party harness?** If `options.harness` is set, go to step 9.
2. **Prepare** exactly as `runPiAgent` does today: `delegationHost(options)` gives the tool list, MCP tools, settings for children and the delegation note. Keep that call; drop only the parts that wrote pi argument files.
3. **Settings for the child.** `const childId = brandString<SessionId>(randomUUID())`. `runSettings.put(childId, settingsFrom(host, options))` (phase 03 `RunSettings`, filled from what `delegationHost` used to put in `env`). Also store `{ systemPrompt, tools, skills }` for this child in the same entry.
4. **Parent.** The orchestrator agent that owns the task: `ctx.agents.get(task.ownerSessionId)`, or the agent of the session that started the planner / chat agent. If there is none (for example a task resumed with no open session), create a standalone agent with `ctx.agents.create({ sessionId: childId, meta: { cwd, agentPreset }, agentOptions })` instead of a subagent, and run steps 6-8 on it.
5. **Start:**
   ```ts
   const activation = await ctx.subagents.startActivation({
     provider: "spawn", label: `${options.agent?.role ?? "agent"} · ${options.agent?.taskId ?? ""}`,
     childId, delivery: "caller", parent, signal, cwd: options.cwd,
     agentPreset: options.autoCompact === false ? "bot-lobby-agent-nocompact" : "bot-lobby-agent",
     agentOptions: modelOptions(options.model, options.thinking),
     prompt: [{ type: "text", text: `Task: ${options.task}` }],
   });
   ```
   `delivery: "caller"` returns the result to Bot Lobby without adding a message to the parent's conversation.
6. **Per-child setup** happens in phase 03's `agent/created` hook, which now also reads the stored `{ systemPrompt, tools, skills }`:
   - `agent.ctx.systemPrompt.section({ name: "bot-lobby:role", order: 900, interpolate: false, text: systemPrompt + "\n\n" + delegationNote })`
   - `agent.ctx.tools.restrict({ allow: tools })` (Bot Lobby tools for the child are registered by phase 03 step 4 from its `RunSettings`)
   - skills: limit to the granted skill names through dsh's skill service (inspect); if it has no per-agent filter, deny other skills in a `tools/pre-execute` gate on the skill tool and note it in `STATUS.md`
   - `compactAt`: phase 06.
7. **Live events** → `options.onEvent` and `options.onActivity`. Listen on the plugin ctx and filter by `session.id === childId`:

   | dsh | `AgentStreamEvent` |
   |---|---|
   | session event `step/start` | `{ type: "turn_start" }` |
   | `agent/assistant-stream` first `reasoning-delta` of a block | `{ type: "thinking" }` |
   | `agent/assistant-stream` first `text-delta` of a block | `{ type: "writing" }` |
   | end of a reasoning block (`block-end`) | `{ type: "thought", text }` (cut to `MAX_THOUGHT_CHARS`) |
   | session event `tool/call` | `{ type: "tool_execution_start", toolName, args }`; also `options.onActivity(activityWord(toolName))` |
   | session event `tool/result` | `{ type: "tool_execution_end", toolName, isError }` |
   | `usage` chunk or `assistant/message` usage | `{ type: "usage", input, output, cost, model }` (cost from dsh's token meter if it has one, else 0) |
   | session events `compaction/start` / `compaction/end` | `{ type: "compaction" }` / `{ type: "compaction_end", error? }` |
   | `agent/request-error` retry | `{ type: "retry", ... }` then `{ type: "retry_end", success }` |
   | a question from this child opens / is answered (phase 08) | `{ type: "asking", questions }` / `{ type: "answered", waitedMs }` |
   | every 15 s while running with nothing else sent | `{ type: "heartbeat" }` |

8. **Steering, cancel, stall, result:**
   - `options.onStart?.({ steer: (text) => ctx.subagents.prompt({ requestId, childSessionId: childId, delivery: "steer", content: [{ type: "text", text }] }, signal) })`. Check the request fields with inspect.
   - `options.signal` aborts the activation (it was passed as `signal`).
   - Stall watchdog: no event for `stallTimeoutMs` (no tool running) or `toolStallTimeoutMs` (a tool running) → abort, result `stalled: true`. 0 or unset disables.
   - `const r = await activation.result` → `AgentRunResult`: `status` from `r.stopReason` (`error` → `failed`, aborted → `cancelled`, stalled → `timeout`, else `success`); `output` = text of `r.output`; `usage` summed from the usage events; `model` from the last `assistant/message`; `children` from `delegationHost` as today.
   - Always `await activation.dispose()` and `runSettings.take(childId)` in `finally`.
9. **Third-party harnesses.** Map `options.harness` to a dsh subagent backend and call `startActivation` with that `provider` (no `agentPreset`, the backend runs its own agent):

   | Bot Lobby harness | dsh backend | Backend config (patch row) |
   |---|---|---|
   | Codex CLI | `@deepseek-ai/dsh-subagent-codex` | `providerName: bot-lobby-codex`, `model`, `permissionMode` |
   | Claude Code | `@deepseek-ai/dsh-subagent-claude-code` | see its README |
   | Gemini CLI, OpenCode, Antigravity, custom ACP | `@deepseek-ai/dsh-subagent-acp` | one row per harness: `providerName: bot-lobby-<id>`, `command`, `args`, `env`, `permission: allow` |

   Add these rows to `cordis.patch.yml`, built from today's defaults in `src/harness/catalog.ts`. Settings → Harnesses (phase 08) edits them through dsh's config editor (`references/host-plugin.md`, "Persist your own configuration"). If a backend gives no live events, the Tasks page shows only start / end for that agent; note which in `STATUS.md`.
10. **Assigned task conversation** (`options.assignedSession`): keep one child per assignment. Save the child session id in `<assigned task dir>/sessions/dsh-child-id`. On the next revision, if that child still exists, send the new assignment with `ctx.subagents.prompt(...)` (delivery `queue`) and await its next result; if not, resume it with `ctx.agents.resume({ resumeSessionId })` as a standalone agent; if that fails, start fresh. Keep `openAssignedSession`'s checks.

## Step 4. Questions from subagents

Today a subagent's `ask_user_question` is relayed to the parent process (`src/ask/relay.ts`) and the engine's `onAsk` shows it. On dsh every agent runs in one process, so every agent's `ask_user_question` goes straight into Bot Lobby's prompt queue (`promptHub`, phase 08 Part E), tagged with the owner session from `RunSettings`. So:

- `options.onAsk` is no longer called. Keep the parameter until phase 09.
- Put `ownerSessionId` in `RunSettings` (the orchestrator session of the task) so phase 08 shows the question in that session.
- `src/ask/relay.ts` is deleted in phase 09.

## Step 5. Desk and board

The file desk (`src/desk/`) lets parallel workers claim files; the board lets them post notes. They talk over local IPC (`src/desk/ipc.ts`). That works unchanged in one process: the master starts the desk, workers' tools connect using `run.desk` / `run.board` from `RunSettings`. Do not rewrite it in this phase.

## Step 6. Wire it

In `src/plugin/index.ts`: `setAgentLauncher(dshLauncher(ctx))` inside `ctx.effect`, returning `() => setAgentLauncher(undefined)`. Declare `subagents` in `inject`.

## Tests

- `test/plugin-launcher.test.ts` with a fake `ctx.subagents` whose activation emits scripted dsh events through a fake `ctx.on`: event mapping order; `delivery: "caller"`; preset chosen by `autoCompact`; result mapping for success, error, abort, stall; `dispose` and `runSettings.take` always run.
- `test/plugin-harness.test.ts`: each harness id maps to the right provider name.
- All existing master / workflow tests pass with a fake launcher.

## Done when

- [ ] Typecheck, build, tests pass.
- [ ] In dsh: a small task ("add a line to the README") runs scout → worker → review → QA to done.
- [ ] dsh's subagent UI shows the children under the session; Bot Lobby's run records (task file) have each agent's activity and thoughts.
- [ ] Steering a worker changes what it does; cancelling the task stops all its children within a few seconds.
- [ ] A worker's `ask_user_question` reaches the user (`prompts.list` for the owner session returns it; the questionnaire UI comes in phase 08).
- [ ] If Codex or Claude Code is installed, a task step assigned to it runs.

Commit: `dsh port: phase 05 subagents`.
