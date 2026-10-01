# Pi notes

The parts of Pi 0.87.0 the web UI depends on.

**Where it comes from:** each item names its source, all under `node_modules/@earendil-works/pi-coding-agent/`:
- `docs/*.md`: Pi's own documentation;
- `dist/core/extensions/types.d.ts`: the extension API's types.

**Status:**
- **Documented:** read in Pi's docs or types, not yet run for this plan.
- **Verified:** run. VERIFIED-FACTS has the run.

Re-read the source when Pi is upgraded (AGENT-GUIDE §7).

## 1. Modes and `hasUI`

```ts
export type ExtensionMode = "tui" | "rpc" | "json" | "print";   // types.d.ts:209
ctx.mode: ExtensionMode;  ctx.hasUI: boolean;
```

- **The lobby today:** it starts only in `tui` (`src/lobby/runtime.ts:830`).
- **In RPC mode:** `ctx.mode` is `"rpc"` and `ctx.hasUI` is `true`, because dialogs work over the protocol. `custom()` returns `undefined` (`docs/rpc.md`, "Extension UI"). **Documented.**
- **The rpc.md advice:** use `ctx.mode === "tui"` to guard terminal-only features like `custom()`. bot-lobby already does this in `src/ask/dialog.ts:114`.

## 2. Dialogs and withdrawing them

From `types.d.ts`, `ExtensionUIContext`:

```ts
select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
editor(title: string, prefill?: string): Promise<string | undefined>;          // no options
custom<T>(factory: (tui, theme, keybindings, done: (result: T) => void) => Component, options?: { overlay?: boolean; … }): Promise<T>;

interface ExtensionUIDialogOptions {
  /** AbortSignal to programmatically dismiss the dialog. */
  signal?: AbortSignal;
  /** Timeout in milliseconds. Dialog auto-dismisses with live countdown display. */
  timeout?: number;
}
```

**What this means for D-13:**
- `select`, `confirm` and `input` can be withdrawn with a signal.
- `editor` cannot.
- `custom` is withdrawn by calling its `done` from outside, since the component is ours.

All of this is **documented**. P0-04 verifies it.

## 3. Knowing when Pi is asking the user

From `docs/extensions.md`, "ui_prompt_start / ui_prompt_end":
- These fire around `select`, `confirm`, `input`, `editor` and `custom`.
- The event carries `{ reason: "ui_prompt", kind, title? }`, where `kind` is `"select" | "confirm" | "input" | "editor" | "custom"`.
- Nested prompts are coalesced into one span. Handlers are not awaited.

bot-lobby already listens to them to step the lobby aside (`runtime.ts`, `promptStarted`). The web uses them for the "Pi is asking something in the terminal" banner. **Documented**; the terminal use is tested in `lobby-runtime`.

## 4. Sending to the oracle

```ts
pi.sendUserMessage(content: string | (TextContent | ImageContent)[], options?: {
  deliverAs?: "steer" | "followUp";
  expandPromptTemplates?: boolean;
}): void;                                                        // types.d.ts:1055
```

- `toOracle` (`runtime.ts`) uses it to send, to steer while busy, and to pass `/commands`.
- **Built-in commands:** Pi's built-in commands are not run this way. The lobby's notice says so, and the web keeps that notice.

## 5. The SDK, for the later standalone host (Phase 6)

From `docs/sdk.md`:

```ts
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory(), modelRuntime });
session.subscribe((event) => { /* message_update, tool_execution_*, … */ });
await session.prompt("…");
```

- **Extensions:** `createAgentSession` loads them through a `ResourceLoader`. `DefaultResourceLoader` does the standard discovery, which would include bot-lobby.
- **The alternative:** `docs/rpc.md`'s `pi --mode rpc` subprocess, which bot-lobby already drives for background sessions (`src/lobby/sessions.ts`).

**Documented.**

## 6. How Pi installs packages (why `webui/dist` is committed)

From `docs/packages.md`:
- `pi install git:github.com/user/repo@v1` clones to `~/.pi/agent/git/<host>/<path>`. "When reconciliation changes the checkout, pi resets and cleans the clone, then runs `npm install` if `package.json` exists."
- "When pi installs a package from npm or git, it runs `npm install`, so those dependencies are installed automatically."

Nothing builds the package. A built page must be in the repo and in `files` (D-08). **Documented.**

## 7. Models, for the settings page

- **The TUI's model list:** `ctx.scopedModels` if any, else `ctx.modelRegistry.getAvailable()` (`src/pi/settings-ui.ts:237`).
- **Looking up one model:** `ctx.modelRegistry.find(provider, id)` (`src/pi/tools.ts:88`).
- **Thinking levels:** checked per model with `checkThinking` (`src/pi/model-support.ts`).

The web's settings page (P5-01) reuses these through the service. It does not call Pi from the server directly.

## 8. Termux

From `docs/termux.md`:
- **Install:** `pkg install nodejs termux-api git`, then `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`.
- **Opening links:** `termux-open-url "<url>"` opens a URL in the default browser. It needs the Termux:API app, from GitHub or F-Droid, not Google Play.

**Documented.** What Android does to Termux in the background is P0-03's question (RISKS R-03).
