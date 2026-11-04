# 08. Bot Lobby screens inside dsh (8 days)

## Goal

Every Bot Lobby screen that still has a job is rebuilt inside dsh's web client from dsh slots and primitives, using phase 07's API, live updates and kit. Two Bot Lobby designs are kept as they are, because the owner asked for them: the **questionnaire** and the **per-agent working indicators**.

Screens that dsh already has are not rebuilt (see the table at the end).

## Read first

- Bot Lobby `webui/src/tabs/tasks/*`, `webui/src/tabs/plan/*`, `webui/src/tabs/knowledge/*`, `webui/src/tabs/settings/*`, `webui/src/tabs/lobby/TaskWidgets.tsx`, `SessionFiles.tsx`, `webui/src/prompts/*`
- Bot Lobby `src/ask/web.ts` (`askUser`, `askText`, `askChoice`, `promptHub`), `src/ask/types.ts` (`AskQuestion`, `AskOption` with `htmlPreview`, `preview`, `image`; `AskResult` with per-answer `notes` and `globalNote`), `src/webui/api/prompts.ts`
- dsh `client/ui-schedule/src/client/index.ts` (panel + main page + right pane tab + turn tail + session row mark), `client/ui-goal/src/client/index.ts` (`conversation.input.dock`), `client/ui-approval/src/client/index.ts` (`ctx.uiSession.registerPendingInteraction`, `conversation.composer` chain entry with `select`), `client/ui-tool/src/client/tool/toolviews/web-row.tsx` (`tool.call.toolview` keyed by tool name), `client/ui-agent-preset/src/client/index.ts` (`settings.section`), `client/ui-workspace/src/client/toast/register.ts` (`workspace.toast`)
- dsh `@deepseek-ai/dsh-client-ui-primitives` exports (list them once; use them for buttons, inputs, lists, tabs, menus, dialogs, empty states, page headers)

Every slot: confirm its props and scope with `Slots.listSubTree` before writing the component.

## The layout

| Bot Lobby today | Inside dsh | Slot |
|---|---|---|
| Lobby tab (chat) | the dsh conversation of a `bot-lobby` session | none (dsh) |
| Tasks tab | **Tasks** panel: sidebar entry + main page | `sidebar.panellist` + `main` (key `bot-lobby-tasks`) |
| Plan tab (planner chat with seats) | **Plans** panel: sidebar entry + main page | `sidebar.panellist` + `main` (key `bot-lobby-plans`) |
| Plan sheet next to a task | right pane tab | `sidebar.right.pane.tab` + `.title` (kind `bot-lobby-plan`) |
| Knowledge tab | **Knowledge** panel: sidebar entry + main page | `sidebar.panellist` + `main` (key `bot-lobby-knowledge`) |
| Task card in the Lobby (`TaskWidgets.tsx`) | task dock above the composer of a `bot-lobby` session | `conversation.input.dock` |
| `start_task`, `orchestrate`, `delegate_subtasks` tool rows | Bot Lobby tool cards | `tool.call.toolview` keyed by tool name |
| Live agent lines under the orchestrator's turn | turn tail: one row per working agent | `conversation.chat.turnTail` |
| Questionnaire drawer | Bot Lobby questionnaire in place of the composer | `conversation.composer` (chain) + `ctx.uiSession.registerPendingInteraction` |
| Session working mark in the sidebar | mark on dsh's session row while a task of that session runs | `sidebar.session.row.leading` |
| Settings tab | Bot Lobby settings sections | `settings.section` |
| Toasts | dsh toasts | `workspace.toast` |

The three panel ids go in one `src/client/panels.ts`. Sidebar order: Tasks 20, Plans 21, Knowledge 22 (after dsh's own panels; check their orders and keep Bot Lobby's together).

## Part A. Tasks panel

Port `webui/src/tabs/tasks/` to `src/client/tasks/`.

