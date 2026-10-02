# Feature inventory

Everything the terminal lobby lets a user see or do, as of bot-lobby 0.6.9 plus the Excalidraw fix (commit `0a2c14d`). Each row has a web task. This is the **parity checklist**:
- the web UI is done when every row is `done`, or has an agreed exception recorded in `docs/web-ui/parity.md`;
- P0-01 copies this file there, and each PR updates the rows it touches.

**Columns:**
- **Terminal:** what it does today, and its key.
- **Source:** under `src/`.
- **Tests:** files in `test/` that state the behaviour exactly.
- **Web:** the task that builds it, and any difference on purpose.

The engine (tracks, the state machine, briefs, workers, the QA gate, budgets, knowledge, provenance, Jev, the web tools) does not change. The web shows what it produces, through the rows below.

## The shell

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-01 | Title: `◆ repo (⎇ branch)`, read off the render path | `lobby/view.ts`, `execution/workspace.ts` | `workspace`, `lobby-view` | P3-02 header |
| W-02 | Eight tabs by default, nine when `lobby.issues` is on (Issues); `tab`/`shift+tab`, `alt+1…N`, click | `lobby/view.ts` (`visibleTabs`, `tabs()`) | `lobby-view`, `lobby-layout` | P3-02: the tabs as cells of the title line (D-09, D-21); `alt+1…N` from `tabJumpKey` (P5-04) |
| W-03 | Status line under Pi's editor while the lobby is hidden: task steps, planning round, quick fix; `lobby.miniLine` | `lobby/mini.ts` | `mini` | P3-02: the header's task state. The status line also gets the web link (P2-08) |
| W-04 | Help: every key (`alt+h`, `?`) | `lobby/view.ts` (`helpBody`), `lobby/keys.ts` | `lobby-view` | P5-04 help sheet |
| W-05 | Search the current tab (`ctrl+f`, `/`) | `tabs/home.ts` `filterFeed`, `tabs/quickfix.ts` `filterJobs`, `tabs/metrics.ts` `filterRecords` | `lobby-view` | P3-05 and each tab's card |
| W-06 | Rebindable keys (`lobby.keys`) | `lobby/keys.ts` | `lobby-view` | P5-04: desktop shortcuts read the same map |
| W-07 | Steps aside while Pi shows a dialog | `lobby/runtime.ts` (`promptStarted`) | `lobby-runtime` | P3-02 banner: "Pi is asking something in the terminal" (D-13) |
| W-08 | Notices (`ctx.ui.notify`) and the lobby's own notice line | `lobby/runtime.ts` (`failed`), every action's return text | `lobby-runtime` | P3-02 toasts from the `notices` topic |
| W-09 | Mouse: click tabs, click panes, click a draft line, wheel; `lobby.mouse` | `lobby/runtime.ts` (`setMouse`), `lobby/view.ts` | `lobby-view` | Native in the browser; touch on phones |
| W-10 | Opens on its own when a task starts (`lobby.autoOpen`); `alt+l` hides | `lobby/runtime.ts` (`autoOpenLobby`) | `lobby-runtime` | The page is always open; `lobby.web.enabled` starts the server (D-17) |
| W-11 | Minimize bot-lobby (`/bot-lobby minimize`) | `pi/ui.ts` | `ui` | Not in the page (a terminal feature) |

