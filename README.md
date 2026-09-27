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

It is optional for the Master. Without it `clarify` still works through Pi's
built-in `select`/`input` prompts (or the Master asks in plain text), just with
less structure. The lobby's planning panel uses the same questionnaire on its
own — the library ships as a bot-lobby dependency, so each round's questions
arrive together in one dialog with options whether or not you install the tool
for the Master (see [The lobby](#the-lobby)).

## Usage

```
/bot-lobby                      Open the lobby (alt+l): tasks, planning, quick fixes, metrics
/bot-lobby <request>            Start a task and hand it to the Master
/bot-lobby --task [--auto] <request>   Start a task even when the request begins with a subcommand word
/bot-lobby status [taskId]      Active task, state, approvals, blockers, legal next states
/bot-lobby tasks                Task list (plus any unreadable task state)
/bot-lobby pause | resume       Stop or allow further workflow steps
/bot-lobby cancel [taskId]      Abandon a task (scratchpad retained)
/bot-lobby approve              Approve the current proposal
/bot-lobby amend <text>         Record an amendment; the Master re-proposes
/bot-lobby decline              Decline the proposal and abandon the task
/bot-lobby knowledge            Knowledge file sizes vs. the compaction threshold
/bot-lobby runs [taskId]        Recent subagent runs: time, turns, tools, tokens, cost, model
/bot-lobby config               Effective configuration and its file path
/bot-lobby settings             Edit each agent's model, thinking, time limit and instructions
/bot-lobby-settings             Same as the settings subcommand
/bot-lobby minimize|restore     Hide or restore bot-lobby for this session (ctrl+shift+m)
/bot-lobby claim <taskId>      Take ownership of an orphaned task
/bot-lobby auto [on|off]        Auto mode: the oracle drives this session's task to completion (alt+g)
/bot-lobby start-plan PLAN-… [auto]   Start a saved plan here; its agreed plan needs no approval
/bot-lobby switch <session.jsonl>     Run a saved session in this window (the session browser's s)
/bot-lobby lobby | help         Open the lobby, or show this list
```

## The lobby

The lobby is bot-lobby's full-screen home: a tabbed view over every task in the
project, your planning, quick fixes and model performance, with one prompt at
the bottom whose target follows the tab. It opens by itself when
this session starts (or resumes) a task — the small zen widget returns whenever
you hide it — and `alt+l` or `/bot-lobby` opens and hides it at any time, with
or without a task.

```
 ◆ bot-lobby │ 1 Lobby  2 Tasks 2  3 Plan 2?  4 Quick fix ⠋  5 Metrics      ⠋ TASK-add-login implementing  Alt+H keys
                    (the task's status: state, what the agents are doing, the plan checklist)
╭ Conversation ──────────────────────────────── Alt+C ╮ ╭ Activity ──────────────────────────────── Alt+A ╮
│ ──────── task started · add login · 12:04 ───────── │ │ 12:04 MASTER    ✓ scouting designer, backend    │
│                                        12:04  You ● │ │ 12:06 DEV       ⠋ reading auth.ts…              │
│        add a login page with email + password ▐     │ │ 12:06 DESIGN    ⠋ editing LoginForm.tsx…        │
│ ◆ Oracle                                      12:06 │ │ 12:06 QUICK FIX ✓ done: rename getUser          │
│   Proposal                                          │ │                                                 │
│   • LoginForm component                             │ │                                                 │
│   • POST /api/login with rate limiting              │ │                                                 │
╰─────────────────────────────────────────────────────╯ ╰─────────────────────────────────────────────────╯
╭ Thinking ────────────────────────────────────────────────────────────────────────────────── DEV · 12s ago ╮
│ The auth module already exposes a session helper; reuse it rather than adding a new one.                  │
╰───────────────────────────────────────────────────────────────────────────────────────────────────────────╯
 ── message the oracle ───────────────────────────────────────────────────────────────────────────────────────
  _
  TYPE  enter send  esc browse  alt+l hide
```

- **1 Lobby** — the task's status (its state box, what the agents are
  doing and the plan checklist), then the conversation with the oracle
  laid out like a chat (its text only: no tool rows, no thinking): your
  messages on the right as bubbles in the accent colour on pi's
  user-message background, each only as wide as its text (at most about
  three quarters of the pane), under `12:04  You ●`; the oracle's replies on
  the left as Markdown under `◆ Oracle  12:06`; and events such as a task
  starting as a centred rule), an activity log that narrates
  every tool call in plain words (`reading index.html…`, `searching for
  "router" in src`, `running npm test`, `delegating to backend: Step 2 …`) from
  the Master and every subagent, and a single **Thinking** pane — the one place
  thoughts show up: the oracle's live thought as it streams, and each finished
  thought from a subagent, quick fix or the planner (pi's own transcript,
  behind the lobby, still carries the oracle's thinking blocks; `ctrl+t`
  collapses them there). The oracle's replies render as Markdown. To keep
  the lobby clean, the animated oracle and agents stay out of it by default:
  they show above pi's editor while the lobby is hidden, and `alt+z` brings
  them into the lobby too (the status box names the key in its corner). `alt+c`, `alt+a` and `alt+k` hide or bring back the conversation,
  the activity log and thinking, and the rest take their room; every choice is
  remembered (`lobby.panels`). Each pane scrolls on
  its own (see **Scrolling** below), and a pane scrolled back stays on what
  you are reading while new lines arrive. The prompt talks to the
  oracle (while it works, enter steers the running turn; `esc` stops it); with
  no task, it starts one.
