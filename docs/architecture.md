# Architecture and guide

[Install and quick start](../README.md). This guide preserves the longer usage and architecture material formerly in the root README.

## Running projects and temporary files

Each project keeps its own Pi process, runtime and loopback server. The browser's entry
server discovers live instances through a private `~/.pi/bot-lobby/web-projects/` registry
(0700 directory, 0600 records containing identity, canonical cwd, port, PID and start time,
never credentials). Discovery checks the same browser session against each server, groups
identical project roots and keeps the entry server for its own root.

The Project selector performs a full-page same-origin navigation with `?project=<id>`;
old streams, drafts and in-flight state are unloaded. Only project API and preview routes
use `/projects/<id>/…`. Static assets, sign-in and discovery stay at the entry root.
The native gateway validates the entry host, origin and session, verifies registered
loopback identity, then streams requests with only the session cookie and necessary
content headers. It drops upstream cookies, redirects and hop-by-hop headers. Unauthorized
or offline projects do not silently fall back. Stopping the entry server requires reopening
a running lobby; there is no daemon, arbitrary folder launcher or automatic failover.

Preview and attachment files live under the system temp directory at
`bot-lobby-previews/<sha256(canonical-project-root)>/`. Identical task or attachment IDs
in different projects cannot share a bucket or attachment ownership index. **After upgrading,
reattach pre-upgrade files**: there is no fallback to the former global bucket. Legacy
temporary files are left untouched, not migrated or deleted.

## How a task runs

```text
full workflow: request → clarify → scout → propose → approve → plan → implement → QA gate → complete
fast track:    request → implement (only the agents it needs) → QA, if it needs tests → complete
```

The rule: **you decide with the LLMs, and the engine enforces.** Agents propose; you shape and approve the plan with the oracle; the extension validates every state change, permission and approval through one `orchestrate` tool.

Your Pi session becomes the **Master** (the oracle). It scouts the codebase, proposes a plan, and delegates work to **Designer+Frontend**, **Backend** and **QA**, each running in its own isolated `pi` process. The oracle is meant to be your most capable model; agents can be smaller and cheaper ones. It makes every decision itself and briefs each agent in full.

### Quick fix or the team

Before any task exists, bot-lobby asks whether **one agent can just do it**: in one file or one area, with nothing to agree between frontend and backend, no unfamiliar codebase to survey, nothing risky and no decision you must make first. Jev answers when it is on (`classifier.thresholds.quickFixAt`, 0.7); plain rules answer otherwise, and whenever Jev is unsure. A request that says it is self-contained ("a single page", "in one html file") counts even when it is rich.

When it reads that way, the oracle confirms in one step, without reading files or planning (`route_request`), and says so: *this looks like a quick feature, the quick-fix agent is on it*. The lobby hands the request to the quick-fix agent and switches to **Quick fix**. No scouts, proposal, plan or QA. A quick feature runs on its builder's model, thinking and time limit (DESIGN's for a page) instead of the quick-fix defaults.

Everything else, or anything the oracle judges needs the team, starts as a task. `--task` always makes a task; `workflow.routeQuickFixes: false` turns routing off. Without the lobby (a background session, RPC mode) every request is a task.

### Fast track or full workflow

The moment a task starts, bot-lobby reads the request and decides how serious it is: its size, who has to take part, and whether it takes the **fast track** or the **full workflow**. The read is instant and costs no tokens (plain rules, refined by Jev when it is on).

| The request… | Who takes part |
| --- | --- |
| changes browser screens, components, styles, copy, canvas or three.js graphics | DESIGN (frontend) |
| changes an API, database, auth, jobs or other server-side code | DEV (backend) |
| needs tests, fixes a bug, or changes backend logic | QA |
| depends on outside facts: latest versions, docs, standards, third-party APIs | RESEARCH |

A **small, clear, low-risk** request takes the fast track: the oracle hands it straight to those agents, with no scouts, no proposal to approve and no plan document (the engine keeps a short plan whose steps are the delegations, so the checklist still works). QA takes part only when the change needs tests (its worker writing and running them as the last step, or the QA gate); without it the task completes as soon as the work is in and checked.