## Lobby tab

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-20 | Conversation with the oracle, Markdown, tool rows and thinking stripped | `lobby/feed.ts` (`chatText`, `chatFromEntries`), `tabs/home.ts` | `chat-markdown`, `lobby-view` | P3-05, rendered as real Markdown (D-10, D-14) |
| W-21 | The streaming reply, capped at 8,000 characters, whole blocks dropped from the start | `lobby/feed.ts` (`trimReply`) | `chat-markdown` | P3-05 via the `reply` delta (ARCHITECTURE §10) |
| W-22 | Older history loaded when scrolled back | `lobby/runtime.ts` (`chatHistory`), `lobby/feed.ts` (`seedChat`) | `lobby-view` | P3-05 `lobby.history` |
| W-23 | "Context cleared" note between requests | `lobby/feed.ts` (`CLEARED_NOTE`) | `fresh-context` | P3-05, shown as a divider |
| W-24 | Activity log: every agent's steps in plain words, colour per source, pending marks, 400 kept | `lobby/feed.ts`, `pi/activity.ts` (`describeToolCall`), `tabs/home.ts` (`activityLine`) | `activity`, `lobby-view` | P3-05 |
| W-25 | Thoughts: each agent's latest, the live one marked, 40 kept | `lobby/feed.ts`, `tabs/home.ts` (`currentThought`) | `lobby-view` | P3-05 |
| W-26 | Task header: task, state, track, plan checklist and current step, budget (hourglass) | `pi/ui.ts` (`taskSnapshot`), `pi/plan-checklist.ts`, `pi/run-summary.ts` | `ui`, `plan-checklist`, `hourglass`, `run-summary` | P3-05 |
| W-27 | Runs: each agent running, its status and time | `pi/ui.ts` (`onRunUpdates`), `lobby/feed.ts` (`runs`) | `lobby-runners` | P3-05 runs strip |
| W-28 | Prompt: send to the oracle; with no task, the request is routed (quick fix or task); `/commands` go to Pi | `lobby/runtime.ts` (`toOracle`) | `lobby-runtime`, `route` | P3-05, through the same `toOracle`: extension commands and prompt templates go to Pi as they do from the terminal lobby, and Pi's built-in commands still need Pi's own editor (the notice says so) |
| W-29 | Steer while the oracle works; `esc` stops it | `lobby/runtime.ts` (`toOracle`, `abortMaster`) | `lobby-runtime` | P3-05 Steer and Stop |
| W-30 | Hide the conversation, activity or thoughts (`alt+c`, `alt+a`, `alt+k`); remembered (`lobby.panels`) | `lobby/view.ts`, `lobby/runtime.ts` (`savePanels`) | `lobby-layout` | P3-05: toggles on wide screens, a segmented control on phones; remembered per browser |
| W-31 | Comment on the running task's plan (`c`) | `lobby/runtime.ts` (`addComment`) | `lobby-runtime` | P3-05 action on the task header |
| W-32 | Auto mode on/off (`alt+g`) | `pi/owner.ts` (`setAuto`), `state/auto.ts` | `auto-mode` | P3-05 toggle on the task header |
| W-33 | Owner events in the log: comments passed on, messages from other sessions, auto nudges, "needs you" | `lobby/runtime.ts` (`onOwnerEvent`) | `auto-mode` | P3-05 (they are activity entries) |

## Questions

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-40 | Questionnaire: up to four questions with 2–4 options each, recommended first; Markdown descriptions and previews; multi-select; your own words; leaving asks first | `ask/dialog.ts`, `ask/view.ts`, `ask/types.ts` | `ask`, `lobby-ask` | P3-06 (D-13) |
| W-41 | Option images: PNG, JPEG, GIF, WebP (Kitty graphics or half-blocks) | `ask/image.ts`, `ask/png.ts` | `ask-image` | P3-06, real images via `/files/preview` (P2-07) |
| W-42 | The designer's questions through the oracle ("DESIGN asks"), with the clock stopped | `ask/relay.ts` | `relay` | P3-06 (arrives as a questionnaire prompt) |
| W-43 | Proposal approval: approve, amend, decline | `pi/tools.ts` (`choose`), `workflow/workflow.ts` | `workflow` | P3-06 `choose` prompt |
| W-44 | Free-text asks from the engine | `pi/tools.ts` (`ask`) | `workflow` | P3-06 `text` prompt (P0-04 decides if the terminal copy can be withdrawn) |
| W-45 | Questions are never answered for you: leaving keeps them open | `ask/tool.ts` | `ask` | P3-06: "Leave" keeps it open; it shows again on the badge |

## Sessions

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-50 | Browse sessions (`alt+o`): this window, the background sessions and other terminals' | `lobby/view.ts` (picker), `lobby/sessions.ts`, `state/presence.ts` | `lobby-sessions`, `presence` | P3-07 |
| W-51 | Start a task in a new background session (`alt+n`, or `s` on a plan), optionally auto | `lobby/runtime.ts` (`startSession`), `lobby/sessions.ts` | `lobby-sessions` | P3-07, P4-01 |
| W-52 | View a session's conversation and activity live; send or steer | `lobby/sessions.ts` (`feed`, `send`), `lobby/session-files.ts` | `lobby-sessions` | P3-07 |
| W-53 | Answer a background session's question | `lobby/runtime.ts` (`answerDialog`) | `lobby-sessions` | P3-06, P3-07 (`sessionDialog` prompt) |
| W-54 | Message a session in another terminal; it passes the message on within seconds | `state/inbox.ts`, `lobby/runtime.ts` (`sendToSession`) | `lobby-sessions` | P3-07 |
| W-55 | Switch this window to a session (`s`); stop one (`x x`) | `lobby/runtime.ts` (`switchTo`), `BackgroundSession.stop` | `lobby-sessions` | P3-07. After a switch the page reconnects (P2-01 rebind) |
| W-56 | Notice when a hidden session waits on you or exits with an error | `lobby/runtime.ts` (`sessionsChanged`) | `lobby-sessions` | P3-07 badge, P5-02 notification |

