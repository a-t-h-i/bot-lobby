# Decisions

Each decision has an id so plans, code comments and PRs can cite it (`per D-07`).
**Status:**
- **Fixed**: the user decided it. Do not reopen it.
- **Adopted**: this handbook decided it. Change it only through a PR to this file that explains why.
- **Provisional**: it waits on a spike. The spike task is named, and its result either confirms the decision or replaces it.

Where a decision rests on DSH behaviour, the entry says whether that behaviour was **verified** (run in DSH `0.2.0-rc.2`) or **documented** (read in DSH's READMEs and type definitions, not yet run).

---

## D-01 · A standalone DSH plugin with no link to Pi · Fixed

The port is a DeepSeek Harness (DSH) plugin. It is not a Pi extension, and nothing links it to Pi:
- It does not import `@earendil-works/*` or `typebox`.
- It uses no `.pi` paths.
- It does not read Pi's config or auth.
- It does not migrate data from `.pi/bot-lobby/`.

bot-lobby's source is the **specification and a code donor**. Pure logic is copied over. Everything that talks to Pi is rewritten against DSH.

## D-02 · A new repository · Fixed

The plugin lives in its own repo, which the swarm initialises from [`templates/skeleton-ts`](templates/skeleton-ts). This `dsh-port/` folder stays in bot-lobby as the handbook and is never copied wholesale into the new repo.

Defaults, which the user may override (see Q-01):
- repo `a-t-h-i/dsh-bot-lobby`;
- npm package `@a-t-h-i/dsh-bot-lobby`;
- plugin row id `bot-lobby`.

Git author on every commit: `a-t-h-i <aonlysmith@gmail.com>`, with no co-author trailers.

## D-03 · Models come from the user's DSH setup · Fixed

Agents run only on providers and models the user has added to DSH, the way bot-lobby runs on the models added to Pi. The plugin bundles no provider, key or model list.
- **Listing:** `ctx.llm.listProviders()` returns routes `{ id, name }`, and `ctx.llm.listModels(route.id)` returns each route's models (**verified**). Pass `route.id`, not the display name: the name fails with *no adapter registered for provider "DeepSeek"*.
- **Per-agent setting:** `{ provider: route.id, model: model.id, reasoningEffort?: effortId }`, plus an optional fallback of the same shape.
- **`inherit`:** means the oracle session's own route.
- **Reasoning efforts:** bot-lobby's thinking levels (`off … max`) are replaced by each model's own efforts. `ctx.llm.resolveModel(provider, model)` returns them as `.reasoning.efforts[]` with opaque ids (**documented**). The settings page offers only the efforts the chosen model lists.
- **Scouts:** where bot-lobby said "scouts think at `low`", scouts use the model's lowest listed effort.

## D-04 · One bundle with a Host half and a Client half, built from TypeScript · Adopted

The package is a DSH bundle (`package.json` → `dsh.bundle.patch`) with two halves:

- **Host half:** `lib/index.js`, which exports `name`, `inject` and `apply(ctx)`.
- **Client half:** `lib/client.js`, registered in the page through `window.__ModuleLoader__.load({ id: <package name>, factory(require) })`.

Both are built with esbuild from `src/`. DSH packages, React and Node built-ins stay external, since DSH resolves them at runtime. [`templates/skeleton-ts/scripts/build.mjs`](templates/skeleton-ts/scripts/build.mjs) does this. The same bundle shape with plain JS is **verified** in [`templates/probe-js`](templates/probe-js); the TS build output is not yet run in DSH (task P0-02).

## D-05 · Keep bot-lobby's engine as pure TypeScript · Adopted

"LLMs decide, the engine enforces" is bot-lobby's core, and it is what the tests cover:
- the state machine;
- tracks and rosters;
- brief checks, approvals, the QA gate and budgets;
- knowledge, metrics and provenance.

This code is ported almost unchanged into `src/core/` in the new repo, with its tests. It stays free of DSH imports, so it can be tested without DSH.

It is **not** rebuilt on `dsh-workflow`, `dsh-plan-mode`, `dsh-goal` or `dsh-experimental-agent-team`. Those are different models, and the agent team is experimental with no stability promise. Borrow their ideas, not their runtime.

## D-06 · Subagents run in-process through `ctx.subagents` · Provisional (P0-04)

Every run that bot-lobby made as a `pi --mode rpc` process goes through `ctx.subagents.start('spawn', request)` in the host process. That covers scouts, workers, the QA gate, the researcher, quick fix, planner seats, the split planner and PR review.

`request` carries these fields (**documented**, `dsh-subagent/lib/types/types.d.ts`):

| bot-lobby | DSH `SubagentStartRequest` |
| --- | --- |
| task message | `prompt: ContentBlock[]` (`[{ type: 'text', text }]`) |
| compiled role prompt (`compilePrompt`) | `persona` (a scoped persona section on the child) |
| `--tools` allow list | `toolFilter: { allow: [...] }` (DSH tool names; see P0-03) |
| `--model`, `--thinking` | `agentOptions: { provider, model, reasoningEffort }` |
| no nesting | `maxDepth: 0`, so children cannot delegate |
| abort / time limits | `signal`, plus `run.dispose()` |
| parsed markdown report | `result.output` (text blocks); optionally `outputSchema` → `result.structured` |

**What changes:**
- **The cut point.** One call replaces the process runner: `runPiAgent(options, ProcessRunner)` becomes an injected `AgentBackend` (see ARCHITECTURE.md §4).
- **In-process children.** In-process children use the parent session's working directory, which constrains git isolation (see D-08).
- **Continuing a child.** Continuable children (`ctx.subagents.startContinuable`, `sendMessage`) replace "the same process carries on":
  - more time after time-up;
  - designer questions answered mid-run.

  This is Phase 4. Until then, a run that needs more time or answers is re-briefed as a new run.

## D-07 · The oracle is the root agent of the task's DSH session · Provisional (P0-05)

In Pi, the user's session becomes the Master. In DSH, the **root agent of the session that owns the task** is the oracle.

- **Scoped registration.** bot-lobby registers its oracle tools (`orchestrate`, `route_request`) and the master prompt on **that agent's scoped context** (`agent.ctx`), not globally. Ordinary DSH sessions are untouched. Every such registration is also tracked in the plugin's own effect (DSH practice: "two owners").
- **Task context.** Task state, plan checklist, budget and pending comments reach the model through `agent.inject()`. That call is logged as `agent/inbox/spliced`, which keeps the session log the source of truth. The plugin never rewrites the system prompt from its own files, and never listens to `system-prompt/assemble`.
- **Waking the oracle.** Auto-mode nudges, delivered comments and inbox messages use `agent.followup()`, which wakes the agent. `inject()` alone does not wake it.
- **Web tools during a task.** The oracle's web tools are hidden while a task runs, with `agent.ctx.tools.restrict({ deny: [...] })`.

## D-08 · One task per DSH session · Provisional (P0-07)

- **Phase 2.** A task runs in the session where it was started (`/bot-lobby <request>` or the panel), as it does in Pi.
- **Phase 4.** Each task gets a new DSH session named after the task (`Task-Change-Table-Font-27-09-2026`). This is bot-lobby's "fresh context per task" feature, done natively. When the task has a worktree, the session's working directory is that worktree, so every in-process child works there too.

This depends on creating a session with a given working directory from the plugin, visible in the session list. `ctx.agents.create({ sessionId, agentOptions, setup })` and `dsh-workspace` are **documented**; the combination is not yet run.

## D-09 · Only root agents ask the user · Adopted (P0-09 settles the details)

DSH refuses human questions from child agents (`dsh-user-questions`: *"A live child cannot open a human interaction"*). Therefore:

- **Engine questions** go through `ctx.userQuestions.ask()` with the oracle (root) agent:
  - approve, amend or decline;
  - clarify;
  - more time;
  - accept the QA round-limit.

  This implements `WorkflowDeps.ask/choose/askQuestions`.
- **Agent questions** come back in the agent's report, for example "DESIGN asks". The oracle then asks them with DSH's `ask_user_question`, and the answers go to the next run (or, in Phase 4, to the continued child).
- **The questionnaire tool.** bot-lobby's own `ask_user_question` tool, its TUI, the image/PNG renderer and the relay protocol are **dropped**. DSH's tool and answer UI replace them. What DSH's question shape cannot carry, such as option previews and images, goes into the question's text or detail, or is shown in the Bot Lobby page (P0-09 decides which).

## D-10 · Where data lives · Adopted

| Data | bot-lobby (Pi) | DSH port |
| --- | --- | --- |
| Project data: tasks, knowledge, backlog, metrics, changes, reviews, knowledge comments, archive, worktrees | `<project>/.pi/bot-lobby/` | `<project>/.bot-lobby/` (same file formats) |
| User settings (models per agent, limits, lobby switches) | `~/.pi/bot-lobby/config.json` | the plugin's DSH `Config` (volatile fields, editable in the UI, persisted in the profile's patch layer) or a DSH storage domain (P0-08 decides) |
| Excalidraw room links (they are keys) | `~/.pi/bot-lobby/excalidraw/` | a DSH storage domain under the DSH home: never in the project |
| API keys (Jev, search providers) | Pi auth / env | DSH credentials (`dsh-credentials`) or env |