Everything else takes the full workflow: anything **medium or large** (a new page, flow or endpoint, a refactor, an upgrade, a vague or many-part request), **serious** whatever its size (security, auth, passwords, payments, migrations, production, personal data), or **unclear** (too short, vague, or asking to investigate first).

- The oracle glances at the read once and acts on it, or corrects it with `orchestrate action=track`: the full workflow for a change bigger than it reads, the fast track for one that is smaller (before its work is planned), or a member added or dropped.
- Once work is under way a track only gets stricter: the full workflow or more members, never QA dropped. A fast task whose worker asks for a new dependency or an architecture change gets QA.
- `/bot-lobby --fast <request>` or `--full <request>` decides it yourself; the oracle never moves a `--full` task to the fast track. `workflow.fastTrack: false` puts every task on the full workflow.
- The track shows in the activity log, task details and `/bot-lobby status`.

### Briefing the agents

Every agent may run on a smaller, cheaper model than the oracle's, one that follows instructions well but does not infer intent. So the oracle writes each delegation (`implement`, `scout`, `research`) as a self-contained brief and settles every design and architecture decision itself first:

- **Goal**, exact **Files**, numbered **What to do** with names, shapes and values, **Contracts** shared with other agents (repeated in full in each brief), **Constraints**, **Done when** (checkable criteria and commands) and **If stuck**.
- Plan steps are written to the same standard, so a brief is the plan step made explicit, never a new decision.
- Every agent is told to follow its brief and the approved plan exactly, use the given names letter for letter, and report what does not match instead of guessing. Workers end their report with a **Brief Check**: each "Done when" item, met or not, with evidence.
- The oracle holds each report to its brief. Drift, a skipped criterion or a guessed choice comes back as a fix step with a more explicit brief.
- A delegation that names nothing concrete (or a long one with no done criteria) is sent back to the oracle once before any agent starts. Sending the same text again goes through, so a short task that is complete as written is never stuck. `workflow.briefCheck: false` turns it off.

### Full workflow and safety

- **Scouts** (read-only) investigate the domains the request touches.
- The Master **proposes** a short bullet list; nothing is built until you approve it.
- **Workers** implement plan steps, one domain each. Several can run in parallel; they share files through a **file desk** (claim a file, queue for a busy one, hand it over with a note).
- The **QA gate** runs once at the end. A failed gate sends fixes back to the owning domain, a bounded number of times. Only critical or major findings fail it, and a re-review checks what the last round asked for instead of starting over. It reviews everything since the commit the task started from, so committed fixes still count. At the round limit you decide: accept the work as it is, one more round, or leave it blocked (`/bot-lobby accept` works any time).
- QA knows who changed each file: task workers (**planned**), a **quick fix**, **pre-existing** work, another task, or **unattributed** work (which the Master asks you about). Quick fixes are never treated as rogue changes or reverted.
- A **researcher** can be summoned for cited web evidence through the web tools.

QA reviews adversarially (it tries to break the change) and writes as few tests as it can: only for a breaking change, for behavior that could turn out unpredictable, or when asked.

**Auto mode** approves proposals and answers clarifying questions for you; after three nudges without progress it pauses. A task started from a plan agreed in the Plan tab skips approval too.

**Safety nets:** every agent has a time limit (asked to wrap up at 75%), a stall watchdog and one retry. Pi's abort action stops running agents; Escape in the browser closes overlays.

## Branches and completion

Every task has a friendly name, made from the first words of its request and the day it started: `Task-Change-Table-Font-27-09-2026`. It is the task's id, the name of the session that drives it and, when you ask for one, its git branch.

`workflow.gitIsolation` (or `--branch`, `--worktree`, `--no-branch` on one request; **Git isolation** in settings) decides what a new task gets. It is `off` by default.

| Setting | A new task gets |
| --- | --- |
| `off` | nothing: it works in the folder you started it in |
| `branch` | a branch named after it, checked out in the working folder (uncommitted work comes along) |
| `worktree` | a second checkout, `.pi/bot-lobby/worktrees/<name>`, on its own branch; every agent runs there |

