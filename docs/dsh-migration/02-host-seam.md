# 02. Host seam (still on pi, 4 days)

## Goal

Every pi import in `src/` moves behind one Bot Lobby-owned interface, `Host`. After this phase:

- Only files under `src/host/pi/` import `@earendil-works/pi-*`.
- Everything else imports types from `src/host/types.ts`.
- Bot Lobby behaves exactly as before on pi. No user-visible change.

This phase is worth doing even if the port stops here: it makes the engine testable without pi.

## Start

```sh
git checkout main && git pull
git checkout -b dsh-port
grep -rl "@earendil-works/pi-" src | sort > /tmp/pi-files.txt   # 34 files on 3c33033
```

## Step 1. Write `src/host/types.ts`

Rules for this file: no pi imports; only the fields Bot Lobby really reads. Use pi's names and shapes so the pi adapter is thin, but do not import pi's types.

Start from this skeleton and extend it as you convert files (step 4). Each time a converted file needs a field that is missing, add only that field.

```ts
// Host-neutral surface Bot Lobby runs on. pi and dsh each implement it (src/host/pi, dsh/src/host).

export type NotifyLevel = "info" | "warning" | "error";
export type DeliverAs = "steer" | "followUp";

/** One content block a tool returns or a message carries. */
export type HostContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface HostToolResult {
  content: HostContent[];
  details?: unknown;
  isError?: boolean;
}

export interface HostTool<P = any> {
  name: string;
  label?: string;
  description: string;
  /** JSON Schema. TypeBox `Type.Object(...)` values are JSON Schema and can be passed as is. */
  parameters: unknown;
  execute(callId: string, params: P, signal: AbortSignal | undefined, onUpdate: ((partial: HostToolResult) => void) | undefined, ctx: HostContext): Promise<HostToolResult>;
  /** pi terminal rendering only; the dsh host ignores it. Typed as unknown so no pi-tui import leaks. */
  piRender?: unknown;
}

export interface HostToolCallEvent { toolCallId: string; toolName: string; input: Record<string, unknown> }
export type HostToolGate = { block: true; reason: string } | undefined;

export interface HostSessionManager {
  getSessionId(): string;
  getSessionFile?(): string | undefined;
  getSessionDir(): string;
  getLeafId(): string | null;
  /** Saved conversation entries, oldest first, in the shape `chatFromEntries` reads. */
  getBranch(): HostEntry[];
  buildContextEntries?(): HostEntry[];
}

/** The subset of a pi session entry Bot Lobby reads. Extend by reading the readers (src/lobby/*.ts). */
export interface HostEntry { type: string; id: string; timestamp?: string; message?: unknown; customType?: string; data?: unknown }

export interface HostUI {
  notify(message: string, level?: NotifyLevel): void;
  setStatus(key: string, text: string | undefined): void;
  select(title: string, options: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  /** Used by the ask relay: a subagent's question travels to the parent as an editor dialog. */
  editor(title: string, prefill?: string): Promise<string | undefined>;
  setToolsExpanded?(expanded: boolean): void;
}

export interface HostModel { provider: string; id: string; name?: string; contextWindow?: number; reasoning?: boolean }

export interface HostContext {
  cwd: string;
  hasUI: boolean;
  ui: HostUI;
  sessionManager: HostSessionManager;
  model: HostModel | undefined;
  signal?: AbortSignal;
  isIdle(): boolean;
  abort(): void;
  /** Command contexts only (pi's ExtensionCommandContext). */
  newSession?(): Promise<unknown>;
  switchSession?(sessionPathOrId: string): Promise<unknown>;
}

/** Events Bot Lobby listens to. Same names as pi so handlers move over unchanged. */
export interface HostEvents {
  session_start: { reason?: string };
  session_shutdown: {};
  before_agent_start: { prompt: string; systemPrompt: string };
  agent_start: {};
  agent_end: { messages: unknown[] };
  agent_settled: {};
  turn_end: { message: unknown; toolResults: unknown[] };
  message_update: { message: unknown; assistantMessageEvent: unknown };
  message_end: { message: unknown };
  tool_call: HostToolCallEvent;
  tool_execution_start: { toolCallId: string; toolName: string; args: unknown };
  tool_execution_end: { toolCallId: string; toolName: string; result: unknown; isError: boolean };
  tool_result: { toolCallId: string; toolName: string; input: unknown; content: HostContent[]; isError: boolean };
  before_provider_request: { payload: unknown };
  session_before_compact: { preparation: unknown; signal: AbortSignal };
  ui_prompt_start: {};
  ui_prompt_end: {};
}

export interface HostCommand {
  description: string;
  getArgumentCompletions?(prefix: string): Array<{ value: string; label: string }> | null;
  handler(args: string, ctx: HostContext): Promise<void>;
}

export interface Host {
  readonly kind: "pi" | "dsh";
  /** Folder name for project data (pi: ".pi"). */
  readonly configDirName: string;
  on<K extends keyof HostEvents>(event: K, handler: (event: HostEvents[K], ctx: HostContext) => unknown): void;
  registerTool(tool: HostTool): void;
  registerCommand(name: string, command: HostCommand): void;
  sendUserMessage(text: string, options?: { deliverAs?: DeliverAs; expandPromptTemplates?: boolean }): void;
  sendMessage(message: { customType: string; content: string; display: boolean; details?: unknown }, options?: { triggerTurn?: boolean }): void;
  appendEntry(customType: string, data: unknown): void;
  getSessionName(): string | undefined;
  setSessionName(name: string): void;
  getActiveTools(): string[];
  getAllTools(): Array<{ name: string; description: string }>;
  setActiveTools(names: string[]): void;
  setModel(model: HostModel): Promise<boolean>;
  getThinkingLevel(): string;
  setThinkingLevel(level: string): void;
}
```

