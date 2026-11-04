# 03. Engine hooks (the only engine changes)

Goal: two small, opt-in additions to the Bot Lobby engine so it behaves well inside herdr. Nothing else in `src/` changes.

## Read first

- `src/webui/command.ts` (`openLink`, `webSessionStarted`), `src/schemas/configuration.ts` (`lobby.web.openBrowser`).
- `src/pi/events.ts` (`agent_start`, `agent_end`, `session_shutdown` handlers).
- `src/lobby/prompt-hub.ts` (`PromptHub.open`, `settle`, `pending`).
- herdr `AGENTS.md` "Agents are terminals whose program reports a status (OSC 7501)". Format used by integrations: `ESC ] 7501 ; state=<word>:app=<name> ESC \`, where word is `working`, `blocked`, `idle` or `done`.

## Step 1. No browser under herdr

When pi runs inside a herdr terminal, the env var `HC_TERMINAL_ID` is set (herdr-core gives every terminal its address there; confirm with `echo $HC_TERMINAL_ID` in a herdr tab first and note it in `STATUS.md`). The web server must still start, but the browser must not open.

- In `src/webui/command.ts` `openLink`: also return early when `process.env.HC_TERMINAL_ID` is set and `process.env.BOT_LOBBY_OPEN_BROWSER !== "1"`.
- Add `BOT_LOBBY_OPEN_BROWSER=1` to `docs/guide.md` (the env var section): "open the browser even inside herdr".
- Test (`test/web-command.test.ts` or the existing web command test): with `HC_TERMINAL_ID=t1` the opener is not called; with `BOT_LOBBY_OPEN_BROWSER=1` it is.

## Step 2. Report the Orchestrator's status to herdr (OSC 7501)

New file `src/pi/herdr-status.ts`:

```ts
/** Tells herdr what the Orchestrator is doing, so herdr's agents list shows it. Only inside herdr. */
export type HerdrState = "working" | "blocked" | "idle" | "done";
export function reportHerdr(state: HerdrState): void {
  if (!process.env.HC_TERMINAL_ID || !process.stdout.isTTY) return;
  if (state === last) return;
  last = state;
  process.stdout.write(`\x1b]7501;state=${state}:app=bot-lobby\x1b\\`);
}
let last: HerdrState | undefined;
```

Wire it (only in the interactive parent process, never in a subagent: check `isSubagentProcess()` as `webSessionStarted` does):

| When | State |
|---|---|
| `agent_start` | `working` |
| `agent_end` | `done` (herdr turns it into `idle` once the person looks) |
| a prompt opens in `promptHub` (`open`) and none was pending | `blocked` |
| the last pending prompt settles | back to `working` if the agent is running, else `idle` |
| a task is running (master busy) while the Orchestrator itself is idle | `working` |
| `session_shutdown` | `idle` |

- Add a tiny listener API to `PromptHub` only if none exists (`onChange(listener): () => void`), called at the end of `open` and `settle`. That is the one engine-logic file touched; keep the change additive.
- Writing to stdout while pi's TUI draws: write the sequence in one `write` call; terminals pass OSC through without moving the cursor. If pi's TUI owns stdout through its own writer, use that writer instead (check `src/pi/ui.ts`). Note which in `STATUS.md`.
- Add `"bot-lobby": { "name": "Bot Lobby", "tile": "#c96442" }` to `herdr/programs.json` and have `install.mjs` merge it into the app home's `programs.json`, so herdr names the agent nicely.

## Done when

- `npm run typecheck` and `npm test` pass (new tests included).
- In herdr: start pi with Bot Lobby in a tab. The browser does not open. herdr's agents list shows "Bot Lobby" as working while it answers, blocked while a questionnaire waits, done when it finishes.
- Outside herdr nothing changes (no escape sequences printed, browser opens as before).