- The name is made unique (`-2`, `-3`…) when a branch or remote branch has it.
- Git never stops a task: outside a repository, without a commit (a worktree needs one) or when a checkout is refused, the task runs without and says why.
- The oracle is told where the work lives, Tasks shows the branch and worktree, and the lobby's title shows the branch.
- A worktree is kept when its task ends: merge or delete it yourself (`git worktree remove …`). One removed while its task runs is reported, and no agent is started in its place. The worktrees folder is added to `.git/info/exclude` so `git add -A` skips it.
- On completion, isolated tasks push their recorded branch and attempt `gh pr create` against the recorded base branch. The proposal/plan and QA verdict form the PR body. A missing base, remote, CLI or authentication records a note instead of blocking completion. Success records and notifies the PR number/link. There is no automatic merge.

## Time budget and context

`/bot-lobby --budget 90m <request>` (or `/bot-lobby budget 90m` on the task in hand, or `workflow.taskBudgetMinutes` for every task) gives a task 90 minutes of work time, for the oracle and every agent. The clock runs while the oracle works and stops while it waits on you.

- The oracle divides the time by scope: each step gets its minutes, and the QA gate keeps a reserve. Every agent is told how long it has and gets a heads-up at 75%.
- When a worker's time is up it stops, keeps its files consistent, and reports what it did, where it left off and how much more it needs. You are asked to give it more time (the same agent carries on with its context intact), or stop it there.
- Once the budget is spent no new work starts: the oracle asks for more with a reason or wraps up. Auto mode gives an agent more once, only from time the task still has, and never grows the budget.
- The lobby shows `34m of 1h 30m`, and each agent's `12/30m`.

**A fresh context per task.** Every agent runs in its own Pi process with its own context. The oracle starts each task clean: its model sees only the conversation since the task started, and once a task ends your next request starts fresh (the lobby shows *context cleared*, and the oracle is told where the finished record is). The session file keeps everything. `workflow.freshContext: false` turns this off.

## Commands

| Command | Does |
| --- | --- |
| `/bot-lobby` | Open the lobby in your browser |
| `/bot-lobby <request>` | Quick fix or task; `--task` always makes a task, `--auto` runs unattended, `--budget 90m` sets time, `--fast` / `--full` picks track, `--branch` / `--worktree` / `--no-branch` selects isolation |
| `/bot-lobby budget [90m\|off]` | Show or set this session's task budget |
| `/bot-lobby status \| tasks \| runs [id]` | Current task, all tasks, recent runs |
| `/bot-lobby approve \| amend <text> \| decline` | Answer the proposal |
| `/bot-lobby accept [id]` | Accept work without a QA pass; the oracle completes it |
| `/bot-lobby pause \| resume \| cancel [id]` | Control a task |
| `/bot-lobby auto [on\|off]` | Auto mode (`alt+g` in Pi) |
| `/bot-lobby claim <id>` | Take over another session's task |
| `/bot-lobby start-plan PLAN-… [auto]` | Start a saved plan |
| `/bot-lobby settings \| config` | Edit settings / show config |
| `/bot-lobby knowledge` | Knowledge file sizes |
| `/bot-lobby minimize \| restore` | Hide bot-lobby in this session (`ctrl+shift+m`) |
| `/bot-lobby web [link\|stop\|reset]` | Open page, print link, stop until next session, or reset link/cookies |

## Lobby

The plugin is web-only. An interactive Pi session serves the lobby on `127.0.0.1` (this machine only, behind a secret link), opens it in your browser and shows its address in Pi's status line. Nothing is drawn in the terminal but Pi itself.

The page has light/dark themes and flat divided panes. One fixed composer floats above content: it grows upward as you type, takes Markdown, images, PDFs and other files (pick, paste or drop, up to 20 MB each, eight per message). Its target follows the tab: oracle, planning panel, quick fix, open task comment (or message to its oracle), or selected session. Activity and Thinking fold into a right-side rail. Shortcut help is available with `Alt+H` or `?`.