- **2 Tasks** — every task in the project as a checklist: this session's, the
  ones other pi sessions are driving, pending plans saved from the planner, and
  recently finished ones, each section under a rule with its count. A task or
  plan still to do wears an empty box `☐` (coloured by its state) with its
  state, auto mode and owner beneath and its plan progress as pips
  (`▰▰▱▱ 2/4`); a completed task is ticked `☑`, and an abandoned one is crossed
  `☒` with its title struck through. The detail pane shows the task's box,
  state and progress bar, then the request, the plan's steps (`☑` done, `☐`
  to do, `◂ now` on the current one), the approved plan, your comments on it,
  amendments, what the task waits on and its recent runs. `c` comments on the selected task's plan (see below), `s`
  starts a pending plan as a task **in a new session** and `h` starts it
  here, in this window (either way its agreed plan needs no approval), `d`
  twice discards one. `n` types a new task that starts in its own session, `o`
  shows the session driving the selected task, `x` twice stops a background
  session, and `alt+g` switches auto mode for the selected task. Rows say who
  drives each task (`this session`, `background`, another running session, or
  `not running` once its session has ended) and mark auto mode `⟳ auto`.
  **Cleaning up:** every finished task is listed, and `a` archives the
  selected one — it leaves every list and moves, folder and all, to
  `.pi/bot-lobby/archive/tasks/` (a task still under way is abandoned first,
  so `a` asks twice). `A` twice archives every finished task at once. `v`
  shows the archive as an ARCHIVED section, where `a` restores a task as it
  was. `d` twice deletes a task, on the list or in the archive, for good. A
  task a running session drives (this window's, a background one, or another
  terminal's) is left alone until that session stops or cancels it.
- **3 Plan** — task planning mode with a planning panel. Describe what you
  want and every seat grills you from its own domain, on the model and
  thinking level its settings name: **DEV** (APIs, data, errors, security,
  performance), **DESIGN** (flows, states, copy, visual language,
  accessibility), **QA** (acceptance criteria, test strategy, edge cases,
  definition of done) and **RESEARCH** (libraries, versions, docs and prior
  art, with the web tools when `pi-web-access` is installed). The **oracle**
  chairs on the Planner model: it reads the seats' questions and notes and
  folds every answer into the draft plan (with a *Decisions by domain*
  section). Each round the seats run in parallel, read-only, then the oracle,
  which **chooses at most four questions** for you from the seats' and its own
  — merged, in plain words, the most decisive first — and decides the rest
  with the recommended option, listed under *Assumptions* in the draft so you
  can see and overrule them (comment on the line). The round's questions come
  in **one** ask-user-question dialog: a tab per question labelled with the
  seat it serves (`QA`, `DEV`…), two to four options with what each means,
  the recommendation first (so `enter` on each accepts it), a row to type your
  own answer or add a note, and a Submit tab that reviews everything and lets
  you leave a question blank (the oracle then takes its recommendation). It opens by itself when a
  round ends while the Plan tab is showing (`lobby.autoAsk`), and otherwise
  when you press `enter` on the empty prompt or `a` while browsing; `esc` puts
  it away with your answers so far kept, and `enter` resumes. Your answers go
  back attributed (`3. [QA] Which browsers must pass? → evergreen only`), and
  every seat reads every answer the next round — so the agents that later
  build the task start aligned. You can still type a free reply instead.
  Without the library the same questions come through pi's own select and
  input dialogs. A roster shows what each seat is doing and whether it is
  READY; the plan is READY only when every seat and the oracle agree. The
  draft plan renders as Markdown (headings, lists, code, tables) beside the
  conversation, followed by what each seat said the plan must respect.
  **Comment on any line of the draft**: click it, or press `enter` to move to
  the draft, pick a line with `↑↓` and press `c`, then type the comment. The
  line is marked `◆` with your comment beneath it, and the comment goes to the
  panel with your answers — or starts a round by itself when no question is
  open. While browsing, `1`–`4` seat or unseat DEV, DESIGN, QA and RESEARCH
  for the next round, `n` starts over, `r` retries a round that failed or lost a seat, `x` stops one, and `m`
  opens the oracle's (Planner) settings.
  **Round limit.** Planning is bounded (`lobby.maxPlanningRounds`, 5 by
  default; `/bot-lobby settings` → **Lobby** → *Planning rounds*). Every seat
  and the oracle are told which round it is, the status line counts
  `round 3/5`, and it warns when the next round is the last. The last round
  skips the seats: the oracle alone folds in your answers, decides every
  point still open with its recommended option (listed under *Assumptions*)
  and marks the plan READY; any question it still writes is decided the same
  way by the engine. After the limit, a reply or a line comment still revises
  the plan, the oracle alone and without questions. A retried round keeps its
  number.
  **With the classifier on** (see [The classifier](#the-classifier-jev)),
  each round seats only the members your idea (round 1) or your latest
  answers touch; the others show `sat out · 0.07` with how likely the
  classifier judged them needed, and a seat that was READY needs stronger
  evidence to come back. Seating a member with `1`–`4` pins it: it sits every
  round whatever the classifier says. After the oracle picks the round's
  questions, any whose recommended option the conversation already makes
  clearly right is answered for you (`✓ [QA] … → Evergreen · decided by the
  classifier`), leaves the dialog, and is listed under *Assumptions*, where a
  line comment overrules it. When it settles every question, the panel folds
  them in with one more round on its own, then waits for you.
- **4 Quick fix** — a direct prompt, the way you would ask pi, that skips the
  whole workflow: one coding agent (full tools) makes the change right away
  while any task keeps running. Quick fixes run one at a time in the order you
  send them; each shows its steps and final report, and `x` cancels one. A
  request that turns out to be large is reported back instead of attempted
  (with the classifier on, one it judges large is held before any run: `r`
  runs it anyway, `t` makes it a task).
  `m` opens the quick fix agent's settings — model, thinking level, time
  limit and instructions — right there (the same entry as in
  `/bot-lobby settings`); the tab shows what it runs on.
- **5 Metrics** — model performance across every Master turn, subagent run,
  quick fix, planning seat and oracle planning turn, as a dashboard: tiles for
  runs (with a sparkline of recent run times), success rate, average and p90
  run time, cost and tasks; average run time per model and thinking level as
  bars; success rate per model as meters marked `✓` (≥90%), `!` (≥70%) or `✗`;
  where the time goes as one bar split by agent, with a legend, and how long a
  task takes from request to done by the oracle's model; then the full table —
  runs, success, mean/median/p90 time, turns, tools, tokens, output tokens per
  second and cost (columns drop from the right on narrow terminals). `g`
  splits the table by agent, `s` cycles the sort (runs, average time, success,
  cost).

The **Issues** tab (GitHub issues through the `gh` CLI, planned into tasks
through the Plan tab) is switched off for now; `"lobby": { "issues": true }`
brings it back as tab 5.

**Keys.** Like a modal editor, the lobby has a typing mode (keys go to the
prompt) and a browsing mode (`esc`; arrows move through lists, single keys run
the tab's commands, and on Lobby, Plan and Quick fix any other key resumes
typing). These work in both modes:

| Key | Does |
| --- | --- |
| `alt+l` | hide the lobby (back to pi) |
| `alt+h` (or `?` while browsing) | show every key, and the current tab's |
| `alt+s` | bot-lobby settings: every agent's model, thinking and time limit, and the lobby's switches |
| `ctrl+f` (or `/` while browsing) | search the current tab |
| `ctrl+s` | save the plan from the Plan tab to the pending tasks — while typing too, from any tab |
| `alt+o` | the session browser: view, message or switch to any session in the project |
| `alt+n` | type a new task that starts in its own session, named after it |
| `alt+g` | auto mode on or off for the task in view (the selected one on Tasks) |
| `tab` / `shift+tab`, `alt+1`…`alt+5` | switch tabs |
| `alt+z` | show or hide the oracle and agent animations in the lobby (off by default; the task's status always shows) |
| `alt+c` / `alt+a` / `alt+k` | show or hide the conversation / activity log / thinking |
| `pageup` / `pagedown` | scroll the focused pane a page |
| `ctrl+c` | clear the prompt, or hide the lobby when it is empty |

Every shortcut can be rebound under `lobby.keys` in the config, by action name:
`hide`, `help`, `settings`, `search`, `savePlan`, `sessions`, `newSession`,
`toggleAuto`, `nextTab`, `prevTab`, `toggleScene`,
`toggleConversation`, `toggleActivity`, `toggleThinking`, `scrollUp`,
`scrollDown` — e.g. `"keys": { "toggleThinking": "alt+t" }`. Pick keys that
never type a character (`alt+…`, `ctrl+…`, `f1`…).

**Scrolling.** Every pane scrolls on its own and shows a scrollbar in its
right border when it holds more than fits. While browsing, `←`/`→` move
between the tab's panes (the conversation, activity log and thinking on
Lobby; the conversation and draft on Plan; the list and detail on Tasks and
Quick fix) and the focused one lights up; `↑`/`↓` scroll it a line (or move
a list's selection, or the draft's cursor), `pageup`/`pagedown` a page, and
`home`/`end` jump to its oldest line or back to its newest. The conversation,
activity log and thinking are newest-last: scrolled back, a pane shows `↓N`
for the lines below it and holds still while new ones arrive; `end` follows
the newest again. Details stop at their last line. The Thinking pane keeps
every recent thought, so earlier ones are a scroll away.

**Search.** `ctrl+f` opens a search bar above the prompt; as you type, the tab
narrows to what matches and every match is highlighted: the conversation,
activity log and thoughts on Lobby; tasks and plans (by id, title, request,
proposal or plan) on Tasks; the conversation on Plan (the draft stays whole,
highlighted); jobs on Quick fix; runs (by agent, model, thinking level, kind or
task) on Metrics. `enter` keeps the search while you browse the results,
`esc` clears it, and each tab keeps its own.

**Mouse.** Clicking a tab opens it, clicking a pane gives it the keys,
clicking a draft plan line comments on it, clicking the prompt starts typing,
and the wheel scrolls whichever pane is under the pointer. In pi's regular
screen the lobby turns mouse reporting on only while it is showing (hold
`shift` to select text with the mouse); in full-screen pi, pi reports the
mouse itself. `"lobby": { "mouse": false }` turns clicks off.

Anything that needs pi itself —
built-in slash commands, `/model`, the tool-row toggle — works with the lobby
hidden; bot-lobby's own `/bot-lobby …` commands also work from the Lobby
prompt. When the Master asks you something (an approval, a clarifying
question), the lobby steps aside for the dialog and comes back once you answer.

**Plan comments.** A comment on a task's plan is saved beside the task
(`comments.jsonl`) from any session, and the session that owns the task passes
new comments to its oracle — right away when you comment in that session,
within a few seconds from another one, held while the task is paused or the
session is minimized. The oracle treats a comment like an amendment and calls
`orchestrate action=plan` with the full revised plan, which replaces the
approved plan while implementing or reviewing, keeps finished steps done and
marks the comments addressed (`○` waiting, `◐` sent to the oracle, `✓` plan
amended). Before a plan exists, a comment asks for a revised proposal instead.

## Several sessions from one window

Start a task in a new session without leaving your terminal, and switch
between sessions from the lobby.

- **Start one.** `alt+n` (or `n` on the Tasks tab) opens the prompt for a new
  task; `enter` starts it in its own pi session. `s` on a saved plan does the
  same for the plan. The new session is a headless pi (`pi --mode rpc`) this
  window launches with the same pi build, model and extensions, and it is an
  ordinary saved session **named after its task** — `/resume` lists it by
  that name. Sessions a task starts are named after it too (`/bot-lobby
  <request>` in a fresh session names that session).
- **Watch and talk to it.** The Lobby tab then shows that session: its task's
  status, its conversation, activity log and thoughts, live. The tab bar names
  the session in view (`◆ add signup form · working`), the prompt messages
  its oracle (steering it while it works) and `esc` stops its running turn.
- **Answer it.** When a background session asks something — an approval, a
  clarifying question — the tab bar shows `● 1 waiting`, and `enter` on the
  empty prompt puts the question to you in this window with pi's own dialog
  (`esc` there cancels it, as it would in that session). With the lobby
  hidden, a notice says who is waiting.
- **Browse.** `alt+o` opens the session browser: every session in the
  project, grouped by where it runs — **this window**, the **background**
  sessions it started (working, idle or ended, `⟳` auto mode, `●` questions
  waiting), sessions running in **other terminals** (with or without a task),
  and tasks whose session is **not running** (it ended, or none ever took
  the task). Beside the list, a preview of the one picked: where it runs, its
  task and progress, what `enter` and `s` do with it, and the end of its
  conversation. Every running session keeps a heartbeat in
  `.pi/bot-lobby/sessions/` so the others can see it; one that goes quiet or
  whose process ends drops off.
- **View.** `enter` shows the picked session in the Lobby tab. A background
  session streams live; for another terminal's session or a task that is not
  running, the conversation comes from its saved session file. What you type
  goes to its oracle: a background session is steered directly, another
  terminal's session gets it through its inbox within a few seconds, and a
  task that is not running keeps it in its task inbox (`inbox.jsonl`) until a
  session picks the task up.
- **Switch.** `s` — in the browser, or while browsing a session shown in the
  Lobby tab — runs that session in this window with pi's own session switch
  (through `/bot-lobby switch`), and the lobby comes back on it. A background
  session's process is stopped first, so only this window writes its
  session; a task that is not running resumes its session here (one that no
  session ever owned is taken over instead, like `/bot-lobby claim`). A
  session running in another terminal stays there: switch in that terminal,
  or close it and resume it here. Not while this window's oracle is working.
  The session this window leaves keeps its task, which then shows as not
  running until you switch back.
- **Stop or start.** `x` twice stops a background session; `n` starts a new
  task in a new session.

Background sessions belong to the window that started them: they keep running
while you switch pi sessions there, and stop when that pi exits. Their tasks
keep their state, so `/resume` (by the task's name) or `/bot-lobby claim`
picks one up later.

## Auto mode

Auto mode lets the oracle drive a task to completion without asking you
anything. Switch it with `alt+g` — in the lobby for the task in view (or the
one selected on Tasks), outside it for this session's task — or with
`/bot-lobby auto [on|off]`; `/bot-lobby --task --auto <request>` and
`/bot-lobby start-plan PLAN-… auto` start a task with it on. The tab bar shows
`⟳ AUTO`. While it is on:

- clarifying questions are not asked: the oracle decides from the request,
  the plan and its reconnaissance, and each decision is recorded
  (`Not asked (auto mode): …`); the ask-user-question tool is blocked with the
  same instruction;
- the proposal is approved without asking, and dependency and architecture
  approvals a worker asks for are granted and recorded;
- when the oracle's turn ends before the task is done, the session nudges it
  to keep going. A nudge that changes nothing counts; after three in a row
  auto mode pauses and says the task needs you, and it resumes as soon as the
  task moves again.

The switch lives beside the task (`auto.json`), so any session can flip it for
any task and the session that drives it follows within a few seconds.

**Agreed plans skip approval.** A task started from a plan saved in the Plan
tab (`s`/`h` on Tasks, or `/bot-lobby start-plan`) records the plan it came
from, and its proposal is approved without asking you again — you agreed the
plan with the panel already. Clarifying questions are still decided by the
oracle for such a task, since the plan answered them.

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
task (the widget shows while the lobby is hidden; inside the lobby the same
scene shows only with `alt+z`, its status box otherwise). At 72 columns and wider it draws a large scene: a header box with the task
title and state in its top border, a progress bar, and a metadata row with
elapsed time, quiet-mode hint and task id; an oracle tower with a twinkling
aura (drifting z's while dormant), a radiant orb crown, two window eyes, a
seven-column mouth and its ORC door. Its pupils look around: they move
left, centre or right in each window and turn up `◓`, ahead `◉` or down `◒`.
While agents work it looks down at them, taking turns between them; while it
talks it looks at you; otherwise its eyes wander the room and keep returning
to you. It keeps a straight, serious face (`───`), tightening into a frown
only when the task is blocked, and its mouth lip-syncs as a voice waveform
for ~2 s whenever it says something new. Every 6–12 s it blinks (lids
stepping down and up) or scans the whole room; asleep, it peeks one eye open
or snores. Beside the crown, the oracle's speech
bubble, its tail on the orb, says what the master is doing (`⠋ delegating`,
`⠋ thinking`, `· your turn` once its turn ends, `· dormant` when paused) above
who is at work (`→ DEV · QA`), the current step (`step 3 of 7`) or the task
phase (`awaiting your approval`);
four animated slots — DEV, DESIGN, RESEARCH and QA — each with a status face, a
caption and two status rows: while running, a braille spinner beside the agent's
live one-word activity (for example `⠋ reading` or `⠋ editing`) with its elapsed
time on the row beneath; otherwise the coloured status glyph and state word over
that elapsed time. A working agent's status row turns into a warning when it is
waiting on a file (`⧗ waiting`), has gone quiet (`! quiet 1m`) or is retrying a
provider call (`↻ retrying`). Under the agents, a live feed row says exactly what
one of them is doing — `▸ DEV editing users.ts · turn 4 · 12 tools · 41k tok` —
rotating between working agents every few seconds and putting warnings first
(gone quiet, waiting on a file, asked to wrap up); once nothing runs it shows the
last run's receipt. It only takes a spare line, so it never costs the tower, the
agents or a checklist row. A full-width TASKS checklist windowed on the current
step closes the scene. Narrower terminals keep the boxed banner, header and
compact animated strip, whose working line names the newest running agent's
activity, its target and elapsed time.

Each agent has a kaomoji personality. About 300 faces across 15 emotions (happy,
proud, love, excited, focused, curious, thinking, nervous, confused, sleepy, sad,
angry, waiting, surprised, grateful) come from a shared pool every agent can use
plus each agent's own set of at least four faces per emotion: DEV wears shades,
flexes and flips tables `(╯°□°)╯︵ ┻━┻`; DESIGN sparkles `✧(◕‿◕✿)`; RESEARCH
takes notes `φ(．．)` and shrugs `¯\_(ツ)_/¯`; QA side-eyes everything `(ಠ_ಠ)`,
then flexes `ᕙ( • ‿ • )ᕗ` and dances `ᕕ( ᐛ )ᕗ` on a pass. The face follows what
the agent is going through — curious while reading, nervous while tests run,
confused when quiet, grateful when handed a file, happy or proud when done, sad
or angry on failure — and every emote blinks: open face, a same-width blink, then
its action (the flip, the sparkle, the bow). Each sprite rests on one calm
five-column face and blinks (~500 ms) or emotes (~2 s) on its own schedule —
every 8–15 s while working, 20–30 s when idle — and reacts immediately when its
agent starts, finishes, fails, gets flagged or receives a file. Everything runs
on one adaptive clock — 250 ms while work is live, 1 s when idle and ~120 ms
while an expression plays or the oracle talks. The header progress bar is
plan-derived.

Every finished subagent run also leaves a one-line receipt in the transcript,
for example `✓ DEV worker · 3m 12s · 9 turns · 23 tools · 41k↑ 6k↓ · $0.12 ·
provider/model`, flagged when it stalled, hit its time limit or wrapped up early,
and a stall or deadline raises a warning. `/bot-lobby runs` lists the task's
recent runs the same way, which makes a slow model easy to spot.

The checklist follows the workers through the plan. Plan steps are read from
`Step N` headings, a `Steps`/`Sequence`/`Order` section, or numbered lines, and
only top-level items count (sub-points nested under a step never inflate it).
Each worker instruction is matched to a step by an explicit label
(`Step 3: ...`, `steps 2-4`) or, failing that, by shared paths, its opening
phrase and word overlap, with near-ties going to the earliest open step so a
file path reused across steps cannot pin progress to step 1. Every worker
delegation is recorded on the task, so progress survives a reload.
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
| `plan` | planning, implementing, reviewing | Record the internal plan (all §12 areas required); later, replace it with an amended plan (addresses lobby comments) |
| `implement` | planning, implementing, reviewing | Delegate a step to a domain Worker, or several domains at once with `assignments` (parallel, sharing files through the file desk) |
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

## Subagent runtime

Every scout, worker, reviewer and researcher is an isolated `pi --mode rpc`
process: the task goes in over stdin, and the run ends when the agent settles.
The runner watches every run:

- **Wrap-up nudge.** At 75% of its time limit (`workflow.wrapUpAt`) the agent is
  steered to stop exploring, leave its files consistent and report now, so a
  slow agent returns partial work instead of nothing. The receipt and the
  Master's report flag the run as wrapped up early.
- **Deadline.** At the time limit the agent is aborted, then killed after a short
  grace. A spent deadline is never retried.
- **Stall watchdog.** An agent that produces no output for `stallTimeoutMs`
  (5 min) — or `toolStallTimeoutMs` (10 min) during a single tool call such as a
  test run — is killed as stalled and retried once. pi's own provider retry
  backoff extends the allowance.
- **Clean kills.** Each subagent leads its own process group, so a kill takes any
  dev server or watch-mode test it started with it, and a run ends on process
  exit even if a leftover process still holds its output pipe.
- **No dead ends.** Dialogs from other extensions are auto-cancelled inside
  subagents, and startup network checks are skipped (`PI_OFFLINE`,
  `PI_SKIP_VERSION_CHECK`) to cut spawn time.

## Parallel workers and the file desk

`orchestrate action=implement` with `assignments` (one entry per domain) runs
those workers at the same time. They share the working tree through a file desk
kept in the Master's process, like people sharing a physical document:

- Before editing a file a worker calls `claim_file` with the path and a one-line
  intent. A free file is granted at once; an `edit`/`write` on an unclaimed file
  is refused. Reading never needs a claim.
- A busy file queues the claimant, who keeps working on its other files. The
  holder is told the queue in order, with each worker's intent (`my_files` shows
  it any time).
- `handover_file` passes the file to whoever is next, with a note written for
  that worker's intent; the receiver is told what changed and who waits behind
  it, and re-reads the file before editing.
- A worker that finishes or crashes hands over everything it still holds, with a
  note built from its report. `wait_for_files` refuses while the caller owes a
  file someone else waits for, which breaks deadlock cycles.

Workers reach the desk over a private Unix socket (a named pipe on Windows)
through bot-lobby's own extension, which loads inside every subagent; the Master
is warned if a worker never checked in. Edits made through bash commands are
governed by the prompt, not enforced.

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
| Failure is never success | Unknown verdicts, empty output, crashes, stalls and timeouts map to failed/timeout/blocked |
| The QA gate never passes by default | A PASS that cites no executed check under `## Verification` is downgraded to CHANGES_REQUIRED |
| Parallel workers never edit the same file at once | `edit`/`write` need a claim from the file desk; busy files queue and are handed over with notes |
| A hung agent cannot hold a step | Stall watchdog, wrap-up nudge, deadline abort and process-group kill; deadlines are never retried |
| Task state is never corrupted by a crash | Single mutation point + disk state; interrupted tasks resume from their state |

Domain boundaries between *writers* remain prompt-enforced and Master
coordinated: only the affected domain is asked to change its own code. Workers
run one at a time unless the Master delegates several domains together, in
which case the file desk serialises edits per file. Worktree isolation is
deferred (§14 of the plan).

## The classifier (Jev)

Some decisions do not need a large model: which planning seats have anything
to ask, which files an agent should open first, how big a task is, which
answer to an obvious question is right, and how much model a simple step
needs. With the classifier on, bot-lobby asks
[Jev](https://github.com/FrancoisChastel/jev-code) — TypeSafe's "System One"
model, which answers typed questions (yes/no, one of a set, a score) with
calibrated probabilities in a few hundred milliseconds instead of writing
text — and acts on the answer only when it is confident; otherwise it does
what it always did.

**Turn it on.** `/bot-lobby settings` → **Classifier (Jev)** → *Classifier*.
It is off by default.

**The key lives with pi's other keys.** bot-lobby registers a `typesafe`
provider with pi (no chat models, so nothing is added to `/model`): run
`/login typesafe` and choose *Use an API key*, and pi saves it in
`~/.pi/agent/auth.json` like any other key (`/logout` removes it), or export
`TYPESAFE_API_KEY`. *Host* switches to OpenRouter or Vercel AI Gateway, which
use the key pi already holds for that provider. *API key* in the menu says
where the key comes from (never the key; `ts_ab…cd` at most), and *Test
connection* makes one tiny call and shows the model and the time it took.
Subagents resolve the key the same way, so it is never passed through the
environment.

**It never gets in the way.** Every call has a time limit
(`classifier.timeoutMs`, 4 s) and one retry; a missing key, an error or a
timeout means bot-lobby decides without it (a missing key is said once).
Three failures in a row pause the classifier for ten minutes with one
warning. Each call is recorded in `metrics.jsonl` (kind `classifier`, with
what it decided, its time and its tokens) and kept out of the agent tables.

**What it decides.** Each decision has its own switch under *Classifier
(Jev)* (`classifier.features`) and its own thresholds
(`classifier.thresholds`):

- **Planning seats** (`seats`): each round, one call asks per seat whether
  the idea or your latest answers touch its domain; a seat sits at
  `seatAt` (0.35, inclusive on purpose: a missing seat costs a wrong plan,
  an extra one only a run), a seat that was READY only at `reseatReadyAt`
  (0.6). Pinned seats are never asked about; a failed call seats everyone.
- **Obvious answers** (`answers`): one call per round asks, for every
  question with options, which answer the conversation and the draft make
  clearly right — or whether it is really your call. It answers only when
  its pick *is* the recommended option, at `autoAnswerAt` (0.9) and ahead of
  the runner-up by `autoAnswerMargin` (0.5). Approvals are never answered
  for you.
- **Task triage** (`triage`): when a task starts, one call reads the
  request — its size (trivial, small, medium, large), which domains it
  touches, whether it needs outside research, whether it is ambiguous as
  written, its kind — with the repository's layout, and attaches its likely
  files. The Master gets it as *Classifier triage* with a suggested path
  (for example the single-domain shortcut for a small backend fix) while the
  task is being shaped, and skips the reasoning and scouts it does not need;
  it stays a hint, and an amendment re-reads the request. A `clarify`
  question with options (recommended first) that the request already settles
  is answered the same way as an obvious panel question, and recorded as a
  decision. A quick fix the classifier judges **large** at
  `quickFixLargeAt` (0.8) is **held** instead of started (`‖ looks like a
  task`): on the Quick fix tab `r` runs it anyway and `t` starts it as a
  task in a new session.
- **File hints** (`files`): before a scout, worker, quick fix or planning
  round starts, the repository's files are ranked against its instruction
  and the agent gets a short **Likely files** list (at most
  `fileHints.topK`, 8, each at `fileRelevantAt` 0.5 or more) to open before
  it searches. Each file is judged on an excerpt of at most 400 characters —
  its leading comment, imports and signatures (headings for Markdown) —
  cached in `.pi/bot-lobby/cache/files.json` and refreshed by size and
  modification time. A large repository is first narrowed by shared words
  (`fileHints.maxCandidates`, 480), then judged in parallel batches. Ranking
  gets `fileHints.budgetMs` (1.5 s); after that the agent starts without it.
  No list is shown when nothing stands out. Agents also get a
  `find_relevant_files` tool: describe what you need in plain words and it
  returns the ranked paths. Files git ignores, bot-lobby's own state,
  binaries, lockfiles and secrets (`.env*`, keys, certificates, `secrets/`,
  `.ssh/`, `.npmrc` …) are never indexed.

**What leaves your machine.** Only what a decision needs, clipped: the
planning conversation and draft for seats and answers, a request or step
instruction for triage and effort, and short file excerpts (never whole
files) for file hints. Paths matching `classifier.exclude` are never sent.

## Configuration

Per-agent settings are edited interactively with `/bot-lobby settings` (or the
top-level `/bot-lobby-settings`) and persist globally to
`~/.pi/bot-lobby/config.json`:

```json
{
  "master": { "model": "inherit", "thinking": "high", "instructions": "" },
  "agents": {
    "designer": { "model": "anthropic/claude-sonnet-5", "thinking": "medium", "instructions": "", "timeoutMs": 900000 },
    "backend": { "model": "anthropic/claude-sonnet-5", "thinking": "medium", "instructions": "", "timeoutMs": 900000 },
    "qa": { "model": "anthropic/claude-sonnet-5", "thinking": "medium", "instructions": "", "timeoutMs": 900000 }
  },
  "scout": { "model": "anthropic/claude-haiku-4-5-20251001", "timeoutMs": 480000 },
  "researcher": { "model": "anthropic/claude-sonnet-5", "thinking": "low", "instructions": "", "timeoutMs": 600000 },
  "quickFix": { "model": "anthropic/claude-sonnet-5", "thinking": "low", "instructions": "", "timeoutMs": 600000 },
  "planner": { "model": "anthropic/claude-sonnet-5", "thinking": "high", "instructions": "", "timeoutMs": 300000 },
  "lobby": { "autoOpen": true, "planningPanel": ["backend", "designer", "qa", "researcher"], "autoAsk": true, "issues": false, "mouse": true, "maxPlanningRounds": 5 },
  "classifier": {
    "enabled": false,
    "provider": "typesafe",
    "model": "",
    "baseUrl": "",
    "timeoutMs": 4000,
    "features": { "seats": true, "answers": true, "files": true, "triage": true, "effort": true },
    "thresholds": { "seatAt": 0.35, "reseatReadyAt": 0.6, "autoAnswerAt": 0.9, "autoAnswerMargin": 0.5, "fileRelevantAt": 0.5, "simpleAt": 0.7, "trivialAt": 0.8, "quickFixLargeAt": 0.8 },
    "fileHints": { "topK": 8, "maxCandidates": 480, "budgetMs": 1500 },
    "effort": { "cheapModel": "inherit" },
    "exclude": []
  },
  "workflow": {
    "maxReviewIterations": 2,
    "maxParallelScouts": 3,
    "maxParallelWorkers": 3,
    "requireApprovalForFeatures": true,
    "requireApprovalForDependencies": true,
    "requireApprovalForArchitectureChanges": true,
    "agentTimeoutMs": 900000,
    "maxAgentRetries": 1,
    "stallTimeoutMs": 300000,
    "toolStallTimeoutMs": 600000,
    "wrapUpAt": 0.75
  },
  "knowledge": {
    "compactionThreshold": 20000,
    "backupCount": 1,
    "scratchpadMaxParagraphs": 4,
    "scratchpadMaxChars": 2000
  }
}
```

Every agent runs on the model and thinking level its settings name — nothing
inherits the live session's thinking level. Designer and Backend workers use
their domain's entry, QA's workers and the QA gate use QA's, and scouts and the
researcher have their own entries. Scouts always run at `low` thinking (their
entry offers a model and a time limit only); every other agent's thinking is
yours to set, defaulting to `medium` (`low` for the researcher). A subagent
whose model is not set yet runs on the session's model, and opening
`/bot-lobby settings` pins such entries to that model so the choice is always
visible; only the master keeps `inherit`, since it is the session itself.
Each subagent entry has a `timeoutMs` (default 15 min; scouts 8, researcher 10),
falling back to `workflow.agentTimeoutMs`.

The lobby's two agents have entries of their own: `quickFix` (the direct-change
agent, `low` thinking and 10 minutes by default) and `planner` (the oracle
chairing the planning panel, `high` thinking; its time limit bounds one round
for every seat, 5 minutes by default). Both appear in `/bot-lobby settings`,
take custom instructions, and run on the session's model until you pin one.
Planning seats reuse their domain's entry — DEV the Backend's, DESIGN the
Designer's, QA the QA's, RESEARCH the Researcher's model, thinking and
instructions — so a seat plans on the model that will later build its part.
The `lobby` entry shapes the lobby itself; `/bot-lobby settings` → **Lobby**
flips its switches, and key rebinding lives in the file:

```json
"lobby": {
  "autoOpen": true,
  "planningPanel": ["backend", "designer", "qa", "researcher"],
  "autoAsk": true,
  "issues": false,
  "mouse": true,
  "maxPlanningRounds": 5,
  "panels": { "animations": false, "conversation": true, "activity": true, "thinking": true },
  "keys": { "toggleThinking": "alt+t" }
}
```

`planningPanel` names the seats a new planning session starts with (every
seat by default; `[]` lets the oracle plan alone); `autoOpen` opens the lobby
by itself when this session starts or resumes a task; `autoAsk` puts the
panel's questions to you as soon as a round ends while the Plan tab is
showing (otherwise `enter` on the empty prompt does); `issues` shows the
GitHub Issues tab (off for now); `mouse` turns clicks and the wheel on;
`maxPlanningRounds` bounds a planning session (the last round the oracle
settles alone; `0` is unlimited);
`panels` is which Lobby panes show, with `animations: true` bringing the
animated oracle and agents into the lobby (off by default; the older
`scene` key is no longer read, and the pane keys update it); `keys` rebinds
shortcuts by action name.

`thinking` must be one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`,
`max`; a legacy `inherit` or unknown value falls back to `medium`. The thinking
picker lists only the levels the selected model supports. Switching to a model
that cannot run the saved level warns ("\"xhigh\" thinking isn't supported by
provider/model — using \"high\"") and saves the nearest supported level; a run
whose level its model cannot use is clamped the same way with a one-time
warning, and `/bot-lobby config` lists any mismatch. `instructions` is appended to that agent's compiled
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
├── archive/tasks/TASK-…/       archived tasks, whole, out of every list until restored
├── sessions/<id>.json          heartbeats of the pi sessions running in the project
├── sessions/<id>.inbox.jsonl   messages for a running session's oracle, and their delivery
├── backlog/PLAN-<slug>.json    pending tasks saved from the planner (optionally linked to an issue)
├── metrics.jsonl               one line per finished run of any agent, for the Metrics tab
└── tasks/TASK-<stamp>/
    ├── state.json              the task record (kept after completion)
    ├── comments.jsonl          your lobby comments on the plan and their delivery (append-only)
    ├── inbox.jsonl             messages for the oracle from other sessions and their delivery (append-only)
    ├── auto.json               auto mode, when switched on for the task
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
│   ├── agent-runner.ts       Single/parallel/sequential runs, live run state, cancellation, retries
│   ├── pi-runner.ts          Isolated `pi --mode rpc` subprocess, watchdog, stream parsing
│   └── git.ts                Diff evidence for reviewers
├── desk/                     File desk for parallel workers: checkout table, socket, worker extension
├── knowledge/                Paths, store (single write path), selector, compactor
├── prompts/                  Layer loader + compiler
├── lobby/
│   ├── runtime.ts            Mounts the full-screen lobby on pi's TUI, dialogs hand-off, background sessions, Master metrics
│   ├── view.ts               The tabbed view: tab bar, per-tab prompt, typing/browsing modes, session switcher, search, help, mouse
│   ├── sessions.ts           Background sessions: headless pi children driven over RPC, their feeds and questions
│   ├── session-files.ts      Other sessions' conversations, read from their saved session files
│   ├── keys.ts               The shortcut table and its config overrides
│   ├── ask.ts                The panel's questions through the ask-user-question questionnaire (or pi's dialogs)
│   ├── markdown.ts           Markdown through pi's renderer, cached per theme and width
│   ├── tabs/                 Pure renderers: home, tasks, plan, quickfix, issues, metrics
│   ├── feed.ts               Activity log, thinking pane and conversation store
│   ├── quickfix.ts           Direct-change jobs, one at a time
│   ├── planner.ts            The planning panel: seats and the oracle per round, reply parsing, saving a plan
│   ├── issues.ts             GitHub issues through the gh CLI
│   └── layout.ts             Boxes, exact-width columns, wrapping, highlights, bars, meters and sparklines
├── classifier/               Jev: the System One client, hosts and keys (pi's /login typesafe), the facade every decision calls; planning seats, obvious answers, likely files and find_relevant_files
├── state/                    Project root, config, task persistence, state mutation, comments, inbox, auto mode, backlog, metrics
├── schemas/                  Task, agent, findings, configuration types
└── pi/                       Commands, lifecycle, orchestrate tool, status widget, the owner's clock (deliveries, auto mode)
prompts/                      global, master, designer, backend, qa, scout, worker, reviewer, researcher, quickfix, planner, panel
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

Deliberately deferred (matching the build plan): worktree-based isolation for
parallel Workers (they share one working tree through the file desk) and
cross-platform runtime abstractions. The internal module boundaries keep those
extractable. The lobby (see above) has since added the full-screen dashboard
and per-model performance analytics.