Event payloads above are a starting point. For each `host.on(...)` you convert, read which fields the handler uses and make the payload type list exactly those (no more).

## Step 2. Write `src/host/pi/adapter.ts`

`export function piHost(pi: ExtensionAPI): Host` returns an object whose methods call the matching `pi.*` method. Because the shapes match pi's, most methods are one line:

```ts
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Host } from "../types.ts";

export function piHost(pi: ExtensionAPI): Host {
  return {
    kind: "pi",
    configDirName: CONFIG_DIR_NAME,
    on: (event, handler) => pi.on(event as any, handler as any),
    registerTool: (tool) => pi.registerTool({ ...tool, ...(tool.piRender as object | undefined) } as any),
    registerCommand: (name, command) => pi.registerCommand(name, command as any),
    sendUserMessage: (text, options) => pi.sendUserMessage(text, options as any),
    sendMessage: (message, options) => pi.sendMessage(message as any, options as any),
    appendEntry: (type, data) => pi.appendEntry(type, data),
    getSessionName: () => pi.getSessionName(),
    setSessionName: (name) => pi.setSessionName(name),
    getActiveTools: () => pi.getActiveTools(),
    getAllTools: () => pi.getAllTools(),
    setActiveTools: (names) => pi.setActiveTools(names),
    setModel: (model) => pi.setModel(model as any),
    getThinkingLevel: () => pi.getThinkingLevel(),
    setThinkingLevel: (level) => pi.setThinkingLevel(level as any),
  };
}
```

The `as any` casts are allowed only in this file. They mark the pi boundary.

## Step 3. Split the entry point

- Move the body of the default export in `src/index.ts` into a new `src/register.ts`: `export function registerBotLobby(host: Host): void`.
- `src/index.ts` becomes the pi entry only:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { piHost } from "./host/pi/adapter.ts";
import { registerPiOnly } from "./host/pi/extras.ts";
import { registerBotLobby } from "./register.ts";

