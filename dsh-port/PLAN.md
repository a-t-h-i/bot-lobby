# Phased porting plan

The plan for porting bot-lobby to a DSH plugin, broken into tasks a swarm can pick up in parallel. Each task card has an id, a lane, dependencies, what to read, what to do, and acceptance criteria that can be checked. Nothing here depends on unstated context: an agent reading only the card, this folder and the source it points to can do the task.

## Phases at a glance

| Phase | Goal | Lanes | Exit criteria |
| --- | --- | --- | --- |
| **0 · Foundations and spikes** | A repo that builds and loads in DSH, and answers to the unknowns | D, B, C | CI green. The skeleton renders in DSH Web. `docs/spikes/*.md` answer P0-03…P0-09. |
| **1 · Core port** | bot-lobby's logic in `src/core`, tested, no Pi | A | Core tests pass with no DSH running. No Pi references in `src/`, `test/` or `prompts/`. |
| **2 · Host runtime** | Tasks run in DSH: oracle, subagents, desk, commands, API | B | The Phase 2 walkthrough (P2-X) passes in DSH Web with a real model |
| **3 · The GUI** | The Bot Lobby page, the Agents view, the dock and tool cards | C | Every tab at parity (FEATURE-INVENTORY). Playwright checks pass in light and dark. |
| **4 · DSH-native parity** | Session per task, worktree cwd, continuable children and the rest | B, C | The FEATURE-INVENTORY rows assigned to P4 are done |
| **5 · Hardening and release** | Live E2E, Desktop, security, docs, publish | all | Published on npm; installs through Plugin Manager; parity signed off |

**Lanes:**
- **A**: core, pure TypeScript.
- **B**: host (DSH runtime).
- **C**: client (React UI).
- **D**: infrastructure and QA.

**Lane A needs no DSH at all and starts on day one**, in parallel with Phase 0.

## Critical path and parallelism

```
P0-01 → P0-02 ─┬→ P0-03 ─┬→ P0-04 → P2-02 → P2-03 → P2-04 → P2-05/06/07 → P2-X ─┐
               │         └→ P1-10 (prompts)                                    │
               ├→ P0-05 → P0-07 ……………………………………………………→ P4-01 → P4-02          │
               ├→ P0-06 → P2-12a (API contract + mock) → P3-02 → P3-03…P3-13 ──┼→ P5
               ├→ P0-08 → P2-08, P2-09, P2-11                                   │
               └→ P0-09 → P2-03                                                 │
P1-01 → P1-02…P1-09, P1-11 (all parallel) ──→ P1-X ──→ (feeds every P2 task) ──┘
```

**Rough agent counts:**

| Time | Who is working |
| --- | --- |
| Day 1 | 1 on P0-01 (then P0-02), and 1 on P1-01 |
| Once P1-01 lands | up to 9 on Lane A |
| Once P0-02 lands | up to 7 on spikes P0-03…P0-09 |
| Once P2-12a lands | up to 12 on Lane C tabs |

## Rules for every task

1. **Claim before starting.** Set the task's status in the new repo's `docs/status.md` to `in progress (<agent>)` in a commit. Two agents never hold one task.
2. **One task, one branch, one PR.** Branch name `p<phase>-<nn>-<slug>`, e.g. `p1-05-knowledge`. The PR title starts with the task id.
3. **Stay in your lane's directories.** The "Owns" line says which paths a task may create or rewrite. Shared files are append-only for everyone else:
   - `package.json`;
   - `src/host/index.ts`, the list of `install*()` calls;
   - `src/shared/api.ts`;
   - `docs/status.md`;
   - `docs/parity.md`.

   Changes to another task's paths go in a separate PR tagged with that task's id.