## Tasks tab

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-60 | Every task and saved plan as a checklist: track, plan progress, the approved plan, comments; part numbers `(1/3)` | `tabs/tasks.ts` (`taskRows`, `taskProgress`, `checkState`) | `lobby-view`, `lobby-state`, `split` | P4-01 |
| W-61 | Comment on a task's plan (`c`) | `lobby/runtime.ts` (`addComment`), `state/comments.ts` | `lobby-runtime` | P4-01 |
| W-62 | Open a task's session (`o`); auto (`alt+g`) | `lobby/view.ts` | `lobby-sessions` | P4-01 |
| W-63 | Archive (`a`), restore, delete (`d d`); refused while a session drives it, with the reason | `lobby/runtime.ts` (`archiveTask`, `drivenElsewhere`), `state/archive.ts` | `archive` | P4-01 with confirmation sheets |
| W-64 | Archived view (`v`) | `state/archive.ts` | `archive` | P4-01 |
| W-65 | Start a plan here (`h`) or in a new session (`s`); discard (`d`); warning when its earlier parts are unfinished | `lobby/runtime.ts` (`startPlanned`), `pi/start-task.ts`, `state/backlog.ts` | `kickoff`, `split` | P4-01 |
| W-66 | New task (`n`) | `lobby/view.ts` | `lobby-view` | P4-01 (opens the composer) |
| W-67 | Message a task's oracle wherever it runs | `lobby/runtime.ts` (`sendToTask`), `state/inbox.ts` | `lobby-sessions` | P4-01 |

## Plan tab

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-70 | Describe an idea; seats (DEV, DESIGN, QA, RESEARCH) question it in parallel; the oracle drafts a plan with up to four questions | `lobby/planner.ts` | `classifier-planning`, `lobby-view` | P4-02 |
| W-71 | Seat or unseat members (`1`–`4`); seat labels show `model · thinking` | `PlanningSession.toggle`, `LobbyHost.seatLabel` | `lobby-view` | P4-02 |
| W-72 | Round counter and limit (`lobby.maxPlanningRounds`); the last round settles alone | `tabs/plan.ts` (`roundLabel`), `lobby/planner.ts` | `lobby-view` | P4-02 |
| W-73 | Answer the panel's questions (`a`, `enter`), resumable; answered questions are never asked again | `lobby/runtime.ts` (`answerPanel`), `lobby/ask.ts` (`questionnaires`, `settledQuestions`) | `lobby-ask` | P4-02 through the prompt hub |
| W-74 | Comment on a draft line (click it, or `c`) | `PlanningSession.commentOnLine`, `tabs/plan.ts` (`draftLines`) | `lobby-view` | P4-02: tap a line |
| W-75 | Retry a round (`r`), stop (`x`), start over (`n`) | `PlanningSession.retry`, `cancel` | `lobby-view` | P4-02 |
| W-76 | Save (`ctrl+s`); a long plan is split into 2–5 tasks after a question | `PlanningSession.saveWithSplit`, `lobby/split.ts` | `split` | P4-02 |
| W-77 | Auto-ask when the round ends on the Plan tab (`lobby.autoAsk`) | `lobby/runtime.ts` (`onRound`) | `lobby-runtime` | P4-02: the prompt opens if the Plan tab is in view |

## Quick fix tab

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-80 | Submit a request; it runs beside any task | `QuickFixQueue.submit` | `lobby-view` | P4-03 |
| W-81 | Jobs newest first; live steps, edited files, report | `tabs/quickfix.ts` (`newestFirst`, `jobDetailLines`) | `lobby-view` | P4-03 (the report as Markdown) |
| W-82 | "Looks like a task" hold: run anyway (`r`), or as a task (`t`) | `QuickFixQueue.runAnyway`, `movedToTask`, `classifier/triage.ts` | `classifier-triage`, `route` | P4-03 |
| W-83 | Cancel (`x`) | `QuickFixQueue.cancel` | `lobby-view` | P4-03 |
| W-84 | Requests the oracle routes here, with its reason; quick features on a builder's model | `lobby/runtime.ts` (`handToQuickFix`), `pi/route.ts` | `route` | P4-03, and the page switches to the job |
| W-85 | Model for quick fixes (`m`) | `pi/settings-ui.ts` (`openEntrySettings`) | `settings-ui` | P5-01 (links there from the tab) |

