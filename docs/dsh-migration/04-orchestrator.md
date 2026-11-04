# 04. The orchestrator: the Lobby chat is a dsh session (size: medium)

## Goal

A dsh session that uses the `bot-lobby` preset **is** the Lobby. The user chats in dsh's conversation view and composer. The orchestrator answers, starts tasks with `start_task`, drives them with `orchestrate`, keeps task clocks, auto mode, the task inbox and plan comments working. Subagents still fail until phase 05; that is expected.

## Words that mean different things

| pi word | dsh word | Meaning |
|---|---|---|
| agent run (`agent_start` … `agent_end`) | **turn** (`turn/start` … `turn/end`) | everything from one user message until the agent stops |
| turn (`turn_end`) | **step** (`step/start` … `step/end`) | one model reply plus its tool calls |
| session entry | session event | one saved record |
| oracle | orchestrator | the agent the user chats with |

Map pi `agent_end` → dsh `turn/end`, pi `turn_end` → dsh `step/end`. Getting this wrong breaks clocks and run summaries.

## Read first

- `src/pi/events.ts` (`registerLifecycle`: status, clocks, `before_agent_start`)
- `src/pi/owner.ts` (`registerOwner`: heartbeat, task inbox, plan comments, auto mode)
- `src/pi/start-task.ts`, `src/pi/start-task-tool.ts`, `src/pi/tools.ts` (`orchestrate`), `src/pi/task-title.ts`
- `src/lobby/runtime.ts` lines 266-353 (`registerLobbyEvents`): what the Lobby did on each pi event (naming the session, narrating activity, chat history)
- dsh `docs/agent-lifecycle.md`; `packages/core/agent/src/runtime-types.ts` (`agent/status`, `agent/turn-stopping`, `agent/inbox/claimed`)
- dsh session title: inspect `Service` list for the session title service (`dsh-session-title`)

## Step 1. `src/plugin/orchestrator.ts`

Called from `onAgent` (phase 03) when `kind === "orchestrator"`. It wires, on `agent.ctx`, the dsh replacements for each pi listener below. Write one small function per row and keep the existing engine calls inside them.

| Today (pi) | What it does | dsh |
|---|---|---|
| `events.ts` `session_start` | decide on/off, apply status | nothing to decide: a `bot-lobby` session is always on. Apply status once at setup |
| `events.ts` `agent_start` | start the task clock | `agent/status` → `running` |
| `events.ts` `tool_execution_start` / `_end` | pause clocks while asking the user; re-clock after `orchestrate` | session events `tool/call` / `tool/result` (filter `session === agent.session`) |
| `events.ts` `agent_end` | stop clocks | session event `turn/end` |
| `events.ts` `session_shutdown` | cancel runs, clear status | `agent/disposed` for this agent |
| `events.ts` `before_agent_start` | master prompt | done in phase 03 step 6 |
| `owner.ts` `session_start` / `session_shutdown` | start/stop the owner loop | at setup / `agent/disposed` |
| `owner.ts` `agent_start` / `agent_end` | owner busy flags | `agent/status` |
| `owner.ts` timer: task inbox, plan comments | pass messages left for this session's task to the orchestrator | keep the timer (`ctx.effect` + `setInterval`); deliver with `agent.followup(...)` when idle, `agent.steer(...)` when running |
| `owner.ts` auto mode | keep the orchestrator going when its turn ends before the task is done | `agent/turn-stopping` (serial): if auto mode is on for this session's task and the task is not terminal, return the continue / steer decision the event allows (check its return type with inspect) with the same nudge text `owner.ts` sends today |
| `owner.ts` `tool_call` | owner gate | add to the phase 03 gates for the orchestrator |
| `runtime.ts` `before_agent_start` | name an unnamed session from the first prompt | the dsh session title service already names sessions (`session-title-first-prompt-llm`). Drop Bot Lobby's naming |
| `runtime.ts` `message_update`, `tool_execution_*`, `message_end` | narrate the oracle's activity into the Lobby feed | dsh shows the orchestrator's text, reasoning and tool calls natively. Drop the narration. The per-agent working indicators for **subagents** come in phase 08 |
| `runtime.ts` `agent_end`, `agent_settled` | chat bookkeeping, topics bump | drop chat bookkeeping (the dsh session is the chat). Keep any task bookkeeping it triggers: read the handler and move task parts into the `turn/end` function |
| `runtime.ts` `ui_prompt_start` / `_end` | status bump while a question is open | phase 08 (question bridge) |

"Heartbeat so other windows see it running" (`owner.ts`): on dsh all sessions live in one process, so the heartbeat file is only needed if other code reads it. Search for its reader; if only the old session list reads it, drop it in phase 09.

## Step 2. Session id, project root, cwd

Engine functions take `sessionId` and `root`. On dsh:

- `sessionId` = `String(agent.session.id)`.
- `cwd` = the session's working directory (inspect `Service workingDirectory`; it can change during a session through dsh's `working_directory` tool, so read it each time, do not cache).
- `root` = `detectProjectRoot(cwd, CONFIG_DIR)` where `CONFIG_DIR` is Bot Lobby's own folder name (phase 09 moves it to `.bot-lobby`; until then `.pi`).

Write `src/plugin/session-info.ts` with `sessionInfo(agent): { sessionId, cwd, root }`.

## Step 3. `start_task` and `orchestrate`

Their bodies call `pi.sendUserMessage(...)` to queue follow-up work for the orchestrator. Replace with:

```ts
const message = (text: string) => createUserMessage({ content: [{ type: "text", text }], source: { kind: "plugin" } });
agent.status === "running" ? agent.steer(message(text)) : agent.followup(message(text));
```

Check the allowed `source.kind` values with inspect (`createUserMessage` in `@deepseek-ai/dsh-llm`). Use the kind that marks text the plugin wrote, so dsh's UI does not show it as if the user typed it. If no such kind exists, use `agent.inject(...)` + `agent.followup` of a short "continue" message and note it in `STATUS.md`.

Text that started with `/bot-lobby ...` (today sent as a user message to trigger the pi command) now calls the command's handler function directly.

## Step 4. Notices and status line

- `ctx.ui.notify` calls go through `notify()` (phase 03 step 8).
- `ctx.ui.setStatus("bot-lobby", text)`: keep the latest status per session in memory (`src/plugin/status.ts`); phase 08 shows it in the task dock.

## Tests

- `test/plugin-orchestrator.test.ts` with a fake agent (`status`, `followup`, `steer`, `ctx.on`) and fake events: `agent/status running` starts the clock; `turn/end` stops it; a `tool/call` for `ask_user_question` pauses clocks and its `tool/result` resumes them; `start_task` while running uses `steer`, while idle uses `followup`; auto mode returns a continue decision on `agent/turn-stopping` only when the task is not done.

## Done when

- [ ] Typecheck, build, tests pass.
- [ ] In dsh: new session with the `bot-lobby` preset; "hi" gets a reply.
- [ ] A request big enough for `start_task` creates a task (check the task file under the project's Bot Lobby folder). The run fails at the first subagent; write that in `STATUS.md` as expected until phase 05.
- [ ] `/bot-lobby status` shows the task.
- [ ] Auto mode: with auto on for the task, ending the orchestrator's turn early triggers another step.

Commit: `dsh port: phase 04 orchestrator`.