export default function (pi: ExtensionAPI): void {
  const host = piHost(pi);
  registerBotLobby(host);
  registerPiOnly(pi); // terminal-only: shortcuts, entry renderer, tool renderers
}
```

- `package.json` `pi.extensions` stays `./src/index.ts`. Subagents still get `--extension src/index.ts` (pi-runner, line ~333). Do not change that.

## Step 4. Convert files, one at a time

Work through `/tmp/pi-files.txt` in this order (fewest dependents first). For each file:

1. Replace `ExtensionAPI` parameters with `Host`, `ExtensionContext` / `ExtensionCommandContext` with `HostContext`, `CONFIG_DIR_NAME` with `host.configDirName` (pass it down the way the file already passes `configDir`).
2. Replace `pi.` calls with `host.` calls.
3. If the file uses something `Host` does not have yet, add the smallest field to `src/host/types.ts` and the pi adapter.
4. Run `npm run typecheck`. Fix before the next file.

Order and notes:

| # | File | Note |
|---|---|---|
| 1 | `src/web/tools.ts` | uses pi-tui `Text` only for rendering: move render parts to `piRender` |
| 2 | `src/ask/types.ts`, `src/ask/relay.ts`, `src/ask/web.ts`, `src/ask/tool.ts` | the ask tool; keep its questionnaire logic |
| 3 | `src/knowledge/catalog-tools.ts` | 3 tools |
| 4 | `src/classifier/tools.ts` | `find_relevant_files` |
| 5 | `src/desk/client-extension.ts`, `src/desk/board-client.ts` | 4 + 3 subagent-only tools |
| 6 | `src/classifier/models.ts`, `src/classifier/instance.ts` | uses `ctx.modelRegistry` and pi-ai types: add a `HostModels` interface (`getAvailable()`, `getApiKeyForProvider(provider)`, `streamSimple(model, context, options)`) on `HostContext` as optional `models?` |
| 7 | `src/pi/model-support.ts`, `src/pi/model-settings.ts` | pi-ai `getSupportedThinkingLevels`, `clampThinkingLevel`: move these two calls into `src/host/pi/thinking.ts` and expose them on `Host` as `thinkingLevels(model)` and `clampThinking(model, level)` |
| 8 | `src/pi/tool-budget.ts`, `src/pi/assignment-guard.ts`, `src/pi/grants.ts` | `tool_call` gates. `grants.ts` uses `loadSkills` / `getAgentDir`: move those to `src/host/pi/skills.ts`, expose `Host.skills(): Array<{name; description; path}>` |
| 9 | `src/pi/auto-compaction.ts` | uses `compact`, `findCutPoint`, `estimateTokens`, `DEFAULT_COMPACTION_SETTINGS`: keep this file pi-only, move it to `src/host/pi/auto-compaction.ts`, call it from `src/index.ts`. Phase 07 writes the dsh twin |
| 10 | `src/pi/delegation.ts`, `src/execution/delegation.ts` | `delegate_subtasks` tool and permissions |
| 11 | `src/pi/start-task.ts`, `src/pi/start-task-tool.ts`, `src/pi/tools.ts`, `src/pi/task-title.ts` | `start_task`, `orchestrate` |
| 12 | `src/pi/switch.ts`, `src/pi/owner.ts`, `src/pi/ui.ts`, `src/pi/events.ts`, `src/pi/commands.ts` | lifecycle and commands; pi-tui bits (`Key`, `KeyId`, `Container`, `Markdown`, `getMarkdownTheme`) go to `src/host/pi/extras.ts` |
| 13 | `src/pi/tool-renderers.ts` | pi-only: move to `src/host/pi/tool-renderers.ts` |
| 14 | `src/lobby/pi-commands.ts`, `src/lobby/runtime.ts`, `src/lobby/service.ts` | `SlashCommandInfo` type: copy the 3 fields used into `types.ts` |
| 15 | `src/webui/command.ts`, `src/index.ts` | last |

### Step 4b. Per-agent environment (needed for dsh)

On pi every subagent is its own process, so Bot Lobby passes settings to it through environment variables and reads them with `process.env`. On dsh, workers run in one process, so `process.env` is shared and these reads would mix agents up. Route them through the host:

1. Add to `Host`: `env(name: string): string | undefined` and `readonly subagent: boolean`.
2. pi adapter: `env: (name) => process.env[name]`, `subagent: process.env.BOT_LOBBY_SUBAGENT === "1"`.
3. Replace every read below with `host.env(...)` (pass `host` down where the function does not have it yet), and `isSubagentProcess()` with `host.subagent`. Find them with:

```sh
grep -rnE "process\.env(\.|\[)(BOT_LOBBY_|[A-Z_]+_ENV\])|isSubagentProcess\(" src
```

Variables on `3c33033`: `BOT_LOBBY_SUBAGENT`, `TASK_ID_ENV`, `DELEGATION_ENV`, `TOOL_BUDGET_ENV`, `COMPACT_AT_ENV`, `AUTO_COMPACT_ENV`, `ASSIGNMENT_ENV`, `AGENT_ENV`, `BOARD_ENV`, `BACKGROUND_ENV`, `ASK_ENV`, `DESK_ENV.address`, `DESK_ENV.worker`. Leave machine-wide ones on `process.env` (`BOT_LOBBY_CONFIG_DIR`, `BOT_LOBBY_WEB_*`, `BOT_LOBBY_WEBUI_DIST`, `BOT_LOBBY_PI_BIN`, `PATH`).

4. Module-level state is also shared in one process. In the files that subagents load, move these module-level variables into the `register...` function's closure so each agent gets its own:
   - `src/knowledge/catalog-tools.ts`: `let callerKey`
   - `src/web/tools.ts`: `let searchCount`
   - `src/pi/grants.ts`: `let source`
   Check again with `grep -nE "^(let |const [a-zA-Z]+ = new (Map|Set))" <file>` for every file in the subagent list (`src/register.ts` lines guarded by `host.subagent`).

Do not rename `src/pi/` files yet. Only move files that are pi-only (rows 9, 12 pi-tui bits, 13). The rest keep their paths so the diff stays reviewable.

## Step 5. A fake host for tests

Create `test/support/fake-host.ts`: `export function fakeHost(overrides?: Partial<Host>): Host & { emit(event, payload, ctx?): Promise<void>; tools: Map<string, HostTool>; sent: string[] }`. It records registrations and lets a test fire events.

Then find tests that build a fake `ExtensionAPI` by hand:

```sh
grep -l "earendil" test/*.ts      # 31 files on 3c33033
```

Switch each to `fakeHost()` when the code under test now takes a `Host`. If a test truly tests pi behaviour (for example pi RPC parsing in `pi-runner`), leave it importing pi. Never delete a test.

## Done when

- [ ] `grep -rl "@earendil-works/pi-" src | grep -v "^src/host/pi/" | grep -v "^src/index.ts$" | grep -v "^src/execution/pi-runner.ts$"` prints nothing. (`pi-runner.ts` may keep pi-only parsing; phase 06 adds the dsh runner beside it.)
- [ ] `npm run typecheck` passes.
- [ ] `npm test` has the same pass/fail counts as `main` before the branch (run it on main first and save the counts in `STATUS.md`).
- [ ] Manual: `pi` with Bot Lobby loads, `/bot-lobby` opens the web UI, a small task runs to done.

Commit: `dsh port: phase 02 host seam`.