4. **Done means the acceptance criteria are checked.** Paste the commands you ran and their output, or screenshots, into the PR. See the Definition of Done in [AGENT-GUIDE.md](AGENT-GUIDE.md#6-definition-of-done).
5. **Spikes write down what they learned** in `docs/spikes/<topic>.md`: the question, what was tried, what happened (verbatim errors), the answer, and the recipe. Keep spike code under `spikes/`; it is not product code.
6. **If a card is wrong, stop and fix the card.** When DSH behaves differently from what a card or a decision says, record it in the spike doc or the PR, then update this plan or DECISIONS.md in the same PR (see "Changing the plan" at the end).

---

## Phase 0 · Foundations and spikes

### P0-01 · Bootstrap the repository · Lane D

- **Depends on:** nothing.
- **Read:** [templates/README.md](templates/README.md), [DECISIONS.md](DECISIONS.md) D-02, D-04, D-17, D-18, D-19.
- **Owns:** the repo root, `.github/`, `scripts/`.
- **Do:**
  1. Create the repo (default `a-t-h-i/dsh-bot-lobby`, Q-01) and set the git author to `a-t-h-i <aonlysmith@gmail.com>`, with no co-author trailers.
  2. Copy [`templates/skeleton-ts`](templates/skeleton-ts) to the repo root. Rename the package to `@a-t-h-i/dsh-bot-lobby`. In `cordis.patch.yml`, change the row to `id: bot-lobby`, `name: '@a-t-h-i/dsh-bot-lobby'`. The client module id follows the package name through `scripts/build.mjs`.
  3. Add:
     - `LICENSE` (Apache-2.0, as bot-lobby);
     - a short `README.md`;
     - `.gitignore`: `node_modules/`, `lib/`, `.dsh-home/`, `*.log`, `web.pid`, `test-results/`, `*.png` outside `docs/`;
     - `.nvmrc` with `22`;
     - `locale/en.json` with `{ "meta": { "title": "Bot Lobby", "description": "…" } }`;
     - `icon.svg`, added to `files` and `exports` as `reference/dsh/skills/cordis-plugin-development/references/host-plugin.md` describes.
  4. Scripts: `build`, `typecheck`, `test`, `check`. `check` runs all three.
  5. Add CI (GitHub Actions) on push and PR: Node 22, `npm ci`, `npm run check`.
  6. Create `docs/status.md` (this plan's task table, all `todo`) and `docs/parity.md` (a copy of FEATURE-INVENTORY's ids, all `todo`).
- **Acceptance:**
  - CI green on `main`.
  - `npm run build` writes `lib/index.js` and `lib/client.js`.
  - `node --check lib/index.js` passes.
  - `head -3 lib/client.js` shows `window.__ModuleLoader__.load({` with `id: "@a-t-h-i/dsh-bot-lobby"`.
  - `package.json` has no dependency on `@earendil-works/*` or `typebox`.

### P0-02 · A DSH dev loop · Lane D

- **Depends on:** P0-01.
- **Read:** [DEV-ENVIRONMENT.md](DEV-ENVIRONMENT.md), [templates/scripts](templates/scripts).
- **Owns:** `scripts/dsh/`, `test/ui/`, `docs/dev.md`.
- **Do:**
  1. Add `@deepseek-ai/dsh` (pinned exactly, D-17) and `playwright-core` as devDependencies.
  2. Copy the start, stop and UI-check scripts, and add npm scripts `dsh:start`, `dsh:stop` and `dsh:check`.
  3. Install the plugin into a repo-local DSH home: `DSH_HOME=$PWD/.dsh-home npx dsh plugin --profile web add $PWD`.
  4. Start DSH, then run the UI check against the skeleton page.
  5. Write down in `docs/dev.md` the exact commands, the DSH version, and what a first run looks like (the Preview Notice, the token URL).
- **Acceptance:**
  - `npm run dsh:check` prints `page: 1`, a model count ≥ 1 and `errors: []`, and saves a screenshot.
  - A second developer can follow `docs/dev.md` from a clean clone.
  - The skeleton's TS build is then **verified** in DSH (it was only built, never run, when this handbook was written).

### P0-03 · Spike: tool names agents see · Lane B

- **Depends on:** P0-02.
- **Read:** DECISIONS D-13; `reference/dsh/skills/cordis-plugin-development/SKILL.md` ("Knowledge sources": `cordis_inspect_query` with `Tool`); `reference/dsh/packages/dsh-tools.md` (Restrict tools per agent); `reference/dsh/skills/cordis-composition-reference/references/packages.md` (the `fs` and `shell` rows).
- **Owns:** `docs/tool-names.md`, `spikes/tool-names/`.
- **Do:**
  1. In a DSH Web session, list the tools the root agent can call. Two ways: ask the agent to run `cordis_inspect_query` for `Tool`, or register a spike tool that returns the schemas visible to `exec.agent`.
  2. Record each built-in tool's name and parameters. Pay particular attention to the edit and write tools' argument names, because `state/changes.ts editedFile` and `desk/session.ts isEditTool` need them.
  3. Note which tools a `spawn` child inherits.
- **Acceptance:** `docs/tool-names.md` maps every name in these lists to a DSH tool, or says "none" and gives the substitute:
  - `WORKER_TOOLS` (`src/roles/worker.ts`);
  - `QUICK_FIX_TOOLS` (`src/lobby/quickfix.ts`);
  - `PLANNER_TOOLS` and `RESEARCH_PANEL_TOOLS` (`src/lobby/planner.ts`);
  - `REVIEW_TOOLS` (`src/lobby/pr-review.ts`);
  - the role specs in `src/roles/*.ts`.

  Pi's names are `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `web_search`, `fetch_content`, `source_check` and `get_search_content`.

### P0-04 · Spike: subagents from a plugin · Lane B

- **Depends on:** P0-02, P0-03.
- **Read:** ARCHITECTURE §4, DECISIONS D-06, `reference/API-NOTES.md` §Subagents, `reference/dsh/packages/dsh-subagent.md`, `dsh-subagent-spawn-in-process.md`, `dsh-tool-subagent.md`.
- **Owns:** `spikes/subagents/`, `docs/spikes/subagents.md`.
- **Do:** Register a spike tool (for example `bot_lobby_spike_delegate`) whose `execute(args, exec)` calls `ctx.subagents.start('spawn', { prompt, parent: exec.agent, signal: exec.signal, persona, toolFilter: { allow: [...] }, agentOptions, maxDepth: 0 })`. From a DSH session, call it and find out:
  1. how to observe the child's tool calls with arguments, its assistant text and reasoning ("thoughts"), and its token usage and cost;
  2. whether `run.localAgent.steer(...)` reaches a busy child mid-run;
  3. what abort through the signal and `dispose()` do, and how fast;
  4. where `persona` lands in the child's prompt;
  5. that an unknown tool name in `toolFilter` fails loud;
  6. that `agentOptions` can pick another route or model and a reasoning effort;
  7. what failures look like (`stopReason`, `diagnostic`) for a bad model id, a missing key and, if reproducible, a rate limit or usage error;
  8. the child's cwd;
  9. several children in parallel.
- **Acceptance:** `docs/spikes/subagents.md` answers 1–9 with code snippets and verbatim outputs, and states the recipe P2-02 will implement.

### P0-05 · Spike: the oracle in a session · Lane B

- **Depends on:** P0-02.
- **Read:** ARCHITECTURE §5, DECISIONS D-07, `reference/dsh/packages/dsh-agent.md`, `dsh-system-prompt.md`, `dsh-tools.md`, the practices file.
- **Owns:** `spikes/oracle/`, `docs/spikes/oracle.md`.
- **Do:** From a command handler (`ctx.commands.register`, handler gets `{ agent }`), attach to that agent:
  - a scoped tool (`agent.ctx.tools.register`);
  - a scoped prompt section (`agent.ctx.systemPrompt.section`);
  - `agent.ctx.tools.restrict({ deny: [...] })`.

  Then:
  1. Check that ordinary sessions don't see any of them.
  2. Try `agent.inject`, `agent.followup` and `agent.steer` with `createUserMessage({ content, source: { kind: 'plugin', plugin: 'bot-lobby' } })`.
  3. Dispose the session, and unload the plugin. Confirm every registration goes away.
  4. Find out how to change a live session's route or model, and reasoning effort, for the master fallback (F-23).
  5. Find how a plugin can list sessions and learn each one's cwd.
- **Acceptance:** `docs/spikes/oracle.md` records each result. It includes a minimal `attachOracle(agent)` / `detach` recipe with two-owner disposal.

### P0-06 · Spike: client↔host transport · Lane C (with B)

- **Depends on:** P0-02.
- **Read:** DECISIONS D-12, RISKS R-02, `reference/VERIFIED-FACTS.md` §Transport, `reference/dsh/packages/dsh-host-webserver.md`, `dsh-client-connection.md`, `dsh-api-gateway.md`, `dsh-api-remotes.md`.
- **Owns:** `src/client/api.ts` (`HostApi`), `docs/spikes/transport.md`.
- **Do:**
  1. Confirm the web route plus `connection.admit` path on the pinned version.
  2. Re-test `ctx.connection.rpc.handle` from a plugin. It fails in rc.2 with *cannot get property "webServer" without inject*.
  3. Try a streaming response (Server-Sent Events) through the route.
  4. If any macOS or Windows machine is available, install DSH Desktop and check whether the page's `fetch('/bot-lobby/api/…')` reaches the host.
  5. Define `HostApi`: `call<T>(endpoint, payload): Promise<T>` and optionally `subscribe(topic, onEvent)`.
- **Acceptance:** The chosen transport is recorded, with evidence, and the skeleton uses `HostApi`. If Desktop could not be tested, R-02 stays open and P5-02 owns it.

### P0-07 · Spike: a session per task · Lane B

- **Depends on:** P0-05.
- **Read:** DECISIONS D-08, `reference/dsh/packages/dsh-agent.md` (`ctx.agents.create`), `dsh-workspace.md`, `dsh-client-runtime.md` (Host-born sessions: `session.create`), `dsh-session.md`.
- **Owns:** `spikes/sessions/`, `docs/spikes/sessions.md`.
- **Do:** From a command handler:
  1. Create a new session whose cwd is a given directory.
  2. Give it a title.
  3. Make it appear in the DSH session list under the right workspace.
  4. Send it a first prompt.
  5. Bring it into view in the page, if possible.
- **Acceptance:** A yes/no per step, with a working recipe or the blocking error. If a step is impossible, propose the fallback. The default fallback is to keep D-08's Phase 2 behaviour: the task runs in the current session.

### P0-08 · Spike: settings, secrets and storage · Lane B

- **Depends on:** P0-02.
- **Read:** DECISIONS D-10, `reference/dsh/packages/dsh-settings.md`, `dsh-storage.md`, `dsh-storage-domain.md`, `dsh-credentials.md`, `reference/dsh/skills/cordis-plugin-development/references/host-plugin.md` ("Config").
- **Owns:** `spikes/settings/`, `docs/spikes/settings.md`.
- **Do:**
  1. Declare a plugin `Config` with a `.volatile()` field. Change it from the plugin's own API. Confirm it persists, where (profile patch), and that it survives a restart.
  2. Open a storage domain with `defineDomain`, then write, read and restart.
  3. Read a key through `dsh-credentials`, and check whether a plugin can write one.
- **Acceptance:** A table of mechanism × works / persists where / survives restart / secret-safe, and a decision for each D-10 row.

### P0-09 · Spike: asking the user · Lane B

- **Depends on:** P0-02.
- **Read:** DECISIONS D-09, `reference/dsh/packages/dsh-user-questions.md`, `dsh-tool-ask-user.md`, `dsh-client-ui-user-questions.md`, `src/ask/types.ts` (bot-lobby's question shape), `src/workflow/workflow.ts` (`WorkflowDeps.ask/choose/askQuestions`).
- **Owns:** `spikes/questions/`, `docs/spikes/questions.md`.
- **Do:**
  1. From a tool running in the root agent, call `ctx.userQuestions.ask(...)` with:
     - a single-choice question;
     - a multi-select question;
     - a free-text-only question, for `WorkflowDeps.ask`;
     - four questions at once.
  2. Record the request shape, the answer shape, and how the DSH UI shows each.
  3. Call it from a child agent and record the refusal.
  4. Check what happens to a question left unanswered when the session is closed.
- **Acceptance:** A mapping table from bot-lobby `AskQuestion` / `AskOption` (`header`, `question`, `options[label, description, preview, image]`, `multiSelect`) and `AskResult` to DSH. Also: what is lost, and where previews go (question text, detail, or our page).

---

## Phase 1 · Core port (Lane A)

All Phase 1 tasks:
- copy files from this repo's `src/` into the new repo's `src/core/`;
- copy their tests into `test/core/`;
- follow [PORT-MAP.md](PORT-MAP.md) §2 for COPY and ADAPT.

**Common acceptance for every P1 task:**
- The ported tests pass with `node --test`.
- `npm run typecheck` passes.
- The ported files contain no `@earendil-works`, `typebox`, `.pi` or `pi --mode`.
- Any test that was dropped or rewritten is listed in the PR with the reason.

### P1-01 · Data root and config seam · Lane A · do first

- **Depends on:** P0-01.
- **Owns:** `src/core/state/project.ts`, `src/core/schemas/configuration.ts`, `src/core/state/config-store.ts`.
- **Do:**
  1. Port `state/project.ts`:
     - `dataRoot(root, dir = ".bot-lobby") = join(root, dir)`, with no legacy roots;
     - `detectProjectRoot` looks for `.bot-lobby` or `.git`.
  2. Replace `loadConfig`/`saveConfig`'s file I/O with a `ConfigStore` interface `{ load(): BotLobbyConfig; save(config): void }`, plus a file implementation for tests.
  3. Port `schemas/configuration.ts` per D-03:
     - model refs are `provider/model`;
     - thinking becomes an opaque effort id, or `inherit`;
     - keep the old level names only where Jev's effort routing needs an order;
     - remove Pi-only defaults.
- **Acceptance:** `project` and `persistence` tests pass, adjusted to the new paths. All later P1 tasks build on this, so merge it before they start.

### P1-02 · Schemas, text, agents · Lane A

- **Depends on:** P1-01.
- **Owns:** `src/core/schemas/{agent,task,findings}.ts`, `src/core/text.ts`, `src/core/agents/*`.
- **Tests:** `task`, `task-state`, `text`.

### P1-03 · The workflow engine · Lane A

- **Depends on:** P1-01, P1-02.
- **Owns:** `src/core/workflow/*`, `src/core/agents/backend.ts`, `src/core/commands/*`, `test/helpers/legacy-runner.ts`.
- **Do:**
  1. Port `workflow/*`, `pi/plan-checklist.ts`, `pi/start-flags.ts`, and `pi/commands.ts`'s pure parts (`parseCommand`, `runsReport`).
  2. Create the `AgentBackend` seam in `core/agents/backend.ts` (ARCHITECTURE §4) and change `WorkflowDeps.runProcess` to `backend`.
  3. Create `test/helpers/legacy-runner.ts` (TESTING.md §3).
  4. Make `workflow/brief.ts`'s memory per task.
- **Tests:** `transitions`, `brief`, `track`, `workflow`, `plan-checklist`, `kickoff`, `run-summary`.

### P1-04 · State, git and workspace · Lane A

- **Depends on:** P1-01, P1-02.
- **Owns:** `src/core/state/*` (except `project.ts`), `src/core/git/*`.
- **Do:**
  1. Port `state/*`, except `presence.ts`, plus `execution/git.ts` and `execution/workspace.ts`.
  2. Keep task inboxes and drop session inboxes.
  3. `changes.ts editedFile` gets DSH tool names after P0-03. Until then, keep a TODO and a test using Pi names.
- **Tests:** `archive`, `budget`, `changes`, `git`, `workspace`, `persistence`, and the core parts of `isolation`.

### P1-05 · Knowledge · Lane A

- **Depends on:** P1-01.
- **Owns:** `src/core/knowledge/*`, `src/core/lobby/knowledge-book.ts`.
- **Tests:** `knowledge`, `selector`, `compactor`, `knowledge-edit`, `knowledge-book`.

### P1-06 · Agents and roles · Lane A

- **Depends on:** P1-03.
- **Owns:** `src/core/agents/{agent-runner,fallback}.ts`, `src/core/master/*`, `src/core/roles/*`, `src/core/prompts/*`.
- **Do:**
  1. Port `execution/agent-runner.ts` onto the backend seam:
     - drop `env` and `onAsk`;
     - keep retries, stall handling, wrap-up, `AgentTime` and fallback;
     - `cancelAllRuns` aborts every live controller.
  2. Port `master/*`, `roles/*` and `prompts/compiler.ts`.
  3. Port `prompts/loader.ts`, resolving `prompts/` relative to the built file.
- **Tests:** `agent-runner`, `reliability`, `fallback` (core part), `master`, `scout`, `worker`, `reviewer`, `qa`, `researcher`, `prompts`, `e2e` (fake backend).

### P1-07 · Lobby models · Lane A

- **Depends on:** P1-03, P1-04, P1-05.
- **Owns:** `src/core/lobby/*`.
- **Do:** Port as PORT-MAP §2 describes:
  - `lobby/feed.ts` (per-session instances), `planner.ts`, `split.ts`, `quickfix.ts`, `pr-review.ts`, `pulls.ts`, `issues.ts` and `ask.ts`;
  - the data parts of `mini.ts`;
  - `pi/activity.ts`, `pi/run-summary.ts` and `pi/notify.ts` (texts);
  - the pure parts of `pi/ui.ts`, `pi/owner.ts`, `pi/events.ts` and `pi/settings-ui.ts`.

  Runs go through the backend seam.
- **Tests:** `split`, `lobby-ask`, `lobby-runners`, `lobby-state`, `pulls`, `mini`, `notify`, and the core parts of `route` and `auto-mode`.

### P1-08 · Excalidraw core · Lane A

- **Depends on:** P1-01.
- **Owns:** `src/core/excalidraw/*`, `test/core/excalidraw-*`.
- **Do:**
  1. Port `room.ts`, `scene.ts`, `client.ts`, `check.ts` and `sessions.ts`:
     - put `ExcalidrawBook` storage behind an interface;
     - drop `GRANT_ENV`.
  2. Port the pure parts of `tools.ts` (`readSessions`, `drawOnSession`, `pickSession`, `drawnText`) to `core/excalidraw/actions.ts`.
- **Tests:** `excalidraw-scene`, `excalidraw-room`, `excalidraw-sessions`, `excalidraw-tools` (pure parts), and `excalidraw-server.ts` as a helper. `socket.io` is a devDependency and `socket.io-client` a dependency.

### P1-09 · Jev core · Lane A

- **Depends on:** P1-01.
- **Owns:** `src/core/classifier/*`.
- **Do:** Port everything except `instance.ts` and `tools.ts`. The key source is injected (D-14), and the cache path is under `.bot-lobby`.
- **Tests:** `classifier`, `classifier-effort`, `classifier-files`, `classifier-knowledge`, `classifier-metrics`, `classifier-planning`, `classifier-triage`. `jev-e2e` stays as a live test.

### P1-10 · Prompts · Lane A

- **Depends on:** P0-03, P1-06.
- **Owns:** `prompts/*`.
- **Do:** Adapt every `prompts/*.md`:
  - DSH tool names (`docs/tool-names.md`);
  - remove Pi, `.pi`, `alt+…`, TUI tab and relay mentions;
  - designer questions go into the report (D-09);
  - keep every rule and format the parsers in `src/core/roles/*` read.
- **Acceptance:**
  - `prompts` tests pass.
  - A reviewer diffs old and new prompts and confirms no rule was lost. The PR includes that diff.

### P1-11 · File desk core · Lane A

- **Depends on:** P1-02.
- **Owns:** `src/core/desk/*`.
- **Do:** Port `desk/desk.ts` and `desk/session.ts` for in-process use. Drop `ipc.ts` and `client-extension.ts`.
- **Tests:** the core parts of `desk`.

### P1-X · Phase 1 exit check · Lane D

- **Depends on:** all P1 tasks.
- **Acceptance:**
  - `npm run check` green.
  - `grep -rnE "earendil|typebox|\.pi/|pi --mode|CONFIG_DIR_NAME" src test prompts` finds nothing.
  - `docs/parity.md` marks each core feature as ported, with its tests.

---

## Phase 2 · Host runtime (Lane B)

Every host module is installed from `src/host/index.ts` inside `ctx.effect` and uses only the DSH APIs its spike confirmed. Every P2 task adds tests in `test/host/` against the fake context (P2-13).

### P2-01 · Host skeleton and per-session state

- **Depends on:** P0-05, P1-01.
- **Owns:** `src/host/index.ts`, `src/host/state.ts`, `src/host/storage.ts`, `src/host/log.ts`.
- **Do:**
  1. Write `apply(ctx, config)` and its `inject` list.
  2. Resolve the project root per session: `detectProjectRoot(agent.session.header.cwd)`.
  3. Turn every process-wide singleton that was per-Pi-process into per-session or per-task state:
     - `lobbyFeed` and `runtime` (`lobby/runtime.ts`);
     - the brief memory;
     - `pendingRequest` in `pi/route.ts`;
     - the classifier scope;
     - the minimized flag, which is dropped;
     - live run registries.
  4. List each one in the PR.
- **Acceptance:** Two sessions in two projects keep separate state (host test). Unload removes everything (fake-ctx effect count back to 0).

### P2-02 · The subagent backend

- **Depends on:** P0-03, P0-04, P1-06.
- **Owns:** `src/host/backend.ts`, `src/host/activity.ts`.
- **Do:**
  1. Implement `AgentBackend` (ARCHITECTURE §4):
     - persona, `toolFilter`, `agentOptions`, `maxDepth: 0`;
     - stall, wrap-up and deadline timers;
     - time-up as a re-brief (D-06);
     - the `stopReason` → status mapping;
     - usage and cost.
  2. Map child events to `AgentStreamEvent`s and activity words.
  3. Feed the edit log from child write and edit tool results (F-12).
  4. Keep a registry for `cancelAllRuns`.
  5. Keep a map from child session id to its desk worker and Excalidraw grant.
- **Acceptance:**
  - Host tests: a fake `ctx.subagents` covers success, failure, abort, timeout, stall and steer.
  - Manual: in DSH Web, a worker run edits a file and returns a parsed `WorkerResult`.

### P2-03 · Engine dependencies and the `orchestrate` tool

- **Depends on:** P0-09, P1-03, P2-02.
- **Owns:** `src/host/deps.ts`, `src/host/tools/orchestrate.ts`.
- **Do:**
  1. Build `WorkflowDeps` from DSH:
     - `ask`, `choose` and `askQuestions` → `ctx.userQuestions.ask` with the oracle agent;
     - `notify` → the session's feed;
     - `backend` → P2-02;
     - `profile` → P2-08.
  2. Define `orchestrate` with the same parameters as `OrchestrateParams` (`src/workflow/workflow.ts:94`), converting TypeBox to the DSH DSL, including `enum` for `action`.
  3. `execute` resolves the task from `exec.agent` and calls `runWorkflowAction`.
- **Acceptance:** Host tests replay bot-lobby's `workflow` scenarios through the tool. Manual: a full-workflow task reaches `awaiting_approval`, and the approval question appears in DSH's UI.

### P2-04 · The oracle

- **Depends on:** P0-05, P2-03.
- **Owns:** `src/host/oracle.ts`.
- **Do:**
  1. `attach(agent, task)`:
     - tools and the master prompt section on `agent.ctx`;
     - web tools denied;
     - two-owner disposal.
  2. Inject task context when it changes (F-60).
  3. Deliver comments and task inbox messages with `agent.followup`.
  4. Drive auto mode (F-14).
  5. Master fallback per P0-05 (F-23), or defer it to P4-04.
- **Acceptance:** Host tests for attach and detach, and for auto-mode nudges and pauses after three. Manual: an auto-mode fast task completes unattended.

### P2-05 · Routing and quick fix

- **Depends on:** P2-02, P2-04.
- **Owns:** `src/host/tools/route.ts`, `src/host/quickfix.ts`.
- **Do:**
  1. Register `route_request` on the oracle.
  2. Run the quick-fix queue on the backend, with triage (F-02, F-36, F-44, F-45).
- **Acceptance:** The `route` and `lobby-runners` scenarios pass as host tests. Manual: "fix the typo in README" becomes a quick fix; "add a login page" becomes a task.

### P2-06 · Desk tools and the edit guard

- **Depends on:** P0-03, P1-11, P2-02.
- **Owns:** `src/host/tools/desk.ts`, `src/host/guard.ts`.
- **Do:**
  1. Define `claim_file`, `handover_file`, `my_files` and `wait_for_files`.
  2. Register a `ctx.tools.guard` that:
     - denies edit and write tools for scouts, the QA gate, planner seats and PR review;
     - for parallel workers, denies edits to files they have not claimed.
- **Acceptance:** Host tests port `desk.test.ts`'s scenarios. A guard test tries every edit tool name from `docs/tool-names.md` as a read-only role and expects each to be denied.

### P2-07 · Commands

- **Depends on:** P2-04.
- **Owns:** `src/host/commands.ts`.
- **Do:** Register `/bot-lobby` with every subcommand in F-20 except `minimize` and `restore`. `parseCommand` comes from core. Answers are short text results.
- **Acceptance:** A host test per subcommand. Manual: `/bot-lobby status` in DSH Web.

### P2-08 · Models and settings

- **Depends on:** P0-08, P1-01.
- **Owns:** `src/host/models.ts`, `src/host/settings.ts`, `src/host/api/settings.ts`.
- **Do:**
  1. List routes and models.
  2. Resolve efforts with `resolveModel`.
  3. Build the profile resolver (from `pi/model-support.ts`).
  4. Store settings per P0-08.
  5. Validate that every configured model still exists, with a warning like bot-lobby's `thinkingMismatches`.
- **Acceptance:** Host tests with a fake `ctx.llm`. Manual: changing the backend agent's model in the API changes the next worker's `agentOptions`.

### P2-09 · Excalidraw in the host

- **Depends on:** P1-08, P2-02, P0-08.
- **Owns:** `src/host/tools/excalidraw.ts`, `src/host/api/excalidraw.ts`.
- **Do:**
  1. Define the tools `excalidraw_read` and `excalidraw_draw`. They look up the grant by `exec.agent`: the oracle's grant, or the child's.
  2. Store the `ExcalidrawBook` in a storage domain.
  3. Keep a room pool per task.
  4. Add the endpoints.
- **Acceptance:**
  - The ported `excalidraw-tools` scenarios pass against the local test server.
  - Links never appear in API responses unmasked, except through `copyLink`.
  - The live test is optional (`BOT_LOBBY_LIVE_EXCALIDRAW=1`).

### P2-10 · Lobby services

- **Depends on:** P1-07, P2-02, P2-12a.
- **Owns:** `src/host/lobby/*`, `src/host/api/{tasks,plans,quickfix,activity,metrics,git,issues,knowledge,workspace}.ts`.
- **Do:** Rewrite the non-TUI parts of `lobby/runtime.ts`:
  - planning sessions per project;
  - save and split;
  - PR reviews;
  - knowledge book operations;
  - feed per session.

  Then implement ARCHITECTURE §6's endpoints.
- **Acceptance:** A host test per endpoint group, covering happy path, validation error and unauthenticated 401.

### P2-11 · Jev in the host

- **Depends on:** P1-09, P0-08.
- **Owns:** `src/host/classifier.ts`, `src/host/tools/find-files.ts`.
- **Do:**
  1. One classifier instance per host.
  2. Keys from credentials or env.
  3. A file scope per session cwd.
  4. The `find_relevant_files` tool, allowed per child through `toolFilter`.
  5. A "test connection" endpoint.
- **Acceptance:** Host tests with a fake HTTP client. The live test stays opt-in.

### P2-12a · API contract and mock server · do early

- **Depends on:** P0-06.
- **Owns:** `src/shared/api.ts`, `test/ui/mock-api.ts`.
- **Do:**
  1. Write the endpoint list from ARCHITECTURE §6 as TypeScript types: request DTO, response DTO and error codes.
  2. Build a mock implementation that serves fixture data, so Lane C can build every tab before the host is done.
- **Acceptance:** The client compiles against `src/shared/api.ts`. The mock serves every endpoint.

### P2-12b · API server

- **Depends on:** P2-12a, P0-06.
- **Owns:** `src/host/api/index.ts`.
- **Do:** The route, admission, `POST` with `content-type: application/json` only (R-09), JSON parsing, a 64 KiB body limit, input validation per endpoint, errors as `{ ok: false, error, code }`, and no caching.
- **Acceptance:** Host tests: 401 without admission, 404 for an unknown endpoint, 415 for a non-JSON request, 400 for invalid input, 413 for an oversized body.

### P2-13 · The fake context for host tests · do early

- **Depends on:** P0-04, P0-05. Draft shapes from API-NOTES earlier.
- **Owns:** `test/host/fake-ctx.ts`.
- **Do:** A fake Cordis context implementing only what the host uses:
  - `effect`, `on`, `inject`;
  - `tools` (register, restrict, guard, schemas);
  - `subagents.start`;
  - `userQuestions.ask`;
  - `commands.register`;
  - `systemPrompt.section`;
  - `llm` (list, resolve);
  - `webServer.register`, `connection.admit`;
  - `storageDomain`;
  - a fake `Agent` with `ctx`, `session`, `inject`, `followup`, `steer`.

  It counts live effects, so leaks can be tested.
- **Acceptance:** Used by every P2 test. Its README states which DSH version's shapes it mirrors.

### P2-X · Phase 2 walkthrough · Lane D

- **Depends on:** P2-01…P2-11.
- **Do:** In DSH Web with a real model, on a small sample repo, run and record the following in `docs/verification/phase2.md`, with screenshots and session exports:
  1. **Fast task:** a copy change completes with one run.
  2. **Full task:** scouts → proposal → approve → plan → two parallel workers with desk claims → QA gate fails once → fix → pass → complete.
  3. **Cancel:** cancel mid-implement; every child stops.
  4. **Budget:** `--budget 5m` reaches time-up, and the user is asked.
  5. **Quick fix:** a quick fix is routed.
  6. **Commands:** `/bot-lobby status`, `runs`, `accept`.
  7. **Excalidraw:** an Excalidraw read and draw with an assigned agent.
- **Acceptance:** All seven pass, or each failure has an issue with a clear reproduction.

---

## Phase 3 · The GUI (Lane C)

Every page:
- uses only `--dsw-alias-*` tokens and our own components;
- imports no DSH client UI package and uses no iframe;
- routes every string through locale;
- handles loading, empty and error states;
- works in light and dark themes;
- works at a narrow width (sidebar open).

Each tab task depends on **P3-02** and on its API endpoints. Build against the mock (P2-12a) first, then switch to the real host.

**Read first for every P3 task:**
- `reference/dsh/skills/cordis-plugin-development/references/ui-plugin.md`;
- `references/practices.md` §UI;
- the bot-lobby tab's render file named in PORT-MAP, for what the tab shows and in what order;
- the screenshot in `docs/*.png` of this repo, if there is one.

### P3-01 · UI kit and locale

- **Depends on:** P0-02.
- **Owns:** `src/client/ui/*`, `locale/*.json`.
- **Do:** Build these components:
  - Tabs, a split list/detail layout, Button, IconButton, Input, TextArea, Select, and a Switch (`role="switch"`, `aria-checked`);
  - Badge, progress pips, a Notice area, an EmptyState;
  - a Modal (focus trap, Escape), a Markdown view, a small Chart set (bars, meters), and a Spinner.

  Copy markup and behaviour from DSH's primitives if useful, as practices.md describes (rename the classes; tokens only). Hook up locale strings.
- **Acceptance:** A gallery page behind a dev flag renders every component in light and dark. The UI checks show no console errors.

### P3-02 · Page shell

- **Depends on:** P3-01, P2-12a.
- **Owns:** `src/client/index.tsx`, `src/client/pages/shell.tsx`, `src/client/hooks/*`.
- **Do:**
  1. Register the main page and the sidebar entry.
  2. Build the tab bar: Tasks, Plan, Quick fix, Metrics, Git, Knowledge, Excalidraw, (Issues), Settings. Remember the last tab in `localStorage`, wrapped in try/catch.
  3. Add a `usePoll(endpoint, payload, ms)` hook that pauses when the page is hidden, and an error boundary per tab.
  4. Add the notice area.
- **Acceptance:** The UI check opens the page and visits every tab, with no console errors.

### P3-03 … P3-10 · The tabs

One task per tab. **Acceptance for each:**
- Parity with its FEATURE-INVENTORY rows (listed below).
- A UI check that renders the tab with mock data, performs its main action, and screenshots light and dark.
- Keyboard: every action reachable by Tab/Enter.

| Task | Tab | Parity rows | bot-lobby render source |
| --- | --- | --- | --- |
| P3-03 | Tasks, plus a "New task" box with the flags as options | F-01, F-07, F-14, F-20, F-21, F-33 | `lobby/tabs/tasks.ts` |
| P3-04 | Plan (seats, rounds, questions form, draft with line comments, save and split) | F-34, F-35, F-40, F-41 | `lobby/tabs/plan.ts`, `lobby/planner.ts` |
| P3-05 | Quick fix | F-36 | `lobby/tabs/quickfix.ts` |
| P3-06 | Metrics (table, time bars, success meters, time share, classifier summary, filter) | F-37, F-58 | `lobby/tabs/metrics.ts` |
| P3-07 | Git (PR list, details, agent review with focus and stop, Jev's read, stale marks) | F-38, F-47 | `lobby/tabs/git.ts` |
| P3-08 | Knowledge (files, entries, edit, insert, delete, whole-file edit, notes) | F-30, F-31 | `lobby/tabs/knowledge.ts` |
| P3-09 | Excalidraw (≤ 5 sessions, add, new, remove, rename, assign, draw/look, check) | F-50 | `lobby/tabs/excalidraw.ts` |
| P3-09b | Issues (optional, off by default) | F-39 | `lobby/tabs/issues.ts` |
| P3-10 | Settings (per agent: model, effort, time limit, instructions, fallback; lobby switches; git isolation; Jev with test connection) | F-24, F-25, F-26 | `pi/settings-ui.ts` |

### P3-11 · The Agents view

- **Depends on:** P3-02, P2-10.
- **Owns:** `src/client/agents/*`.
- **Do:** Per session, show:
  - the activity log (each agent's steps, colour by agent);
  - the latest thought of each agent;
  - running agents with elapsed time and allotment (`12/30m`);
  - the task's track and plan progress.

  Home it in a right-sidebar tab, or a `conversation.view` tab. Decide after trying both, and record why (D-11).
- **Acceptance:** Parity with F-32 (activity and thoughts) and F-54. A UI check during a live run shows entries appearing.

### P3-12 · Composer dock and notices

- **Depends on:** P3-02.
- **Owns:** `src/client/dock.tsx`.
- **Do:** In a session with a task, show the status line: the plan step bar or stage, who is working, the budget, `● waiting` when a question waits, and buttons (open Bot Lobby, stop all agents, auto mode). Hide it in sessions with no task.
- **Acceptance:** Parity with F-55, F-22 and F-54.

### P3-13 · Tool cards

- **Depends on:** P3-02.
- **Owns:** `src/client/toolviews/*`.
- **Do:** Build renderers for `orchestrate` and `route_request` calls in the chat: the action, the target domains and the result summary, collapsed by default (F-59).
- **Acceptance:** A UI check in a session with a task shows the cards.

### P3-14 · UI checks in CI

- **Depends on:** P3-03…P3-13.
- **Owns:** `test/ui/*`, the CI workflow.
- **Do:** Run the Playwright checks against DSH Web in CI: install pinned DSH, add the plugin, use the mock API mode or a stub provider, and upload screenshots as artifacts.
- **Acceptance:** CI runs the UI checks on every PR.

---

## Phase 4 · DSH-native parity

| Task | What | Depends on | Parity rows |
| --- | --- | --- | --- |
| P4-01 | A task starts in its own DSH session, named after the task (setting: current session or new session, Q-03) | P0-07, P2-04 | F-19, F-53 |
| P4-02 | Git isolation: the task session's cwd is the branch checkout or worktree; worktree reported missing if removed | P4-01, P1-04 | F-17 |
| P4-03 | Continuable children: time-up "give it N more minutes" continues the same child; designer questions answered mid-run | P2-02, P0-09 | F-18, F-51 |
| P4-04 | Master fallback: switch the session's model on usage failure, tell the user | P0-05 | F-23 |
| P4-05 | Two DSH hosts on one project: presence file, ownership claims | P2-01 | F-21 |
| P4-06 | `source_check` tool for the researcher (port `web/read.ts checkSource` + `web/fetch.ts` guards) | P2-02 | F-52 |
| P4-07 | Designer previews and screenshots with questions (as P0-09 allows) | P0-09, P3-04 | F-51 |
| P4-08 | Live updates by stream instead of polling (if P0-06 found streaming works) | P0-06 | — |

**Acceptance for each:** its parity rows pass a manual check written into `docs/verification/phase4.md`, plus host tests where logic changed.

---

## Phase 5 · Hardening and release

| Task | What | Acceptance |
| --- | --- | --- |
| P5-01 | Live E2E: a scripted scenario on a fixture repo with a real model, opt-in by env (as bot-lobby's `BOT_LOBBY_E2E=1`) | The scenario from P2-X passes unattended in auto mode |
| P5-02 | DSH Desktop (macOS and/or Windows): install from npm through Plugin Manager; every tab works (R-02) | Checklist with screenshots, or a documented limitation and workaround |
| P5-03 | Performance: 200 tasks, 5 MB metrics, 20 KB knowledge files, 5 parallel workers; poll cost | The page stays responsive (< 100 ms tab switch); host CPU is idle when nothing runs |
| P5-04 | Security review against ARCHITECTURE §9 and RISKS | Each fence has a test or a written check |
| P5-05 | Docs: README (install, quick start, screenshots), CHANGELOG, `docs/dsh-compat.md` (supported DSH versions) | Reviewed by a second agent from a clean machine |
| P5-06 | Package and publish: `npm pack --dry-run` ships `lib`, `prompts`, `locale`, `icon.svg`, `cordis.patch.yml`, `README.md`, `LICENSE`; publish; install through Plugin Manager (`install_bundle`) | A fresh DSH profile installs it from npm and the page works |
| P5-07 | Parity sign-off | Every row of `docs/parity.md` is ported, replaced or dropped, with a link to its evidence |

---

## Changing the plan

The plan is a living document **in the new repo**, as `docs/plan.md`, copied from this file at P0-01. When a spike overturns an assumption:
1. The spike's PR updates the affected cards and decisions (`docs/decisions.md`, copied from DECISIONS.md).
2. It adds a line to the changelog at the bottom of `docs/plan.md`: date, task, what changed, why.
3. Tasks already in progress that are affected get a comment.

This folder in bot-lobby stays as the original handover. Don't edit it from the new repo's work.
