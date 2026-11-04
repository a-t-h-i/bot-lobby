# 03. Presets, per-agent setup, tools, gates, prompts, commands (size: large)

## Goal

Every Bot Lobby capability that attaches to an agent works on dsh: which dsh built-in tools each agent gets, Bot Lobby's own tools, the tool gates, the prompt text, per-agent settings, and the `/bot-lobby` command. The orchestrator flow itself comes in phase 04 and subagents in phase 05.

## Read first

- `src/index.ts` (today's registration list; each line is a capability to port)
- `src/pi/tools.ts`, `start-task-tool.ts`, `delegation.ts`, `tool-budget.ts`, `assignment-guard.ts`, `grants.ts`, `events.ts` (the `before_agent_start` handler), `commands.ts`, `quiet.ts`
- `src/web/tools.ts`, `src/knowledge/catalog-tools.ts`, `src/classifier/tools.ts`, `src/desk/client-extension.ts`, `src/desk/board-client.ts`, `src/ask/tool.ts`
- dsh `packages/core/tools/src/contracts.ts` (`ToolDefinition`, `ToolRunContext`, `PreToolDecision`, `ToolRestriction`, `ToolGuard`); `docs/cookbook/adding-a-tool.md`
- dsh `packages/core/system-prompt/src/index.ts` (`PromptSection`)
- dsh `packages/interaction/commands/src/index.ts`, `types.ts` (`CommandDefinition`, `CommandResult`)
- dsh `packages/bundle/web-app/presets/standard.patch.yml`
- dsh Creator skill `references/practices.md`, section "Stability"

## Step 1. Presets

Add to `cordis.patch.yml` one `@deepseek-ai/dsh-agent-preset` row per kind of Bot Lobby agent:

| Preset id | Used by | dsh rows inside |
|---|---|---|
| `bot-lobby` | the orchestrator (the Lobby chat) | copy from dsh's `standard` preset: `persona`, `agent-instructions`, `time-context`, `tool-bash`, `tool-pwsh`, `tool-fs`, `tool-fs-search`, `tool-jobs`, `skill-filesystem`, `tool-skill`, the `compaction` group (`compaction-basic`, `command-compact`, `tool-result-pruner`). Plus the `delegation` group with `tool-subagent-control` only (Bot Lobby starts subagents itself; see phase 05) |
| `bot-lobby-agent` | every Bot Lobby subagent (scout, researcher, worker, reviewer, QA, design, planner seat) | same as `bot-lobby` minus `tool-subagent-control` |
| `bot-lobby-agent-nocompact` | subagents whose settings turn auto-compaction off | `bot-lobby-agent` minus the `compaction` group |

Leave out on purpose (Bot Lobby has its own, or names clash): `tool-ask-user` (Bot Lobby's `ask_user_question` stays, see step 4), `tool-web` (`web_search` clashes; Bot Lobby's web tools stay), `tool-todo`, `planning`/`plan-mode`, `tool-subagent`, `tool-subagent-fork`, `workflow-ptc`, `tool-workflow`, `command-goal`, `tool-goal`, `tool-schedule`, `present`, `tool-plugin-manager`, `tool-plugin-market`.

Copy each row's `config` from the standard preset at your pinned version, do not retype it.

## Step 2. Per-agent setup: `src/plugin/agents.ts`

Bot Lobby behaviour attaches to an agent when it is created:

```ts
export function trackAgents(ctx: Context, onAgent: (agent: Agent, kind: BotLobbyAgentKind, run: RunSettings | undefined) => void): void {
  ctx.on("agent/created", ({ agent }) => {
    const preset = presetOf(ctx, agent);                  // ctx.agentPresets or the agent's meta; check with inspect
    if (!preset?.startsWith("bot-lobby")) return;
    const run = runSettings.take(agent.session.id);       // phase 05 stores per-subagent settings before starting it
    const kind = preset === "bot-lobby" ? "orchestrator" : "subagent";
    agent.ctx.effect(() => { onAgent(agent, kind, run); return () => {}; });
  });
}
```

Rules (from dsh practices):
- Register per-agent things on `agent.ctx` so they go away when the agent is disposed.
- Also keep each agent's disposer in a `Map` owned by the plugin's own `ctx.effect`, so unloading the plugin removes them too.

`RunSettings` replaces today's environment variables. On pi, each subagent was a process and got its settings through `BOT_LOBBY_*` variables read with `process.env`. On dsh all agents share one process, so `process.env` must not be used for per-agent values. Create `src/plugin/run-settings.ts`:

```ts
export interface RunSettings {
  taskId?: string;            // was TASK_ID_ENV
  policy?: AgentPolicy;       // was AGENT_ENV (src/execution/delegation.ts)
  delegation?: string;        // was DELEGATION_ENV
  toolBudget?: string;        // was TOOL_BUDGET_ENV
  compactAt?: number;         // was COMPACT_AT_ENV
  autoCompact?: boolean;      // was AUTO_COMPACT_ENV
  assignment?: string;        // was ASSIGNMENT_ENV
  board?: string;             // was BOARD_ENV
  desk?: { address: string; worker: string }; // was DESK_ENV
  background?: boolean;       // was BACKGROUND_ENV
  ask?: string;               // was ASK_ENV
}
export const runSettings = { put(id, s), take(id) };   // Map keyed by child session id
```

Then change every reader. Find them with:

```sh
grep -rnE "process\.env(\.|\[)(BOT_LOBBY_|[A-Z_]+_ENV\])|isSubagentProcess\(" src
```

Each reader takes a `RunSettings` (or the agent) instead. `isSubagentProcess()` becomes `kind === "subagent"`. Keep machine-wide variables on `process.env` (`BOT_LOBBY_CONFIG_DIR`, `BOT_LOBBY_WEB_ALLOW_PRIVATE`).

Module-level state is also shared now. Move these into per-agent closures: `src/knowledge/catalog-tools.ts` `let callerKey`, `src/web/tools.ts` `let searchCount`, `src/pi/grants.ts` `let source`. Check every file you port with `grep -nE "^(let |const [a-zA-Z]+ = new (Map|Set))" <file>`.

## Step 3. A small tool helper: `src/plugin/tool.ts`

Today's tools are pi tool objects: `{ name, label, description, parameters: Type.Object(...), execute(id, params, signal, onUpdate, ctx) → { content, details } }`, plus pi-tui render functions. Port each to dsh with one helper so the bodies barely change:

```ts
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";

export interface BotLobbyTool<P> {
  name: string;
  description: string;
  parameters: unknown;   // JSON Schema; TypeBox Type.Object(...) values are JSON Schema
  execute(params: P, run: ToolRunContext): Promise<{ content: Array<{ type: "text"; text: string }>; details?: unknown; isError?: boolean }>;
}

export function dshTool<P>(tool: BotLobbyTool<P>): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: JSON.parse(JSON.stringify(tool.parameters)),   // drops TypeBox symbol keys
    output: { schema: { type: "object" }, render: (_a, v) => (v as any).content },
    async execute(args, run) {
      const result = await tool.execute(args as P, run);
      if (result.isError) throw new Error(result.content.map((b) => b.text).join("\n"));   // dsh: throw = isError
      return { content: result.content, details: toJson(result.details) };
    },
  };
}
```

`toJson` drops values JSON cannot hold. Delete the pi-tui `renderCall` / `renderResult` code: tool cards are built in phase 08.

## Step 4. Port the tools

Register each with `agent.ctx.tools.register(dshTool(...))` from `onAgent`, for the agent kinds listed:

| Tool | File | Orchestrator | Subagent |
|---|---|---|---|
| `orchestrate` | `src/pi/tools.ts` | yes | no |
| `start_task` | `src/pi/start-task-tool.ts` | yes | no |
| `delegate_subtasks` | `src/pi/delegation.ts` | no | yes, when `run.delegation` is set |
| `ask_user_question` | `src/ask/tool.ts` | yes | yes |
| `web_search`, `fetch_content`, `get_search_content`, `source_check` | `src/web/tools.ts` | yes, only when no task is active (today's `webToolsFor` rule) | researcher only (by `run.policy`) |
| `search_knowledge`, `open_knowledge`, `list_bookmarks` | `src/knowledge/catalog-tools.ts` | when knowledge access is on | when `run.policy` grants knowledge |
| `find_relevant_files` | `src/classifier/tools.ts` | no | when file hints are on |
| `claim_file`, `handover_file`, `my_files`, `wait_for_files` | `src/desk/client-extension.ts` | no | when `run.desk` is set |
| `post_board`, `read_board` | `src/desk/board-client.ts` | no | when `run.board` is set |

The `ask_user_question` tool keeps Bot Lobby's question format (options, multi-select, mockups). Its transport stays Bot Lobby's own prompt queue (`promptHub`), because dsh's question service cannot carry notes, a global note or mockups; phase 08 Part E moves it off pi and shows it in Bot Lobby's questionnaire inside dsh. For now, leave its body calling the existing questionnaire code and mark it in `STATUS.md` as "transport: phase 08".

Turning tools on and off during a session (today `pi.setActiveTools`): use one replaceable `agent.ctx.tools.restrict({ allow })` per agent; dispose the previous restriction before adding the next.

## Step 5. Tool gates

Today's `tool_call` handlers return `{ block: true, reason, terminate? }` or nothing. On dsh, one `tools/pre-execute` waterfall listener per agent:

```ts
agent.ctx.on("tools/pre-execute", async (exec, next) => {
  if (exec.agent !== agent) return next();
  for (const gate of gates) {
    const verdict = await gate({ toolCallId: exec.callId, toolName: exec.name, input: exec.arguments, nested: exec.parent !== undefined });
    if (verdict?.block) {
      if (verdict.terminate) queueMicrotask(() => agent.cancel({ kind: "hook", reason: verdict.reason }));
      return { kind: "deny", reason: verdict.reason };
    }
  }
  return next();
});
```

Gates to port: `registerAgentPermissions` (`src/pi/delegation.ts`), `registerToolBudget` (`src/pi/tool-budget.ts`, skips nested calls), `registerAssignmentGuard` (`src/pi/assignment-guard.ts`). The assignment guard's `before_provider_request` tool filter becomes the agent's `tools.restrict({ allow })`. Synchronous hard rules (edit scope) also go into `agent.ctx.tools.guard(...)`.

Check `AgentCancelCause` with inspect (on `8bd07339`: `{ kind: 'user' | 'parent' | 'disposed' }` or `{ kind: 'hook', reason }`).

## Step 6. Prompt text

Today `src/pi/events.ts` `before_agent_start` writes `event.systemPromptOptions.sections["bot-lobby"]`: the Lobby chat note when no task runs, or the compiled master prompt (task, standards, knowledge, decisions, bookmarks, scripts) when one does.

On dsh, register on the orchestrator's `agent.ctx`:

```ts
agent.ctx.systemPrompt.section({
  name: "bot-lobby", order: 900, interpolate: false,
  text: () => masterPromptFor(agent),   // the same body as today's handler, returning the string instead of writing it
});
```

Move the handler body into `src/plugin/prompt.ts` `masterPromptFor(agent)`. It is called at each prompt assembly (once per step), so cache the result per turn: keep `{ turn, text }` and recompute only when the agent's turn number changes (read it from the last `turn/start` session event).

Subagents get their prompt from phase 05 (the role prompt the engine already builds).

## Step 7. `/bot-lobby` command

Register with `ctx.commands.register({ name: "bot-lobby", description, input: { hint: "subcommand or request" }, handler })`. The handler calls the same `parseCommand` and subcommand code as `src/pi/commands.ts`, with these changes:

- Keep: `lobby`, `help`, `status`, `runs`, `tasks`, `pause`, `resume`, `cancel`, `approve`, `amend`, `decline`, `accept`, `knowledge`, `config`, `settings`, `claim`, `carry-on`, `auto`, `start-plan`, and a bare request (starts a task).
- Drop (dsh owns these, or they were for pi's terminal): `on`, `off`, `minimize`, `restore`, `switch`, `new`, `web`. On dsh, Bot Lobby is "on" for any session using the `bot-lobby` preset.
- `settings` opens Bot Lobby's settings section (phase 08); for now return its text summary.
- Return `{ kind: "success", text }` with the text pi showed through `ctx.ui.notify`.

Also register `bot-lobby-settings` the same way if it is still used.

## Step 8. Notices

Today 77 calls go to `ctx.ui.notify(message, level)`. Add `src/plugin/notify.ts` `notify(message, level, sessionId?)` that, for now, logs through `ctx.logger` (check the API). Phase 07 sends these to the web client as toasts. Replace the calls in the files you port in this phase.

## Tests

- `test/plugin-tool.test.ts`: `dshTool` passes params and `run` through; `isError` throws; `details` is JSON.
- `test/plugin-gates.test.ts`: block → deny with reason; terminate → `cancel` with `{ kind: "hook" }`; no verdict → `next()`.
- `test/plugin-agents.test.ts`: `agent/created` with a non-Bot Lobby preset does nothing; with `bot-lobby` calls `onAgent` with `orchestrator`; `runSettings.take` returns and clears.
- Keep every existing test of the ported tool bodies passing (update imports and call shapes only).

## Done when

- [ ] Typecheck, build, tests pass.
- [ ] In dsh, a new session with the `bot-lobby` preset lists Bot Lobby's orchestrator tools and no `tool-web` / `tool-ask-user` duplicates (`cordis_inspect_query` → `Tool`).
- [ ] The session's system prompt contains the Lobby chat note.
- [ ] `/bot-lobby status` answers in the dsh composer.

Commit: `dsh port: phase 03 presets, tools, gates, prompts, commands`.
