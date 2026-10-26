# Bot-Lobby guide

The details behind the [README](../README.md): how tasks run and land, what the agents keep, and
every setting worth knowing.

## Planning

A plan opens with a short list of steps; the detail of each follows for whoever wants it. In the
**Plan** tab the panel's conversation fills the page, and **View plan** (`V`) opens the draft in a
slide-out, where you comment on any line. Plans you leave without saving them as a task wait under
**Plan → Previous**. You can read, carry on, archive or delete them there. A plan saved as a task
leaves that list.

The panel's members (DEV, DESIGN, QA, RESEARCH) sit the first round. After that the oracle plans
alone and calls a member back only when it needs that member's view, so later rounds stay quick.
A member you pin with its key sits every round.

## Tasks

Follow the agents in **Lobby** and **Tasks**: in a task's steps, the one being worked on reads
`active · 1m 12s`, and each task shows how long its agents have worked on it (idle time left out).
Models, effort and each agent's tools and skills are in **Settings**.

The **Tasks** screen has **List** and **Board** subtabs. Board groups saved plans and new tasks
in **Backlog**, active work in **In progress**, and finished work in **Completed**. Abandoned
work stays labeled in Backlog until archived. Cards open the existing task details and actions;
archiving removes a card immediately, while the List view can still show the archive.

A task that is paused, or that no running session drives, shows **Resume** (`R`) in **Tasks**.
It carries the task on without moving your window: a paused task is unpaused where it runs, and a
stopped one carries on in a background session, which restarts its own session when its file is found.
Whatever a background session asks (its questionnaires, picks, yes/no and free-text questions) pops up
in the window you are in, named after the session, so you never switch sessions to answer.

New tasks get a short title summarizing the full request, which also names their branch and
session. Naming uses low reasoning on `classifier.effort.cheapModel` when configured, otherwise
the session model. If naming fails or takes more than eight seconds, the request's first content
words are used. Tasks started from an agreed plan keep that plan's title.

## Lobby chat

The **Lobby** is a chat with the team. Without a task the oracle (the Master) is your Pi session with
its full tools, so everyday questions, code changes and minor fixes happen in the chat itself, with no
plan, scouts or QA gate. Each message goes to whoever it belongs to: start it with an @ mention
(`@design`, `@dev`, `@qa`, `@research`, `@scout` or `@master`; `@frontend`, `@backend` and `@oracle`
work too), or leave it to the classifier, which hands a frontend question to DESIGN, a backend change
to DEV, a test to QA, an outside fact to RESEARCH, "how does this work" to a scout and a question about
the project's saved knowledge to the knowledge lookup. Anything it is unsure of goes to the Master.
**Settings → Classifier → Lobby replies** turns the classifier's choice off (`classifier.features.lobby`;
`classifier.thresholds.lobbyAgentAt`, 0.5 by default, is how sure it must be).

An agent answers with its own model, effort, tools and skills (the DESIGN, DEV and QA entries, the
researcher's and the scout's). DESIGN, DEV and QA may edit files; RESEARCH and scouts only read. One
agent answers at a time; every reply shows under its agent's name, and it is kept in the Pi session,
so the Master reads it as context. While a task runs, messages go to its oracle, as before.

Two commands start the team's workflow, and only when you ask for it:

- `/plan <idea>` plans it with the panel in **Plan** (a fresh planning session when the current one
  has messages). `/plan` alone plans what the chat has been about.
- `/task <request>` starts it as a task. `/task` alone makes a task of the chat so far.

Typing `/` or `@` at the start of a message opens a list to pick from (arrow keys move, Enter or
Tab picks, Esc closes). Any other `/` command goes to Pi.

## Delivery

`/bot-lobby <request>` in Pi starts a task as well. `--fast` / `--full` picks the workflow,
and `--branch` / `--worktree` isolates it in git. When an isolated task completes, the oracle asks
you to confirm merging and pushing main, then removes its worktree after verifying the merge.
Declining or failed verification keeps the worktree. Delivery can also be reviewed in **Tasks**,
where you can create a PR instead. The task branch is kept.