1. **Page:** list on the left, detail on the right with a draggable divider when the page is ≥ 900 px wide; below that, list then detail (back button). Port `TasksTab.tsx`, `TaskList.tsx`, `TaskDetail.tsx`, `DetailSections.tsx`.
2. **Data:** `useCall("tasks.list", {}, where, "tasks")`, `useCall("tasks.get", { id }, where, "tasks")`. Live agent rows also refetch on the `runs` topic, throttled to 4 per second.
3. **Live agents:** every running agent of the task is one row: `RoleWord` (role and working word), `InlineActivity` (what it is doing now), `InlineThinking` (last thought, folded), elapsed time. Data comes from the task's run records (phase 05 writes the events there). These are the owner's indicators: keep their look and motion.
4. **Actions** (each a kept API call): auto mode toggle (`tasks.auto`), message the task (`tasks.message`), comments (`Comments.tsx`), skip step (`SkipStep.tsx`), resume (`ResumeTask.tsx`), accept, force close, approvals (`TaskInterventions.tsx`), delivery review / defer / deliver (`DeliveryReview.tsx`), archive / restore / delete (delete asks first with a dsh confirm dialog).
5. **"Open in session"** (`OpenInSession.tsx`): opens the task's dsh session (the orchestrator session that owns it). Find the navigation call with inspect (`ctx.uiWorkspace`, used by ui-schedule's `startSession`; look for an open/select session method).
6. **Files an agent changed:** clicking a file opens dsh's file view, not Bot Lobby's code viewer. Find the call with inspect (`ctx.sidebarRight.openTab` with the files or document kind that `ui-sidebar-files` registers).
7. **Phase timing** (`PhaseTiming.tsx`) stays.
8. Drop: cost columns if phase 06 step 4 found no prices.

## Part B. Plans panel and plan sheet

Port `webui/src/tabs/plan/` to `src/client/plans/`.

1. **Plans page:** the planner conversation with seats (`planner.*` calls): seat toggles, messages, edit message, retry, answer the planner's questions, previous plans (open, archive, delete), save, start (`plans.start`), discard. Its message list can use dsh's markdown component if one exists (phase 07 step 6); otherwise the kit's.
2. **Line comments:** `LineComment.tsx` stays (comment on one plan line, `planner.commentLine`).
3. **Plan sheet** (`PlanSheet.tsx`): a right pane tab, kind `bot-lobby-plan`, params `{ taskId }`. Opened from the task dock, the `start_task` tool card and the Tasks page with `ctx.sidebarRight.openTab("bot-lobby-plan", { params: { taskId } })` (check the call shape against ui-schedule line ~205).

## Part C. Knowledge panel

Port `webui/src/tabs/knowledge/` to `src/client/knowledge/`: inbox list (`InboxList.tsx`; note: the row grid is `1fr auto`, there is no agent tile column), note cards, note sheet, editors, ask box, answer card, agent cards. All `knowledge.*` calls stay. Attachments in the ask box: send dsh attachment refs if `knowledge.ask` can read them; otherwise text only and note it in `STATUS.md`.

## Part D. Pieces inside the Lobby conversation

These only show in sessions whose preset is `bot-lobby`. Each slot's `inject(sessionId)` first checks the session's preset (find it on the session binding with inspect); for other sessions return an injected value that renders nothing.

### D1. Task dock (`conversation.input.dock`)

Port `TaskWidgets.tsx`: tasks under way for this session, as an accordion. Each task: title, current step, a checklist with Bot Lobby's real bordered checkboxes (empty; accent outline + breathing halo = current; amber outline = waiting; filled accent + drawn tick = done). A click on the title opens the task in the Tasks panel; a "Plan" button opens the plan sheet. Hidden when no task runs. Keep it compact: at most 3 rows open, the rest folded.

Session files (`SessionFiles.tsx`): files agents changed in this session, as a second fold in the same dock. Clicking opens dsh's file view (Part A step 6).

### D2. Tool cards (`tool.call.toolview`)

Register keys `start_task`, `orchestrate`, `delegate_subtasks`. Each card shows the tool's args in plain words (task title, step, which agents), and while the tool runs, the working agents as `RoleWord` + `InlineActivity` rows from the `runs` topic. When it ends: the result line and a link to the task. Check the toolview props (`web-row.tsx`) for args, status and result.