## Metrics tab

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-90 | Tiles: runs, success rate, time, cost | `tabs/metrics.ts` (`tileRow`) | `lobby-view` | P4-04 |
| W-91 | Run time and success per model or agent (`g` groups, `s` sorts) | `tabs/metrics.ts` (`timeBars`, `successMeters`, `fittedColumns`) | `lobby-view` | P4-04 SVG charts |
| W-92 | Time share per task | `tabs/metrics.ts` (`timeShare`) | `lobby-view` | P4-04 |
| W-93 | Tokens and cost table | `tabs/metrics.ts` (`tableLines`) | `lobby-view` | P4-04 (scrolls in its box on phones) |
| W-94 | Classifier (Jev) summary, kept apart | `tabs/metrics.ts` (`classifierLines`), `state/metrics.ts` | `classifier-metrics` | P4-04 |

## Git tab

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-100 | Open pull requests through `gh`: checks (`✓ ✗ ●`) and size; reload (`r`) | `lobby/pulls.ts`, `tabs/git.ts` (`changeSize`) | `pulls` | P4-05 |
| W-101 | Detail: facts, files, description, reviews, comments | `tabs/git.ts` (`pullDetailLines`) | `pulls` | P4-05 (description as Markdown) |
| W-102 | Review with an agent (`v`), with a focus (`f`), stop (`x`); verdict, findings by severity, tests, questions; stale when new commits land | `lobby/pr-review.ts` | `pulls` | P4-05 |
| W-103 | Jev's quick read (`t`) | `PullReviews.readWithJev` | `pulls` | P4-05 |
| W-104 | Nothing is posted to GitHub | `lobby/pr-review.ts` | `pulls` | P4-05 states it |

## Knowledge tab

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-110 | Files per agent, sizes, compaction marks | `lobby/knowledge.ts`, `tabs/knowledge.ts` (`sizeWords`) | `knowledge-book` | P4-06 |
| W-111 | Entries of a file; pick one | `KnowledgeBook.open` | `knowledge-book` | P4-06 |
| W-112 | Edit (`e`), add after (`n`), delete (`d d`); a stale entry is refused | `KnowledgeBook.edit`, `add`, `remove` | `knowledge-edit` | P4-06 (`conflict`, P2-06) |
| W-113 | Edit the whole file (`E`) | `KnowledgeBook.replaceFile` | `knowledge-edit` | P4-06 (a full-screen editor) |
| W-114 | Notes on entries (`c`), the newest taken back (`x x`); agents read them | `KnowledgeBook.comment`, `unnote` | `knowledge-book` | P4-06 |
| W-115 | Every write archives the version before | `knowledge/edit.ts` | `knowledge-edit` | P4-06 (the notice says so) |

## Excalidraw tab

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-120 | Up to five sessions; add a link (`a`) or make a room (`n`) | `excalidraw/sessions.ts` | `excalidraw-sessions` | P4-07 |
| W-121 | Assign agents (checklist, `*` all) | `ExcalidrawBook.toggleAgent`, `toggleAll` | `excalidraw-sessions` | P4-07 |
| W-122 | Look only or draw (`w`) | `ExcalidrawBook.toggleContribute` | `excalidraw-sessions` | P4-07 |
| W-123 | Check (`t`): reach, people, elements, key fit, and the reason when unreachable | `excalidraw/check.ts`, `excalidraw/client.ts` (`connectFailure`) | `excalidraw-room` | P4-07 |
| W-124 | Rename (`r`), remove (`d d`) | `ExcalidrawBook.rename`, `remove` | `excalidraw-sessions` | P4-07 |
| W-125 | Links are keys: kept outside the project | `excalidraw/sessions.ts` | `excalidraw-sessions` | P4-07: masked; `reveal` and copy on tap; "Open board" (D-12) |

## Issues tab (when `lobby.issues` is on)

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-130 | Issues list and detail | `lobby/issues.ts`, `tabs/issues.ts` | `pulls` | P4-08 |
| W-131 | New issue (`n`); plan it (`p`) | `IssuesState.create`, `lobby/view.ts` | `pulls` | P4-08 |

## Settings and commands

