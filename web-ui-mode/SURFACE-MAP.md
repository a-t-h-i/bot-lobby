# Surface map

Where each part of the terminal lobby goes in the web UI. Three tables:
1. **Files:** every file of the terminal lobby, and what happens to it.
2. **Data the terminal assembles inside `view.ts`:** what moves to the service so the web can have it.
3. **View models to split out of the tab files (P1-03).**

Sizes are line counts at commit `0a2c14d`.

## 1. Files

**Status:**
- **KEEP:** unchanged, and the web uses it as it is.
- **SPLIT:** the data part moves out (§3), and the string rendering stays.
- **SERVICE:** its logic moves into or behind `LobbyService` (P1-01).
- **TERMINAL:** terminal-only. The web has its own version and does not import this file.

| File | Lines | Status | Web counterpart |
| --- | ---: | --- | --- |
| `src/lobby/runtime.ts` | 1,006 | SERVICE | `createLobbyService` (P1-01), topics (P1-02), `startLobbyService` / `mountTerminalLobby` (P1-05) |
| `src/lobby/view.ts` | 3,013 | TERMINAL, plus §2 | `webui/src/app/*`, `webui/src/tabs/*` |
| `src/lobby/layout.ts` | 496 | TERMINAL | CSS layouts (D-09) |
| `src/lobby/split.ts` | 230 | KEEP | the plan split runs in the service (W-76) |
| `src/lobby/feed.ts` | 389 | KEEP | `lobby` topic, `feed` / `reply` deltas (P2-04) |
| `src/lobby/sessions.ts` | 328 | KEEP | `sessions.*` calls (P2-05, P2-06) |
| `src/lobby/session-files.ts` | 275 | KEEP | `sessions.chat` |
| `src/lobby/quickfix.ts` | 402 | KEEP | `quickfix.*` |
| `src/lobby/planner.ts` | 1,074 | KEEP | `planner.*` |
| `src/lobby/pulls.ts`, `pr-review.ts`, `issues.ts` | 250, 360, 227 | KEEP | `git.*`, `issues.*` |
| `src/lobby/knowledge.ts` | 179 | KEEP | `knowledge.*` |
| `src/lobby/ask.ts` | 137 | KEEP | the panel's questions become prompts (P1-04) |
| `src/lobby/mini.ts` | 159 | KEEP, plus the web link (P2-08) | header task state (P3-02) |
| `src/lobby/markdown.ts` | 121 | TERMINAL | `webui/src/lib/markdown.ts` (marked + DOMPurify) |
| `src/lobby/keys.ts` | 54 | KEEP (the action table) | desktop shortcuts read the same names (P5-04) |
| `src/lobby/theme.ts` | 30 | TERMINAL | CSS tokens (P3-01) |
| `src/lobby/tabs/home.ts` | 544 | SPLIT | `webui/src/tabs/lobby/` |
| `src/lobby/tabs/tasks.ts` | 412 | SPLIT | `webui/src/tabs/tasks/` |
| `src/lobby/tabs/plan.ts` | 262 | SPLIT | `webui/src/tabs/plan/` |
| `src/lobby/tabs/quickfix.ts` | 136 | SPLIT | `webui/src/tabs/quickfix/` |
| `src/lobby/tabs/metrics.ts` | 302 | SPLIT | `webui/src/tabs/metrics/` |
| `src/lobby/tabs/git.ts` | 162 | SPLIT | `webui/src/tabs/git/` |
| `src/lobby/tabs/knowledge.ts` | 135 | SPLIT | `webui/src/tabs/knowledge/` |
| `src/lobby/tabs/excalidraw.ts` | 95 | SPLIT | `webui/src/tabs/excalidraw/` |
| `src/lobby/tabs/issues.ts` | 73 | SPLIT | `webui/src/tabs/issues/` |
| `src/ask/dialog.ts`, `view.ts`, `image.ts`, `png.ts` | | TERMINAL (the drawing) | `webui/src/prompts/` (P3-06) |
| `src/ask/types.ts`, `relay.ts`, `tool.ts`, `state.ts` | | KEEP | the prompt hub (P1-04) |
| `src/pi/settings-ui.ts` | | TERMINAL (the dialogs) | `webui/src/tabs/settings/` (P5-01), on the same config functions |
| `src/pi/ui.ts` | | KEEP | `taskSnapshot`, `onRunUpdates`, `currentZenTask` feed the `lobby` topic |
| `src/state/*` | | KEEP | read by the service exactly as today |