Workers never commit; the oracle does. When a task completes, the oracle writes a short commit
message (a first line of 72 characters or fewer, at most three lines below it). The engine then
commits only the files that task's workers changed. The lobby chat does not commit unless you ask
it to. Changes that were already there before, another agent's, the lobby chat's (recorded as
yours, so QA never reverts them) and anything no agent made are left uncommitted.

## Checks

Before QA and at completion, the engine runs the project's own linter
(ESLint, Biome, Oxlint, Ruff, or a command you set) on the files the task touched. Only problems on
changed lines count, and QA judges any lint suppression a worker adds. **Settings → Linting** sets it
to off, advise or block. Visual questions come with interactive mockups that expand and scroll side by side; they are drawn with the project's own stylesheets (its tokens and component classes) when it has them.

QA is sized to what was built, not to the request. Once the work is in, the classifier
reads the diff and sets the QA risk. A change with nothing that runs (docs, styles, comments) passes
on the engine's checks with no QA agent, and a small one gets a light check. One that touches
security, data, concurrency or orchestration gets a deep, adversarial review. The test budget is a
ceiling, never a quota, and the Tasks tab shows the classifier's read and why. With it off, the engine's rules decide.

## Composer and removed pages

The composer is available only on **Lobby**, **Tasks**, **Plan** and **Knowledge**,
including their detail routes and Knowledge's Docs/Chat views. On Metrics and Settings it stays
mounted but hidden and inert: no focus, attachment input, submission or composer shortcut can activate
it, and `--composer-h` is zero so the page reclaims its space. Draft text, completed attachments and
uploads finishing while hidden return intact. Phone navigation remains available independently.

Focus motion lasts about 360ms with ease-out timing and scale within about ±3%. Only the box
animates, anchored at its top edge; the attached tray stays stationary and icons do not wobble.
Reduced motion disables focus animation while retaining a visible focus indicator.

There is no Sessions conversation page or composer target for starting or messaging sessions.
Background session management, task resume, agent execution and Thinking/activity remain available;
no session conversation is embedded in Tasks. Former `#/sessions[/<key>]` and Excalidraw routes
fall back to Lobby, whose composer policy applies. Excalidraw UI, APIs, agent tools and runtime
integration are removed; external boards and locally saved room links are not deleted or read.

## Sidebar and terminal

The sidebar lists the running sessions as cards: this window's first, then the background sessions
it started, with sessions in other terminals and ended ones on shelves at its foot. Click a card to
bring that session into this window; **New session** starts one in the background from what you
type, and the search filters the list. `Alt+B` folds the sidebar off the page (the button at the
start of the bar brings it back), and dragging its edge resizes it.

`` Ctrl+` `` (or the bar's **Terminal** button) opens a terminal drawer under the composer: a real
shell in the project's folder, as many as eight, listed down its right side when there is more than
one. Shells keep running while the drawer is hidden or the page reloads, and end when you end them
or the lobby stops. Inside a terminal every key is the shell's except `` Ctrl+` ``. It uses
`node-pty` when that is installed and otherwise Python's standard `pty` module (macOS and Linux);
on Windows it needs `node-pty`.

## Crashes and restarts

If Pi crashes, is killed or loses its terminal, the lobby page keeps everything on screen and
reconnects when Pi is back. The next Pi started in the project carries on what was running. The
planning session returns as it was, and a round that was cut off runs again. Every task's session starts again from its saved file, picking up where it stopped. A
quit on purpose stops this work, and `pi -c` brings back the planning session.

## Projects