**Why keep project data as files:**
- The state layer is file-based, crash-safe (temp file + rename) and heavily tested.
- Knowledge is Markdown the user reads and edits.
- DSH storage domains are host records under the DSH home, not project files.

Following DSH practice, no new session event types are appended. Session-derived views use projections of existing events.

## D-11 · UI surfaces · Adopted

The TUI becomes React components in DSH slots:

| bot-lobby | DSH |
| --- | --- |
| The lobby window and its tabs | A **Bot Lobby** page: the `main` slot keyed `bot-lobby`, plus a `sidebar.panellist` entry (**verified**). It holds the tabs Tasks · Plan · Quick fix · Metrics · Git · Knowledge · Excalidraw · (Issues) · Settings |
| Lobby tab: the conversation with the oracle | The DSH chat of the task's session (not rebuilt) |
| Lobby tab: activity log + thoughts | An **Agents** tab in the right sidebar (`sidebar.right.*`), or a `conversation.view` tab beside Chat/Trajectory (P3 decides; community plugin `dsh-agent-canvas` uses `conversation.view`) |
| Status line under the editor | `conversation.composer.dock`. Its registration was accepted and it rendered nothing on the home page (**verified**); rendering inside a session is documented, and P3-12 checks it first |
| Tool renderers (`orchestrate` cards) | `tool.call.toolview` renderer |
| Questionnaire overlay | DSH's own question UI (D-09) |
| `ctx.ui.notify` toasts | The Bot Lobby page's own notices plus DSH notifications if exposed (P3) |
| Settings dialogs | A Settings tab in the Bot Lobby page |

