# Bot-Lobby

A [Pi](https://pi.dev) extension that forces you to vibe code intentionally.
You still describe what you want in plain words, but you don't just hand it
over: you and the model work out together what's needed until the picture is
clear, and then a multi-agent software team builds what you agreed on.

![The Lobby tab: your conversation with the oracle, the activity log of every agent, and their latest thoughts](https://raw.githubusercontent.com/a-t-h-i/bot-lobby/main/docs/gallery.png)

`/bot-lobby <request>` (or a request typed in the lobby) starts a task, unless
one agent can simply do it: then it goes to the [quick-fix agent](#quick-fix-or-the-team).
For a task, your Pi session becomes the **Master**
(the "oracle"): it scouts the codebase, proposes a plan, and delegates the
work to three domain agents — **Designer+Frontend**, **Backend** and **QA** —
each running in its own isolated `pi` process. QA's reviewer is the quality
gate before anything is marked done. QA reviews adversarially (it tries to
break the change) and writes as few tests as it can: only for a breaking
change, for behavior that could turn out unpredictable, or when asked.

The rule: **you decide with the LLMs, and the engine enforces.** Agents
propose; you shape and approve the plan with the oracle; the extension
validates every state change, permission and approval through one
`orchestrate` tool.

The oracle is meant to be your most capable model; the agents can be smaller
and cheaper ones. So it never assumes they are as capable as it is: it makes
every decision itself and [briefs each agent in full](#briefing-the-agents).

## Install

```bash
pi install npm:@a-t-h-i/bot-lobby
```

Try it once without installing: `pi -e npm:@a-t-h-i/bot-lobby`. From a source
checkout: `pi -e ./src/index.ts` (keep `prompts/` next to `src/`).

Nothing else to install: bot-lobby brings its own
[questionnaire and web tools](#questions-and-the-web), and they work in plain
Pi too, with or without a task. If you installed `pi-web-access` or
`rpiv-ask-user-question` for bot-lobby, remove them: they register the same
tool names.

## Quick start

1. `/bot-lobby add a login page` — starts a task; the lobby opens.
2. Answer the Master's questions, then approve its proposal.
3. Follow the agents in the lobby, a web page that opens in your browser when Pi starts: what they do, and what they think.

The lobby's Settings page sets each agent's model, effort (a slider that skips
what the model cannot do), time limit and extra instructions.

## Commands

| Command | Does |
| --- | --- |
| `/bot-lobby` | Open the lobby in your browser (it already runs: the page starts with Pi) |
| `/bot-lobby <request>` | Start a request: a [quick fix](#quick-fix-or-the-team) when one agent can do it alone, else a task (`--task` to always make it a task, also when it begins with a command word; `--auto` to run unattended, `--budget 90m` to give it a time budget, `--fast` / `--full` to pick its [track](#fast-track-or-full-workflow), `--branch` / `--worktree` / `--no-branch` to give it its own [git branch or worktree](#a-branch-or-worktree-per-task) or none) |
| `/bot-lobby budget [90m\|off]` | Show or set this session's task time budget |
| `/bot-lobby status \| tasks \| runs [id]` | Current task, all tasks, recent agent runs |
| `/bot-lobby approve \| amend <text> \| decline` | Answer the proposal |
| `/bot-lobby accept [id]` | Accept a task's work as it is, without a QA pass; the oracle then completes it |
| `/bot-lobby pause \| resume \| cancel [id]` | Control a task |
| `/bot-lobby auto [on\|off]` | Auto mode: the oracle finishes the task without asking (`alt+g` in Pi) |
| `/bot-lobby claim <id>` | Take over a task another session owned |
| `/bot-lobby start-plan PLAN-… [auto]` | Start a plan saved from the Plan tab |
| `/bot-lobby settings \| config` | Edit settings / show the effective config |
| `/bot-lobby knowledge` | Knowledge file sizes |
| `/bot-lobby minimize \| restore` | Hide bot-lobby in this session (`ctrl+shift+m`) |
| `/bot-lobby web` | Open the lobby page again (it starts with every interactive Pi session, on this machine only) and print its link |
| `/bot-lobby web link` | Print the browser UI's link |
| `/bot-lobby web stop` | Stop the page until the next session |
| `/bot-lobby web reset` | Reset the browser UI's link (its old cookies stop working) |

## Quick fix or the team

Before any task exists, bot-lobby asks whether **one agent can just do it**:
in one file or one area, with nothing to agree between frontend and backend,
no unfamiliar codebase to survey, nothing risky and no decision you must make
first. [Jev](#the-classifier-jev) answers when it is on (`classifier.thresholds.quickFixAt`,
0.7); plain rules answer otherwise, and whenever Jev is unsure. A request that
says it is self-contained ("a single page", "in one html file") counts even
when it is rich.

When it reads that way, the oracle confirms in one step, without reading
files or planning (`route_request`), and says so: *this looks like a quick
feature, the quick-fix agent is on it*. The lobby then hands the request to
the quick-fix agent and switches to the **Quick fix** tab, where you follow
it. No scouts, proposal, plan or QA. A quick feature (bigger than a small
change, but in one place) runs on its builder's model, thinking and time limit
(DESIGN's for a page) instead of the quick-fix defaults.

Everything else, or anything the oracle judges needs the team, starts as a
task below. `--task` always makes a task; `workflow.routeQuickFixes: false`
turns routing off. Without the lobby (a background session, RPC mode) every
request is a task.

## How a task runs

```
full workflow:  request → clarify → scout → propose → approve → plan → implement → QA gate → complete
fast track:     request → implement (only the agents it needs) → QA, if it needs tests → complete
```

### Fast track or full workflow

The moment a task starts, bot-lobby reads the request and decides how serious
it is: its size, who has to take part, and whether it takes the **fast
track** or the **full workflow**. The read is instant and costs no tokens
(plain rules, refined by [Jev](#the-classifier-jev) when that is on).

| The request… | Who takes part |
| --- | --- |
| changes anything that runs in the browser: screens, components, styles, copy, canvas or three.js graphics | DESIGN (frontend) |
| changes an API, the database, auth, jobs or other server-side code | DEV (backend) |
| needs tests: asks for them, fixes a bug, or changes backend logic | QA |
| depends on outside facts: latest versions, docs, standards, third-party APIs | RESEARCH |

A **small, clear, low-risk** request takes the fast track: the oracle hands
it straight to those agents, with no scouts, no proposal to approve and no
plan document (the engine keeps a short plan whose steps are the
delegations, so the checklist still works). QA takes part only when the
change needs tests (its worker writing and running them as the last step, or
the QA gate); without it the task completes as soon as the work is in and
checked. A copy change is one agent run.

Everything else takes the full workflow below: anything **medium or large**
(a new page, flow or endpoint, a refactor, an upgrade, a vague or
many-part request), **serious** whatever its size (security, auth,
passwords, payments, migrations, production, personal data), or **unclear**
(too short, vague, or asking to investigate first).

- The oracle glances at the read once and acts on it, or corrects it with
  `orchestrate action=track`: the full workflow for a change bigger than it
  reads, the fast track for one that is smaller (before its work is planned),
  or a member added or dropped.
- Once work is under way a track only gets stricter: the full workflow or
  more members, never QA dropped. A fast task whose worker asks for a new
  dependency or an architecture change gets QA.
- `/bot-lobby --fast <request>` or `--full <request>` decides it yourself;
  the oracle never moves a `--full` task to the fast track.
  `workflow.fastTrack: false` puts every task on the full workflow.
- The track shows in the lobby's activity log, the task's details on the
  Tasks tab, and `/bot-lobby status`.

### Briefing the agents

Every agent may run on a smaller, cheaper model than the oracle's, one that
follows instructions well but does not infer intent. So the oracle writes
each delegation (`implement`, `scout`, `research`) as a self-contained brief
and settles every design and architecture decision itself first:

- **Goal**, the exact **Files**, numbered **What to do** with names, shapes
  and values, the **Contracts** shared with other agents (repeated in full in
  each brief), **Constraints**, **Done when** (checkable criteria and the
  commands to run) and **If stuck**.
- Plan steps are written to the same standard, so a brief is the plan step
  made explicit, never a new decision.
- Every agent is told to follow its brief and the approved plan exactly, use
  the given names letter for letter, and report what does not match instead of
  guessing. Workers end their report with a **Brief Check**: each "Done when"
  item, met or not, with evidence.
- The oracle holds each report to its brief. Drift, a skipped criterion or a
  guessed choice comes back as a fix step with a more explicit brief.
- The engine backs it up: a delegation that names nothing concrete (or a long
  one with no done criteria) is sent back to the oracle once before any agent
  starts. Sending the same text again goes through, so a short task that is
  complete as written is never stuck. `workflow.briefCheck: false` turns it off.

### The full workflow

- **Scouts** (read-only) investigate the domains the request touches.
- The Master **proposes** a short bullet list; nothing is built until you
  approve it.
- **Workers** implement plan steps, one domain each. Several can run in
  parallel; they share files through a **file desk** (claim a file, queue for
  a busy one, hand it over with a note).
- The **QA gate** runs once at the end. A failed gate sends fixes back to the
  owning domain, a bounded number of times. Only critical or major findings
  fail it, and a re-review checks what the last round asked for instead of
  starting over. It reviews everything since the commit the task started
  from, so committed fixes still count. At the round limit you decide: accept
  the work as it is, one more round, or leave it blocked (`/bot-lobby accept`
  works any time). It knows who changed each file:
  this task's workers (**planned**), a **quick fix** you ran, work that was
  there before the task (**pre-existing**), another task, or no agent at all
  (**unattributed**, which the Master asks you about). Quick fixes are never
  treated as rogue changes or reverted.
- A **researcher** can be summoned for cited web evidence, through
  bot-lobby's [web tools](#the-web).

**Auto mode** approves proposals and answers clarifying questions for you;
after three nudges without progress it pauses. A task started from a plan
agreed in the Plan tab skips approval too.

**Safety nets:** every agent has a time limit (asked to wrap up at 75%), a
stall watchdog and one retry; `Esc` aborts every running agent.

## A branch or worktree per task

Every task has a friendly name, made from the first words of its request and
the day it started: `Task-Change-Table-Font-27-09-2026`. It is the task's id,
the name of the session that drives it and, when you ask for one, its git
branch.

`workflow.gitIsolation` (or `--branch`, `--worktree`, `--no-branch` on one
request; a **Git isolation** entry in `/bot-lobby settings`) decides what a new
task gets. It is `off` by default.

| Setting | A new task gets |
| --- | --- |
| `off` | nothing: it works in the folder you started it in |
| `branch` | a branch named after it, created and checked out in the working folder (uncommitted work comes along) |
| `worktree` | a second checkout of its own, `.pi/bot-lobby/worktrees/<name>`, on a branch named after it. **Every agent of the task runs there**, so tasks (and your own checkout) never trample each other's files; uncommitted changes in your checkout are not in it |

- The name is made unique (`-2`, `-3`… when a branch or remote branch has it).
- Git never stops a task: outside a repository, without a commit (a worktree
  needs one) or when a checkout is refused, the task runs without and says why.
- The oracle is told where the work lives, the Tasks tab shows the branch and
  worktree, and the lobby's title shows the branch a task works on.
- A worktree is kept when its task ends: merge or delete it yourself
  (`git worktree remove …`). One that was removed while its task runs is
  reported, and no agent is started in its place. bot-lobby adds the worktrees
  folder to `.git/info/exclude` (a local file) so `git add -A` skips it.

## Time budget

`/bot-lobby --budget 90m <request>` (or `/bot-lobby budget 90m` on the task in
hand, or `workflow.taskBudgetMinutes` for every task) gives a task 90 minutes
of work time, for the oracle and every agent. The clock runs while the oracle
works and stops while it waits on you.

- The oracle divides the time by scope: each step gets its minutes, and the
  QA gate keeps a reserve. Every agent is told how long it has and gets a
  heads-up at 75%.
- When a worker's time is up it stops, keeps its files consistent, and
  reports what it did, where it left off and how much more it needs. You are
  asked: *DEV was busy with …; left to do: …; it needs 10 more minutes.* Give
  it the time (or another amount) and the same agent carries on where it
  stopped, its context intact; or stop it there.
- Once the budget is spent no new work starts: the oracle asks you for more
  (with a reason) or wraps up with what is done. Auto mode gives an agent more
  once, only from time the task still has, and never grows the budget.
- The lobby shows `34m of 1h 30m`, and each agent's `12/30m`.

**A fresh context per task.** Every agent runs in its own Pi process with its
own context. The oracle, which is your session, starts each task clean: its
model sees only the conversation since the task started, and once a task ends
your next request starts fresh (the lobby shows *context cleared*, and the
oracle is told where the finished task's record is). The session file keeps
everything. `workflow.freshContext: false` in the config turns this off.

## The lobby

bot-lobby is a web-only plugin. When Pi starts an interactive session it also
starts the lobby, a page served on `127.0.0.1` (this machine only, behind a
secret link), opens it in your browser and shows its address in Pi's status
line. Nothing is drawn in the terminal but Pi itself.

The page is a calm, glassy window in a light or a dark theme (the sun/moon
button in its top row). The tabs are numbered pills joined by dotted lines; the
lit pill glides to the tab you pick like a drop of water. Under the tabs, each
tab is a pair of cards, a list on the left and the chosen item on the right.
At the bottom floats **one text box for everything**: it grows as you type (or
opens up to a tall editor), takes Markdown, and takes images, PDFs and other
files (pick, paste or drop them, up to 20 MB each, eight per message). Who it
talks to follows the tab: the oracle everywhere, the planning panel on Plan, a
quick fix on Quick fix, a comment on the open task (or a message to its
oracle) on Tasks, the picked session on Sessions. The oracle's questions pop
up in the middle of the window over a blurred backdrop; there is only ever one
pop-up, and one toast, on screen at a time. Activity and Thinking can be
minimized to their title bar. `alt+h` lists every key.

| Tab | What it is |
| --- | --- |
| **1 Lobby** | Your conversation with the oracle, an activity log of every agent's steps, and each agent's latest thought |
| **2 Tasks** | Every task and saved plan as a checklist. Start a plan here or in a new session; comment on a plan (images welcome); archive or delete |
| **3 Plan** | Plan a task with a panel of agents before building it (below) |
| **4 Quick fix** | One agent makes a change right away, beside any running task; requests the oracle [routes here](#quick-fix-or-the-team) show up too |
| **5 Metrics** | Run time, success rate, tokens and cost per model and agent |
| **6 Git** | The repository's open pull requests; review one with an agent, or have Jev read it |
| **7 Knowledge** | Everything each agent knows about the project; edit an entry, or leave a note every agent reads |
| **8 Excalidraw** | Up to five shared Excalidraw sessions, each assigned to one agent or several, who read the board and draw on it with you |

### Lobby

![The Lobby tab](https://raw.githubusercontent.com/a-t-h-i/bot-lobby/main/docs/gallery.png)

Your conversation with the oracle on the left, the activity log of every
agent's steps on the right, and the agents' latest thoughts below. Activity and
Thinking fold down to their title bar; the box at the bottom steers the
running turn.

### Tasks

![The Tasks tab](https://raw.githubusercontent.com/a-t-h-i/bot-lobby/main/docs/lobby-tasks.png)

Every task as a checklist, with its track, plan progress, the approved plan
and your comments on it.

### Plan

![The Plan tab](https://raw.githubusercontent.com/a-t-h-i/bot-lobby/main/docs/lobby-plan.png)

The panel's questions, with their options, on the left; the draft plan
on the right. See [Planning](#planning).

### Quick fix

![The Quick fix tab](https://raw.githubusercontent.com/a-t-h-i/bot-lobby/main/docs/lobby-quickfix.png)

One agent's jobs, each with its live steps, the files it edited and its
report. See [Quick fix or the team](#quick-fix-or-the-team).

### Metrics

![The Metrics tab](https://raw.githubusercontent.com/a-t-h-i/bot-lobby/main/docs/lobby-metrics.png)

Run time, success rate, cost and tokens per model and agent, so you can see
which cheaper models hold up.

### Git

The repository's open pull requests through the GitHub CLI (`gh` owns sign-in;
bot-lobby holds no token): the list with checks and size, and the
selected one with its facts, files, description, reviews and comments.

- **Review it with an agent**: a read-only agent on QA's model, thinking
  and time limit (and its custom instructions) gets the description, changed
  files and diff, may read the repository for context, and writes a review:
  verdict, summary, findings by severity (`file:line`), tests, questions. It
  never edits, and never follows instructions written inside the pull request.
  A focus can be typed first (*is the migration reversible?*), and a review
  can be stopped.
- **Jev's quick read** ([the classifier](#the-classifier-jev)): size, and
  how likely the change is risky, security-relevant, breaking or untested, in a
  moment, with whether a full review is worth its tokens.
- Reviews are kept per pull request (`.pi/bot-lobby/reviews/`), marked stale
  when the pull request gets new commits, and count in the Metrics tab.
  **Nothing is posted to GitHub.**

### Knowledge

Every agent's knowledge — the Master's, Designer's, Backend's and QA's
knowledge, standards, decisions and completed tasks — files on the left, the
open file's entries on the right (a heading, a bullet, a paragraph), one of
them picked. Files past the compaction threshold are marked.

Completion is gated on compaction: the engine refuses `complete` while any
knowledge file is over the threshold (default 20,000 chars,
`knowledge.compactionThreshold`). The Master first disperses domain-relevant
facts where they belong with `action=knowledge (domain=designer|backend|qa)`
— per-agent files fill up through that dispersal — then rewrites each
oversized file with `action=compact` (which archives the previous version)
before the task closes.

- `e` edits the picked entry: it comes into the prompt (Shift+Enter for a new
  line, Enter saves). `n` adds an entry after it, `d d` deletes it, `E` edits
  the whole file in pi's editor. Every write archives the version before
  (`archive/<Agent>/`), and an entry that changed on disk since it was drawn is
  refused instead of being put on the wrong line.
- `c` **comments** on it: a note about the entry ("outdated, we moved to
  Redis"). It shows under the entry, and **every agent that reads that
  knowledge reads the note right under the entry**, so it weighs it there. Notes
  move with an edited entry and go with a deleted one; `x x` takes the newest
  back. They live in `.pi/bot-lobby/knowledge-comments.jsonl`, never in the
  files, which agents rewrite when they compact.

**What an agent reads.** Knowledge, standards and decisions go into an agent's
prompt; a file past about 4,000 characters is cut to the sections that bear on
the step (by keywords, or by [Jev](#the-classifier-jev) when it is on), and the
prompt says how many sections it left out and where the whole file is. Nothing
is looked up on demand: what a step needs has to be in the file and near the
top of its relevance, so keep entries short, one topic under one heading.

### Excalidraw

A live [Excalidraw](https://excalidraw.com) room that you and your agents draw
in together. Add up to **five sessions**, assign each to **one agent or several**
(the oracle, Designer, Backend, QA, scouts, the researcher, quick fix, the
planner), and those agents can look at what you drew and add to it.

- `a` **adds a session**: in Excalidraw, *Share → Live collaboration → Start
  session*, copy the link, paste it into the prompt (a name may follow it).
  `n` **makes a new room** instead and shows its link, for you to open in
  Excalidraw. Neither works past five sessions: `d d` removes one.
- `enter` moves into the checklist of agents; `enter` or `space` assigns the
  picked agent (or takes the session back), `*` assigns every agent.
- `w` lets agents **draw** in the session or **only look** at it. An agent whose
  sessions are all look-only gets no drawing tool.
- `t` **checks** the session: joins the room for a moment and says whether the
  server can be reached, who is in it, and how much is on the board. `r` renames it.
- `orchestrate action=whiteboard [name=...]` lets the Master create its own
  session: a room on the configured collaboration server, assigned to itself,
  with the join link returned. Its seat (opened by `excalidraw_read` /
  `excalidraw_draw`) holds the room alive for the pi session's lifetime, so it
  needs no one else in the room. The room is not guaranteed to persist after
  the last connection leaves.

**What an assigned agent can do.** It gets two tools and the room link:
`excalidraw_read` describes the board in words (shapes with their labels, arrows
as *from → to*, free text, each with its id and place), and `excalidraw_draw`
adds labelled rectangles, ellipses and diamonds, arrows between them (with
labels), free text and lines, or changes and deletes what is there by id. It
joins the room as its own collaborator (`Backend · bot-lobby`) with a cursor
where it drew, so you watch it work. The board stays yours: agents may move,
recolour and relabel what you drew, but delete only what agents drew (elements
they draw are marked, and Excalidraw cannot undo another collaborator's
deletion), and one call draws at most 100 shapes and removes at most 50.

- **You must have the session open in Excalidraw.** A room's board lives in the
  browsers that are in it; an agent that joins an empty room can read nothing,
  and is not allowed to draw, since nothing would keep it. It says so and asks
  you to open the link.
- **Boards are other people's writing.** What an agent reads from a board comes
  fenced as untrusted data, like a web page, and it is told never to follow
  instructions written on it.
- **The link is a key.** Anyone with a room link can read and draw in the room, so
  bot-lobby keeps your sessions with your own settings
  (`~/.pi/bot-lobby/excalidraw/`, one file for each project) and never in the
  project, where a commit could publish them. An agent's process is handed only the
  links of the sessions assigned to it.
- Rooms are Excalidraw's own collaboration protocol, end-to-end encrypted with the
  key in the link, over `oss-collab.excalidraw.com`. A self-hosted collaboration
  server is used when `BOT_LOBBY_EXCALIDRAW_SERVER` names it.
- **When `t` says it could not reach the server**, the reason in brackets says
  why: a name that did not resolve (the network or DNS), a refused or timed-out
  connection, a certificate a firewall replaced (point `NODE_EXTRA_CA_CERTS` at
  its certificate), or a refusal with an HTTP status. Where only a proxy lets
  traffic out, set `HTTPS_PROXY` (`NO_PROXY` exempts hosts); agents then join
  through it, and the message names it. A network that blocks websockets but not
  HTTPS still works: the seat falls back to long-polling, as a browser does.

Common keys: `alt+1`…`alt+9` jump to a tab, `alt+[` and `alt+]` cycle them,
`ctrl+s` saves the plan on Plan, `alt+o` browses sessions, `alt+s` opens
settings, `alt+a` and `alt+t` fold Activity and Thinking on the Lobby, `alt+h`
shows them all. Rebind any key under `lobby.keys` in the
config.

**Themes.** Settings > Appearance picks light, dark or system and one of a few
colour themes. A theme from [tweakcn](https://tweakcn.com/editor/theme) can be
pasted (its Code panel: the `:root` and `.dark` blocks) or uploaded as a `.css`
or `.json` file. It stays in your browser, and only its colours and fonts are
used.

**Several sessions from one window.** The Sessions page starts a task in a
background Pi session (the box's New session target). The page can show any
session, and your messages steer it; a badge on its row means it has a
question for you.

**A question put away.** Esc (or the cross) puts a question pop-up away
without losing a word; the *waiting* button in the top row brings it back.

The conversation keeps its newest 100 messages in memory; scroll to the top
to load the rest.

## Planning

Describe an idea on the Plan tab. Each round, the **seats** — DEV, DESIGN, QA
and RESEARCH, each on its domain's model — question it in parallel, and the
**oracle** turns their input into a draft plan plus at most **four questions**
for you (options with a recommendation first; accept with `enter`). Whatever
you don't answer is decided with the recommendation and listed under
*Assumptions*.

- Comment on any line of the draft: click it, or `enter`, pick the line, `c`.
- `1`–`4` seat or unseat a member; `r` retries a round; `n` starts over.
- **Round limit:** 5 by default (`lobby.maxPlanningRounds`, 0 = unlimited).
  In the last round the oracle alone settles everything still open.
- `ctrl+s` saves the plan as a pending task.
- **A long plan is split into tasks when you save it.** `ctrl+s` on a plan with
  more than 8 steps (`lobby.splitPlanAbove`; `0` turns it off; *Split long
  plans* in `/bot-lobby settings` → Lobby) has the oracle propose two to five
  tasks, each a part that leaves the project working and can be reviewed on its
  own, and asks you in the questionnaire, with the split as a preview: take it,
  keep the plan whole, or write what to change (*merge 2 and 3*; it revises, up
  to three times). Nothing is saved until you answer, and a question you put
  away saves nothing.
  - The oracle decides where the lines go; the engine enforces the rest: at
    most five tasks, every step of the plan in exactly one of them, and a task
    building only on earlier ones. A split that breaks a rule goes back once
    with the problems and never reaches you; if it still fails you are asked
    whether to save the plan whole.
  - Each part's brief is the plan as written (objective, decisions,
    assumptions, risks) with only its own steps, renumbered, under a header with
    its goal, what it builds on and its *done when* points, so nothing you
    agreed is lost in a retelling. The parts are saved as pending tasks in
    order, numbered `(1/3)` in the Tasks tab, and each knows the others: the
    oracle is told which part it is and to do only that part.
  - Starting a part before the parts it builds on are finished warns and starts
    anyway: the order is yours to keep.
- **A question you answered (or left for the oracle to decide) is never asked
  again.** Your answers are kept per question and every seat and the oracle
  read them as a closed list; a question that repeats a settled one, however
  it is worded, is held back before it reaches you (the activity log says so).
  A round that fails or is stopped after you answered no longer puts the same
  questionnaire up again: `r` retries it.

## Questions and the web

bot-lobby registers these tools in every Pi session it loads in, so plain Pi
has them as well.

### The questionnaire

`ask_user_question` puts up to four questions to you in one pop-up in the
lobby page, each with two to four options. Agents do not recommend an answer, so you think it through; only a quite obvious one is marked `(Recommended)`.
Questions, option descriptions and **previews** are Markdown: an option's
preview (a layout sketch, a component mockup, a code snippet, a config) shows
beside the list while that option is focused, under it in a narrow window, so
design choices can be compared by looking at them.

Click an option, or press `1`–`4`; several can be picked in a multi-select;
the last field takes an answer in your own words. *Later* (Esc) puts the
pop-up away without losing anything, *Cancel* asks whether to leave, so a
stray click does nothing. Questions you leave are never answered for you: the
oracle waits and asks again when you next write, and the designer asks again
before it may decide. A question with nobody to answer it (a one-shot
`pi -p` run) is put away at once.

**Images.** An option can also carry an `image`: a PNG, JPEG, GIF or WebP
file (a screenshot, a rendered mockup), shown above its preview text.

**The designer asks you directly.** During a task (not in auto mode) the
designer worker can put its visual choices to you: its questions reach you
through the oracle in the same questionnaire, titled *DESIGN asks*, with
wireframes as previews and, when it can render them, screenshots of each
option (saved outside the repository). Its clock and the task's budget stop
while you answer, and your answers are recorded as the task's decisions.

### The web

| Tool | Does |
| --- | --- |
| `web_search` | Numbered results (title, URL, snippet, date) under a search id; filters for recency and sites |
| `get_search_content` | Reads several results of a search at once |
| `fetch_content` | Reads one page as Markdown with its title and dates; long pages in parts |
| `source_check` | Before citing: reachable?, final URL, title, the date the page states |

Search uses the first provider set up: `BRAVE_API_KEY`, `TAVILY_API_KEY`,
`EXA_API_KEY`, `SEARXNG_URL` (your own instance), else DuckDuckGo, which needs
no key but throttles automated searches; `BOT_LOBBY_SEARCH=<provider>` picks
one. A provider that fails hands over to the next, and the result says so.

Pages are read as Markdown without menus, scripts, forms or cookie banners,
and marked as untrusted content that is never to be followed as instructions.
Only public `http(s)` addresses are fetched, redirects included (no
localhost, private networks or cloud metadata endpoints;
`BOT_LOBBY_WEB_ALLOW_PRIVATE=1` lifts that, e.g. for a local docs server).
PDFs and images are not read. While a task runs, the oracle leaves the web to
the researcher; the tools come back once the task ends.

## The classifier (Jev)

[Jev](https://github.com/FrancoisChastel/jev-code) is a fast "System One"
model: it answers yes/no, multiple-choice and score questions with
probabilities in a few hundred milliseconds, without writing text. With it on,
bot-lobby hands Jev the obvious decisions so the large models spend fewer
tokens and less time.

**Setup.** It uses a key Pi already holds:

- **OpenCode (free):** if you're signed into OpenCode in Pi (`/login opencode`
  or `opencode-go`, or `OPENCODE_API_KEY`), Jev runs on OpenCode Zen's free
  `jev-1.13-free`.
- **TypeSafe:** otherwise `/login typesafe` → *Use an API key*, or
  `TYPESAFE_API_KEY`.

Then `/bot-lobby settings` → **Classifier (Jev)** → turn it on, and *Test
connection*. The default host, *Auto*, picks OpenCode when you have that key,
else TypeSafe.

**What it decides** (each can be switched off):

| Decision | Effect |
| --- | --- |
| Planning seats | Each round, only the seats the idea or your latest answers touch sit; `1`–`4` pins a seat |
| Obvious answers | Answers a question itself when the conversation already makes an option marked `(Recommended)` clearly right (≥ 0.9); listed under Assumptions |
| File hints | Agents start with a short list of the files they most likely need, and get a `find_relevant_files` tool |
| Relevant knowledge | When an agent's knowledge, standards or decisions file is too long for its prompt (over 4,000 characters), Jev keeps the sections that bear on the step, and the prompt says how many it left out and where the whole file is, so the agent can read the rest. A file that fits goes in whole, untouched; standards are never left empty |
| Quick fix or task | Whether one engineer can do a new request alone decides whether it goes to the [quick-fix agent](#quick-fix-or-the-team) (the oracle confirms) |
| Task triage | The task's [track](#fast-track-or-full-workflow) and roster use its read (size, domains, research, ambiguity), and the Master gets it as hints; a quick fix that is really a task (large, and not one engineer's work) is held (`r` run anyway, `t` make it a task) |
| Effort routing | Simple steps run one thinking level lower; trivial ones on a **cheaper model** you pick. A routed run that falls short re-runs on your normal settings |
| Pull request read | The Git tab's `t`: a pull request's size, and how likely it is risky, security-relevant, breaking or untested |

**It never gets in the way:** any failure, timeout or missing key means
bot-lobby decides as it would without it; three failures in a row pause it
for ten minutes. Calls and savings show on the Metrics tab.

**What is sent:** the planning conversation, task text, file excerpts of
at most 400 characters (never whole files), and, for a knowledge file too long
for a prompt, the first 700 characters of each of its sections. Gitignored files, `.env*`, keys,
certificates and anything in `classifier.exclude` are never sent. If
OpenCode's free model ends, set *Model* to `jev-1.13` (paid); bot-lobby won't
switch on its own.

## Configuration

Settings live in `~/.pi/bot-lobby/config.json` (`BOT_LOBBY_CONFIG_DIR`
overrides). Edit them on the lobby's Settings page (the cog in its top row;
it saves as you go); `/bot-lobby config` shows the result.

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

- Entries: `master`, `agents.designer|backend|qa`, `scout`, `researcher`,
  `quickFix`, `planner`, `lobby`, `workflow`, `knowledge`, `classifier`.
- An agent without a model runs on the session's model. Thinking is one of
  `off, minimal, low, medium, high, xhigh, max`, limited to what the model
  supports: on the Settings page it is a slider whose unsupported stops are
  struck through and cannot be chosen. Scouts always think at `low`.
- `instructions` adds your own text to an agent's built-in prompt.
- `fallbackModel` and `fallbackThinking` on any agent (and the master): see
  [Fallback models](#fallback-models).
- Classifier thresholds and limits (`classifier.thresholds`, such as
  `knowledgeRelevantAt`, 0.4, and `classifier.fileHints`) are edited in the file.

## Fallback models

Running the oracle on a subscription model and the agents on another provider
means one of them can run out of usage mid-task. Give each agent class a
**fallback model** and the **thinking level** to run it at (`/bot-lobby
settings` → the agent → *Fallback model* / *Fallback thinking*). When a run
fails because its model is out of usage, rate-limited, out of credit or
unavailable, it runs again on the fallback instead of failing the task.

- Works for the master, DESIGN, DEV, QA, the researcher, scouts (their fallback
  thinks at `low` too), quick fixes and the planner and its panel seats.
- The exhausted model is skipped for 20 minutes, so the next agents go straight
  to their fallback instead of each spending a failed run finding out.
- **The master** is your own Pi session: on a usage failure the session
  switches to its fallback model and thinking level, tells you, and the oracle
  carries on from where it stopped. Switch back with `/model` when your usage
  returns.
- Only usage, limit and availability errors switch model; an ordinary failure
  still retries on the same model. If the fallback fails the same way, the run
  fails: it does not chain to a third model.
- The activity log says when an agent switched, and the run's receipts and the
  Metrics tab show the model that actually ran.

```json
{
  "master": { "model": "anthropic/claude-fable-5-1", "thinking": "high", "fallbackModel": "deepseek/deepseek-v3", "fallbackThinking": "medium" },
  "agents": { "backend": { "model": "zai/glm-4.6", "thinking": "medium", "fallbackModel": "deepseek/deepseek-v3", "fallbackThinking": "low" } },
  "scout": { "model": "zai/glm-4.6", "fallbackModel": "deepseek/deepseek-v3" }
}
```

## What the engine enforces

| Rule | How |
| --- | --- |
| Steps happen in order | A state machine validates every action |
| Nothing is built before approval | On the full workflow `implement` refuses earlier states; only a fast-track task (small, clear, low-risk) starts straight away |
| Scouts and the QA gate can't edit code | Scouts get read-only tools; the QA gate adds only `bash` for tests |
| New dependencies and architecture changes need approval | Parsed from worker reports; the domain is blocked until resolved |
| Only the Master writes knowledge | Agents can only propose it |
| Knowledge is compacted before done | `complete` is refused while any knowledge file is over the threshold; disperse with `action=knowledge (domain=designer\|backend\|qa)`, then `action=compact` |
| "Done" is earned | Needs a plan, a passing QA gate that ran checks (or your explicit acceptance), and no open blockers; on the fast track, a finished worker step, and QA's part only when the change needs tests |
| Parallel workers don't clobber files | Edits need a file-desk claim |
| A crash doesn't corrupt a task | State is on disk; tasks resume from their state |

## Files on disk

```
.pi/bot-lobby/
├── <Agent>/knowledge/      knowledge, standards and decisions per agent
├── tasks/Task-…/           state.json, budget.json, scratchpads, scout and research reports
├── worktrees/Task-…/       a task's own worktree, when workflow.gitIsolation is worktree
├── reviews/pr-<n>.json     the agent's review of a pull request (Git tab)
├── knowledge-comments.jsonl  your notes on knowledge entries (Knowledge tab)
├── backlog/PLAN-….json     plans saved from the Plan tab
├── archive/                archived tasks and old knowledge, and the version before each knowledge edit
├── sessions/               heartbeats of running Pi sessions
├── cache/files.json        file excerpts for the classifier
├── changes.jsonl           the files each quick fix and worker edited
└── metrics.jsonl           one line per agent run and classifier call
```

## Development

```bash
npm install
npm run typecheck
npm test
```

Live checks (spend tokens or need a key and network):

```bash
BOT_LOBBY_E2E=1 node --test test/e2e.test.ts
BOT_LOBBY_LIVE_WEB=1 node --test test/web.test.ts
BOT_LOBBY_JEV_E2E=1 OPENCODE_API_KEY=… node --test test/jev-e2e.test.ts
BOT_LOBBY_LIVE_EXCALIDRAW=1 node --test test/excalidraw-live.test.ts
```

Source layout: `src/workflow` (engine), `src/master` (delegation),
`src/execution` (subagent processes), `src/lobby` (the lobby's state and service), `src/webui` and `webui/` (the
server and the page; rebuild with `npm run web:build`),
`src/classifier` (Jev), `src/state` (persistence), `src/ask` (the
questionnaire), `src/web` (the web tools), `src/excalidraw` (shared
Excalidraw sessions: the room protocol, the sessions, the agents' tools),
`prompts/` (agent prompts).

## Publishing

Bump the version, then `npm publish --access public`. Check the tarball
with `npm pack --dry-run`; it ships `src` and `prompts` only.