Click the project in the message box (or press `P`) to switch between running projects or choose **Open folder…**.
The folder browser lists directories on the machine running bot-lobby, not the browser's machine;
you can browse, go to a parent, or enter an absolute path. An existing project is reused; otherwise
a dedicated Pi session starts for the folder's detected project root. It loads this copy of bot-lobby
without other extensions and does not automatically trust project-local resources. Switching projects
reloads the page and discards unsent drafts. Projects opened this way stop when their hosting lobby
stops; opening a folder does not start a task or merge work.

## Knowledge

Each agent keeps what it learns about your project in `.pi/bot-lobby/<Agent>/knowledge/`:
stable facts (`knowledge.md`), its standards (design language, engineering or testing standards),
decisions with their reasons, and a short history of completed tasks. Workers only propose
knowledge and the oracle records it, so nothing gets in unchecked; research stays evidence until
the oracle keeps it. When a file is long, the classifier picks the parts that matter to each step, so prompts
stay short. A task cannot complete while a file is over `knowledge.compactionThreshold` (20,000
characters): the oracle rewrites it shorter, and the version before is kept under `archive/`.

The **Knowledge** tab shows the files as a tree, from the project to each agent and the model it
runs on. Open a file to edit, add or delete its entries, or leave a note on one ("outdated, we
moved to Redis"). A note travels with its entry into every agent's prompt.

Ask project questions directly from the **Knowledge** composer. The oracle checks saved knowledge
first, searches the codebase for missing information, and records verified findings in the relevant
agent's knowledge. Answers appear in the side pane; the **Chat / Docs** toggle inside the composer
switches back to the selected document. Questions do not create tasks.

## Scripts

Jobs that come back (seeding data, regenerating fixtures, a set of checks before review) are kept
as scripts in `.pi/bot-lobby/scripts/`, shared by every agent, so a step done once is run the next
time instead of being worked out again, which saves tokens and time. Each is named for what it
does, in snake_case with its language's extension (`seed_public_holidays.py`,
`run_changed_tests.sh`), and its first lines say what it is for and how to run it. The oracle
decides when a step is worth a script and saves it (`action=script`); workers only propose one, and
a replaced script is kept under `archive/`. For each step, the classifier picks the scripts that do part of it
and the agent is told to run them (**Settings → Classifier → Shared scripts**; with it off, scripts
whose names share words with the step are suggested).

## Less searching

Agents spend most of their time finding things, so bot-lobby hands them what it already knows:

- **Repository map.** Scouts, workers, lobby chat agents and the planner get the project's layout and the
  files that match their step, each with what it says it is for and the names it declares. It is
  read from the files themselves, so it needs no model and works with the classifier off
  (`workflow.repoMap`).
- **Scout notes.** What a scout found about a file is kept and shown in the map as long as the file is
  unchanged, so the next task starts from it. A changed file's note is dropped.
- **Reused scouts.** The same question for the same task on a tree with no changes reuses the earlier
  findings instead of running again, for example after a crash and resume (`workflow.reuseScouts`).
- **Line anchors.** Scouts report `path:12-40`, and the oracle copies those anchors into each brief,
  so a worker opens the exact place.
- **Tool budget.** A scout is told to wrap up after 60% of `scout.maxToolCalls` (30). Past the limit,
  further calls are refused, so it reports with what it has (0 means no limit).

## Classifier

A fast classifier makes the small decisions so the large models don't spend tokens on them: who
sits on the planning panel, a task's size, how hard each step is, which files, knowledge and
scripts it needs, and how much QA a change warrants. It is off until you turn it on in
**Settings → Classifier**, and every decision falls back to plain rules when it is off or fails.

**Answered by** picks who answers, from the models your pi logins offer:

- **Jev on a host** (the default): TypeSafe's classifier on OpenCode Zen (free while it lasts),
  TypeSafe, OpenRouter or the Vercel AI Gateway.
- **Another classifier model** pi lists for your logins, such as Cloudflare's clef, Liquid's d1,
  Upstage's solar-decide or Inception's mercury-decide. These answer the same typed questions natively.