Questions appear in a modal; Escape puts one away without losing a word, and the *waiting* button brings it back. The conversation keeps its newest 100 messages in memory; scroll to the top to load the rest. Own task comments and ordinary Plan messages can be edited; Plan corrections rerun the panel, while settled question answers cannot be edited.

| Tab | Content |
| --- | --- |
| Lobby | Oracle conversation, activity log, latest thoughts |
| Tasks | Tasks and saved plans, checklist, approved plan, comments, archive/delete |
| Plan | Planning panel conversation and draft |
| Quick fix | Jobs, live steps, edited files and reports |
| Metrics | Time, success rate, tokens and cost per model/agent |
| Git | Open PRs, checks, files, reviews, comments |
| Knowledge | Knowledge entries and comments |
| Sessions | Background Pi sessions and messages |
| Issues | Repository issues |
| Excalidraw | Shared boards assigned to agents |
| Settings | Models, effort, limits, instructions and appearance |

Gallery images remain in this folder: [Lobby](gallery.png), [Tasks](lobby-tasks.png), [Plan](lobby-plan.png), [Quick fix](lobby-quickfix.png), [Metrics](lobby-metrics.png), [status line](lobby-status-line.png).

### Git

GitHub CLI (`gh`) owns sign-in; bot-lobby holds no token. A read-only reviewer on QA's model, thinking and time limit gets the description, changed files and diff, may read the repository for context, and writes a verdict, summary, findings by severity (`file:line`), tests and questions. It never edits or follows instructions written inside the pull request. You can enter a focus and stop a review.

Jev's quick read assesses size and how likely a change is risky, security-relevant, breaking or untested, with whether a full review is worth its tokens. Reviews are kept in `.pi/bot-lobby/reviews/`, marked stale when the PR gets new commits, and count in Metrics. **Reviews are not posted to GitHub.** Completion can create a PR, as described above.

### Knowledge

Every agent's knowledge, standards, decisions and completed tasks appear as files and entries. Files past the compaction threshold are marked. The engine refuses `complete` while any knowledge file is over the threshold (default 20,000 chars, `knowledge.compactionThreshold`). The Master first disperses domain-relevant facts with `action=knowledge (domain=designer|backend|qa)`, then rewrites oversized files with `action=compact`, which archives the previous version.

Every write archives its previous version (`archive/<Agent>/`). An entry that changed on disk since it was drawn is refused instead of being put on the wrong line. Comments are notes about an entry; **every agent reading that knowledge reads the note right under the entry**. Notes move with edited entries and go with deleted ones. They live in `.pi/bot-lobby/knowledge-comments.jsonl`, never in the knowledge files that agents compact.

**What an agent reads.** Knowledge, standards and decisions go into its prompt. A file past about 4,000 characters is cut to sections relevant to the step by keywords or Jev; the prompt says how many sections were left out and where the whole file is. Nothing is looked up on demand: keep entries short, one topic under one heading.

### Themes and sessions