### D3. Turn tail (`conversation.chat.turnTail`)

Under the orchestrator's last turn, while any task of this session has running agents and no tool card of D2 is open for them: one row per working agent (`RoleWord`, `InlineActivity`, `InlineThinking`). Disappears when they finish. This keeps Bot Lobby's "who is doing what" view under the chat.

### D4. Session row mark (`sidebar.session.row.leading`)

`WorkingMark` on the session row while one of its tasks runs. Data: `tasks.list` filtered by owner session (one shared fetch for all rows, not one per row).

## Part E. The questionnaire (keep Bot Lobby's design)

The owner keeps Bot Lobby's questionnaire: the drawer that replaces the composer, one question at a time, options with mockups (`htmlPreview`, `preview`, `image`), multi-select, per-answer notes, a global note, put away and reopen.

dsh's own question service cannot carry this (its answer has `selected` and `custom` only; no notes, no global note, no mockups). So the transport stays Bot Lobby's.

### E1. Host

1. Keep `promptHub` (`src/ask/web.ts` and its hub) as the in-process queue. Move it to `src/ask/hub.ts` with no pi imports. Delete `viaWindow`, `relayAsker`, `BACKGROUND_ENV`, `isBackgroundSession` (phase 09 deletes `relay.ts`).
2. Every prompt carries the **owner session id**: the orchestrator session of the asking agent's task (from `RunSettings.ownerSessionId`, phase 05), or the asking agent's own session for the orchestrator. Add `sessionId`, `role` and `taskId` to `WebPrompt`.
3. `askText` / `askChoice` (engine prompts, for example from `orchestrate`) use the same hub with the same session id.
4. API: `prompts.list` takes `{ session }` and returns that session's open prompts. `prompts.answer`, `prompts.dismiss` unchanged. The hub bumps a `prompts` topic.
5. Phase 05's `asking` / `answered` events: emit them from the hub (open / answer) for the asking run, so the Tasks page shows "waiting on you".
6. Clock pause (phase 04 step 1 `tool/call` for `ask_user_question`): also pause while an engine prompt is open.
7. Images in options: today the page loaded them through a preview route. Add `GET /bot-lobby/api/prompt-image?prompt=<id>&option=<n>` that reads the absolute path the hub stored and streams it (only paths named by an open prompt; never a path from the query).

### E2. Client

1. Port `webui/src/prompts/` to `src/client/questions/`: `Drawer.tsx`, `MockupViewer.tsx`, `StaticPreview.tsx`, `payload.ts`, `nav.ts`, `planQuestions.ts`, `putAway.ts`. Keep their layout, motion and keyboard nav. Swap colours to phase 07 tokens; swap buttons, inputs and text areas to dsh primitives where the look stays the same.
2. Pending interaction: `const publish = ctx.uiSession.registerPendingInteraction<PendingBotLobbyQuestion>(() => 10)` (check the priority meaning against ui-approval, which uses 0). For each open prompt from `useCall("prompts.list", { session }, ..., "prompts")`, create one `PendingBotLobbyQuestion(sessionId, prompt)` and `publish(pending, delegate)`; remove it when the prompt is answered, dismissed or gone.
3. Composer chain entry:
   ```ts
   ctx.slots.inject("conversation.composer", () => ctx.slots.register({
     name: "conversation.composer", priority: 2,
     select: ({ pendingInteraction }) => pendingInteraction instanceof PendingBotLobbyQuestion ? pendingInteraction : null,
     locale: NS, inject: () => ({ answer, dismiss }),
   }, BotLobbyQuestionnaire));
   ```
   `answer` calls `prompts.answer` with the same `AskResult` shape `Drawer.tsx` builds today.
4. Header line: who asks (role and task title from the prompt), as today.
5. Put away: the drawer folds into a small bar above the composer ("1 question waiting · Open"), dsh's composer is usable meanwhile; reopen brings the drawer back. Port `putAway.ts`.
6. **Mockups:** `StaticPreview` renders `htmlPreview` in `<iframe sandbox="" srcDoc=...>`. This is the one allowed iframe (builder rule 6 is about host-served pages). Keep `sandbox=""` (no scripts, no same origin) and `referrerPolicy="no-referrer"`.
7. dsh's own questions (from other dsh tools, if any) keep dsh's UI. Bot Lobby agents do not get dsh's `tool-ask-user` (phase 03), so all Bot Lobby questions use this path.

