# Testing

## 1. Four levels

| Level | Where | Runs with | Needs | When |
| --- | --- | --- | --- | --- |
| **Core unit** | `test/core/*.test.ts` | `node --test` | nothing | every PR (CI) |
| **Host** | `test/host/*.test.ts` | `node --test`, against `test/host/fake-ctx.ts` | nothing | every PR (CI) |
| **UI checks** | `test/ui/*.mjs` | Playwright against a running DSH Web with the plugin | DSH (devDependency), Chromium; the mock API for data | every PR once P3-14 lands (CI) |
| **Live** | `test/live/*.test.ts` | `node --test`, opt-in by env | a DSH with a model key; network | before a release; on DSH upgrades |

- **Commands:** `npm test` runs core and host. `npm run check` runs typecheck, tests and build. `npm run dsh:check` runs the UI checks against a local DSH (see DEV-ENVIRONMENT.md).
- **Live tests** keep bot-lobby's opt-in switches:
  - `BOT_LOBBY_E2E=1` (a real task end to end);
  - `BOT_LOBBY_JEV_E2E=1` with `OPENCODE_API_KEY` (Jev);
  - `BOT_LOBBY_LIVE_EXCALIDRAW=1` (the public Excalidraw collab server).

## 2. Porting bot-lobby's tests (Lane A)

- **Keep assertions.** Port every test that still applies, and change its **setup**, not its **assertions**. An assertion that no longer holds is a behaviour change: say so in the PR.
- **Paths.** The data root moves from `<tmp>/.pi/bot-lobby` to `<tmp>/.bot-lobby`. Tests that pass `configDir` keep passing it; its value is `.bot-lobby` (PORT-MAP, P1-01).
- **Config.** Tests that set `BOT_LOBBY_CONFIG_DIR` switch to an in-memory or temp-file `ConfigStore` (P1-01).
- **The runner.** Tests that drive the engine with a fake Pi process move to the backend seam (§3).
- **TUI and Pi tests** (`lobby-view`, `lobby-layout`, `ask*`, `relay`, `width`, `chat-markdown`, `quiet`, `ui`, `settings-ui`, `lobby-sessions`, `presence`, `fresh-context`, `pi-runner`, `model-support`, `package`, `lobby-runtime`) are not ported as tests. Before dropping one, copy each behaviour it asserts that still matters into the matching FEATURE-INVENTORY row or UI task as an acceptance criterion. For example, `lobby-view` asserts the tab bar shows `● waiting` when a session waits on the user; that becomes a P3-12 dock criterion.

## 3. The legacy runner adapter

About 35 of bot-lobby's test files fake the Pi subagent process. They pass a `ProcessRunner` that returns `stdout` in Pi's JSON event-stream format:

```ts
runProcess: async () => ({ exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } }), stderr: "", killed: false, timedOut: false })
```

The engine now calls an `AgentBackend` instead (ARCHITECTURE §4). So those tests can move with a one-line change, P1-03 creates a **test-only** adapter that turns a fake process runner into a backend. Its logic is copied from bot-lobby's `src/execution/pi-runner.ts`, which the product no longer contains:

```ts
// test/helpers/legacy-runner.ts
// Drives the AgentBackend seam with bot-lobby's fake Pi processes, so the ported
// engine tests keep their scripted replies. Copied from bot-lobby's
// src/execution/pi-runner.ts (buildPiArgs, parsePiStream, toResult and the
// ProcessRunner types); test-only.
import type { AgentBackend } from "../../src/core/agents/backend.ts";
import { activityWord } from "../../src/core/lobby/activity.ts";

export type ProcessRunner = (args: string[], options: ProcessRunOptions) => Promise<ProcessOutcome>;
// ProcessRunOptions, ProcessOutcome, ParsedStream: copied from pi-runner.ts.

export function backendFromProcessRunner(run: ProcessRunner): AgentBackend {
  return async (options) => {
    const args = buildPiArgs(options);                  // tests that look at args still see Pi's argv
    const outcome = await run(args, {
      cwd: options.cwd,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      prompt: `Task: ${options.task}`,                  // + grantNote(grant), as runPiAgent did
      stallTimeoutMs: options.stallTimeoutMs,
      toolStallTimeoutMs: options.toolStallTimeoutMs,
      wrapUpAtMs: options.wrapUpAtMs,
      ...(options.time ? { time: options.time } : {}),
      onStart: options.onStart,
      onEvent: (event) => {
        if (event.type === "tool_execution_start") options.onActivity?.(activityWord(event.toolName));
        options.onEvent?.(event);
      },
    });
    return toResult(parsePiStream(outcome.stdout), outcome, options.signal?.aborted === true, options);
  };
}
```