These UI rules come from DSH practice, `reference/dsh/skills/cordis-plugin-development/references/practices.md`:
- React components in slots.
- Styles use only `--dsw-alias-*` theme tokens.
- No import of any DSH client UI package, such as `dsh-client-ui-primitives`. Copy the markup instead.
- No iframes and no DOM writes outside our components.
- Every visible string goes through the locale service.
- Light and dark themes both work.

## D-12 · Client↔Host transport: a JSON API on a host web route · Provisional (P0-06)

The page calls `POST /bot-lobby/api/<endpoint>` with `credentials: 'same-origin'`. The host registers that route with `ctx.webServer.register({ kind: 'prefix', path: '/bot-lobby', handler })` and admits requests with `ctx.connection.admit(req)`. This is **verified in DSH Web**: unauthenticated requests get 401, and the logged-in page gets 200.

- **Why not `ctx.connection.rpc.handle()`:** it fails from a third-party plugin in rc.2 (*cannot get property "webServer" without inject*, raised on the connection service's own context), so it is not used. Re-test it on every DSH upgrade.
- **The interface.** All page→host calls go through one `HostApi` interface in `src/client/api.ts`, so the transport can change in one place.
- **Desktop is unproven.** The Desktop (Electron) app loads its UI over `file://` and *"carries fetch over an IPC bridge"* (`dsh-host-webserver` README). Whether plugin routes are reachable there is **not verified** (see R-02).
- **Live updates.** Phase 3 polls every 1–2 s, as the TUI re-read its files every 2 s. A stream can come later.

## D-13 · Tool names and contracts carry over · Adopted

These tools keep bot-lobby's names, parameters and behaviour:
- `orchestrate` and `route_request`;
- the desk tools `claim_file`, `handover_file`, `my_files` and `wait_for_files`;
- `excalidraw_read` and `excalidraw_draw`;
- `find_relevant_files`.

The tests and prompts that name them keep working.

- **Registration.** Tools are defined with `defineTool` from `@deepseek-ai/dsh-tools` (**verified**) and registered where they are needed: the oracle's tools on its `agent.ctx`, and agent tools globally but visible only through each child's `toolFilter`.
- **Desk guard.** "Edits need a desk claim" becomes `ctx.tools.guard(execution => …)`. The guard is synchronous and monotonic, sees `execution.agent`, and denies edit tools on files the calling worker has not claimed.
- **Built-in tool names.** Pi's `read, bash, edit, write, grep, find, ls` have DSH names (from `dsh-tool-fs`, `dsh-tool-fs-search`, `dsh-tool-bash`, …) that are **not yet listed**. P0-03 records them in the new repo's `docs/tool-names.md`, and the prompts are updated to match.
- **Web tools.** The researcher uses DSH's `web_search` and `web_fetch` (`dsh-tool-web`). bot-lobby's own search/fetch stack is not ported in Phase 2. Its pure `source_check` may be ported later as a plugin tool (P4).

## D-14 · Jev (the classifier) stays optional · Adopted

- **Code.** The classifier code (`src/classifier/*`) is pure and ports as-is.
- **Keys.** It reads keys from DSH credentials or env (`OPENCODE_API_KEY`, `TYPESAFE_API_KEY`), never from Pi's auth. It is off by default.
- **Scope.** All eight decisions are kept, each behind its own switch (see FEATURE-INVENTORY F-40…F-47).

## D-15 · Excalidraw ports as-is · Adopted

The room protocol, scene logic, session book and tools (`src/excalidraw/*`) are pure Node plus `socket.io-client` and port unchanged.
- **Where rooms run:** in the host half.
- **Grants:** replaced by `toolFilter` plus a per-run grant map inside the plugin. No env variable is needed, because children are in-process.
- **Links:** kept in the DSH storage domain (D-10).
- **The tab:** becomes a React tab. An SVG preview of the board is a Phase 5 option.

## D-16 · GitHub through the `gh` CLI, nothing posted · Adopted

- **Unchanged:** the Git tab (pull requests, agent review, Jev's read) and the Issues tab keep calling `gh` through `child_process` in the host.
- **Reviews:** stored in `.bot-lobby/reviews/`.
- **Rule:** nothing is posted to GitHub.

## D-17 · Pin the DSH version · Adopted

Every DSH release so far is a pre-release, and plugin APIs changed between RCs.
- **Pin:** pin `@deepseek-ai/dsh` exactly in `devDependencies` and CI (`0.2.0-rc.2` when this was written).
- **The plugin's range:** state the supported DSH range in the plugin's README.
- **Upgrades:** upgrade on purpose, one PR per upgrade, running the checklist in AGENT-GUIDE.md §7.

## D-18 · Licensing · Adopted

- **The plugin:** Apache-2.0, the same author and licence as bot-lobby, so code copies freely.
- **Vendored DSH docs** (`reference/dsh/`): MIT, © 2026 DeepSeek. `@deepseek-ai/cordis`: MIT, © 2021-present Shigma. Keep both notices if any of it is copied.

## D-19 · Tooling · Adopted

- **Language:** TypeScript strict, as in bot-lobby's tsconfig.
- **Runtime:** Node ≥ 22. Tests are `.ts` files run directly with `node --test`, as in bot-lobby.
- **Tools:** esbuild for bundling, `playwright-core` for UI checks.
- **Runtime dependencies:**
  - `socket.io-client` for Excalidraw;
  - nothing else without a PR that says why;
  - DSH packages and React come from DSH at runtime, and are never bundled.

## D-20 · No new session event types · Adopted

Per DSH practice: task state lives in `.bot-lobby/` files, per-session views derive from existing events through `ctx.sessionProjections`, and nothing calls `Session.append()` with a custom `type`.

---

## Open questions for the user

Each question has a default. The swarm proceeds on the default until the user answers.

| Id | Question | Default |
| --- | --- | --- |
| Q-01 | Repo and package names | `a-t-h-i/dsh-bot-lobby`, `@a-t-h-i/dsh-bot-lobby`, row id `bot-lobby` |
| Q-02 | Keep the Issues tab? | Yes, off by default behind a setting, as in bot-lobby |
| Q-03 | Should every task open its own DSH session? | Yes, from Phase 4, with a setting to run in the current session |
| Q-04 | Where to publish | npm (public), plus whatever plugin listing DSH's Plugin Manager reads, if any |
| Q-05 | Keep Jev? | Yes, optional and off by default |
| Q-06 | Minimum DSH version to support | The version pinned when Phase 5 starts; no older RCs |