## Part F. Settings sections (`settings.section`)

Port `webui/src/tabs/settings/` to `src/client/settings/`. One section per group, ids `bot-lobby-*`, order after dsh's own:

| Section | From | Notes |
|---|---|---|
| Agents | `SettingsForm.tsx` agent rows | model (from phase 06 `availableModels`), effort slider (Bot Lobby's elaborate drag slider; levels from `levelsFor`), Compact at (number box), tools and skills grants. The orchestrator row shows "uses this session's model" and has only Compact at and auto compaction |
| Harnesses | `HarnessesGroup.tsx` | edits phase 05's backend patch rows through dsh's config editor; if the editor is a dsh component, embed it; otherwise keep Bot Lobby's form and save through the host |
| Tools & skills | `GrantsGroup.tsx` | MCP tools and skills from dsh (step below) |
| Workflow | workflow and review settings in `SettingsForm.tsx` | |
| Linting | `LintWizard.tsx` | `settings.linters`, `lintSetup`, `lintRule`, `lintCreate` |
| Classifier | classifier group | chat models only (phase 06 step 2) |

Drop: Appearance (`ThemeGroup.tsx`), themes, fonts, sounds, PWA, sessions, Lobby retention.

`settings.grants` on dsh: MCP tools from the tool registry (check their names with inspect `Tool`; Bot Lobby grants use `mcp__<server>__<tool>`; map if dsh names differ and keep the reverse map for gates), skills from dsh's skill service. Write `src/plugin/grants.ts`.

## Part G. Toasts

Bot Lobby notices (`notice` stream event) show as dsh toasts. Register `workspace.toast` keys `bot-lobby.info`, `bot-lobby.warning`, `bot-lobby.error` with `display: (notice) => ({ text: notice.text, tone })`. Find how a plugin raises a toast (inspect the toast service in `ui-workspace`) and raise one per notice. The orchestrator session's notices (phase 03 `notify()`) go the same way.

Bot Lobby's goo bubble toast is dropped (dsh's toast is used).

## Part H. What is not rebuilt

| Bot Lobby screen | Why |
|---|---|
| Sessions sidebar, new / switch / rename / archive / delete, background sessions | dsh sessions |
| Lobby chat feed, composer, slash and `@` trays, long paste to `.txt`, attach document | dsh conversation and composer. `@mention` agents become dsh commands or the orchestrator's own routing (phase 04) |
| Code viewer, terminal drawer and pop-out | dsh right sidebar files / changes / terminal |
| Project picker | dsh workspaces |
| Theme picker, themes, fonts, 90% scale | dsh theme and sizes |
| Login page, PWA, app icon set | dsh |
| Lightbox | dsh image view |

## Tests

UI checks are typecheck and build (builder rule 9). Add unit tests only for logic with no DOM:

- `test/client-questions.test.ts`: `payload.ts` builds the same `AskResult` as before for single, multi, custom, notes and global note (port the existing tests if there are any).
- `test/plugin-prompts.test.ts`: a prompt from a worker gets the owner session id; `prompts.list` for another session does not return it; `prompt-image` refuses a path not named by an open prompt.

## Done when

- [ ] Typecheck, build, tests pass.
- [ ] Tasks, Plans, Knowledge show in dsh's left sidebar and each opens its page.
- [ ] A running task shows live agent rows with Bot Lobby's working indicators on the Tasks page, in the turn tail and in the tool card.
- [ ] The task dock shows the running task's checklist above the composer.
- [ ] A worker's question opens Bot Lobby's questionnaire in place of the composer, with a mockup option; answering reaches the worker; put away and reopen work.
- [ ] Each Bot Lobby settings section saves and the next run uses the change.
- [ ] Bot Lobby notices appear as dsh toasts.

Commit: `dsh port: phase 08 ui`.