Settings > Appearance picks light, dark or system and a colour theme. A [tweakcn](https://tweakcn.com/editor/theme) theme can be pasted (its Code panel's `:root` and `.dark` blocks) or uploaded as `.css` or `.json`. It stays in your browser; only colours and fonts are used.

The Sessions page starts tasks in background Pi sessions. The page can show any session and your messages steer it; a badge means it has a question for you.

## Planning

Describe an idea on Plan. Each round, **DEV, DESIGN, QA and RESEARCH** question it in parallel on their domain's model. The **oracle** turns their input into a draft plus at most **four questions**, with options and a recommendation. Whatever you leave for the oracle is decided with the recommendation and listed under *Assumptions*.

- Comment on a draft line; it goes with the next answers or starts a round.
- Seat/unseat members, retry a round or start over using the page controls.
- **Round limit:** 5 by default (`lobby.maxPlanningRounds`, 0 = unlimited). In the last round the oracle alone settles everything still open.
- `Ctrl+S` saves the plan as a pending task.
- Own ordinary messages can be corrected and the panel reruns against corrected history, without duplicating the user turn. Settled question-answer messages and panel replies cannot be edited.

**Long plans split when saved.** More than 8 steps (`lobby.splitPlanAbove`; `0` disables) has the oracle propose two to five tasks, each a part that leaves the project working and can be reviewed alone. A questionnaire offers the split, keeping the plan whole, or changes (*merge 2 and 3*; up to three revisions). Nothing saves until you answer; putting the question away saves nothing.

- The oracle decides the boundaries; the engine enforces at most five tasks, every step in exactly one part, and dependencies only on earlier parts. A broken split goes back once with problems; if still invalid, you can save the whole plan.
- Each part's brief keeps the agreed objective, decisions, assumptions and risks, with only its own steps renumbered, under a header with its goal, prerequisites and done criteria. Pending tasks are numbered `(1/3)` and each knows the others; the oracle does only that part.
- Starting a part before its prerequisites are finished warns but starts anyway: the order is yours to keep.

**Settled questions are never asked again.** Answers are kept per question, and all seats/oracle read them as a closed list. Repeated questions are held back even when differently worded; the activity log says so. A failed/stopped round after answers does not put the same questionnaire up again; retry replays it.

## Questions and web tools

These tools register in every Pi session where the extension loads, including plain Pi. There is nothing else to install. Remove `pi-web-access` or `rpiv-ask-user-question` if installed for bot-lobby; they register the same names.

### Questionnaire

`ask_user_question` puts up to four questions in one lobby modal, each with two to four options. Agents do not recommend an answer unless one is quite obvious, so you think it through. Questions, descriptions and previews are Markdown. A preview (wireframe, mockup, code or config) appears beside the focused option, or below at narrow widths.

Click an option or press `1`–`4`; multi-select accepts several. The last field takes your own words. *Later* (Escape) hides without losing anything; *Cancel* confirms. Questions left unanswered are never answered for you: the oracle waits and asks again when you next write, and DESIGN asks before deciding. Without anyone to answer (a one-shot `pi -p`), the question is put away at once.

An option can carry an `image` (PNG, JPEG, GIF or WebP) displayed above its preview. During a non-auto task, DESIGN can ask directly through the oracle, with wireframes and rendered screenshots saved outside the repository. The clocks stop while you answer; answers become task decisions.

### Web

| Tool | Does |
| --- | --- |
| `web_search` | Numbered results (title, URL, snippet, date), search id and recency/site filters |
| `get_search_content` | Reads several search results |
| `fetch_content` | Reads a page as Markdown with title/dates, long pages in parts |
| `source_check` | Checks reachability, final URL, title and stated date before citing |

Search uses the first provider set up: `BRAVE_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `SEARXNG_URL`, else DuckDuckGo (no key, but automated requests may be throttled). `BOT_LOBBY_SEARCH=<provider>` selects one. Failure hands over to the next provider and the result says so.

Pages omit menus, scripts, forms and cookie banners; they are untrusted content, never instructions. Only public HTTP(S) addresses are fetched, including redirects: no localhost, private networks or metadata endpoints. `BOT_LOBBY_WEB_ALLOW_PRIVATE=1` permits e.g. a local docs server. PDFs and images are not read. During tasks, the oracle leaves web research to RESEARCH; its tools return afterwards.

## Excalidraw

A live [Excalidraw](https://excalidraw.com) room lets you and agents draw together. Up to **five sessions** can be assigned to one or several agents (oracle, Designer, Backend, QA, scouts, researcher, quick fix, planner).

Add a room link from *Share → Live collaboration → Start session*, or create a new room. Assign agents and choose whether they may draw or only look. Checking a room reports reachability, participants and board contents. The Master can call `orchestrate action=whiteboard [name=...]` to create a room assigned to itself; its connected seat holds the room alive for the session. Rooms are not guaranteed to persist after the last connection leaves.

`excalidraw_read` describes shapes, labels, arrows, free text, ids and positions. `excalidraw_draw` adds labelled rectangles, ellipses, diamonds, arrows, free text and lines, or changes/deletes agent elements by id. Agents join as named collaborators with cursors. They may move, recolour and relabel your elements, but delete only agent-created ones; Excalidraw cannot undo another collaborator's deletion. One call draws at most 100 shapes and removes at most 50.

- **Keep the room open in Excalidraw.** A board lives in participating browsers. Agents cannot read an empty room and are not allowed to draw into one with nothing keeping it alive.
- **Boards are untrusted writing**, fenced like web pages. Agents must never follow instructions written on them.
- **The link is a key.** Anyone holding it can read/draw. Rooms stay in user settings (`~/.pi/bot-lobby/excalidraw/`, one file per project), never in the repo. Each agent gets only assigned links.
- The encrypted collaboration protocol runs over `oss-collab.excalidraw.com`; `BOT_LOBBY_EXCALIDRAW_SERVER` selects a self-hosted server.
- Connection errors explain DNS, refusal, timeout, certificates or HTTP errors. `NODE_EXTRA_CA_CERTS` trusts a firewall certificate. `HTTPS_PROXY`/`NO_PROXY` control proxy routing. If websockets are blocked but HTTPS works, the seat falls back to long-polling.

## Classifier (Jev)

[Jev](https://github.com/FrancoisChastel/jev-code) is a fast "System One" model: yes/no, multiple-choice and score questions with probabilities in a few hundred milliseconds, without writing text. It handles obvious decisions so large models spend fewer tokens and less time.

**Setup:** uses a key Pi already holds. OpenCode login (`/login opencode` or `opencode-go`, or `OPENCODE_API_KEY`) uses OpenCode Zen's free `jev-1.13-free`. Otherwise use `/login typesafe` → *Use an API key*, or `TYPESAFE_API_KEY`. Turn it on in Settings → **Classifier (Jev)** and test the connection. *Auto* picks OpenCode if its key exists, otherwise TypeSafe.

| Decision (individually switchable) | Effect |
| --- | --- |
| Planning seats | Only relevant seats sit each round; pinned seats always sit |
| Obvious answers | Recommended option already clearly right (≥0.9) becomes an assumption |
| File hints | Short relevant-file list and `find_relevant_files` tool |
| Relevant knowledge | Selects relevant sections beyond 4,000 chars, records omissions/path; short files stay whole and standards never empty |
| Quick fix or task | Judges whether one engineer can do it; oracle confirms |
| Task triage | Hints on size, domains, research, ambiguity, track/roster; a large quick fix is held for routing |
| Effort routing | Simple steps think one level lower; trivial ones use your chosen cheaper model; falling short reruns normal settings |
| Pull request read | Size/risk/security/breaking/untested assessment |

**It never gets in the way:** failure, timeout or missing key falls back to ordinary decisions; three consecutive failures pause it ten minutes. Metrics shows calls/savings.

**What is sent:** planning conversation, task text, file excerpts of at most 400 characters (never whole files), and the first 700 chars per section of long knowledge. Gitignored files, `.env*`, keys, certificates and `classifier.exclude` are never sent. If the free model ends, choose paid `jev-1.13`; bot-lobby never switches on its own.

## Configuration and fallback models

Settings live in `~/.pi/bot-lobby/config.json` (`BOT_LOBBY_CONFIG_DIR` overrides). Settings saves as you go; `/bot-lobby config` shows effective values.

```json
{
  "master": { "model": "inherit", "thinking": "high" },
  "agents": {
    "backend": { "model": "anthropic/claude-sonnet-5", "thinking": "medium", "timeoutMs": 900000, "instructions": "" }
  },
  "scout": { "model": "anthropic/claude-haiku-4-5-20251001", "timeoutMs": 480000 },
  "planner": { "thinking": "high", "timeoutMs": 300000 },
  "lobby": { "planningPanel": ["backend", "designer", "qa", "researcher"], "maxPlanningRounds": 5, "splitPlanAbove": 8, "web": { "port": 7347, "openBrowser": true } },
  "workflow": { "maxReviewIterations": 2, "maxParallelWorkers": 3, "stallTimeoutMs": 300000, "wrapUpAt": 0.75, "taskBudgetMinutes": 0, "fastTrack": true, "briefCheck": true, "routeQuickFixes": true, "gitIsolation": "off" },
  "classifier": { "enabled": false, "provider": "auto", "effort": { "cheapModel": "inherit" } }
}
```

- Entries: `master`, `agents.designer|backend|qa`, `scout`, `researcher`, `quickFix`, `planner`, `lobby`, `workflow`, `knowledge`, `classifier`.
- An agent without a model inherits the session's. Thinking: `off, minimal, low, medium, high, xhigh, max`, limited to model support. Settings strikes unsupported slider stops. Scouts always think at `low`.
- `instructions` adds text to built-in prompts. Shortcut overrides live under `lobby.keys`; defaults are in `src/lobby/keys.ts`.
- Classifier thresholds/limits (e.g. `knowledgeRelevantAt`, 0.4, and `classifier.fileHints`) can be edited in the file.

Model errors are reported on the configured primary model, without automatic model switching. Legacy fallback keys are ignored when loading configuration and omitted from saved configuration. Bounded transient crash/stall retries still use the same model. Classifier cheaper-model effort routing remains independent of error handling.

Activity, receipts and Metrics name the model actually used.

## Engine guarantees

| Rule | Enforcement |
| --- | --- |
| Ordered steps | State machine validates actions |
| Approval before full-workflow work | `implement` refuses earlier states; fast track starts directly |
| Read-only scouts/gate | Scouts get read-only tools; QA gate adds only bash for checks |
| Dependencies/architecture require approval | Worker reports block domain pending resolution |
| Only Master writes knowledge | Agents propose only |
| Compaction before completion | Refuses oversized knowledge; disperse then compact |
| Earned completion | Plan, QA pass with checks or explicit acceptance, no blockers; fast track requires finished worker and QA when needed |
| Parallel safety | File desk claims |
| Crash recovery | Persisted state and resume |

## Files on disk

```text
.pi/bot-lobby/
├── <Agent>/knowledge/         knowledge, standards, decisions, completed tasks
├── tasks/Task-…/              state.json, budget.json, comments.jsonl, scratchpads, reports
├── worktrees/Task-…/          isolated worktree
├── reviews/pr-<n>.json        saved PR reviews
├── knowledge-comments.jsonl  notes on entries
├── backlog/PLAN-….json        saved plans
├── archive/                  archived tasks/knowledge and previous edits
├── sessions/                 running-session heartbeats
├── cache/files.json          classifier excerpts
├── changes.jsonl             quick-fix/worker edited-file records
└── metrics.jsonl             agent/classifier calls
```

Task comments are append-only events separate from `state.json`, so owner-state saves cannot discard comments from another session. Edits preserve author/creation metadata, mark `editedAt` and reopen for delivery.

## Development and publishing

```bash
npm install
npm run typecheck
npm test
npm run web:build
npm run web:check
```

Live checks spend tokens or need network/keys:

```bash
BOT_LOBBY_E2E=1 node --test test/e2e.test.ts
BOT_LOBBY_LIVE_WEB=1 node --test test/web.test.ts
BOT_LOBBY_JEV_E2E=1 OPENCODE_API_KEY=… node --test test/jev-e2e.test.ts
BOT_LOBBY_LIVE_EXCALIDRAW=1 node --test test/excalidraw-live.test.ts
```

Source layout: `src/workflow` (engine), `src/master` (delegation), `src/execution` (processes), `src/lobby` (state/service), `src/webui` (server), `webui/` (page; rebuild with `npm run web:build`), `src/classifier` (Jev), `src/state` (persistence), `src/ask` (questionnaire), `src/web` (web tools), `src/excalidraw` (room protocol, sessions, agent tools), `prompts/` (agent prompts).

Bump the version then `npm publish --access public`. Inspect the tarball with `npm pack --dry-run`; shipped files are controlled by `package.json`.
