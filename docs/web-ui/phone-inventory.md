# Phone Screen and Interaction State Inventory

Input document for the phone redesign (plan steps 3–5). It records every screen
and interaction state that exists in `webui` today, with exact ids, routes,
component names and file paths, so the later briefs can rely on them. It is a
snapshot of the **current code**; where the plan assumes behaviour that is not
implemented yet, that is called out rather than described as existing.

Boundaries used throughout:

- **Current detail mechanism is decided by `useWide()` = `(min-width: 1024px)`**
  (`webui/src/ui/SplitPane.tsx:20`), not by 768px. Below 1024px a detail is a
  right-hand `Sheet` by default, an inline stacked grid when `inlineDetail` is
  passed, or an inline pane.
- **Current "phone" CSS boundary is 640px** (Tailwind `sm`/`max-sm` and the
  `@media (max-width: 639px)` block in `index.css`). There is currently **no
  768px rule anywhere**; the 640–767px band is the inconsistent seam the plan
  unifies below 768px.
- Tab ids, labels and order come from the server/shared
  `src/lobby/prompts.ts` (`TAB_IDS`, `TAB_LABELS`, `visibleTabs`), built into
  `TabInfo[]` by `src/webui/api/status.ts`.

---

## 1. Tab registry

Tab numbers are **not stored in the code**: `src/webui/api/status.ts:13` builds
each tab's shortcut as `` `Alt+${index + 1}` `` over the `visibleTabs()` order,
and the client prints the trailing digit of `tab.key`
(`tabNumber`, `webui/src/app/TabStrip.tsx:37-39`). Removing/hiding a tab
therefore shifts the numbers of the tabs after it today.

| # | id | Label | Route | Component file | Availability / visibility |
|---|---|---|---|---|---|
| 1 | `lobby` | Lobby | `#/lobby`, `#/lobby/<rest>` (rest ignored) | `webui/src/tabs/lobby/LobbyTab.tsx` | always |
| 2 | `tasks` | Tasks | `#/tasks`, `#/tasks/board`, `#/tasks/<id>`, `#/tasks/board/<id>` | `webui/src/tabs/tasks/TasksTab.tsx` (dispatches via `taskRoute(rest)`) | always |
| 3 | `plan` | Plan | `#/plan`, `#/plan/previous`, `#/plan/previous/<id>` | `webui/src/tabs/plan/PlanTab.tsx` | always |
| 4 | `quickfix` | Quick fix | `#/quickfix`, `#/quickfix/<id>` | `webui/src/tabs/quickfix/QuickfixTab.tsx` | always |
| 5 | `issues` | Issues | `#/issues`, `#/issues/<number>` | `webui/src/tabs/issues/IssuesTab.tsx` | only while `lobby.issues` is on (`visibleTabs(issues)` filters it out when off); `IssuesOff` renders when the route is reached with the feature off |
| 6 | `excalidraw` | Excalidraw | `#/excalidraw`, `#/excalidraw/<id>` | `webui/src/tabs/excalidraw/ExcalidrawTab.tsx` | always |
| 7 | `git` | Git | `#/git`, `#/git/<number>` | `webui/src/tabs/git/GitTab.tsx` | always |
| 8 | `knowledge` | Knowledge | `#/knowledge`, `#/knowledge/<agent>/<file>`, `#/knowledge/ask`, `#/knowledge/ask/<agent>/<file>` | `webui/src/tabs/knowledge/KnowledgeTab.tsx` | always |
| 9 | `metrics` | Metrics | `#/metrics` | `webui/src/tabs/metrics/MetricsTab.tsx` | always in the registry today; **excluded from the phone carousel by the plan** and preserved unchanged at ≥768px |

Notes:

- **`TAB_IDS` has 9 entries**; `visibleTabs(true)` returns all 9,
  `visibleTabs(false)` returns 8 (Issues removed, order otherwise unchanged).
  Because numbers are `index + 1`, hiding Issues makes Metrics `Alt+8` instead
  of `Alt+9`. The plan requires this numbering **not** to be renumbered by the
  phone carousel filter.
