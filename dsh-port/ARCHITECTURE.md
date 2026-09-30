# Target architecture

This is how bot-lobby's parts land in a DSH plugin. Read [DECISIONS.md](DECISIONS.md) first; this file shows how the decisions fit together. The source paths on the left are bot-lobby's (this repo). The paths on the right are in the new repo.

## 1. Shape of the plugin

```
┌──────────────────────────── DSH host process (Node) ────────────────────────────┐
│ @a-t-h-i/dsh-bot-lobby — host half (lib/index.js: name, inject, apply)          │
│                                                                                 │
│  src/core/      ported from bot-lobby, no DSH imports (D-05)                    │
│    workflow/  schemas/  state/  knowledge/  master/  roles/  prompts/           │
│    classifier/  excalidraw/  desk/desk.ts  lobby-model/ (planner, quickfix …)   │
│                                                                                 │
│  src/host/      everything that touches DSH                                     │
│    index.ts      apply(ctx): builds the pieces below, each inside ctx.effect    │
│    config.ts     plugin Config + settings resolution against ctx.llm (D-03)     │
│    storage.ts    project root → <project>/.bot-lobby; secrets → storageDomain   │
│    backend.ts    AgentBackend over ctx.subagents.start('spawn', …)  (D-06)      │
│    oracle.ts     the task session's root agent: agent.ctx tools, prompt,        │
│                  inject/followup, auto mode, master fallback        (D-07)      │
│    deps.ts       WorkflowDeps for the engine: ask/choose → ctx.userQuestions     │
│    tools/        orchestrate, route_request, desk, excalidraw, find_files       │
│    guard.ts      ctx.tools.guard: edits need a desk claim; read-only roles       │
│    commands.ts   /bot-lobby … via ctx.commands.register                          │
│    api/          ctx.webServer route /bot-lobby/api/* behind connection.admit    │
│    activity.ts   child-agent events → activity log, thoughts, run records        │
└───────────────▲─────────────────────────────────────────────────────────────────┘
                │  POST /bot-lobby/api/<endpoint>  (JSON, same-origin login cookie)  D-12
┌───────────────┴──────────── DSH page (browser; Electron in Desktop) ────────────┐
│ client half (lib/client.js, loaded by window.__ModuleLoader__)                  │
│  src/client/                                                                    │
│    index.tsx     apply(ctx): slot registrations (below)                          │
│    api.ts        HostApi: the only place that knows the transport                │
│    ui/           own components, --dsw-alias-* tokens only (D-11)               │
│    pages/        Tasks · Plan · Quick fix · Metrics · Git · Knowledge ·          │
│                  Excalidraw · Issues · Settings                                  │
│    agents/       right-sidebar "Agents" tab: activity log + thoughts             │
│    dock.tsx      conversation.composer.dock status line                          │
│    toolviews/    tool.call.toolview for orchestrate / route_request              │
│  src/shared/     DTO types shared by host api/ and client api.ts                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Slots used by the client. All are named in DSH's READMEs. The first two are **verified**. For the dock, only this was verified: its registration is accepted and it shows nothing on the home page.

| Slot | Registration | For |
| --- | --- | --- |
| `main` (keyed) | `ctx.slots.register({ name: 'main', key: 'bot-lobby' }, Page)` | The Bot Lobby page |
| `sidebar.panellist` (list) | `{ name: 'sidebar.panellist', id: 'bot-lobby', order: 90, label: () => … }` | Its entry in the left sidebar; `ctx.layout.selectPanel('bot-lobby')` opens it |
| `conversation.composer.dock` | `{ name: 'conversation.composer.dock', id, order }` | Status line in a session (a session composer slot; not shown on the home page) |
| `sidebar.right.*` | see `reference/dsh/packages/dsh-client-ui-sidebar-right.md` | Agents tab per session |
| `conversation.view` | see `dsh-client-ui-conversation.md` | Alternative home for the Agents view |
| `tool.call.toolview` | see `dsh-tools.md` "Host presentation descriptors" | Cards for `orchestrate` calls |

Every registration goes through `ctx.slots.inject(<slot>, () => ctx.slots.register(...))`, which is how a registration is re-installed when its owning declaration returns.

## 2. Repository layout (new repo)

```
dsh-bot-lobby/
├── package.json          name, exports (".", "./client", "./package.json"), dsh.bundle + dsh.client
├── cordis.patch.yml      inserts the plugin row (id: bot-lobby)
├── locale/en.json        { "meta": { "title", "description" } } + UI strings
├── icon.svg              Plugin Manager card icon (≤ 256 KiB, relative path)
├── scripts/build.mjs     esbuild: host ESM + client CJS wrapped for __ModuleLoader__
├── prompts/              bot-lobby's prompts/*.md, adapted to DSH tool names (P1-10)
├── src/core/             pure logic (Phase 1)
├── src/host/             DSH host half (Phase 2)
├── src/client/           DSH client half (Phase 3)
├── src/shared/           API DTOs
├── test/core/            ported bot-lobby tests
├── test/host/            host tests with a fake ctx (test/host/fake-ctx.ts)
├── test/ui/              Playwright checks against a running DSH
└── docs/                 tool-names.md, spikes/*.md, dsh-compat.md
```

## 3. The three seams bot-lobby already has

bot-lobby was built with its Pi dependencies behind interfaces. The port rewrites those interfaces' **implementations**, not their callers.

| Seam | Where in bot-lobby | Callers (unchanged in the port) | DSH implementation |
| --- | --- | --- | --- |
| **`WorkflowDeps`** | `src/workflow/workflow.ts:126`: `ask`, `choose`, `askQuestions`, `notify`, `onUpdate`, `runProcess`, `hints`, `knowledge`, `classifier`, `triage`, `effort`, `profile` | the whole engine (`runWorkflowAction(params, deps)`, `workflow.ts:1670`) | `src/host/deps.ts` |
| **The agent runner** | `runPiAgent(options: PiRunOptions, run: ProcessRunner)` in `src/execution/pi-runner.ts:746`, called from `agent-runner.ts`, `lobby/planner.ts`, `lobby/quickfix.ts`, `lobby/pr-review.ts`; `ProcessRunner` also threads through `master/master.ts` and `master/research.ts` | scouts, workers, reviewer, researcher, quick fix, planner, split, PR review | `src/host/backend.ts` (§4) |
| **`LobbyHost`** | `src/lobby/view.ts:139`: everything the TUI needs from Pi and bot-lobby | the TUI (dropped) | its data methods become API endpoints (§6); its view logic becomes React |

## 4. Cutting the agent runner

Replace the Pi process runner with one injected function:

```ts
// src/core/agents/backend.ts (new; pure types)
export interface AgentRunOptions {
  cwd: string;                     // informational; in-process children use the parent session's cwd
  task: string;                    // the brief
  systemPrompt?: string;           // compiled role prompt → DSH persona
  tools?: readonly string[];       // role allow list, DSH tool names → toolFilter.allow
  model?: string;                  // "provider/model" (DSH route id + model id) or undefined = inherit
  thinking?: string;               // DSH reasoning-effort id, or undefined = model default
  timeoutMs: number;
  signal?: AbortSignal;
  onActivity?: (activity: string) => void;
  onEvent?: (event: AgentStreamEvent) => void;   // same union as PiStreamEvent minus Pi-only kinds
  stallTimeoutMs?: number;
  toolStallTimeoutMs?: number;
  wrapUpAtMs?: number;
  onStart?: (handle: { steer(text: string): void }) => void;
  time?: TimeLimit;                // unchanged from pi-runner.ts
  excalidraw?: Grant;              // unchanged from excalidraw/sessions.ts
}
export interface AgentRunResult {  // = PiRunResult
  status: "success" | "failed" | "cancelled" | "timeout";
  output: string;
  error?: string;
  usage: { input: number; output: number; cost: number; turns: number };
  model?: string;
  stalled?: boolean; wrappedUp?: boolean; timeUp?: boolean; extendedMs?: number;
}
export type AgentBackend = (options: AgentRunOptions) => Promise<AgentRunResult>;
```

**Port steps.**

1. Callers change `runPiAgent(options, run)` to `backend(options)`.
2. Every `run: ProcessRunner = spawnPiProcess` default becomes a required `backend: AgentBackend` parameter or dependency. Tests pass a fake backend: bot-lobby's fakes emit Pi JSON streams, while the new ones return `AgentRunResult` directly, which is simpler.
3. The Pi-only parts are deleted: argv building, JSON-stream parsing, `env`, `onAsk` relay, stdin RPC.

**The DSH backend** (`src/host/backend.ts`), per run:

```ts
const run = await ctx.subagents.start('spawn', {
  label: `${agentName} · ${taskId}`,
  prompt: [{ type: 'text', text: options.task }],
  parent: oracleAgent,                         // the task session's root Agent (exec.agent in orchestrate)
  signal: controller.signal,
  persona: options.systemPrompt,
  toolFilter: { allow: [...options.tools ?? [], ...deskTools, ...excalidrawTools(options.excalidraw)] },
  agentOptions: { provider, model, reasoningEffort },   // from D-03 settings; omit to inherit
  maxDepth: 0,
});
// observe run.localAgent (child Agent): events → onEvent/onActivity; usage → result.usage
// wrap-up: run.localAgent.steer(createUserMessage({ content: [...], source: { kind: 'plugin', plugin: 'bot-lobby' } }))
// deadline / stall / cancel: controller.abort(); await run.dispose()
const result = await run.result;              // { output: ContentBlock[], structured?, diagnostic?, stopReason }
```

| DSH `stopReason` | `AgentRunResult.status` |
| --- | --- |
| `completed` | `success` |
| `aborted` | `cancelled`, or `timeout` when our deadline fired |
| `error`, `max-tokens`, `refusal` | `failed` (`error` = `diagnostic`) |

The fallback-model logic (`execution/fallback.ts`, `withFallback`) is unchanged. It needs `looksUnavailable(error)` to recognise DSH's usage and availability errors: collect real examples in P0-04.

**Open points P0-04 must settle.**
- How to observe a child's tool calls, assistant stream, usage and cost. Candidates: `localAgent.ctx.on('agent/assistant-stream', …)`, `tools/result` scoped to the child, and `localAgent.session` events.
- Whether `persona` fully replaces or only prefixes the deployment prompt. It is documented as a scoped `deployment:persona-prefix`, so role prompts may sit after DSH's harness identity; this is acceptable.
- The exact DSH tool names for the role allow lists (P0-03).

## 5. The oracle in a DSH session

```
user: /bot-lobby add a login page     (or the panel's "New task")
  └─ commands.ts handler({ agent, rawInput })        agent = the session's root Agent
       ├─ parse flags (pi/start-flags.ts, pi/commands.ts parseCommand)
       ├─ route? (workflow/track.ts chooseRoute + Jev) ─ quick fix → QuickFixQueue (in the host)
       └─ startTask():
            ├─ core: create task (state/persistence.ts), triage, track
            ├─ oracle.attach(agent, task):
            │    agent.ctx: orchestrate + route_request tools, master prompt section,
            │               web tools restricted, desk/excalidraw oracle grants
            │    plugin effect keeps the disposer too (two owners)
            └─ agent.followup(kickoff message)          (pi/start-task.ts kickoff())
oracle model calls orchestrate({ action: 'scout' | 'propose' | 'implement' | … })
  └─ tools/orchestrate.ts execute(args, exec)
       ├─ exec.agent → which task/session is calling
       └─ core runWorkflowAction(args, deps)  deps = host/deps.ts:
            ask/choose/askQuestions → ctx.userQuestions.ask({ agent: oracleAgent, … })
            backend                 → host/backend.ts (children of oracleAgent)
            notify / onUpdate       → activity feed + API state
after each turn (turn/end) with changed task state → agent.inject(task context)
auto mode: timer → agent.followup(nudge)   (pi/owner.ts autoStep/autoNudge logic)
```

**Per-turn task context.** bot-lobby adds `masterTaskContext(...)` in `before_agent_start` on every turn (`src/pi/events.ts`). In DSH this must not come from the plugin rewriting the prompt (D-07). Instead:
- inject the context when it **changes** (after a transition, a delivered comment, a budget change);
- let the log carry it.

The orchestrate tool's own result already reports the new state, as it does in bot-lobby.

**Fresh context per task.**
- Pi: bot-lobby filters the model's messages (`src/pi/fresh-context.ts`).
- DSH (D-08): a task gets its own session in Phase 4, so no filtering is needed.
- Phase 2: the oracle works in the current session and simply carries its history, which is accepted for Phase 2.

## 6. Host API (`/bot-lobby/api/*`)

One endpoint per `LobbyHost` data need. Every endpoint is `POST`, JSON in and `{ ok, result | error }` out, and admitted by `ctx.connection.admit(req)`.

| Group | Endpoints (suggested names) | Backed by (bot-lobby module) |
| --- | --- | --- |
| Tasks | `tasks.list`, `tasks.get`, `tasks.archive`, `tasks.restore`, `tasks.delete`, `tasks.comment`, `tasks.auto`, `tasks.send`, `tasks.start`, `tasks.accept`, `tasks.pause`/`resume`/`cancel` | `state/persistence.ts`, `state/archive.ts`, `state/comments.ts`, `state/auto.ts`, `state/inbox.ts`, `pi/commands.ts` actions |
| Plans | `plans.list`, `plans.start`, `plans.discard`, `planner.state`, `planner.new`, `planner.say`, `planner.seat`, `planner.retry`, `planner.answer`, `planner.save` | `lobby/planner.ts`, `lobby/split.ts`, `state/backlog.ts`, `lobby/runtime.ts savePlan/answerPanel` |
| Quick fix | `quickfix.list`, `quickfix.submit`, `quickfix.cancel`, `quickfix.run`, `quickfix.task` | `lobby/quickfix.ts` |
| Activity | `activity.feed` (activity, thoughts, runs since a cursor) | `lobby/feed.ts`, `pi/run-summary.ts`, `pi/ui.ts` |
| Metrics | `metrics.records`, `metrics.classifier` | `state/metrics.ts` |
| Git | `git.pulls`, `git.pull`, `git.review`, `git.stopReview`, `git.read` | `lobby/pulls.ts`, `lobby/pr-review.ts`, `classifier/review.ts` |
| Issues | `issues.list`, `issues.get`, `issues.create` | `lobby/issues.ts` |
| Knowledge | `knowledge.files`, `knowledge.view`, `knowledge.edit`, `knowledge.insert`, `knowledge.delete`, `knowledge.note`, `knowledge.unnote` | `lobby/knowledge.ts` (KnowledgeBook), `knowledge/*` |
| Excalidraw | `excalidraw.list`, `excalidraw.add`, `excalidraw.new`, `excalidraw.remove`, `excalidraw.rename`, `excalidraw.assign`, `excalidraw.mode`, `excalidraw.check` | `excalidraw/sessions.ts` (ExcalidrawBook), `excalidraw/check.ts` |
| Settings | `settings.get`, `settings.set`, `models.list`, `models.efforts` | `schemas/configuration.ts`, `pi/settings-ui.ts` logic, `ctx.llm` |
| Workspace | `workspace.info` | `execution/workspace.ts describeWorkspace` |

**Rules for the API layer.**
- **Validate input** like a tool does: the page is a client like any other.
- **Return DTOs** from `src/shared/`, never raw internal objects.
- **Keep long operations asynchronous.** Planner rounds, reviews and checks return immediately, and the page polls their state.
- **Never return secrets.** Excalidraw links are returned masked (`maskedLink`), except to the explicit "copy link" action.

## 7. Data layout (`<project>/.bot-lobby/`)

The same tree as bot-lobby's `.pi/bot-lobby/` (README "Files on disk"), minus Pi-only parts:

```
.bot-lobby/
├── <Agent>/knowledge/        knowledge, standards, decisions per agent (Master, Designer, Backend, QA)
├── tasks/Task-…/             state.json, budget.json, auto.json, scratchpads, scout and research reports
├── worktrees/Task-…/         a task's worktree (workflow.gitIsolation = worktree)
├── reviews/pr-<n>.json       agent reviews of pull requests
├── knowledge-comments.jsonl  notes on knowledge entries
├── backlog/PLAN-….json       saved plans
├── archive/                  archived tasks, old knowledge, pre-edit versions
├── cache/files.json          classifier file excerpts
├── changes.jsonl             files each quick fix and worker edited
└── metrics.jsonl             one line per agent run and classifier call
```

**Dropped:**
- `sessions/`: Pi heartbeats. In DSH one host process runs every session, so presence comes from the DSH session list. Keep `state/presence.ts` only if two DSH hosts on one project must be detected (P4 decides).
- Per-session inboxes (`state/inbox.ts` session part): the DSH session list and `agent.followup` replace them.

**Core adaptation (P1-01).**
- `state/project.ts`: `dataRoot(root, dir = ".bot-lobby") = join(root, dir)`, with no `bot-lobby` subfolder and no legacy `dev-lobby`/`dev-house` roots.
- `detectProjectRoot`: looks for `.bot-lobby` or `.git`.
- Global config goes behind a `ConfigStore` interface: a file implementation for tests, a DSH implementation in the host (P0-08).

## 8. Concurrency and lifetime

- **One plugin instance per DSH host process** serves every session. Module-level singletons in bot-lobby are safe only where they were per-process in Pi *and* are still correct across sessions. Examples: `lobbyFeed`, `runtime`, the classifier instance, `briefs` in `workflow/brief.ts`, `pendingRequest` in `pi/route.ts`, the minimized flag. Most must become **per-session maps** keyed by session id, or per-task maps. P2-01 lists them and fixes each.
- **Registrations are effects.** Everything registered in `apply` goes through `ctx.effect(() => …register…)` so unload and HMR remove it. Per-agent registrations use `agent.ctx` and are also tracked in the plugin's own effect.
- **Children end with their parent.** A task's children are disposed when the task is cancelled, the session is disposed or the plugin unloads (`cancelAllRuns()` equivalent).
- **File locking.** The core already writes through temp files and renames. Two DSH hosts on the same project (Web and Desktop at once) are a known limitation, as two Pi processes were: task ownership (`ownerSessionId`) stays.

## 9. Security fences that must survive the port

| Fence | bot-lobby | Port |
| --- | --- | --- |
| Page API needs DSH login | n/a | `ctx.connection.admit(req)` on every request; 401 otherwise (**verified**) |
| Scouts / QA gate cannot edit | Pi `--tools` allow list | `toolFilter.allow` + `ctx.tools.guard` denying edit tools for read-only roles |
| Parallel workers don't clobber files | desk IPC + edit gating in the child process | in-process `FileDesk` + guard on edit tools by `execution.agent` |
| Board / web / PR text is untrusted | fenced in tool output, prompts say never follow it | unchanged (`excalidraw/tools.ts`, PR review prompt, DSH web tools already label results untrusted) |
| Room links are secrets | `~/.pi/bot-lobby/excalidraw/`, never in project; child sees only its links | DSH storage domain; child's tools see only granted sessions |
| Classifier never sends secrets | `classifier/files.ts` SECRET_EXCLUDES, gitignore | unchanged |
| Only the Master writes knowledge | engine | unchanged |
| Nothing posted to GitHub | `gh` read-only calls | unchanged |
