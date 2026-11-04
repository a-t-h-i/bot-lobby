# 04. Tools and tool gates on dsh (2 days)

## Goal

The dsh side of `Host` can register Bot Lobby tools on one dsh agent, block tool calls the way `tool_call` handlers do on pi, and change which tools an agent sees. No agents use it yet; this phase is tested with unit tests and one manual run.

## Read first

- Your `src/host/types.ts` from phase 02 (`HostTool`, `HostToolResult`, `HostToolCallEvent`, `HostToolGate`)
- dsh `packages/core/tools/src/contracts.ts`: `ToolDefinition`, `ToolOutputDefinition`, `ToolRunContext`, `ToolExecution`, `PreToolDecision`, `ToolRestriction`, `ToolGuard`
- dsh `docs/cookbook/adding-a-tool.md` ("Throwing or returning an invalid value means isError")
- dsh Creator skill `references/practices.md`, section "Stability"
- Bot Lobby gates: `src/pi/tool-budget.ts`, `src/pi/assignment-guard.ts`, `src/pi/delegation.ts` (`registerAgentPermissions`)

## Names that clash with dsh

dsh ships tools with the same names as two Bot Lobby tools:

| Bot Lobby tool | dsh tool with the same name | What to do |
|---|---|---|
| `ask_user_question` (`src/ask/tool.ts`) | `@deepseek-ai/dsh-tool-ask-user` | Bot Lobby agents never load dsh's row (phase 05 presets leave it out) |
| `web_search` (`src/web/tools.ts`) | `@deepseek-ai/dsh-tool-web` | same: leave dsh's `tool-web` row out of Bot Lobby agents |

dsh's `todo_write`, `plan-mode`, `tool-subagent` are also left out: Bot Lobby has its own plan checklist, Plan tab and delegation.

## Files to create

```
dsh/src/host/
├── tools.ts        # HostTool -> dsh ToolDefinition
├── gates.ts        # tool_call handlers -> tools/pre-execute
└── active-tools.ts # get/setActiveTools -> ctx.tools.restrict
```

### `dsh/src/host/tools.ts`

```ts
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { HostContext, HostTool } from "../../../src/host/types.ts";

/** Wraps a Bot Lobby tool as a dsh tool. The canonical value is the tool's whole result. */
export function toDshTool(tool: HostTool, context: () => HostContext): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as ToolDefinition["parameters"],
    output: {
      schema: { type: "object" },
      render: (_args, value) => (value as { content: any[] }).content,
    },
    async execute(args, run: ToolRunContext) {
      const result = await tool.execute(run.callId, args as any, run.signal, undefined, context());
      // dsh marks a tool result as an error when the tool throws.
      if (result.isError) throw new Error(result.content.map((block) => ("text" in block ? block.text : "")).join("\n"));
      return { content: result.content, details: result.details ?? null };
    },
  };
}
```

Check with `cordis_inspect_query`:
- that `parameters` accepts JSON Schema from TypeBox as is (TypeBox adds `[Kind]` symbol keys, which JSON ignores; if dsh rejects them, pass `JSON.parse(JSON.stringify(tool.parameters))`);
- the exact `ContentBlock` shape for text and image. If image blocks differ (`mimeType` vs `mediaType`), convert them here.
- `details` must be JSON. If a tool puts non-JSON in `details` (functions, Maps), strip it here.

### `dsh/src/host/gates.ts`

Bot Lobby's `tool_call` handlers return `{ block: true, reason, terminate? }` or `undefined`. Map them to one `tools/pre-execute` listener per agent:

```ts
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { HostToolCallEvent, HostToolGate, HostContext } from "../../../src/host/types.ts";

type Gate = (event: HostToolCallEvent, ctx: HostContext) => HostToolGate | { block: true; reason: string; terminate?: boolean } | Promise<unknown> | undefined;

export function installGates(plugin: Context, agent: Agent, gates: Gate[], context: () => HostContext): void {
  plugin.effect(() => agent.ctx.on("tools/pre-execute", async (exec, next) => {
    if (exec.agent !== agent) return next();
    const event: HostToolCallEvent = { toolCallId: exec.callId, toolName: exec.name, input: (exec.arguments ?? {}) as Record<string, unknown> };
    for (const gate of gates) {
      const verdict = (await gate(event, context())) as { block?: boolean; reason?: string; terminate?: boolean } | undefined;
      if (verdict?.block) {
        // pi's terminate: stop the agent after this step.
        if (verdict.terminate) queueMicrotask(() => agent.cancel({ kind: "hook", reason: verdict.reason ?? "Bot Lobby stopped this agent." }));
        return { kind: "deny", reason: verdict.reason ?? "Blocked by Bot Lobby." };
      }
    }
    return next();
  }));
}
```

Check with `cordis_inspect_query`:
- `tools/pre-execute` is a waterfall with `(exec, next)` and returns `PreToolDecision`;
- `AgentCancelCause` (on `8bd07339`: `{ kind: 'user' } | { kind: 'parent' } | { kind: 'hook'; reason } | { kind: 'disposed' }`, in `packages/core/session/src/types.ts`);
- whether nested calls carry `exec.parent` (pi's `parentToolCallId`; `tool-budget.ts` skips nested calls). Add `parentToolCallId: exec.parent ? "nested" : undefined` to the event if so, and add that field to `HostToolCallEvent`.

Hard denials that must hold whatever other plugins do (the assignment guard's edit scope) should also be a `ctx.tools.guard()` on the agent's context: the guard is synchronous, so only use it for checks that do not await.

### `dsh/src/host/active-tools.ts`

pi's `getActiveTools()` / `setActiveTools(names)` become one replaceable restriction on the agent's context:

```ts
export function activeTools(agentCtx: any) {
  let active: string[] | undefined;
  let release: (() => void) | undefined;
  return {
    get: (all: () => string[]) => active ?? all(),
    set(names: string[]) {
      release?.();
      active = [...names];
      release = agentCtx.tools.restrict({ allow: active });
    },
  };
}
```

`getAllTools()` lists the agent's resolved tool set. Find the method on `ctx.tools` that lists registered tools (`cordis_inspect_query` → `Service tools`).

## Tests (`dsh/test/tools.test.ts`)

Use plain objects as fakes. Assert:

1. `toDshTool` passes `callId`, args and signal through, and returns `{ content, details }`.
2. A tool returning `isError: true` makes `execute` throw with the text.
3. `installGates`: a gate returning `{ block: true, reason: "x" }` yields `{ kind: "deny", reason: "x" }`; `undefined` calls `next()`.
4. `terminate: true` calls `agent.cancel`.
5. `activeTools().set(["a"])` calls `restrict({ allow: ["a"] })` and releases the previous restriction.

## Manual check

In a dsh Creator session, temporarily add a test hook in `dsh/src/index.ts` that creates one agent (like phase 01) with `toDshTool` for `find_relevant_files` (`src/classifier/tools.ts`) and a gate that blocks `bash`. Ask it to find files and run `ls`. Expect: the tool runs; `bash` is denied with your reason. Remove the hook after.

## Done when

- [ ] Tests pass. `npx tsc --noEmit -p dsh` passes.
- [ ] Manual check behaves as above.
- [ ] pi still passes `npm run typecheck` and `npm test`.

Commit: `dsh port: phase 04 tools and gates`.