| Id | Terminal | Source | Tests | Web |
| --- | --- | --- | --- | --- |
| W-140 | `/bot-lobby settings` (`alt+s`): every agent's model, thinking, time limit, instructions; the lobby; Jev | `pi/settings-ui.ts` | `settings-ui` | P5-01 |
| W-141 | `/bot-lobby` commands (status, tasks, pause, resume, cancel, approve, amend, decline, accept, budget, claim, auto, …) | `pi/commands.ts` | `kickoff`, `budget`, … | Not in the page: the matching buttons cover the actions (task header, Tasks tab). Plain commands stay in the terminal |
| W-142 | `/bot-lobby web` and its subcommands | new (P2-08) | new | P2-08 |

## Better in the web, on purpose (D-14)

| Id | What |
| --- | --- |
| W-150 | Real Markdown (tables, code with copy, links) everywhere text is shown |
| W-151 | Real images in questionnaires and previews |
| W-152 | Charts in Metrics |
| W-153 | Diagrams (Mermaid) in Markdown, if Q-05 stays yes (P5-05) |
| W-154 | Installable app (P5-03) and browser notifications (P5-02) |

## Phase 3 verdicts (Step 12)

Every row below is `matches` (the page mirrors the terminal), `GUI improvement`
(deliberately better on the web, keyed to a D-decision), or `deferred` (with a
reason and the task that owns it). Verdicts cover the shell (W-01…W-11), the
Lobby tab (W-20…W-33) and questions (W-40…W-45); everything else stays open for
Phases 4–5. Evidence: `npm run web:check` (`test/web/lobby.spec.ts`) and the
`full`/`empty`/`question` fixture sets.

### The shell

| Id | Verdict | Notes |
| --- | --- | --- |
| W-01 | matches | Header reads `◆ repo (⎇ branch)` off the same render path |
| W-02 | GUI improvement (D-09, D-14) | The tabs drawn as the terminal draws them, cells of the title line with the number printed (D-21); chevrons when they overflow; `Alt+1…N` from `tabJumpKey`, same order and labels |
| W-03 | matches | Header carries the task state; the status line gained the web link in P2-08 |
| W-04 | matches | `Alt+H` key sheet reads the server's key table (built early in P3-02) |
| W-05 | deferred | Search arrives with the Lobby tab and each later tab's card |
| W-06 | deferred | P5-04: desktop shortcuts read the same map; rebinding UI pending |
| W-07 | matches | Banner: "Pi is asking something in the terminal" (D-13) |
| W-08 | matches | Toasts off the `notices` topic |
| W-09 | GUI improvement (D-09, D-14) | Native browser pointer; touch ≥768 px only, phones dropped |
| W-10 | matches | The page is always open; `lobby.web.enabled` starts the server |
| W-11 | deferred | Minimizing is a terminal feature; not in the page |

### Lobby tab

| Id | Verdict | Notes |
| --- | --- | --- |
| W-20 | GUI improvement (D-10, D-14) | Real Markdown; tool rows and thinking stripped as in the terminal |
| W-21 | matches | Streaming reply via the `reply` delta |
| W-22 | deferred | `chatOlder` is seeded but load-on-scrollback is unproven; P3-X walkthrough |
| W-23 | matches | "Context cleared" renders as a divider |
| W-24 | matches | Activity log, colours per source, pending marks |
| W-25 | matches | Thoughts pane, live entry marked |
| W-26 | matches | Task header: task, state, track, plan checklist, current step, budget |
| W-27 | matches | Runs strip with status and time |
| W-28 | matches | Same `toOracle` routing; extension commands go to Pi, built-ins need Pi's editor (notice says so) |
| W-29 | matches | Steer while busy; Stop aborts |
| W-30 | deferred | Panel show/hide toggles pending; no per-browser memory yet |
| W-31 | deferred | Plan comments pending with the Tasks tab (P4-01) |
| W-32 | deferred | AUTO shows as a badge; the toggle is pending |
| W-33 | matches | Owner events render as activity entries |

### Questions

| Id | Verdict | Notes |
| --- | --- | --- |
| W-40 | matches | Questionnaire slideout, one at a time, `1 of N`, own words, Leave-keeps-open (D-13) |
| W-41 | matches | Real images via `/files/preview` (P2-07) with a no-preview fallback |
| W-42 | matches | Designer relays arrive as questionnaire prompts through the hub |
| W-43 | matches | Proposal approval as a `choose` prompt |
| W-44 | matches | Free-text asks as a `text` prompt |
| W-45 | matches | "Leave" keeps the question open; the badge brings it back |

### Sessions (P3-07, not yet built)

| Id | Verdict | Notes |
| --- | --- | --- |
| W-50…W-56 | deferred | Route + placeholder only; bodies are P3-07 |
