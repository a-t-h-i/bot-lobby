# Bot-Lobby

A Pi-native TypeScript extension that turns Pi into a structured multi-agent
software engineering orchestrator.

`/bot-lobby <request>` starts a task. One Master agent (the Pi session you are
already talking to) coordinates three domain agents — **Designer+Frontend**,
**Backend**, and **QA** — each able to act as a **Scout** or **Worker** in an
isolated Pi subprocess. **QA** also runs the read-only **Reviewer** role as the
single quality gate. A read-only **Researcher** role can be
summoned for cited internet evidence.

The core rule: **LLMs make decisions; the engine enforces the rules.** Agents
propose work; the extension validates state transitions, role permissions,
approval gates, and completion authority through one `orchestrate` tool.

## Install

Install the published package from npm:

```bash
pi install npm:@a-t-h-i/bot-lobby
```

Pi records the declaration and loads the package's extension and prompt layers
from Pi's own npm directory; `pi list` shows what is installed. Use
`pi -e npm:@a-t-h-i/bot-lobby` to try it for a single invocation without adding
it to settings.

### Advanced and local options

Reference the entry file from `settings.json` (global, or project
`.pi/settings.json`):

```json
{
  "extensions": ["/absolute/path/to/bot-lobby/src/index.ts"]
}
```

Or, for auto-discovery and `/reload` support, add a one-line shim at
`.pi/extensions/bot-lobby/index.ts` (project) or
`~/.pi/agent/extensions/bot-lobby/index.ts` (global):

```ts
export { default } from "/absolute/path/to/bot-lobby/src/index.ts";
```

Or run it for a single session without installing: `pi -e ./src/index.ts`.

The published package ships `prompts/` alongside `src/`, so an npm install loads
the prompt layers without a local checkout. A source checkout must keep
`prompts/` beside `src/`, because the loader resolves the directory relative to
its own source files.

## Recommended companion: ask-user-question