**In a ported test:**

```diff
- const deps = makeDeps({ runProcess: runner });
+ const deps = makeDeps({ backend: backendFromProcessRunner(runner) });
```

Once the port is stable, tests can move to a direct fake backend where that reads better:

```ts
const backend: AgentBackend = async (options) => ({ status: "success", output: scoutReply(), usage: { input: 0, output: 0, cost: 0, turns: 1 } });
```

## 4. Host tests: the fake context

Host code is tested against `test/host/fake-ctx.ts` (P2-13), a small fake of the Cordis context that implements only what the host half uses. Shapes are in [reference/API-NOTES.md](reference/API-NOTES.md).

- **The effect ledger.**
  - `effect(fn, label)` records the disposer. `fake.disposeAll()` runs them all.
  - `fake.liveEffects()` counts what is still registered.
  - **Every host test ends by disposing and asserting 0**, which catches leaks in the "two owners" rule.
- **`tools`.**
  - `register` stores definitions; `restrict` and `guard` store their masks and guards.
  - `fake.callTool(name, args, { agent })` runs a registered tool through the guards exactly as DSH would: guards first; a returned reason denies.
- **`subagents.start(name, request)`.**
  - It records the request: persona, `toolFilter`, `agentOptions`.
  - It returns a run whose `result` the test resolves: `fake.finishChild(id, { stopReason, output })`.
  - `localAgent` is a fake agent that records `steer`.
- **`userQuestions.ask(request)`.**
  - Queues the request. The test answers with `fake.answer({ answers: [...] })`.
  - It refuses when `request.agent` is a child, as DSH does.
- **Commands, prompt and models.**
  - `commands.register` stores the definition, and `fake.runCommand('/bot-lobby status', agent)` calls it.
  - `systemPrompt.section` and `llm` return canned routes, models and efforts.
- **Web.**
  - `webServer.register` stores the handler, and `fake.request('POST', '/bot-lobby/api/tasks.list', body, { admitted })` calls it with fake `req`/`res`.
  - `connection.admit` follows the `admitted` flag.
- **Agents.** Fake agents: `{ session: { id, header: { cwd } }, ctx: <child fake>, inject, followup, steer, options }`. Each records the messages it receives.

**Keep the fake small and honest.** When a spike shows DSH behaving differently from the fake, fix the fake first, in its own commit.

## 5. UI checks

- **Where they run.** Against a real DSH Web with the plugin installed, never against a mock page. That is the only way to catch slot, theme and module-loader problems. See `templates/scripts/ui-check.mjs`.
- **Data without models.** A dev-only plugin `Config` flag (for example `mockApi: true`, used only by tests) makes the host API serve fixtures from `test/ui/fixtures/`. The page then renders every state with no model keys and no network. P2-12a builds the mock; P3-14 wires it into CI.
- **Per page, check:**
  1. it renders (a `data-testid`);
  2. the loading, empty and error states;
  3. one main action round-trips through the API;
  4. no console errors, in particular no `slot entry crashed in …`;
  5. screenshots in light and dark;
  6. a narrow viewport (about 900 px with the sidebar open).
- **Theme.** Switch light and dark the way the DSH page does (inspect the page: `data-ds-dark-theme` is what `dsh-agent-canvas` watches). Screenshot both.
- **CI artifacts.** Screenshots go to the job's uploads, not into the repo.

## 6. Manual walkthroughs

Phases 2 and 4 end with written walkthroughs (`docs/verification/phase2.md`, `phase4.md`): the exact steps, the model used, screenshots and the outcome. They are the evidence for parity rows that cannot be automated cheaply. Examples: a real QA gate failing once and passing, and a budget time-up question.

## 7. What must have a test, whatever the task

- **Every engine rule** in FEATURE-INVENTORY's last table.
- **Every fence** in ARCHITECTURE §9. Examples: "a scout's edit is denied by the guard"; "the API refuses without admission"; "no response contains an unmasked room link".
- **Unload removes everything** (host).
- **Two sessions or projects don't share per-session state** (host, P2-01).