- `src/lobby/prompts.ts` also holds `ANSWERED_ELSEWHERE` ("already answered in
  another window") and `ATTACHMENTS_MARK` ("Attached files:").
- **Settings and Sessions are separate `Route` kinds, not tabs**: `#/settings`
  → `webui/src/tabs/settings/SettingsTab.tsx`; `#/sessions` and
  `#/sessions/<key>` → `webui/src/tabs/sessions/SessionsTab.tsx`. They have no
  number and never appear in the tablist (`webui/src/app/router.ts:22-23`).
- `goKey` (`webui/src/tabs/registry.tsx:20`) is a separate letter→tab map used
  by the `g` chord (`webui/src/app/useLobbyKeys.ts:134`) and the Alt+H help
  rows (`webui/src/app/AltH.tsx:38`); it is not the visible tab number.
- `registry.tsx` `routeBody` is exhaustive over `TabId`, so every tab id above
  has a body. `detailId` (`registry.tsx:10`) decodes the first path segment for
  sessions/quickfix/excalidraw, but Plan and Issues receive raw `route.rest`.

---

## 2. Per-tab screens and states

Legend for the "Detail mechanism" column: **sheet** = right `DetailSheet`
(`SplitPane`, width `data-[side=right]:w-[92%] sm:max-w-3xl`) below 1024px;
**inline** = rendered in the page flow; **inline panes** = `InlinePanes`
(list `1fr` over detail `2fr`).

### 2.1 Lobby (`#/lobby`)

Owning files: `webui/src/tabs/lobby/{LobbyTab,Conversation,ChatParts,ActivityLog,RunsStrip,TaskHeader,Thoughts,Orb}.tsx`,
`types.ts`, `busy.ts`, `thoughtSteps.ts`, `orbPlace.ts`.

| Screen / state | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks (44px targets, 320px overflow) |
|---|---|---|---|---|---|
| Lobby root | `#/lobby` | `LobbyTab.tsx` (`LobbyTab`, `LobbyView`) | inline single column | loading → `Spinner` + "Connecting…"; error → `<ErrorState onRetry={lobbyStore.onHello({})}>` | uses `pb-dock` bottom clearance |
| Task header | top of Lobby, `shrink-0` | `TaskHeader.tsx` (`TaskHeader`, `Dot`, `Worked`, `Progress`, `Under`) | inline | no task → title "No task yet" + session name / "Type a request below to start one." | `h-12` (48px) row; facts already hidden `md:`/`lg:`/`xl:` (`TaskHeader.tsx:16,28,41,52,90`); `min-w-0 flex-1 truncate` title; it is `shrink-0`, so it does not scroll away |
| Runs strip | under header | `RunsStrip.tsx` (`RunsStrip`, `useNow`, `statusMark`) | inline | returns `null` when `runs.length === 0` (`:38`) | `flex-wrap` chips; step text `max-w-[18rem] truncate` |
| Narrow pane switcher | `< 1024px`, `available.length > 1` | `LobbyTab.tsx` (`NarrowView`), state `picked`, `available`, `running` | inline `role="radiogroup" aria-label="Pane"` | activity button shows `Spinner` when `running > 0` | buttons `h-8` (32px) < 44px |
| Conversation pane | default pane in `NarrowView` | `Conversation.tsx` (`Conversation`, `Message`, `LiveReply`, `ConversationEmpty`, `NoteEntry`, `useOlderChat`) | inline `role="log" tabIndex={0}` | `ConversationEmpty`: `NO_TASK`/`NO_TASK_HINT` or `NOTHING_SAID`; older-history error swallowed; "Jump to latest" `ActionButton` while `!atBottom` | `.chat-column` `max-width:46rem` `px-5`; empty state shows `Keys chord="3"`/`"4"` (shortcut UI to remove on phone); bubbles `min(80%,36rem)` / `min(100%,40rem)` |
| Live reply / typing | `reply?.trim()` or `busy` | `Conversation.tsx` (`LiveReply`, `TypingDots`), `ChatParts.tsx` | inline | — | — |
| Activity log pane | picked in `NarrowView` | `ActivityLog.tsx` (`ActivityLog`, `ActivityRow`, `KindMark`) | inline (`bare`, `collapsed={false}`) | empty → "No activity yet." (`:51`); running note spinner; "Latest" `ActionButton` | row grid `grid-cols-[2.75rem_5rem_1rem_minmax(0,1fr)]` leaves ~150px text at 320px; `break-words`; `px-2` |
| Folded activity side rail | `≥1024px` and folded | `LobbyTab.tsx` (`SideRail`, `RailButton`) | inline `aside` | — | desktop only |
| Thinking orb (floating) | every page, portal to `document.body` | `Orb.tsx` (`ThinkingOrb`), placed by `orbPlace.ts` | floating control | rendered only when `worthShowing`; `hidden={overlay}`; `aria-label="Open Thinking"` | `size: var(--touch-target)` = 44px; `bottom: calc(var(--composer-h) + 1rem + env(safe-area-inset-bottom))`; `right: max(1rem, env(safe-area-inset-right))`; `z-20` under composer `z-30`; drag SLOP 5, NUDGE 16, place in `localStorage["bot-lobby.orb"]` |
| Thinking pane (detail) | orb tap / Thinking key (`alt+t`) | `Thoughts.tsx` (`Thoughts`, `ThoughtBubble`, `useSpotlight`, `useThinkingKey`), `components/ui/popup.tsx` | `Popup` dialog (`PRIORITY.sheet`), `max-w-xl`, `max-h-[min(86svh,48rem)]` | empty → "Thoughts from the oracle and every agent appear here, and only here."; earlier steps folded (`SHOWN_STEPS=4`) | closes on Esc/backdrop/Thinking key; single overlay slot |
| Connection / reconnecting | global | `app/Shell.tsx` (`Banner`, `useOutage`, `OUTAGE_MS=2500`), `States.tsx` (`ReconnectingState`), `Header.tsx` (`Connection`) | banner above `#main` | `ReconnectingState` after 2.5s `connecting` when previously live, or on `offline`; "Retry now" | `mx-3 mb-1 max-sm:mx-2`; not owned by the tab |

Pure helpers (no DOM): `types.ts` (`ChatEntry`, `ActivityEntry`, `ThoughtEntry`, `sourceLabel`, `sourceColor`, `sourceTone`, `agentName`, `runsOf`, `latestThoughts`), `busy.ts` (`busyAgents`, `busyLabel`), `thoughtSteps.ts` (`thoughtSteps`), `orbPlace.ts` (`loadPlace`/`savePlace`).

### 2.2 Tasks (`#/tasks`, `#/tasks/board`)

Owning files: `webui/src/tabs/tasks/{TasksTab,TaskList,TaskBoard,TaskDetail,DetailSections,DeliveryReview,PlanDetail,Comments,OpenInSession,PhaseTiming,ResumeTask}.tsx`.
Route parsing: `webui/src/app/taskRoute.ts` → `{ board, id }`.

| Screen / state | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| List view | `#/tasks` | `TasksTab.tsx` (`TasksTab`, `TasksListView`), `TaskList.tsx` (`TaskList`, `TaskItem`) | list inline; detail **sheet** below 1024 | `ListSkeleton`; `ErrorState "Could not load tasks. …" + reload`; empty `<NoTasks/>` (`EMPTY_LIST` + "Plan a task" → `go(tabHash("plan"))`); stale selection → `<Missing/>` "That task is not on the list any more." | `PaneHeader` sticky `top-0`; `TaskItem` `min-h-10` (40px); `ArchivedToggle` `h-7` (28px) |
| List / Board sub-nav | always | `TasksTab.tsx` (`Tabs.List aria-label="Task views"`) | inline radix `Tabs` | — | triggers `px-3 py-1.5` (~30px) < 44px |
| Task detail | `#/tasks/<id>` (`select → go(tabHash("tasks", id))`) | `TaskDetail.tsx` (`TaskDetail`, `Header`, `Actions`, `AutoMode`, `ArchiveButton`, `OpenTask`, `factParts`, `Progress`), `SplitPane.tsx` (`DetailSheet`) | **sheet** `<1024px` (`open={Boolean(id)}`); inline two-pane ≥1024 | loading: header/actions with no skeleton; error → "Could not load the plan detail. …" (`:205`) | sheet `w-[92%]`; header "Close · Esc" `Keys`; `ActionBar` sticky `-top-5` `flex-wrap` with `E/R/A/O/S/Delete`; id line `break-all` |
| Plan detail | `#/tasks/<planId>`, `row.kind === "plan"` | `PlanDetail.tsx` (`PlanDetail`, `PlanSections`, `Split`) | same sheet/inline | `PlanSections` loading returns `null`; error "Could not load the agreed plan. …" | `ActionBar` "Start here"/"New session"/"Discard"; `row.id` `break-all`; split titles wrap; Markdown brief |
| Task board | `#/tasks/board` | `TaskBoard.tsx` (`TaskBoard`, `Board`, `BoardColumn`, `columnFor`) | `SplitPane wide={false}` (`:50`) → detail always a sheet, even ≥1024 | `ListSkeleton`; `ErrorState`; empty column → "No tasks here." | board `grid md:grid-cols-3` → one column below 768px |
| Board detail | `#/tasks/board/<id>` | `TaskBoard.tsx`, `TaskDetail.tsx` | sheet (always) | selection only when `columnFor(row) !== undefined` | same as task detail |
| Detail sections Steps / Full plan / Request / Proposal / Plan / Amendments / Waiting on / QA risk / Recent runs | inside detail | `DetailSections.tsx` (`PlanSections`, `DetailTrailer`, `StepsSection`, `FullPlan`, `Amendments`, `Waiting`, `QaRisk`, `Runs`) | inline `Section`s; `FullPlan` disclosure | Steps only when non-empty; Plan empty copy; Amendments/Waiting/QA/Runs `null` when empty; loading/error from `tasks.get` | `break-words`; QA `riskFactors.join(" · ")` long; Markdown tables scroll in `overflow-x-auto` |
| Delivery review | `detail.data.delivery` | `DeliveryReview.tsx` (`DeliveryReview`, `Panel`, `Facts`, `Status`, `Actions`, `Confirmation`, `useDeliveryController`) | inline `Section` + confirmation `Popup` (`PRIORITY.confirm`) | busy "Updating delivery…" `role="status"`; errors `role="alert"`; `STATUS` map `pending_approval/deferred/in_progress/successful/recoverable_failure` | action grid `sm:grid-cols-2` stacks below 640; `break-all`; buttons `h-8` |
| Comments | inside detail | `Comments.tsx` (`Comments`, `CommentItem`, `CommentMeta`), `ui/InlineEditor.tsx` | inline list; `InlineEditor` replaces body | empty copy varies (`finished`/`canComment`); **`read.error` never surfaced** (`Comments.tsx:53`) | "Edit" `size="sm"`; Markdown; textarea |
| Action bar / dialogs | top of detail | `TaskDetail.tsx` (`Actions`), `ui/Actions.tsx` (`ActionBar`, `ActionButton`), `ui/ConfirmButton.tsx` | sticky `role="toolbar"`; confirm dialogs | archive confirm; delete "This cannot be undone." | buttons `h-8`; `flex-wrap`; visible `E/R/A/O/S/Delete`; `AutoMode` `Switch` |
| Resume / Open in session / Conversation | detail actions | `ResumeTask.tsx`, `OpenInSession.tsx`, `TaskDetail.tsx` (`OpenTask`) | navigation / toast | busy/disabled; toasts | navigation to `#/lobby` or `#/sessions/<id>`; toasts clear `--composer-h` |

Interaction triggers: detail nav is a **route change** (`#/tasks/<id>`, `#/tasks`, `#/tasks/board[/id]`); List/Board switch goes through `go(tabHash("tasks", …))`; composer target set by `setComposerTask(commentable)` and cleared on cleanup; draft is Shell-level single state (`Composer.tsx:152`).

### 2.3 Plan (`#/plan`, `#/plan/previous`)

Owning files: `webui/src/tabs/plan/{PlanTab,Conversation,Draft,Header,LineComment,Previous,Roster}.tsx`.

| Screen / state | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| Current plan — loading | `#/plan` before first read | `PlanTab.tsx:166` | inline | `<p role="status" class="p-5 …">Loading the plan…</p>` | — |
| Current plan — error | `planner.get` fails | `PlanTab.tsx:165` | inline | `<ErrorState …>` | `ErrorState max-sm:mx-2` (640 boundary) |
| Seating intro | `#/plan`, `isFresh(snap)` (`round===0 && messages.length===0 && !busy`) | `PlanTab.tsx` `Intro`, `Roster.tsx` `Seats`, `words.ts` `PLAN_STEPS`/`INTRO_LEAD` | inline, `@container` | — | visible `KeyHint` chords `/` and `Enter` (`PlanTab.tsx:97-98`) to remove on phone; `PLAN_STEPS @2xl:grid-cols-2` |
| Session — conversation pane | `#/plan`, not fresh | `PlanTab.tsx` `ConversationPane`, `Conversation.tsx` | **inline stacked** (not a sheet); `max-h-[45svh]` narrow (`:120`); two columns ≥1024 | — | pane header not sticky; `min-h-12` |
| Session — asked question cards | message with `questions` | `Conversation.tsx` `Asked` | inline | — | option pills `flex-wrap` |
| Session — mockup thumbnails | option has `mockup` | `Conversation.tsx` `OptionMockups` (`:22`) | **Popup** (`PRIORITY.sheet`) → `MockupViewer`, `h-[min(92svh,60rem)] max-w-6xl` | — | `grid-cols-2` at 320px ≈ 148px cells; popup covers composer |
| Session — decided classifier entries | `message.decided` | `Conversation.tsx` `Decided` | inline | — | probability text wraps |
| Session — user turn edit | Edit on unsettled user message | `Conversation.tsx` `UserTurn`, `ui/InlineEditor.tsx` | inline editor | inline `role="alert"` on failure | `min-h-24 max-h-[40vh]`; Save/Cancel `size="sm"` (28px) |
| Session — draft plan lines | `#/plan`, `snap.draft` | `Draft.tsx` `DraftBody`/`Line` | inline | `DRAFT_WAITS` or `NO_DRAFT` | fenced lines `whitespace-pre-wrap break-words`; per-line comment `size="icon"` (32px) |
| Session — seat needs | `snap.notes` | `Draft.tsx` `SeatNeeds` | inline `Section` | `null` when empty | `dt w-20 shrink-0` + Markdown `dd` |
| Session — roster chips | always in `PlanHeader` | `Roster.tsx` `Roster`/`Chip` | inline | — | chip `min-h-8` (32px); `Checkbox` 18px |
| Session — plan header / actions | always | `Header.tsx` `PlanHeader`/`Actions` | inline, `shrink-0` | status line | header does **not** scroll away; action buttons carry `Keys` (`Answer questions A`, `Retry R`, `Save Ctrl+S`, `New plan N`, `Previous H`) |
| Line comment editor | draft line / comment icon | `LineComment.tsx`, `ui/NoteForm.tsx` | **Popup** `PRIORITY.confirm`, `max-w-xl` | `NoteForm` keeps text on failure | "Enter adds · Esc cancels" hint |
| Previous plans — list | `#/plan/previous` | `Previous.tsx` `PreviousPlans`, `SplitPane.tsx` | **sheet** below 1024 | `ListSkeleton`; empty "No previous plans…"/"No archived plans."; `ErrorState` | `PaneHeader` sticky `top-0` with Archived/Previous toggle |
| Previous plan — detail | `#/plan/previous/<id>` | `Previous.tsx` `Detail` | sheet | loading returns `null` (blank) (`:80`); error `ErrorState` | sticky `ActionBar`; `Markdown(plan.draft)`; full `PanelConversation` |
| New plan / Delete plan | header / detail | `Header.tsx`, `Previous.tsx`, `ConfirmButton` | **AlertDialog** `PRIORITY.confirm` | — | dialog `max-w-[calc(100%-2rem)] sm:max-w-md`; `Esc`/`Y`/`Delete` caps |

Route quirk: `#/plan/previous/<id>` passes raw (encoded) `rest` to `PlanTab`, unlike sessions/quickfix/excalidraw which decode.

### 2.4 Quickfix (`#/quickfix`)

Owning files: `webui/src/tabs/quickfix/{QuickfixTab,JobList,JobDetail}.tsx`.

| Screen / state | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| Loading list | `#/quickfix` before first read | `QuickfixTab.tsx:44` | sheet on select | `ListSkeleton` | — |
| Load error | `quickfix.list` fails | `QuickfixTab.tsx:43` | inline | `ErrorState "Could not load quick fixes. …"` | — |
| Empty (no jobs) | loaded, `jobs.length===0` | `QuickfixTab.tsx` `Intro` | inline | `Empty` with `INTRO` | `Empty` `m-4` |
| List | `#/quickfix` | `JobList.tsx`, `SplitPane.tsx` | list pane + **sheet** | — | rows `ROW min-h-10` (40px); status mark + prompt line `break-words` + elapsed |
| Detail selected | `#/quickfix/<id>` | `JobDetail.tsx`, `SplitPane.tsx` | **sheet** `w-[92%]` | — | — |
| Detail — job gone | `#/quickfix/<id>` not in list | `QuickfixTab.tsx:54` | sheet | "That quick fix is not on the list any more." | no actions |
| Detail — status / facts | any selected | `JobDetail.tsx` `Header` | sheet | — | status badge; `job.id` `break-all` |
| Detail — steps | `job.steps` | `JobDetail.tsx` `Steps` | sheet | `noStepsText(status)` (`queued/running/held/…`) | `formatClock` + `break-words` |
| Detail — edited files | `job.files?.length` | `JobDetail.tsx` | sheet | — | file paths `break-all` |
| Detail — error / report | `job.error`, `job.report` | `JobDetail.tsx` | sheet | error paragraph destructive | `Markdown` report |
| Cancel quick fix | status queued/running | `JobDetail.tsx` `Actions`, `ConfirmButton` | **AlertDialog** | — | `Cancel C` cap |
| Held actions | status `held` | `JobDetail.tsx` `Actions` | inline ActionBar | — | `Run anyway R`, `Make it a task T` |
| Detail actions bar | any selected | `JobDetail.tsx`, `Actions.tsx` | sticky bar | — | `sticky -top-5` |

Status strings: `queued`, `running`, `success`, `failed`, `timeout`, `cancelled`, `held`. New jobs are submitted only through the global composer (`act("quickfix.submit", …)`). Composer target `{id:"quickfix", pill:"Quick fix"}` + Oracle.

### 2.5 Issues (`#/issues`)

Owning files: `webui/src/tabs/issues/{IssuesTab,IssueList,IssueDetail}.tsx`.

| Screen / state | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| Feature off | `lobby.issues` off | `IssuesTab.tsx` `IssuesOff` | inline | `EmptyTitle "Issues are off"`, `EmptyDescription` `font-mono` `OFF` | — |
| List loading | `#/issues` | `IssuesTab.tsx:100` | sheet on select | `ListSkeleton` | — |
| List error | `issues.list` fails (not "off") | `IssuesTab.tsx:96` | inline | `ErrorState` | — |
| List empty | loaded, no open issues | `IssuesTab.tsx` `NoIssues` | inline | `NOT_LOADED` / `LOADING_LIST` / `EMPTY_LIST` / `✗ {error}` + Retry | `NoIssues` plus a second `CreateBox` in a `pb-dock` wrapper (`:111`) — two `CreateBox` instances on this path |
| List | `#/issues` | `IssueList.tsx`, `IssuesTab.tsx` `CreateBox`, `SplitPane.tsx` | list pane + **sheet** | row error line when `read.data.error` | rows `ROW min-h-10`; row may grow tall when title wraps; labels wrap |
| New issue composer | always in list pane | `IssuesTab.tsx` `CreateBox`, `ui/NoteForm.tsx` | inline `Pane` | `NoteForm` keeps text on failure | "File issue" 32px |
| Detail loading | `#/issues/<number>` | `IssueDetail.tsx:96` | sheet | `<Spinner/> loading #{number}…` | — |
| Detail error | `issues.get` fails | `IssueDetail.tsx:97` | sheet | "Could not load #{number}. …" (no retry) | — |
| Detail | `#/issues/<number>` | `IssueDetail.tsx`, `SplitPane.tsx` | **sheet** `w-[92%]` | `NO_DESCRIPTION` | title `#N` `break-words`; `issue.url` `break-all`; `ActionBar` sticky; Description Markdown |
| Comments | `issue.comments` | `IssueDetail.tsx` `Comments`/`Comment` | sheet | hidden when none | `card-flat` cards; long author/body |
| Plan it | `PlanIt` in detail | `IssueDetail.tsx` `PlanIt`, `ConfirmButton` | **AlertDialog** | — | "Plan #N with the panel?"; confirm → `go("#/plan")` + seed session |

`issueNumber` accepts only positive integers (else list). `IssueDetail` computes `now = Date.now()` once per render (no ticker). Composer target on Issues is Oracle only.

### 2.6 Excalidraw (`#/excalidraw`)

Owning files: `webui/src/tabs/excalidraw/{ExcalidrawTab,SessionList,SessionDetail}.tsx`.

**The board is never embedded.** There is no iframe, no `@excalidraw/excalidraw` import and no `<canvas>`; `Open board` is an external `<a target="_blank">` (`ExcalidrawTab.tsx:6-10`, `Actions.tsx:96-99`). Any pinch/scroll board requirement applies to the external site, not this app. `MAX_SESSIONS = 5`.

| Screen / state | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| No sessions at all | `#/excalidraw`, `sessions.length === 0` | `ExcalidrawTab.tsx` `ExcalidrawEmpty` | full page (not `SplitPane`), `@container @4xl:grid-cols-[…]` | `EMPTY_HEADLINE` "No sessions yet.", `EMPTY_LEAD`, `EMPTY_LIMIT` | single column at phone |
| Session list | `#/excalidraw` (sessions exist) | `ExcalidrawTab.tsx` `list`, `SessionList.tsx` | list pane; ≥1024 two-pane | count `${sessions.length}/${MAX_SESSIONS}`; `ListSkeleton`; `ErrorState "Could not load sessions."` | rows `ROW min-h-10` (comment claims 44px); masked link `font-mono break-all` |
| No session selected (desktop only) | `wide && read.data && !selected` | `ExcalidrawTab.tsx` `Overview` | ≥1024 detail pane | capacity/`Steps`/add boxes | **not rendered below 1024px** (`:74-76`): phone with sessions and none selected shows the list alone, no overview |
| Session detail | `#/excalidraw/<id>` | `SessionDetail.tsx` | **sheet** below 1024; two-pane ≥1024 | `ActionBar` Copy / Open board or Reveal / Look only / Check / Remove; facts `draw`/`look only`, agent count, `not checked yet` / `checking the room…` / `reachable` / `unreachable` | `ActionBar` wraps; `Line` `grid-cols-[6rem_minmax(0,1fr)]` tight at 320px; revealed link `break-all` |
| Reveal link | "Reveal" (`R`) | `SessionDetail.tsx` `reveal` | inline call | toast `REVEAL_FAILED` | `LINK_NOTE` "Masked until revealed…" |
| Agent assignment | checkbox chips | `SessionDetail.tsx` `AgentCard`, `AgentChip` | inline card | `EXCALIDRAW_AGENTS` | `AgentChip h-9` (36px); `@md:grid-cols-2` |
| Rename / Add by link / New room | field forms | `SessionDetail.tsx` `FieldForm`, `RenameForm`, `LinkForm`, `NewRoomForm`, `AddForms` | inline | `required` disables empty; busy spinner; `ADD_HINT`, `NEW_ROOM_HINT` | input `h-8` (32px) |
| Check room | "Check" (`T`) | `ExcalidrawTab.tsx` `check`, `SessionDetail.tsx` `CheckLine` | inline | `CHECKING_ROOM`, `CHECK_HINT` | — |
| Remove session | "Remove" (`Delete`) | `SessionDetail.tsx` `ConfirmButton` | **overlay confirm** | `Remove "<name>"?` | — |

### 2.7 Git (`#/git`)

Owning files: `webui/src/tabs/git/{GitTab,PullList,PullDetail}.tsx`.

**There is no line-by-line diff renderer.** "Git diff" appears only as the
`READING = "reading the diff…"` string; `Files` is a path/size table and code
blocks appear only inside Markdown bodies (description, reviews, notes).

| Screen / state | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| Pull list | `#/git` | `GitTab.tsx`, `PullList.tsx`, `SplitPane.tsx` | list pane; ≥1024 two-pane | `NOT_LOADED` "Refresh to load open pull requests with the GitHub CLI (gh)." / `LOADING_LIST` / `EMPTY_LIST` "No open pull requests." / `ErrorState` + Retry | rows `min-h-10`; title `break-words`; meta `flex-wrap`; Refresh `ActionButton R` 32px |
| Pull detail | `#/git/<number>` (integer > 0) | `PullDetail.tsx` | **sheet** below 1024 | `Loading` "loading #<n>…"; error "Could not load #<n>. …"; `Header`/`ReviewBox`/`Files`/`Description`/`Discussion` | `ActionBar` sticky, wraps (Review / Jev's read / Stop); `FocusInput` `rows=2`; URL `break-all` |
| Files changed | inside detail | `PullDetail.tsx:116-131` | inline Section | hidden when `pull.files.length === 0` | `overflow-x-auto` + table (path `max-w-0 break-all`, size `whitespace-nowrap`) — bounded |
| Review running | `git` topic | `PullDetail.tsx` `ReviewSteps`/`ReviewBody`, `useNow` | inline | `READING`, `STALE`; steps `slice(-6)`; `running/cancelled/failed/timeout/done` | ticks 1s; steps `break-words` |
| Jev's read | `git` topic | `PullDetail.tsx` `JevReadLine` | inline | `JEV_FAILED` "Jev could not read it"; `readNote` `<model> · <ms> ms` | Markdown output; code blocks bounded |
| Stop confirmation | running review → "Stop" | `PullDetail.tsx`, `ConfirmButton` | overlay (`PRIORITY.confirm`) | "Stop this review?" | destructive |
| Description / Discussion | inside detail | `PullDetail.tsx` `Note`/`Notes` | inline | `NO_DESCRIPTION` "(no description)"; notes hidden when 0 | Markdown; cards wrap |
| Non-existent pull | `#/git/<bad>` | `GitTab.tsx` | — | falls back to the list | — |

### 2.8 Knowledge (`#/knowledge`)

Owning files: `webui/src/tabs/knowledge/{KnowledgeTab,KnowledgeList,FileDetail,Editors}.tsx`,
`webui/src/app/KnowledgePaneToggle.tsx`, `webui/src/app/knowledgeView.ts`.

**Knowledge is the one tab whose detail is inline, not a sheet.**
`KnowledgeTab` passes `inlineDetail` (`KnowledgeTab.tsx:71`), so below 1024px
`SplitPane` renders `InlinePanes` — list (`1fr`) over detail (`2fr`), each with
`pb-dock` (`SplitPane.tsx:75-82,114`). At ≥1024px it is the standard two-pane
grid. There is no sheet.

Routes from `knowledgeView(rest)` (`webui/src/app/knowledgeView.ts:3-6`):

- `#/knowledge` — list only, no detail.
- `#/knowledge/<agent>/<file>` — file detail.
- `#/knowledge/ask` — chat detail.
- `#/knowledge/ask/<agent>/<file>` — chat detail with that file selected.

The **pane toggle lives in the composer**, not the page:
`<KnowledgePaneToggle rest={route.rest} />` is rendered by `Composer.tsx:425`
only when `route.tab === "knowledge"`. It is a `role="group"` of two buttons
"Chat"/"Docs", each `h-6` (24px), `aria-pressed`, calling
`go(knowledgeHash(rest, label === "Chat"))` — `ask` present ⇔ Chat.

| Screen / state | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| File tree (list) | `#/knowledge`, `#/knowledge/ask`, `#/knowledge[…/<file>]` | `KnowledgeTab.tsx` `FilesList`/`FilesContent`, `KnowledgeList.tsx` | **inline** (never sheet) | `ListSkeleton`; `ErrorState "Could not load the knowledge files."`; `NoFiles` "No knowledge files yet." | `Leaf` `min-h-9` (36px); facts `shrink-0` |
| Agent branch folded/unfolded | click/Enter/Space/←/→ | `KnowledgeList.tsx` (`aria-expanded`, motion `<ul>`) | inline tree | fold persisted to `localStorage["bot-lobby.knowledge.folded"]` | spring height animation; `ktree` |
| File detail | `#/knowledge/<agent>/<file>` | `KnowledgeTab.tsx` `detailFor`, `FileDetail.tsx` | **inline** row 2 below 1024 | `reading…` / "Could not read the file. …"; "Nothing here yet. Add the first entry below."; missing → "That file is not on the list any more." | `ActionBar` 5 actions (Edit/Add/Comment/Edit file/Delete) wraps; `EntryRow min-h-9`; long filename header may push width |
| Entry selected | click/Enter/Space | `FileDetail.tsx` `EntryRow`, `cursor` | inline | selected `border-primary/30 bg-accent`; `aria-pressed` | 36px row; Markdown body |
| Entry editing | "Edit" (`E`) | `Editors.tsx` `EntryEditor` | inline card | Enter saves, Shift+Enter breaks line; Cancel/Save; busy spinner | `Textarea rows=4 autoFocus`; buttons `h-8` |
| Comment / Add entry | "Comment" (`C`) / "Add" (`A`) | `FileDetail.tsx` → `ui/NoteForm.tsx` | inline | `NoteForm` label/hint/buttonLabel (`ARCHIVE_HINT`) | textarea + send |
| Edit whole file | "Edit file" (`F`) | `Editors.tsx` `FileEditor` | **Popup** `PRIORITY.confirm`, `dismissOnBackdrop={false}`, `max-w-3xl`, `max-h-[min(86svh,48rem)]` | `Textarea rows=14 font-mono`; Cancel / "Save file"; busy spinner | 14-row monospace textarea on 320px; overlay consumes viewport |
| Notes on changed entries | end of detail | `FileDetail.tsx` `Detached` | inline Section | hidden when none | note lines wrap; take-back `size-7` |
| Saving | any write | `FileDetail.tsx` `busy` | inline | "saving…" + `Spinner`; 409 conflict surfaces server message and rereads | — |

### 2.9 Metrics (`#/metrics`) — excluded from the phone carousel

Owning files: `webui/src/tabs/metrics/{MetricsTab,Charts,Classifier,DateFilter,MetricsTable,Tiles}.tsx`.

**This tab is planned to be removed from the phone carousel and sequential tab
cycling, and to show a compact unavailable-on-phone notice with a Lobby action
for explicit `#/metrics` routes. It must stay unchanged at ≥768px.** Today there
is **no phone filter at all**: the tab strip renders `status.tabs` and `cycle()`
wraps unfiltered (`Shell.tsx:114-122`); Metrics is a normal `TabId`
(`registry.tsx:47`). The page is non-`SplitPane`, `max-w-6xl px-5 pt-5 pb-dock`
(`MetricsTab.tsx:115`).

| Screen / state | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| Tiles | `#/metrics` | `MetricsTab.tsx` `Body`, `Tiles.tsx` | page | `Skeleton` (`role=status`) while loading | `grid-cols-2 sm:grid-cols-5`, last child `col-span-2`; value `text-2xl` |
| Filters (period + date range) | page header | `MetricsTab.tsx`, `DateFilter.tsx` | inline `section[aria-label="Metrics filters"]` | periods "All time"/"Today"/"Past 7 days"/"Date range"; inline error `role="alert"` | `SelectTrigger h-9` (36px); `Input h-9 w-36`; `Apply h-9` all < 44px |
| Group by | "by model · thinking" / "… · agent" | `MetricsTab.tsx` `GroupToggle` `role="radiogroup"` | inline | arrow-key roving | `Button size-sm h-7` (28px) |
| Search runs | input | `MetricsTab.tsx` `SearchBox` | inline | placeholder; `No run matches "<q>" in this period.` | `input h-8 w-64 max-w-full`; shows `Keys chord="/"` to remove on phone |
| Daily trends | `tiles.runs` / `daily` | `Charts.tsx` `DailyTrends`, `TrendChart` | inline SVG `viewBox="0 0 512 220" w-full` | hidden when `daily.length === 0` | axis text 10/11px in a 512 viewBox — likely unreadable at 320px; hover-driven |
| Average run time | `tiles.runs > 0` | `Charts.tsx` `AvgTime`, `BarRow` | inline | "No timed runs yet." | "Show all n" `h-6` (24px) |
| Success rate | `tiles.runs > 0` | `Charts.tsx` `SuccessRate`, `MeterRow` | inline | "No runs yet."; sr-only word per state | bar `h-5`; "Show all" 24px |
| Where the time goes | runs or `taskTimes` | `Charts.tsx` `TimeShare`, `Stacked`, `ShareLegend`, `TaskTimes` | inline | "No timed runs yet." | legend wraps; stacked `h-6` |
| Classifier (Jev) | `data.classifier` | `Classifier.tsx` | inline card | "no calls recorded" | stats `grid-cols-2 sm:grid-cols-4` |
| Full table | `tiles.runs > 0` | `MetricsTable.tsx` | inline `§` | — | **15 columns** in `div.max-h-80 overflow-auto` (`tabIndex=0 role=region`); bounded but very cramped at 320px; header sticky |
| Empty period | `tiles.runs === 0` | `MetricsTab.tsx` `EMPTY` | inline | "No runs recorded yet. …" | — |
| Error | fetch failure | `MetricsTab.tsx` | page | `ErrorState "Could not load metrics." + Retry`; inline `role="alert"` | — |
| Refreshing | topic update | `MetricsTab.tsx` | inline | spinner "refreshing", `opacity-60`, `aria-busy` | — |

---

## 3. App-level screens and global chrome

### 3.1 Shell, header and global surfaces

| Screen / component | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone interaction states and risks |
|---|---|---|---|---|---|
| `Shell` frame | every route | `webui/src/app/Shell.tsx` | header + `Banner` + `#main` + composer dock | renders `SignIn` / `LoadingState` / `ErrorState` | draft owned by `Composer`; blocking overlay via `useAnyOverlay`; pending question via `QuestionPopup`; `max-sm:mx-0 max-sm:mb-0` on `#main` (640 boundary) |
| `Header` | always | `webui/src/app/Header.tsx` | `useOneRow` measurement (`:166-190`); one row ≥640px and when it fits, two rows below 640 (`index.css:922-936`) | `ProjectNotice` error line `role="alert"` | tools `flex-wrap`; visible `Keys` chords in tooltips; controls `size-8` (32px) with a coarse-pointer 40px `::after`; `md:inline` session task chip, `min-[1500px]:inline` state/session name |
| `ProjectSwitcher` | `P` / header trigger | `webui/src/app/ProjectSwitcher.tsx` | `Popover` combobox, `walk` listbox keys | `projectError`; `ProjectNotice` `role="alert"`; busy spinner after 300ms (`slow`) | `w-[min(26rem,calc(100vw-1.5rem))]`; branch chip `hidden sm:inline-flex` |
| `ProjectFolderDialog` | "Open folder…" | `webui/src/app/ProjectFolderDialog.tsx` | `Popup` on `PRIORITY.help` | "Loading folders…", `role="alert"` error, Retry/Cancel, "No subfolders" | `max-h-64` list; `p-5` |
| `SignIn` | `signedOut` | `webui/src/app/SignIn.tsx`, `Shell.tsx:186-194` | form in `#main` | error `role="alert"`; copy "Paste the link from Pi below." | `input h-8` (32px); `max-w-md p-6` |
| `LoadingState` | first paint (`!status`) | `webui/src/app/States.tsx:12` | header + spinner in `#main` | text "Connecting…" | `max-sm:mx-0 mb-0` |
| `ErrorState` | `statusRecord.error` or a topic read failure | `webui/src/app/States.tsx:22` | in `#main` | message + "Try again" | `m-4`; `max-sm:mx-2` |
| `ReconnectingState` | `useOutage`: `connection==="offline"`, or `"connecting"` for > `OUTAGE_MS=2500` after being live | `webui/src/app/States.tsx:43`, `Shell.tsx:53-74` | `Banner` above `#main`, destructive `Alert role="status"`, "Retry now" | — | `max-sm:mx-2`; banner pushes content down |
| `AltH` shortcut help | `Alt+H`/`?` or header `HelpButton` | `webui/src/app/AltH.tsx`, `Shell.tsx:210` | `Popup` on `PRIORITY.help`, `max-w-4xl`, `md:grid-cols-2` | sections: Everywhere / Jump to a tab / Navigation and editing / Message box / Lists and panes / Buttons on a page / Questions | key badges throughout; closes on Esc, the help key, or Close |
| Toasts / notifications | `toast.*` | `webui/src/lib/toast.ts`, `webui/src/components/ui/toaster.tsx` | one fixed toast at `bottom: calc(var(--composer-h) + 0.25rem)` | `role="status"` / `aria-live`; waits while `useAnyOverlay` | depends on `--composer-h`; **no safe-area term** |
| Browser notifications | Settings toggle | `webui/src/app/notify.ts` | only while `document.hidden`; `useSoundUnlock` | `enableNotifications` → granted/denied/unsupported | `Notification` may be unsupported on phone; sound needs a user gesture |

Header controls (`Header.tsx`): `IconLink` Sessions (`Alt+O`), Settings
(`Alt+S`), `HelpButton` (`Alt+H`), `ThemeToggle` (`D`), `SoundToggle`,
`Connection`, `SessionChip`. There is **no Thinking control in the header**; the
Thinking key is surfaced only by the orb/thoughts pane.

### 3.2 Settings (`#/settings`)

Owning files: `webui/src/tabs/settings/{SettingsTab,SettingsForm,ThemeGroup,parts}.tsx`.
Route `#/settings`; not numbered.

Loading → 4 skeleton cards (`PAGE.loading`); load error → `ErrorState` with
reload. Section nav is `SECTIONS = ["Agents","Workflow","Linting","Lobby","Classifier","Appearance & notifications"]`
(`SettingsForm.tsx:528`), a button strip `aria-label="Settings sections"` where
panels are `<div hidden>` (client-only, no per-section route).

| Section | Controls / sub-sections | Phone risks |
|---|---|---|
| Agents | per agent (`AGENT_ORDER`, 8): Model (`ModelChoice` Combobox + custom input), Effort (`EffortSlider`), Instructions (disclosure), Time limit (`MinutesField w-24`), MCP tool grants (`Textarea rows=2`) | `md:grid-cols-2`, `xl:grid-cols-2`; card header `truncate`; `min-h-8` disclosure |
| Workflow | Git isolation `off`/`branch`/`worktree` (`Combobox`) | — |
| Linting | Lint gate `off`/`advise`/`block`, Command, File types (when command custom), Time limit, "Found in this project" (`foundNone`, installed/not installed) | long folder `truncate` |
| Lobby | On when pi starts, Issues tab, Conversation pane, Activity log pane, Thinking bubble (switches), Planning rounds, Split long plans, Port, Open browser | row label + `Switch` |
| Classifier | enabled, Host, Model, API key, 8 feature switches (Planning seats, Obvious answers, Task triage, Effort routing, QA risk, Pull request read, Relevant knowledge, File hints), Cheaper model | 8 long help rows |
| Appearance & notifications | Prompt sounds, Mode (light/dark/system), Colour theme `ThemePicker` (`role=radiogroup`, swatch `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`), Saved themes (rename/remove), Import a theme (`Textarea` + file input, `MAX_THEME_BYTES`), Browser notifications, Install as app, Fullscreen when supported | switches at 640, not 768; rename form `flex-wrap`; buttons row may wrap |

### 3.3 Sessions (`#/sessions`, `#/sessions/<key>`)

Owning files: `webui/src/tabs/sessions/{SessionsTab,SessionList,SessionDetail,ChatView,Dialogs,WhereIcon}.tsx`.
Not numbered.

| Screen / state | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| Sessions list | `#/sessions` | `SessionsTab.tsx:52-81`, `SessionList.tsx` | list; detail **sheet** below 1024 | `ListSkeleton`; `ErrorState` on `sessions.list` error | `PaneHeader` sticky `top-0`; row `px-4 py-3`; `--control-target: 40px` |
| This window / Background / Other terminals groups | derived | `SessionList.tsx:62-71`, `words.ts:9-10` | inline sections | groups hidden when empty | — |
| Session row | tap/click | `SessionList.tsx:15-52` | button row, `WhereIcon`, "This window" badge, spinner, "N waiting" | status text | 44px claim vs `--control-target: 40px` |
| "No other sessions" | one entry | `SessionsTab.tsx:73` | inline | `NO_OTHERS` | — |
| Other windows links | `status.windows` | `SessionsTab.tsx:24-46` | inline `Section` | hidden if none | `min-h-8` (32px) links |
| Session detail | `#/sessions/<key>` | `SessionDetail.tsx:74-87` | sheet below 1024; inline ≥1024 | — | "Back · B", "Move · M", "Stop · S" key hints visible |
| Detail actions | this-window → "Back to the Lobby"; else "Move here" + Stop confirm | `SessionDetail.tsx:36-63` | `ActionBar`; Stop `ConfirmButton` `PRIORITY.confirm` | Stop disabled if not alive | — |
| Task / waiting / other-terminal note | task, dialogs | `SessionDetail.tsx:21-34,78-83` | inline | `NOTHING_SAID`, `OTHER_TERMINAL_NOTE` | — |
| Missing session | key not in list | `SessionsTab.tsx:48-50` | inline | "That session is not on the list any more." | — |
| Questions waiting | `entry.dialogs` | `Dialogs.tsx:76-88` | inline cards | `waitingText(n)` `role="status"` | select buttons wrap; typed `Textarea rows=2/4` |
| Answer select/confirm/typed | method field | `Dialogs.tsx:45-57` | inline | Send disabled when empty | — |
| Put away | button | `Dialogs.tsx:70-72` | sends `cancelled` | — | — |
| Conversation | — | `ChatView.tsx:60-82` | inline ordered list | `empty` text; "Load earlier messages" | you-bubble `max-w-[85%]`, oracle `max-w-[90%]` |
| Remote conversation | background/other-terminal | `ChatView.tsx:84-100` `RemoteChat`, `useApiRead("sessions.chat")` paged `before` | inline | "Loading the conversation…", `emptyNote()` | — |

### 3.4 Question popups and cards

Owning files: `webui/src/prompts/{QuestionPopup,QuestionCard,MockupViewer,StaticPreview}.tsx`,
`payload.ts`, `nav.ts`; queue from `webui/src/app/usePrompts.ts`.

`parsePrompt` yields exactly five kinds: `questionnaire` (`AskQuestion[]`,
optional `multiSelect`), `choose` (`options: string[]`), `confirm`
(`question`, optional `detail`), `text` (`question`, optional `placeholder`),
and `sessionDialog` (`dialog.method` = `select` | `confirm` | `input` |
`editor`). `QuestionCard.tsx` renders `QuestionnaireCard`, `ChoiceCard`,
`ConfirmCard`, `TextCard`, `SessionDialogCard` (`:609-615`).

| Screen / component | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| Questions pill (minimised) | header extra when `putAway && prompts.length > 0` | `QuestionPopup.tsx` `QuestionsPill:38-48` | button in header | count 0 → not rendered | button ~`h-8`; word "waiting" is `hidden sm:inline` (absent on phone) |
| Question popup (open) | `useOverlaySlot(wants, PRIORITY.question)` | `QuestionPopup.tsx:47-140` | centered `Popup`, blurred backdrop, `dismissOnBackdrop={false}` | "1 of N" header Later/X; malformed → "This question cannot be shown here." + Dismiss; submitting → "Sending…/Leaving…"; `question_withdrawn` → `ANSWERED_ELSEWHERE` toast | base `max-w-2xl`, wrapper `p-4`, inner `px-6`; Esc steps viewer→question→minimise; Later `size="icon"` 32px |
| Questionnaire card | inside popup | `QuestionCard.tsx:196-470` | inline card | empty `answers` blocked; own-answer `OWN_ANSWER` placeholder; no preview → no Preview panel | chips `min-h-8`, OptionRow `min-h-9`; option grid single column until `lg`; digits/arrows select |
| Choose card | `choose` prompt | `QuestionCard.tsx:474-518` | inline | Cancel/Choose; disabled when empty | OptionRow heights |
| Confirm card | `confirm` prompt | `QuestionCard.tsx:520-560` | inline | "Sending…" | visible `Y`/`N` key hints |
| Text card | `text` prompt | `QuestionCard.tsx:562-589` | inline | placeholder `OWN_ANSWER` | `min-h-9` textarea; `md:text-sm` but coarse-pointer override keeps 16px |
| Session dialog card | `sessionDialog` (`select/confirm/input/editor`) | `QuestionCard.tsx:591-607` | inline | Cancel always; disabled when not ready | editor `rows=4` can push the popup; body scrolls |
| Mockup viewer (expanded) | questionnaire `expanded && mockups`, or `E`, or Preview "Expand" | `MockupViewer.tsx` | **Popup** `PRIORITY.sheet`, `h-[min(92svh,60rem)] max-w-6xl` | `hasMockup` false → "No mockup for this option."; empty `role="region" aria-roledescription="carousel"` | `mockup-track snap-x snap-mandatory overflow-x-auto`; tablist pills `h-7`; prev/next arrows `max-sm:hidden` → swipe only on phone; footer button truncates label |
| StaticPreview | Preview in card / Mockup in viewer | `StaticPreview.tsx`, `webui/src/lib/staticPreview.ts` | **`<iframe sandbox="">`** (no scripts, no allow-same-origin), `referrerPolicy="no-referrer"`, `srcDoc` from `staticPreviewDocument` | fail-closed static doc on parse/sanitize error | thumbnail mode scales a 1200px-wide layout into the box (`aspect-[3/2]`, `pointer-events-none`); viewer mode `minWidth=1024` scales down — unreadable at 320px but does not overflow (`overflow-hidden`) |

`StaticPreview` is a deliberate isolation boundary (Chromium sandbox + CSP); do
not relax the sandbox in the redesign.

### 3.5 Attachments

Owning files: `webui/src/ui/Attachments.tsx`, `webui/src/app/Composer.tsx`.

| Screen / component | Route / trigger | Owning file(s) | Detail mechanism | Empty / loading / error | Phone risks |
|---|---|---|---|---|---|
| Attachment list in a message | Markdown `Attached files:` block | `Attachments.tsx` `splitAttachments:22-38`, `AttachmentList:42-66` | image `mime` → `<a target=_blank>` thumbnail (`max-h-40 max-w-56`); other → non-interactive `<span>` chip | `files.length === 0` → `null`; invalid block → original text | no in-app lightbox: images open `/files/preview/attachments/<id>` in a **new browser tab**; chips `max-w-64 truncate`, `flex-wrap gap-2` |
| Composer attachment chips | dropped/pasted/picked | `Composer.tsx` `Chip:104-166` | image chip `size-16` (64px) + remove `size-5`; file chip `h-9` + remove `size-7`; upload `Spinner` overlay | uploading state; failure toast + chip removed; `MAX_ATTACHMENTS` warning | remove buttons have no `data-compact`, so the coarse 40px hit area grows inside the 64px image chip |

### 3.6 Composer

Owning file: `webui/src/app/Composer.tsx`. Global, mounted in `Shell` below
every route. Draft is a single `useState("")` (`:152`) plus in-memory
`Pending[]` attachments — it survives in-app tab/route changes because
`Composer` stays mounted, but is lost on reload and is shared across tabs
(no per-tab draft).

Single card: attachments `<ul>` (wraps), optional Markdown preview
(`max-h-48`), textarea
(`field-sizing-content max-h-[min(45vh,20rem)] min-h-[1.75rem] md:text-[0.9375rem]`),
one wrapping tool row: attach (`size-8 data-compact`), preview (`size-8`),
separator, target radiogroup `h-6` pills (`data-compact`) **or**
`KnowledgePaneToggle` **or** "To the X" text, then a right cluster of
`KeyHint`s gated by container queries (`@[8rem]`…`@[34rem]`) + shortcuts button
(`h-7`), then Stop `ConfirmButton` (busy + oracle) and Send
(`size-8 data-compact`); drag overlay "Drop to attach".

Phone risks: tool buttons and Send are 32px **with `data-compact`**, so the
coarse-pointer 40px hit-area rule does **not** apply; target pills are ~22.5px;
up to 8 visible `KeyHint`s are shown on phone (the plan removes these). The dock
uses `max-sm:px-2 max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]`.

### 3.7 Overlay and sheet mechanism

`webui/src/lib/overlay.ts` — one global slot. Each entry is
`{id, priority, order}`; the winner is the highest `priority`, ties broken by
earliest `order` (`holder()`, `:31-38`). Priorities
(`:40`): **`question: 30`, `confirm: 20`, `help: 10`, `sheet: 5`**.

`useOverlaySlot(wantsOpen, priority)` appends while `wantsOpen` and returns
`wantsOpen && current === id` (`:43-55`). A second overlay stays closed but
keeps its `wantsOpen`, and opens when the winner releases. `hasOverlay()` is a
sync guard for keys; `useAnyOverlay()` is reactive and makes the composer and
toaster give way (`:58-64`).

Users of `useOverlaySlot`/`PRIORITY` (grep-verified): `AltH.tsx:11,146` (help),
`ProjectFolderDialog.tsx:7,70` (help), `prompts/QuestionPopup.tsx:16,67`
(question), `tabs/knowledge/Editors.tsx:12,78` (confirm),
`tabs/lobby/Thoughts.tsx:15,121` (sheet),
`tabs/plan/Conversation.tsx:11,32` (sheet), `tabs/plan/LineComment.tsx:8,20`
(confirm), `tabs/tasks/DeliveryReview.tsx:7,94` (confirm),
`ui/ConfirmButton.tsx:11,46` (confirm), `ui/SplitPane.tsx:14,46` (sheet).
`useAnyOverlay` consumers: `Composer.tsx:20`, `toaster.tsx:6`.
`ProjectFolderDialog` shares `PRIORITY.help` with `AltH`.

### 3.8 Keyboard and viewport

- **No `visualViewport` and no `innerHeight` usage anywhere** in `webui/src`.
  The software keyboard is not tracked.
- Viewport units: only `svh` — `components/ui/popup.tsx:65`
  (`max-h-[min(86svh,48rem)]`), `prompts/QuestionPopup.tsx:105` (`92svh`),
  `tabs/plan/Conversation.tsx:52`, `tabs/plan/PlanTab.tsx:116` (`45svh`).
  No `dvh`/`100vh` dynamic handling.
- `--composer-h`: declared default `6.5rem` (`index.css:111`). **Set** by a
  `ResizeObserver` on the composer dock root (`Composer.tsx:188-203`,
  `ref={card}` at `:332`), writing `Math.ceil(height)px`, or `0px` while
  `blocked = useAnyOverlay()`; reset to `0px` on cleanup. Because the measured
  element is the whole dock container (`Composer.tsx:334`), the value already
  includes its padding and `env(safe-area-inset-bottom)`. **There is no carousel
  or collapsed handle in the dock today.**
  Used by `pb-dock`/`bottom-dock` (`index.css:365-370`), `toaster.tsx:33`, and
  `.thinking-bubble` (`index.css:598`). Note the orb adds
  `env(safe-area-inset-bottom)` on top of `--composer-h` (`index.css:598`) while
  the dock already includes it — a double-count risk.
- Safe-area: `env(safe-area-inset-bottom)` in `Composer.tsx:334` and
  `index.css:598`; `env(safe-area-inset-right)` in `index.css:597`; the Toaster
  has **no** safe-area term.
- `--touch-target: 44px` (only the Thinking orb uses it) and
  `--control-target: 40px` (`index.css:491`); coarse-pointer controls get a 40px
  invisible `::after` hit margin, excluding `[role=switch]`, `[role=checkbox]`
  and `[data-compact]` (`index.css:337-350`).

### 3.9 Global interaction states

| State | Trigger | Owning file | How it renders | Phone risk |
|---|---|---|---|---|
| Reconnecting | stream closed, or `connecting` >2500ms after being live | `Shell.tsx:53-74`, `States.tsx:43` | destructive `Alert role="status"` under the header + "Retry now"; header `Connection` shows "reconnecting…"/"Connection lost" | `max-sm:mx-2`; pushes content down |
| Offline | `connection === "offline"` | `useOutage`/`Banner` | same `ReconnectingState` | as above |
| Bootstrap / loading | first paint, `!status` | `Shell.tsx:190-192`, `bootstrap.ts:14`, `States.tsx:12` | header + `LoadingState` in `#main` | `max-sm:mx-0 mb-0` |
| Sign-in required | `signedOut` | `Shell.tsx:186-189`, `SignIn.tsx:19` | `SignIn` form in `#main` | 32px input/buttons |
| Toasts | `toast.*` | `toast.ts`, `toaster.tsx:14-60` | one fixed toast at `bottom: --composer-h + 0.25rem`; waits while overlay open | depends on `--composer-h`; no safe-area |
| Pending question | `prompts` topic non-empty, not minimised | `QuestionPopup.tsx:63-67` (`PRIORITY.question`), `Shell.tsx:206`; header pill when minimised (`:181`) | centered `Popup`, blurred backdrop; one of N; Later/Cancel | `max-w-3xl`; expanded `92svh`; pill label `sm:inline` |
| Blocking overlay open | any `useOverlaySlot` winner | `lib/overlay.ts`, `Composer.tsx:20,191-196`, `toaster.tsx:6`, `keyGuards.ts` | composer `opacity-0` + `inert`, `--composer-h` → `0px`; configured keys blocked | composer vanishes; the page regains the dock height |
| Software keyboard open | none | — | **no handler**: no `visualViewport`/`innerHeight`/`dvh`; `html,body { height:100%; overflow:hidden }` (`index.css:305-313`) | real risk for a fixed-percentage shell; keyboard height untracked |
| Session switch / busy transition | `switchProject` / `act("sessions.switch")` | `lib/switching.ts:10-38`, `Shell.tsx:141`, `SessionDetail.tsx:48` | `switchStarted`/`switchEnded` gate first paint via `afterSwitch`; `SwitchProject` reloads the page | reload drops drafts on purpose; 900ms safety cap |

Boot: `webui/src/app/bootstrap.ts` `useBootstrap` (`:14-30`) signs in and marks
`SHELL_TOPICS`; `install.ts` handles `beforeinstallprompt` and
`(display-mode: …)` matchMedia for the installed-app/Settings install controls.

---

## 4. Breakpoints in use

Tailwind v4 defaults: `sm` = 40rem = 640px, `md` = 48rem = 768px,
`lg` = 64rem = 1024px, `xl` = 80rem = 1280px, `2xl` = 96rem = 1536px.
CSS media queries use rem against the initial 16px root, so
`html { font-size: 93.75% }` (`index.css:310`) does not move the px boundaries.
`max-sm:` compiles to `width < 40rem` (below 640px).

**Distinct numeric viewport breakpoints: `360, 640 (max 639), 768, 1024, 1280, 1500`**
(plus Tailwind `2xl`/1536 defined but unused as a viewport utility). There is no
`max-md`/`max-lg`/`max-xl` and no width media other than 639/640px.

Counts: 12 CSS `@media` blocks total (11 in `index.css`, 1 in
`discover-button.css`); 3 CSS width media (`max-width:639px` ×2,
`min-width:640px` ×1); 10 `matchMedia` call sites (5 distinct queries);
Tailwind viewport utilities: `sm:` 42, `md:` 14, `lg:` 9, `xl:` 4, `2xl:` 0,
`max-sm:` 12; arbitrary `min-[Npx]:` 3 (360px, 1500px ×2); arbitrary container
`@[Nrem]:` 6 (all Composer); named container variants 14 (viewport-independent);
non-viewport CSS queries 7 (`pointer:coarse` ×2, `hover:none + pointer:coarse`
×1, `prefers-reduced-motion` ×5 incl. `discover-button.css`).

### Below 640px (`max-width: 639px` / `max-sm:` / `width < 40rem`)

| Breakpoint / query | Where defined | Kind | Affects |
|---|---|---|---|
| `max-width: 639px` | `index.css:380` | CSS media | `.surface` → radius 0, no side borders/shadow (edge-to-edge page card) |
| `max-width: 639px` | `index.css:922` | CSS media | `.app-header` single column; `.tools` left-aligned + wrap |
| `max-sm:px-2 max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]` | `app/Composer.tsx:334` | Tailwind | composer dock padding |
| `max-sm:mx-0 max-sm:mb-0` | `app/Shell.tsx:178,198` | Tailwind | both `#main` surfaces |
| `max-sm:mx-2` | `app/States.tsx:47` | Tailwind | error/loading/reconnecting banner |
| `max-sm:col-start-2 max-sm:mt-2 max-sm:justify-start` | `components/reui/alert.tsx:85` | Tailwind | Alert action placement |
| `max-sm:hidden` | `prompts/MockupViewer.tsx:197,202` | Tailwind | mockup viewer arrows → swipe only on phone |

### 640px (`sm:` / `min-width: 640px`)

| Breakpoint / query | Where defined | Kind | Affects |
|---|---|---|---|
| `min-width: 640px` | `index.css:936` | CSS media | `.app-header[data-one-row]` → 3-column `where tabs tools` |
| `sm:inline-flex` | `app/ProjectSwitcher.tsx:206` | Tailwind | branch/Git chip |
| `sm:w-4` | `app/TabStrip.tsx:481` | Tailwind | tab connector width |
| `sm:row-end-3`; `sm:col-start-3 sm:row-start-1 sm:justify-end sm:self-center` | `components/reui/alert.tsx:9,85` | Tailwind | Alert layout |
| `sm:max-w-md`; `sm:flex-row sm:justify-end` | `components/ui/alert-dialog.tsx:41,58` | Tailwind | AlertDialog width/footer |
| `data-[side=right]:sm:max-w-sm`; `data-[side=right]:sm:max-w-3xl` | `components/ui/sheet.tsx:69`; `ui/SplitPane.tsx:56` | Tailwind | Sheet width; SplitPane overrides to `3xl` |
| `sm:px-5` ×2, `sm:w-auto`, `sm:px-14` | `prompts/MockupViewer.tsx:141,149,181,207` | Tailwind | viewer chrome |
| `sm:inline` | `prompts/QuestionPopup.tsx:54` | Tailwind | QuestionsPill "waiting" word |
| `sm:px-8` | `tabs/excalidraw/ExcalidrawTab.tsx:71` | Tailwind | Excalidraw page padding |
| `sm:p-4` | `tabs/lobby/Thoughts.tsx:154` | Tailwind | thoughts log padding |
| `sm:grid-cols-4` | `tabs/metrics/Classifier.tsx:30` | Tailwind | classifier grid |
| `sm:grid-cols-3`, `sm:grid-cols-5`, `sm:[&>:last-child]:col-span-1` | `tabs/metrics/MetricsTab.tsx:99`, `tabs/metrics/Tiles.tsx:36` | Tailwind | metrics tiles/grids |
| `sm:grid-cols-3` | `tabs/plan/Conversation.tsx:38` | Tailwind | mockup grid |
| `sm:px-8 sm:pt-10` | `tabs/plan/PlanTab.tsx:54` | Tailwind | Plan page padding |
| `sm:text-right` ×3, `sm:items-end`, `sm:justify-end` ×2, `sm:px-8 sm:pt-8` | `tabs/settings/SettingsForm.tsx:378,380,382,467,506,518,551` | Tailwind | Settings alignment/padding |
| `sm:px-8 sm:pt-8` | `tabs/settings/SettingsTab.tsx:16` | Tailwind | Settings loading padding |
| `sm:grid-cols-3` | `tabs/settings/ThemeGroup.tsx:61` | Tailwind | theme swatch grid |
| `sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center sm:gap-6` | `tabs/settings/parts.tsx:15` | Tailwind | settings row layout |
| `sm:grid-cols-2` | `tabs/tasks/DeliveryReview.tsx:117` | Tailwind | delivery review grid |

### 767 / 768px (`md:` ≥768)

| Breakpoint / query | Where defined | Kind | Affects |
|---|---|---|---|
| `md:grid-cols-2` | `app/AltH.tsx:172` | Tailwind | keyboard-help dialog columns |
| `md:text-[0.9375rem] md:leading-relaxed` | `app/Composer.tsx:388` | Tailwind | composer textarea type size |
| `md:inline` | `app/Header.tsx:131` | Tailwind | session task chip |
| `md:text-sm` | `components/ui/input.tsx:10`, `components/ui/textarea.tsx:9` | Tailwind | all inputs/textareas |
| `md:text-sm` ×3 | `prompts/QuestionCard.tsx:397,545,607` | Tailwind | question textareas |
| `md:inline-flex` ×2 | `tabs/lobby/TaskHeader.tsx:16,28` | Tailwind | task id/branch chips |
| `md:grid-cols-2` | `tabs/settings/SettingsForm.tsx:280` | Tailwind | settings grid |
| `md:text-xs` | `tabs/settings/ThemeGroup.tsx:218` | Tailwind | theme JSON textarea |
| `md:grid-cols-3` | `tabs/tasks/TaskBoard.tsx:37` | Tailwind | task board columns |

### 1024px (`lg:` ≥1024; `useWide` `min-width: 1024px`)

| Breakpoint / query | Where defined | Kind | Affects |
|---|---|---|---|
| `(min-width: 1024px)` | `ui/SplitPane.tsx:20` (`useWide` via `app/hooks.ts:30 useMediaQuery`) | JS matchMedia | list+detail: sheet below 1024 → two panes at ≥1024 (Tasks, Issues, Git, Quickfix, Sessions, Knowledge, Excalidraw) |
| `lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]` | `prompts/QuestionCard.tsx:371` | Tailwind | options beside focused preview |
| `lg:inline-flex` | `tabs/lobby/TaskHeader.tsx:90` | Tailwind | task-header step |
| `lg:grid-cols-2` | `tabs/metrics/Charts.tsx:62` | Tailwind | chart pair |
| `lg:grid-cols-2`, `lg:grid-cols-5`, `lg:w-auto lg:flex-1 lg:justify-end` | `tabs/metrics/MetricsTab.tsx:86,99,123` | Tailwind | metrics layout/filters |
| `lg:grid-cols-4` | `tabs/settings/ThemeGroup.tsx:61` | Tailwind | theme swatch grid |

### Others (1280, 1500, 360, 1536, non-viewport, containers)

| Breakpoint / query | Where defined | Kind | Affects |
|---|---|---|---|
| `xl:inline-flex` ×2, `xl:inline` | `tabs/lobby/TaskHeader.tsx:41,52` | Tailwind 1280 | task header tokens/branch |
| `xl:grid-cols-1`, `xl:grid-cols-2` | `tabs/settings/SettingsForm.tsx:280,577` | Tailwind 1280 | settings grids |
| `min-[1500px]:inline` ×2 | `app/Header.tsx:133,136` | Tailwind arbitrary | task state / session name |
| `min-[360px]:flex-row` | `ui/EffortSlider.tsx:145` | Tailwind arbitrary | effort slider row |
| `--breakpoint-2xl: 96rem` | `node_modules/tailwindcss/theme.css:331` | theme token | defined, no `2xl:` viewport utility used |
| `(pointer: coarse)` 16px controls | `index.css:325` | CSS media | prevents iOS zoom; overrides input/QuestionCard/composer type |
| `(pointer: coarse)` 40px hit area | `index.css:337` | CSS media | `button, [role=tab], [role=combobox], header a[aria-keyshortcuts]` minus `[role=switch]`, `[role=checkbox]`, `[data-compact]` |
| `(hover: none) and (pointer: coarse)` | `index.css:477` | CSS media | `.kbd-hint { display:none }` — key caps hidden on touch |
| `[@media(hover:none)]:opacity-100` | `tabs/plan/Draft.tsx:71` | Tailwind arbitrary | line-comment button always visible on non-hover devices |
| `(pointer: coarse)` | `app/Shell.tsx:157` | JS matchMedia | switches tab-change autofocus away from composer to `#main` |
| `(prefers-reduced-motion: reduce)` | `index.css:824,897,1041,1075,1137` | CSS media | orb/chat/site-wide/effort/brain animations |
| `(prefers-reduced-motion: reduce)` | `app/TabStrip.tsx:365` | JS matchMedia | tab liquid transition uses instant scroll |
| `(prefers-color-scheme: dark)` | `components/theme-provider.tsx:18,34,129`; `tabs/settings/ThemeGroup.tsx:29`; `app/Header.tsx:103` | JS matchMedia | theme resolution/labels |
| `(display-mode: fullscreen/standalone/minimal-ui)` | `app/install.ts:61,63` | JS matchMedia | installed-app detection |
| `@container` + `@[8rem]/@[11rem]/@[22rem]/@[28rem]/@[34rem]:` | `app/Composer.tsx:449,452,456,459,462,465,478` | Tailwind container | composer key-hint cluster |
| `@container` + `@md/@lg/@2xl/@3xl/@4xl:` | `tabs/excalidraw/ExcalidrawTab.tsx:72`; `tabs/excalidraw/SessionDetail.tsx:69,156,242,310,330`; `tabs/plan/PlanTab.tsx:56,66,83`; `tabs/plan/Roster.tsx:95` | Tailwind container | Excalidraw/Plan internal grids |

### Where phone treatment is split today

- The **≤639px** band is where "phone" is actually defined: `.surface` goes
  edge-to-edge (`index.css:380`), `.app-header` stacks (`:922`), the composer
  dock tightens (`Composer.tsx:334`), `#main` loses its margins
  (`Shell.tsx:178,198`), and the mockup arrows disappear
  (`MockupViewer.tsx:197,202`).
- At exactly **640px** the desktop-ish layout resumes: `.app-header` becomes a
  3-column grid (`index.css:936`) and all 42 `sm:` rules switch on (metrics
  3–5 columns, plan/settings 3 columns, `SheetContent sm:max-w-sm`,
  `SplitPane sm:max-w-3xl`, project branch chip).
- A separate **768px** tier sits on top (`md:`): the header task chip appears
  (`Header.tsx:131`), inputs drop to `text-sm` (`input.tsx:10`), `TaskBoard`
  becomes 3 columns (`TaskBoard.tsx:37`) — while edge-to-edge phone treatment
  already ended at 640. **The 640–767px band is an unlabelled hybrid.**
- The wide/sheet boundary is **1024px**, not 768px: `useWide`
  (`SplitPane.tsx:20`) alone decides sheet vs two-pane and is the only JS
  viewport breakpoint. The 768–1023px detail-sheet layout must be preserved by
  that constant.
- No `max-md`/`max-lg`/`width < 48rem` rules exist, so any phone rule keyed to
  `<768px` would be new; today all phone treatment is keyed to `<640px`.

---

## 5. Notes for Steps 3–5

The trickiest screens and the seams that will decide the redesign:

1. **Knowledge inline detail.** The only tab that passes `inlineDetail`
   (`KnowledgeTab.tsx:71`) and therefore the only one using `InlinePanes`
   (list over detail) below 1024px. Every other master/detail tab uses the
   right `DetailSheet`. The composer-hosted `KnowledgePaneToggle` (Chat/Docs,
   `h-6` buttons) is the only pane switch. Steps 3–5 must adapt three distinct
   narrow patterns (list-only, right sheet, inline stacked grid) without
   unifying them into a regression for ≥768px.
2. **Question cards and the mockup viewer.** Five card kinds plus four
   `sessionDialog` sub-kinds, all inside one `PRIORITY.question` popup. The
   expanded viewer is a snap-scroll carousel whose arrows are already
   `max-sm:hidden` (swipe only on phone), and `StaticPreview` is a sandboxed
   `<iframe>` of a 1200px/1024px desktop document scaled into a phone box.
   Option rows and chips are 32–36px, below the 44px target. The plan removes
   visible key hints here (`Y`/`N`, `E`, digits, arrows) but must keep the
   keyboard behaviour.
3. **Excalidraw.** No canvas is rendered in the webui: the board is an external
   link. So "Excalidraw canvas" work is really the session list/detail sheet,
   the masked `break-all` link, the `grid-cols-[6rem_minmax(0,1fr)]` fact lines,
   and the desktop-only `Overview` that does not exist below 1024px (phone with
   sessions but nothing selected shows the list alone). Do not add an embedded
   board.
4. **Wide tables and code.** `Markdown` already wraps tables (`overflow-x-auto`)
   and `<pre>` (`overflow-x-auto`); the Metrics table is a 15-column
   `max-h-80 overflow-auto` region; Git `Files` is an `overflow-x-auto` table;
   long ids/paths/URLs use `break-all`. The residual risk is inline `code` in
   `.md-body`, which was not inspected, and the cramped 320px reading of these
   bounded scrollers. Verify no page-wide horizontal scroll at 320px.
5. **Sticky headers vs "titles scroll away".** `SplitPane`'s `PaneHeader` is
   `sticky top-0`, `ActionBar` is `sticky -top-5`, and `PlanHeader`/`TaskHeader`
   are `shrink-0`; the plan wants page titles and tools to scroll away on
   phones. These shared surfaces are reused by most tabs, so the change must be
   phone-scoped and leave the ≥768px layout as-is.
6. **Bottom dock and `--composer-h`.** Today the value measures only the
   composer card (no carousel) and already includes the composer's safe-area
   padding; the orb adds safe-area again and the Toaster has none. Step 3 must
   measure the **whole dock** (carousel/handle + composer + spacing) exactly
   once, and keep last rows, jump controls, toasts and the orb clear of it.
7. **Metrics.** It exists in the registry and is a normal `TabId`; nothing
   filters it out yet. The phone carousel must skip it without renumbering the
   others (numbers are `index + 1` over `visibleTabs`), and explicit `#/metrics`
   routes should show the unavailable-on-phone notice with a Lobby action while
   the ≥768px screen is untouched.
8. **Shortcut UI.** Visible key caps and chords exist across `ActionButton`/
   `ActionBar`, `ConfirmButton`, `Sheet` close, `QuestionCard`, `MockupViewer`,
   the Plan intro, Metrics `SearchBox` and the composer `KeyHint`s. Removal on
   phones must be width-based; `.kbd-hint` is hidden only by
   `(hover:none) and (pointer:coarse)`, i.e. by device, so a narrow non-touch
   window still shows everything. Hardware keyboard and `aria-keyshortcuts`
   must survive.
9. **No software-keyboard handling.** There is no `visualViewport`/
   `innerHeight`/`dvh` logic and the shell is `height:100%; overflow:hidden`;
   the composer autosize and dock need explicit keyboard-aware behaviour.
10. **Touch targets.** The floor in code is 40px (`--control-target`), not 44px,
    and `data-compact` controls (composer tools/Send, target pills) are excluded
    from even that. Rows are `min-h-10` (40px), Knowledge leaves `min-h-9`
    (36px), `KnowledgePaneToggle`/`Roster` chips are smaller still.

---

## 6. Discrepancies between the plan's assumptions and the code

1. **The `<768px` phone boundary does not exist.** All phone treatment is keyed
   to `<640px` (`index.css:380,922`; 12 `max-sm:`, 42 `sm:`), and the 640–767px
   band is an unlabelled hybrid. The plan's "consistent below-768px boundary"
   is new work.
2. **The detail sheet boundary is 1024px**, not 768px (`SplitPane.tsx:20`).
   The 768–1023px sheet layout is what must be preserved, and it is already
   "phone-like" (one Lobby pane, Tasks detail as a sheet).
3. **Metrics filtering, the phone carousel, bottom dock, 500ms commit delay,
   spring selection transitions and sound ticks do not exist yet.**
   `TabStrip` is rendered only in the header (`Shell.tsx:175`); the composer
   dock contains only the composer; `--composer-h` measures that composer card
   (`Composer.tsx:188-203`). Expected — they are the planned work.
4. **Page titles/tools do not scroll away today.** `PaneHeader` is
   `sticky top-0`, `ActionBar` is `sticky -top-5`, and `PlanHeader`/`TaskHeader`
   are `shrink-0`.
5. **Thinking orb/pane is global**, not Lobby-only: `Shell.tsx:211` renders
   `<Thinking status lobby />` on every route, including the sign-in shell.
6. **Reconnecting is global**, not per-tab: it is `ReconnectingState` in the
   Shell `Banner`; the tabs own only Connecting/`LoadingState` and `ErrorState`.
7. **"Drafts survive crossing 768px" holds only in-app**: the draft is one
   Shell-level `useState("")` (`Composer.tsx:152`) with no storage and no
   per-tab draft, so a reload loses it and all tabs share one draft.
8. **Toolbar/row targets are 40px, not 44px**, on coarse pointers
   (`--control-target: 40px`, `index.css:337-350,491`), and `data-compact`
   controls are excluded; `--touch-target: 44px` is used only by the orb.
9. **Safe-area is inconsistent / double-counted**: `--composer-h` includes the
   dock's `env(safe-area-inset-bottom)` (`Composer.tsx:334`) while
   `.thinking-bubble` adds it again (`index.css:598`) and `Toaster` omits it
   (`toaster.tsx:33`).
10. **Excalidraw `Overview` is desktop-only** (`ExcalidrawTab.tsx:74-76`): a
    phone with sessions and nothing selected gets the list alone, with no
    overview and no empty-detail hint.
11. **Git has no diff renderer**: `Files` is a path/size table and code blocks
    appear only inside Markdown bodies.
12. **Attachment images have no in-app preview dialog**: `AttachmentList` opens
    `/files/preview/attachments/<id>` in a new browser tab; the only in-app
    preview surface is the question Preview/`MockupViewer`.
13. **Visible shortcut UI is only partly suppressed on phones**: `.kbd-hint` is
    hidden by input device, not width, so `Keys` rendered without that class
    (ActionBars, confirm dialogs, Sheet close, Plan intro, Metrics search)
    remain visible in narrow non-touch windows.
14. **Plan and Issues do not decode their route segments** (`registry.tsx:55`
    passes raw `rest`), unlike sessions/quickfix/excalidraw (`detailId`).
15. **Phone baseline captures are incomplete**: `test/web/phone-baseline/`
    covers only lobby, tasks, plan, issues, quickfix and the git list at
    768/800/1024/1280, light theme; there are no knowledge, excalidraw or
    metrics captures and no detail/overlay captures. Plan step 1's "capture the
    larger layouts" is unmet for those.