Bot-lobby's `clarify` step and proposal ceremony work best when the Master can ask
you a concrete question with typed options instead of guessing. The
[ask-user-question](https://github.com/juicesharp/rpiv-mono) extension adds an
`ask_user_question` tool — one or more questions, each with described options and
a free-form answer, and optional previews — which fits this system directly: the
Master asks during `clarify`, you answer in a single panel, and the decision is
recorded in the task.

```bash
pi install npm:@juicesharp/rpiv-ask-user-question
```

It is optional. Without it `clarify` still works through Pi's built-in
`select`/`input` prompts (or the Master asks in plain text), just with less
structure.

## Usage

```
/bot-lobby <request>            Start a task and hand it to the Master
/bot-lobby status [taskId]      Active task, state, approvals, blockers, legal next states
/bot-lobby tasks                Task list (plus any unreadable task state)
/bot-lobby pause | resume       Stop or allow further workflow steps
/bot-lobby cancel [taskId]      Abandon a task (scratchpad retained)
/bot-lobby approve              Approve the current proposal
/bot-lobby amend <text>         Record an amendment; the Master re-proposes
/bot-lobby decline              Decline the proposal and abandon the task
/bot-lobby knowledge            Knowledge file sizes vs. the compaction threshold
/bot-lobby config               Effective configuration and its file path
/bot-lobby settings             Edit per-agent model, thinking, and instructions
/bot-lobby-settings             Same as the settings subcommand
/bot-lobby minimize|restore     Hide or restore bot-lobby for this session (ctrl+shift+m)
/bot-lobby claim <taskId>      Take ownership of an orphaned task
```

## Sessions and ownership

A task is owned by the pi session that started it (`ctx.sessionManager` id,
`ownerSessionId` on the task). Only the owning session shows the zen widget and
injects the Master prompt; any other pi session in the same project stays
ordinary pi. Each session owns at most one active task, so several sessions can
drive their own tasks concurrently over the shared per-project task and
knowledge files. A task with no owner (legacy state, or one created before this
is claimed by the first session that runs a state-moving `orchestrate` action;
`/bot-lobby status`, `tasks` and the widget never claim. Take over an orphaned or
foreign task — including one whose owning session has ended — explicitly with
`/bot-lobby claim <taskId>`.

`/bot-lobby minimize` (or `ctrl+shift+m`) collapses the widget and skips the
Master prompt for that session only, so plain prompts go straight to standard
pi; ownership is kept, and `/bot-lobby restore` resumes exactly where you were.

Subcommands only win when no free-form text follows, so `/bot-lobby status page
redesign` still starts a task named "status page redesign".

Press `Esc` during a run to abort the current step: the signal propagates to
every in-flight subagent process.

While the owning session has a task active, its transcript switches to a zen view: `orchestrate` rows
and the built-in spinner are hidden, and a widget above the editor animates the
task. At 72 columns and wider it draws a large scene: a header box with the task
title and state in its top border, a progress bar, and a metadata row with
elapsed time, quiet-mode hint and task id; a spinner line above the oracle
naming the master's live tool activity (`⠋ delegating`, `⠋ planning`) or
`dormant` when the task is paused or finished; an oracle tower with its ORC
door, animated orb, window eyes and seven-column mouth;
four animated slots — DEV, DESIGN, RESEARCH and QA — each with a status face, a
caption and two status rows: while running, a braille spinner beside the agent's
live one-word activity (for example `⠋ reading` or `⠋ editing`) with its elapsed
time on the row beneath; otherwise the coloured status glyph and state word over
that elapsed time; and a full-width TASKS checklist windowed on the current
step. Narrower
terminals keep the
boxed banner, header and compact animated strip, whose working line names the
newest running agent's activity and elapsed time. Each sprite rests on one calm
face and, independently every 20–30 s, briefly blinks (~500 ms) or emotes
(~2 s, stepping through its kaomoji frames); the oracle's mouth moves with its
adaptive clock — 250 ms while work is live, 1 s when idle and ~120 ms while an
expression plays — and their faces, colours and words follow each agent's status
(working, idle, done, failed). The large scene's rest and blink frames stay the
five-column ASCII eyes, while its emote frames are status-aware kaomoji: nervous
while working, happy when done (QA flexes and dances), scared on failure. The
header progress bar is plan-derived.
New tasks get a <=3-word title derived from the request (for example "create
landing page") plus an id `TASK-<slug>` built from the full request, so the banner
and header stay concise; older `TASK-<timestamp>` tasks keep loading untouched.

## Lifecycle

```
REQUEST → CLARIFY → (CHALLENGE) → SCOUT → SYNTHESIS → PROPOSAL
  → APPROVE / AMEND / DECLINE → PLAN → WORK → QA GATE → (FIX → QA GATE)
  → KNOWLEDGE UPDATE → CLEANUP → COMPLETE
```

States: `created`, `clarifying`, `scouting`, `synthesizing`,
`awaiting_approval`, `planning`, `implementing`, `reviewing`, `blocked`,
`completed`, `abandoned`. Only the transitions in
`src/workflow/transitions.ts` are legal, plus abandonment from any
non-terminal state.

A trivial, single-domain request may go straight from `clarifying` to
`awaiting_approval` to `planning`, skipping the Scout round and the proposal
ceremony; the Master is instructed to reserve that shortcut for small, obvious,
one-domain changes.

## The `orchestrate` tool

One tool, every workflow step. It is the Master's only way to move a task.

| Action | State required | Effect |
|---|---|---|
| `clarify` | created, clarifying | Ask the user a question (or return it for the Master to ask) |
| `scout` | created…synthesizing | Run domain reconnaissance in parallel; repeat later to target-verify a claim |
| `research` | any active | Summon the read-only Researcher (domain + instruction) for cited internet evidence; persists the report for audit |
| `propose` | created…awaiting_approval | Record the proposal, request approval, handle approve/amend/decline |
| `plan` | planning | Record the internal plan (all §12 areas required) |
| `implement` | planning, implementing, reviewing | Delegate one step to a domain Worker |
| `qa` | implementing, reviewing | Run the QA gate — the only review — over the whole feature |
| `knowledge` | any active | Record Master-approved knowledge or a decision |
| `compact` | any active | Replace a knowledge file with a rewritten version (archived) |
| `resolve_approval` | any active | Approve or reject a Worker's dependency, architecture or pushback request |
| `complete` | reviewing | Check every gate, record history, drop scratchpads, finish |
| `block` / `resume` | implementing, reviewing / blocked | Escalate or continue |
| `decide`, `status`, `cancel` | any active | Record a decision, inspect, abandon |

## Research

`orchestrate action=research` summons a read-only **Researcher** for one domain
(reusing that domain's model, thinking level, and prompt layers) with a `domain`
and an `instruction`. It is legal in any non-terminal state, is never callable by
workers, and never changes the task state or `task.domains`.

The researcher has read-only repository tools plus `web_search`, `fetch_content`,
`source_check`, and `get_search_content`. It must cite a URL (and a date or
version where the source states one) for every claim, list what it could not
verify, and state a confidence level; it never implements, writes, or installs
anything. Reports are persisted for audit as `research-<domain>.json` and
appended to `research.md` in the task directory, and the tool returns a bounded
summary to the Master.

Those web tools come from the separate `pi-web-access` extension. The pi CLI
silently ignores unknown `--tools` names, so without it the researcher loses
internet access and degrades to repository-only; the returned message says so
explicitly instead of presenting it as findings.

Research is evidence only: it is not injected into worker, reviewer, or QA
prompts, and it never enters persistent knowledge automatically. The Master must
decide to record it with `action=knowledge`.

## What the engine enforces (not just prompts)

| Rule | Enforcement |
|---|---|
| A step cannot run out of order | State machine validated in `runWorkflowAction` |
| No implementation before user approval | `implement` rejects any pre-approval state |
| Scouts cannot modify anything | Spawned with `--tools read,grep,find,ls` |
| The QA gate cannot modify implementation | Read-only Reviewer tools plus `bash` for tests/analysis |
| Dependency and architecture changes need approval | Worker output is parsed; pending approvals block that domain until resolved |
| An agent pushback blocks its domain until the oracle decides it | A pushback is recorded as a pending approval; `assertNoPendingApprovals` blocks that domain, and only the Master resolves it |
| QA review loops are bounded | `maxReviewIterations`; exceeding it forces the blocked path |
| Only the Master writes knowledge | Agents only propose; one dedup-aware write path |
| Research never becomes knowledge by itself | Reports are artifacts; only the Master's `action=knowledge` writes persistent knowledge |
| Completion is gated | Plan, passing QA gate, no blockers or pending approvals |
| A task has one owning session | Ownership is stamped at start; a foreign session is rejected unless it claims the task |
| Proposals are short and scannable | `validateProposal` rejects non-bullet or over-long proposals before they reach the user |
| Failure is never success | Unknown verdicts, empty output, crashes, and timeouts map to failed/timeout/blocked |
| Task state is never corrupted by a crash | Single mutation point + disk state; interrupted tasks resume from their state |

Domain boundaries between *writers* remain prompt-enforced and Master
coordinated: Workers run sequentially and only the affected domain is asked to
change its own code. Worktree isolation is deferred (§14 of the plan).

## Configuration

Per-agent settings are edited interactively with `/bot-lobby settings` (or the
top-level `/bot-lobby-settings`) and persist globally to
`~/.pi/bot-lobby/config.json`:

```json
{
  "master": { "model": "inherit", "thinking": "high", "instructions": "" },
  "agents": {
    "designer": { "model": "inherit", "thinking": "medium", "instructions": "" },
    "backend": { "model": "inherit", "thinking": "medium", "instructions": "" },
    "qa": { "model": "inherit", "thinking": "high", "instructions": "" }
  },
  "workflow": {
    "maxReviewIterations": 2,
    "maxParallelScouts": 3,
    "requireApprovalForFeatures": true,
    "requireApprovalForDependencies": true,
    "requireApprovalForArchitectureChanges": true,
    "agentTimeoutMs": 900000,
    "maxAgentRetries": 1
  },
  "knowledge": {
    "compactionThreshold": 20000,
    "backupCount": 1,
    "scratchpadMaxParagraphs": 4,
    "scratchpadMaxChars": 2000
  }
}
```

`"model": "inherit"` uses the session's model; any other value is passed to the
subagent as `--model` (e.g. `"anthropic/claude-sonnet-4-5"`). `thinking` must be
one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; an invalid value
falls back to the default. `instructions` is appended to that agent's compiled
system prompt as a `Custom Instructions` layer (empty layers are dropped). The
master's model and thinking are applied to the live session when a task starts
and when you change them in the settings TUI. A malformed config falls back to
the defaults; `BOT_LOBBY_CONFIG_DIR` overrides the config directory.

The model picker is searchable: type to fuzzy-filter by `provider/id` or model
name, `inherit` and `custom…` stay reachable, and ↑↓/enter/esc behave as before.

### Prompts and custom instructions

Every agent's system prompt is composed, never duplicated, from the baked-in
Markdown in `prompts/`: `global.md`, the domain file (`designer.md`,
`backend.md`, `qa.md`), the role file (`scout.md`, `worker.md`, `reviewer.md`,
`researcher.md`) with that role's output contract, and then the task context,
selected standards/knowledge/decisions, and workflow context. `src/prompts/compiler.ts`
joins the layers and drops empty ones, so an agent never sees an empty heading.
`prompts/master.md` is the Master's operating prompt and is injected only into the
live session that owns the task.

Your own prompt is injected as a `Custom Instructions` layer on top of those
built-ins. Set it per agent — `master`, `designer`, `backend`, `qa` — either in
config (`instructions`) or via `/bot-lobby settings` → Instructions. It applies to
every run of that agent: the Master's instructions to the orchestrating session,
and a domain's instructions to its Scouts, Workers and (for QA) the Reviewer. The
layer is additive — the built-in prompts still define role boundaries, permissions
and the output contract — and an empty layer is dropped.

## On-disk layout

```
.pi/bot-lobby/
├── Master/knowledge/           knowledge.md, standards.md, decisions.md, completed-tasks.md
├── Designer/knowledge/         knowledge.md, design-language.md, decisions.md, completed-tasks.md
├── Backend/knowledge/          knowledge.md, engineering-standards.md, decisions.md, completed-tasks.md
├── QA/knowledge/               knowledge.md, testing-standards.md, decisions.md, completed-tasks.md
├── archive/<Agent>/            previous knowledge versions (outside all retrieval paths)
└── tasks/TASK-<stamp>/
    ├── state.json              the task record (kept after completion)
    ├── proposal.md             scratchpads: deleted on completion
    ├── plan.md
    ├── designer.md backend.md qa.md
    ├── scout-<domain>.json     structured scout artifacts
    ├── research-<domain>.json  structured research reports (kept for audit)
    └── research.md             appended research log (kept for audit)
```

The global config lives outside this per-project tree, at
`~/.pi/bot-lobby/config.json`.

After the dev-house → dev-lobby → bot-lobby renames, reads merge every tree:
`listTasks` and `taskHealth` enumerate `.pi/bot-lobby`, `.pi/dev-lobby` and the
pre-rename `.pi/dev-house` tree with the newest root winning per task id,
`loadTask` and knowledge reads fall back per file, and the newest existing of
`~/.pi/bot-lobby/config.json`, `~/.pi/dev-lobby/config.json` and
`~/.pi/dev-house/config.json` is still read while no bot-lobby config exists.
Writes always target the bot-lobby paths, and `ensureProjectStructure` seeds the
new knowledge files from the newest pre-rename tree so legacy knowledge is
migrated rather than shadowed by defaults.

Scratchpads are capped (`scratchpadMaxParagraphs`, `scratchpadMaxChars`) by the
engine, not by prompt discipline.

## Architecture

```
src/
├── index.ts                  Extension entry: lifecycle, commands, orchestrate tool
├── master/
│   ├── master.ts             Scout/Worker/Reviewer delegation and artifact persistence
│   ├── research.ts           Researcher delegation and research artifact persistence
│   ├── synthesis.ts          Bounded summaries, shared-file and gap detection
│   └── decisions.ts          Decision log, review-loop rule, completion gates
├── agents/                   Domain specs (designer, backend, qa) + registry
├── roles/                    Scout/Worker/Reviewer/Researcher specs, contracts, parsers
├── workflow/
│   ├── workflow.ts           The engine: every action, every guard
│   ├── transitions.ts        Legal state machine
│   └── approvals.ts          Dependency/architecture/pushback approval bookkeeping
├── execution/
│   ├── agent-runner.ts       Single/parallel/sequential runs, cancellation, retries
│   ├── pi-runner.ts          Isolated `pi --mode json` subprocess + stream parsing
│   └── git.ts                Diff evidence for reviewers
├── knowledge/                Paths, store (single write path), selector, compactor
├── prompts/                  Layer loader + compiler
├── state/                    Project root, config, task persistence, state mutation
├── schemas/                  Task, agent, findings, configuration types
└── pi/                       Commands, lifecycle, orchestrate tool, status widget
prompts/                      global, master, designer, backend, qa, scout, worker, reviewer, researcher
```

Prompts are composed, never duplicated: `global + domain + role + task context +
standards + knowledge + decisions + workflow context + output contract`, with
empty layers dropped and only task-relevant knowledge slices included.

## Development

```bash
npm install
npm run typecheck
npm test                 # node:test, no extra framework
```

Live end-to-end checks (spend tokens, need a configured model):

```bash
BOT_LOBBY_E2E=1 npx tsx --test test/e2e.test.ts  # or: node --test test/e2e.test.ts
```

They cover: a real isolated subagent run, a real workflow-level scout that
advances the task state, and the Master prompt injection in a real Pi session.

## Publishing (maintainers)

The [Pi package gallery](https://pi.dev/packages) discovers npm packages that
carry the `pi-package` keyword, which `package.json` already sets: the package
page is [pi.dev/packages/@a-t-h-i/bot-lobby](https://pi.dev/packages/@a-t-h-i/bot-lobby)
and the registry page is
[npmjs.com/package/@a-t-h-i/bot-lobby](https://www.npmjs.com/package/@a-t-h-i/bot-lobby).

A release is a version bump followed by:

```bash
npm publish --access public
```

`publishConfig.access` pins public access, and `files` (`src`, `prompts`) keeps the
tarball to the extension and its prompt layers — check it with
`npm pack --dry-run`. Pi supplies the Pi packages at runtime, so they stay in
`peerDependencies` with a `"*"` range.

## Scope of v0.1

Included: the full workflow above, persistent knowledge with governance and
compaction, bounded review loops, dependency/architecture approval, retries,
cancellation, corrupted-state detection, and the commands/status UI.

Deliberately deferred (matching the build plan): worktree-based parallel
Workers, a large dashboard, cost/token analytics beyond per-run usage, and
cross-platform runtime abstractions. The internal module boundaries keep those
extractable.