- **Any chat model you are signed in to** (an OpenAI, Anthropic or Google account, an API key,
  OpenRouter, …). It answers the same questions as JSON with the least reasoning the model allows.
  It is slower and less calibrated than a classifier model, so pick a small, fast one.

The thresholds in `config.json` are tuned for Jev; raise them if another model decides too eagerly.

## Delegation

Requires **Pi 1.3.x** (1.3.0 or later). DEV and DESIGN workers and QA reviewers can use
`delegate_subtasks` for useful, separable work. Delegation is optional. Each parent gets five child
slots total, shared across retries; the classifier selects each child’s model and reasoning effort from its brief, lowering
inference for simple work and raising reasoning for complex work on the configured
model. Children inherit the parent’s role,
permissions, grants and worktree. Children report to their parent, which
integrates and verifies the result. Children cannot delegate further. Active
children share `workflow.maxParallelWorkers`; waiting parents do not use those
child slots. Cancelling or finishing a parent stops its children and releases
their file claims. Full reports are saved under `.pi/bot-lobby/delegations/`.

Agents have no time limit, in auto mode or not. An assignment runs until its agent
reports, you press **Stop**, or the agent goes silent for so long that the stall watchdog
(`stallTimeoutMs`, `toolStallTimeoutMs`) stops it and the oracle reassigns the step. Older
`timeoutMs`, `workflow.agentTimeoutMs`, `wrapUpAt` and `taskBudgetMinutes` keys are ignored and
dropped the next time Settings saves.

In **Tasks**, a step being worked on shows how many agents are on it, for example
**Implement large feature (6 agents working)**. Click the count to see which agent is
doing what, with children under their parent. Queued and finished agents are left out,
and a child finishing does not complete a checklist step.

## Agents working together

The oracle still decides what gets done and when a task is finished. The agents share facts
without going through it:

- **Task board.** Each task keeps a board (`board.jsonl` in its folder). Workers post typed
  entries there: `contract`, `decision`, `blocker`, `question`, `done` and `note`. Each role reads
  only the kinds it follows, and running workers hear about new contracts and blockers straight
  away. Later steps and the QA gate read the board too, and each step's report lists its new posts.
- **QA alongside the build.** On the full workflow, QA can write its tests in the same batch as
  the build. It works from the plan's contracts and acceptance criteria, then runs the tests as
  pieces are posted `done`.
- **Clean review** (`workflow.cleanReview`, on by default). The QA gate sees the request, the
  plan, the board and the diff. It does not see the workers' own accounts of their work. It also
  checks the change against what you asked for, not only against the plan.
- **Files, not relays.** A long worker report is kept whole under the task's `reports/` folder,
  and the oracle gets its path.

## Compaction

The oracle, agents and children compact at settled turn boundaries before context
reaches 64,000 estimated tokens, or earlier at 60% of the model window or Pi's
native reserve threshold. Recent messages and summaries retain unfinished work;
raw session history remains available. A failed summary leaves context intact.
Checkpoints preserve constraints, decisions, changed files, verification, failed
approaches, and next actions. A single large input can exceed the threshold before
the next settled boundary.

Each agent's card in Settings → Agents has an **Auto-compact** switch (on by
default; `autoCompact: false` in the agent's settings entry). With it off, that
agent is never compacted by bot-lobby; children inherit their parent's choice.
Under the switch, **Compact at** takes the token count that starts a compaction
(`compactAt`, 4,000 to 2,000,000). Left empty, the built-in threshold above applies.
Whatever you set, compaction still starts before the window less Pi's reserve.
When the oracle compacts, its checkpoint also lists what it learned that is
worth keeping, tagged by agent, and those lines go into the knowledge base: the
oracle's own files, and the designer's, backend's and QA's where they concern
them. Duplicates are skipped.

## Tools and skills

