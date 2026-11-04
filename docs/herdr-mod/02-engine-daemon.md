# 02. Engine daemon: Bot Lobby without pi

Goal: Bot Lobby's engine runs as its own Node program, `bot-lobby serve`, with no pi. It owns the project's state, the master, the workflow, the web API and the event stream exactly as today. It does no model calls itself: every model call goes through an installed harness (phases 03 and 04).

Owner decision (2026-11-04): bot-herdr drops pi entirely and uses whatever harnesses are installed.

## Read first

- `src/index.ts` (the pi extension entry: everything it registers, in order).
- Every file that imports pi (34 in `src/`): `src/pi/*` (17), `src/ask/{relay,tool,types,web}.ts`, `src/classifier/{instance,models,tools}.ts`, `src/desk/{board-client,client-extension}.ts`, `src/execution/delegation.ts`, `src/knowledge/catalog-tools.ts`, `src/lobby/{pi-commands,runtime,service}.ts`, `src/web/tools.ts`, `src/webui/command.ts`. List them yourself with `grep -rl "@earendil-works/pi" src`.
- `src/lobby/host.ts` (`LobbyService`), `src/lobby/runtime.ts`, `src/webui/server.ts` (`startWebServer`).
- `docs/dsh-migration/mapping.md` "pi hooks and calls": the same table of what pi provides, useful here too.

## Step 1. A `Host` interface (still on pi, nothing breaks)

Write `src/host/host.ts`: the small set of things the engine asks of its host. Derive it from what the pi-importing files actually call. Expected shape (adjust to what you find; write the final list in `STATUS.md`):

```ts
export interface Host {
  projectRoot(): string;
  /** Tools the Orchestrator can call (name, description, JSON schema, run). */
  registerTool(tool: HostTool): void;
  /** Slash commands typed in the Lobby. */
  registerCommand(name: string, run: (args: string) => Promise<void>): void;
  /** Lifecycle the engine listens to. */
  on(event: "turnStart" | "turnEnd" | "toolStart" | "toolEnd" | "shutdown", listener: (e: unknown) => void): () => void;
  /** Queue a user message for the Orchestrator (idle: start a turn; busy: steer). */
  sendToOrchestrator(text: string, opts?: { steer?: boolean }): void;
  abortOrchestrator(): void;
  notify(text: string, level: NoticeLevel): void;
  /** One model call with no tools (classifier, titles, knowledge digest). */
  complete(input: { system?: string; prompt: string; model?: string; effort?: string; json?: boolean }): Promise<string>;
}
```

- Implement `PiHost` over `ExtensionAPI` in `src/host/pi-host.ts` and move every pi call behind it. The engine files then import `Host`, never pi.
- Run `npm run typecheck && npm test`: everything still passes on pi. Commit. This step makes the rest reversible.

## Step 2. The daemon `src/daemon/main.ts`

```
bot-lobby serve [--project <folder>] [--port <n>]
```

- Add a `bin` entry `bot-lobby` in `package.json` (`node --experimental-strip-types src/daemon/main.ts` or a built `dist/`; follow how the repo runs TS today).
- Builds a `DaemonHost` (implements `Host`, phases 03 and 04 fill in the model parts), then runs the same registration as `src/index.ts` against it, then `startWebServer({ service, port })`.
- One daemon per project folder. A lock file `<project>/.bot-lobby/daemon.lock` with pid and port; a second `serve` for the same folder prints the running one's port and exits 0.
- It never opens a browser. It prints `bot-lobby: http://127.0.0.1:<port>` and, once, the link with the token (for people who still want the web app).
- Logs to stderr in plain lines; the herdr tab that runs it shows them.
- `SIGINT` / `SIGTERM`: abort the Orchestrator, cancel running agents (existing task cancellation), close the server, remove the lock.

## Step 3. Data folders

- New homes: `~/.bot-lobby/` (global: config, `web.json`, `web-projects/`) and `<project>/.bot-lobby/` (project state).
- On first start, if the new folder is missing and the old one exists (`~/.pi/bot-lobby`, `<project>/.pi/bot-lobby` or whatever `src/state/project.ts` names), copy it once. Leave the old folders alone.
- `BOT_LOBBY_CONFIG_DIR` keeps working.
- Same choice as the dsh port spec (risks.md), so the two routes stay compatible.

## Step 4. Status for herdr (OSC 7501)

When bot-herdr starts the daemon it runs it in a herdr terminal tab named "Bot Lobby". The daemon reports the Orchestrator's state on that terminal so herdr's agents list shows it.

- `src/daemon/herdr-status.ts`: if `process.env.HC_TERMINAL_ID` is set and stdout is a TTY, write `\x1b]7501;state=<word>:app=bot-lobby\x1b\\` on change. Confirm with `echo $HC_TERMINAL_ID` in a herdr tab first; note it in `STATUS.md`.
- `working` while the Orchestrator or any task runs; `blocked` while a prompt waits in `promptHub` (add a small `onChange` listener to `PromptHub`, called at the end of `open` and `settle`); `done` when a turn ends; `idle` at shutdown.
- `herdr/programs.json` entry `"bot-lobby": { "name": "Bot Lobby", "tile": "#c96442" }`, merged by the installer.

## Done when

- Step 1 committed with all tests passing on pi.
- `bot-lobby serve` in a test repo starts, answers `status.get` and opens `/api/events` (check with `curl` and the cookie), with the Orchestrator parts stubbed (phase 03 fills them).
- A second `serve` in the same folder exits with the first one's port.
- `npm run typecheck`, `npm test` pass.