## 2. Data the terminal assembles inside `view.ts`

`view.ts` builds several inputs for its tabs in private methods. The web needs the same data, so each moves to `src/lobby/models/` and is called by both (P1-03):

| Today (in `LobbyView`) | Builds | Moves to |
| --- | --- | --- |
| `planView(session)`, `seatViews(session)` (`view.ts:2732–2764`) | `PlanView`, `SeatView[]` for the Plan tab | `models/plan.ts` |
| `metricsFigures(query)` (`view.ts:2197`) | records, groups (`aggregateMetrics`, `sortGroups`), `taskTimesByModel`, `taskStats`, `summarizeClassifier` | `models/metrics.ts` (the functions themselves are already pure, in `src/state/metrics.ts`) |
| `taskRowList()` (`view.ts:2215`) | `taskRows(...)` with names of live sessions and `filterRows` | `models/tasks.ts` |
| the Lobby tab's input (`viewedEntry()`, chat, activity, thoughts per viewed session) | `HomeInput` | `models/lobby.ts` |
| the Excalidraw tab's input (sessions, selected, agents) | `ExcalidrawTabInput` | `models/excalidraw.ts`, with links masked |
| the Git tab's input (pulls, details, reviews, reads) | `GitTabInput` | `models/git.ts` |

## 3. View models to split out of the tab files

Functions already pure and data-only **move as they are**. Functions that mix data and strings are **split**.

| File | Function | Kind | Action |
| --- | --- | --- | --- |
| `tabs/tasks.ts` | `TaskRow`, `RowContext`, `checkState`, `taskProgress`, `taskRows`, `filterRows` | data | move to `models/tasks.ts` (re-export from `tabs/tasks.ts` so imports keep working) |
| `tabs/tasks.ts` | `stateWords`, `ownerLabel` | words | move: the web shows the same words |
| `tabs/home.ts` | `filterFeed`, `currentThought` | data | move to `models/lobby.ts` |
| `tabs/home.ts` | `activityLine`, `chatLines`, `thoughtLines`, … | strings | stay |
| `tabs/plan.ts` | `SeatView`, `PlanView`, `roundLabel` | data, words | move to `models/plan.ts` |
| `tabs/plan.ts` | `draftLines` | mixed: it finds the draft's commentable lines **and** wraps them | split: `draftItems(view)` (data, the line ids the web comments on) and the wrapping (stays) |
| `tabs/quickfix.ts` | `newestFirst`, `filterJobs` | data | move to `models/quickfix.ts` |
| `tabs/quickfix.ts` | `elapsed` | words | move (the web shows the same "2m 10s") |
| `tabs/metrics.ts` | `filterRecords` | data | move to `models/metrics.ts` |
| `tabs/metrics.ts` | `percent`, `duration`, `money`, `millis`, `status` | words | move to `models/format.ts`; the page has its own formatter but must match (a test compares them on fixtures) |
| `tabs/knowledge.ts` | `sizeWords` | words | move |
| `tabs/git.ts` | `changeSize` | mixed (colour) | split: `changeSizeWords` (data) and the colouring (stays) |
| `tabs/excalidraw.ts` | the detail's status words (reached, people, elements, key fit) | words | move to `models/excalidraw.ts` |

**Rules:**
- **A model never imports `@earendil-works/pi-tui` or a theme.** A test scans `src/lobby/models/` for such imports.
- **The page imports types only.** Models run on the server. The page receives their results as JSON, and imports only their types, through `src/webui/protocol.ts`.