Pi's native MCP, `tool_search` and `codemode` are available. Every agent picks up the tools of
the MCP servers Pi has connected on its own, including servers added later (they show up on the
agent's next run). **Settings → Tools & skills** narrows that per agent: pick an agent, switch off
**Every MCP tool pi connects**, then tick a whole server, single tools, or type an exact tool name
that is not connected right now. Every tick saves. Scouts, the researcher and the
planner only get tools the server marks read-only (`readOnlyHint: true`); hidden tools and
ungranted calls are blocked, including calls nested inside codemode. Configure server connections
through Pi's native MCP settings.

Skills are the ones Pi finds for the session and the project (`.pi/skills`, packages, settings
paths). By default an agent gets every skill; switch off **Every skill pi finds** to pick some or
none. The oracle is your Pi session itself, so it uses the skills Pi loads for it.

In `config.json` the fields are `mcpTools: ["mcp__github__get_issue"]` and
`skills: ["pdf-tools"]` on `agents.backend`, `agents.designer`, `agents.qa`, `scout`,
`researcher` and `planner` (`master` takes `mcpTools`). For both, an absent field
means every one Pi has, and `[]` means none. Children inherit their parent's grants. A granted
skill Pi no longer finds is skipped.

## Harnesses

Any subagent except the planner can run on another coding agent instead of pi: Codex CLI, Claude
Code, Antigravity, Gemini CLI, OpenCode, or any agent that speaks the Agent Client Protocol (ACP).
Pick one per agent with the **Harness** menu on its card in Settings > Agents. The model menu then
lists that harness's own models, and the effort slider offers the levels the chosen model takes.
The oracle and the planner always run in the pi session, because the workflow, the knowledge base
and compaction live there. Give the oracle a Claude model through pi's own Anthropic login
(`/login`).

Claude Code runs through the Claude Agent SDK (an optional dependency, installed by default), which
is Anthropic's supported way for apps to drive it on a Claude plan. It starts your installed
`claude`, or the command set under Harnesses, else the SDK's own build; without the SDK, Bot Lobby
falls back to `claude -p`. On a Claude plan, Anthropic bills app use from the plan's Agent SDK
credit and then extra usage.

Each step still gets its role prompt (instructions, knowledge, standards and the report format).
Codex gets it as developer instructions, Claude Code appends it to its own system prompt, and ACP
agents receive it in front of the first message. Read-only roles stay read-only: a read-only sandbox
on Codex, only the matching tools in `dontAsk` mode on Claude Code, and refused permission requests
on ACP agents. A harness uses its own login. It cannot ask you questions, and it has no access to Bot Lobby's own tools (the file desk, the task board).

Settings > Harnesses shows whether each one is installed. Each harness has these settings: its
command, launch arguments, home folder (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`), model provider (Codex:
OpenAI, Ollama, LM Studio or a `model_provider` from its config; Claude Code: Anthropic, Bedrock or
Vertex), the token count it compacts at, extra model ids, and whether Bot Lobby's prompts go in. An
agent's Auto-compact switch turns compaction off on Codex and Claude Code too. ACP agents compact on
their own.

## Keys

The lobby is keyboard-first, and every action button shows its key (`Archive E`, `Delete Del`).
`Alt+1`…`Alt+9` switch tabs, `j` / `k` move through lists, `/` focuses search or the message box,
`p` switches project, `d` flips the theme and `?` lists every key. Alt and Ctrl shortcuts can be
rebound with `lobby.keys`. In Pi, `Alt+G` toggles auto mode and `Ctrl+Shift+M` turns bot-lobby on or off.

## Configuration

Settings live in `~/.pi/bot-lobby/config.json` (`BOT_LOBBY_CONFIG_DIR` moves them), and
`/bot-lobby config` shows what is in effect. Colour themes you import, under a name you choose,
are kept in `themes.json` beside it, so every Pi session and project shows them. Tasks and
project knowledge stay in `.pi/bot-lobby/` inside your project.
