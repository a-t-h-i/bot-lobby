# Architecture

How the web UI fits into bot-lobby. Read [DECISIONS.md](DECISIONS.md) first: this file shows how the decisions fit together. Paths are in this repository.

## 1. Shape

```
┌──────────────────────────── Pi process (one terminal window) ────────────────────────────┐
│ bot-lobby extension (src/index.ts)                                                        │
│                                                                                           │
│  engine, agents, state …   unchanged (src/workflow, src/master, src/state, …)             │
│                                                                                           │
│  src/lobby/runtime.ts      per Pi session: builds the stores and the service              │
│  src/lobby/service.ts      LobbyService: every read and action, no terminal  (D-05)       │
│  src/lobby/topics.ts       which topic changed: the feed, runs, stores, files (§4)        │
│  src/lobby/prompts.ts      questions offered to every surface, first answer wins (D-13)   │
│  src/lobby/models/         pure view models shared by both UIs                (D-06)      │
│        │                                │                                                 │
│        ▼                                ▼                                                 │
│  terminal lobby (view.ts, tabs/*)   src/webui/  the local server  (D-04, D-11, D-12)      │
│  LobbyHost = service + terminal     server.ts  auth.ts  static.ts  events.ts  api/*.ts    │
│  bits (rows, theme, keys, …)        protocol.ts (types shared with the page)              │
└────────────────────────────────────────────▲──────────────────────────────────────────────┘
                                             │ 127.0.0.1:<port>
                                             │ POST /api/<group>.<action>  (JSON, cookie)
                                             │ GET  /api/events            (server-sent events)
                                             │ GET  /, /app-<hash>.js …    (webui/dist)
┌────────────────────────────────────────────┴──────────────────────────────────────────────┐
│ the page (any browser on this machine: desktop, or Chrome on the phone running Termux)    │
│ webui/src/                                                                                │
│   lib/       api.ts (calls, sign-in), events.ts (EventSource), store.ts (topics → state),  │
│              markdown.ts (marked + DOMPurify), format.ts (times, sizes, money)            │
│   app/       shell: header, tabs (bottom bar / top / side), routing, layouts, toasts      │
│   ui/        components: Button, Sheet, Tabs, List, Badge, Empty, Markdown, Chart …        │
│   tabs/      lobby · tasks · plan · quickfix · metrics · git · knowledge · excalidraw ·   │
│              issues · sessions · settings                                                 │
│   prompts/   the questionnaire and dialogs (D-13)                                         │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. What is added to the repository

```
bot-lobby/
├── src/lobby/service.ts        LobbyService interface + createLobbyService(state)   (P1-01)
├── src/lobby/topics.ts         Topic, LobbyTopics (an emitter with versions)        (P1-02)
├── src/lobby/prompts.ts        PromptHub: surfaces, pending prompts, first answer   (P1-04)
├── src/lobby/models/           view models split out of tabs/*.ts                   (P1-03)
├── src/webui/
│   ├── protocol.ts             every call's request/result, stream events, topics    (P2-03)
│   ├── server.ts               listen, route, lifecycle, rebind on session switch    (P2-01)
│   ├── auth.ts                 secret file, link token, cookie, Host/Origin checks   (P2-02)
│   ├── static.ts               webui/dist with CSP and caching                       (P2-01)
│   ├── events.ts               the SSE stream: hello, changed, deltas, coalescing    (P2-04)
│   ├── api/<group>.ts          one file per group in §5                              (P2-05, P2-06)
│   ├── files.ts                preview images                                        (P2-07)
│   ├── open.ts                 open the link in a browser (Termux, macOS, …)         (P2-08)
│   ├── command.ts              /bot-lobby web …                                      (P2-08)
│   └── dev/                    mock server + fixtures for working on the page         (P2-09)
├── webui/
│   ├── src/                    the page (§6)
│   ├── dist/                   built page, committed (D-08)
│   ├── build.mjs               esbuild → dist/, content-hashed, writes dist/build.json
│   └── tsconfig.json           DOM + JSX settings for the page
├── test/webui-*.test.ts        server, auth, events, api, models
└── test/web/                   Playwright checks against the mock server (TESTING §4)
```

`package.json` gains:
- `webui/dist` in `files`;
- the scripts `web:build`, `web:dev` and `web:check`;
- the page's libraries as devDependencies (D-08).

## 3. The service seam (Phase 1)

`LobbyHost` (`src/lobby/view.ts:139`) has about 60 members. Each is sorted into one of three places.

**In `LobbyService`** (shared, no terminal):

| Group | Members today in `LobbyHost` |
| --- | --- |
| Session | `sessionId`, `sessionName`, `workspace`, `refreshWorkspace`, `masterBusy`, `zen` (the task and its runs), `feed` |
| Oracle | `toOracle`, `abortMaster`, `chatHistory` |
| Tasks and plans | `tasks`, `plans`, `comments`, `comment`, `startPlanned`, `discardPlan`, `archivedTasks`, `archiveTask`, `restoreTask`, `deleteTask`, `isAuto`, `setAuto`, `sendToTask` |
| Sessions | `sessions`, `startSession`, `answerDialog` (split: the dialog data and `answer` go to the service, putting it on screen stays with the terminal), `sendToSession`, `liveSessions`, `switchTo`, `sessionChat`, `hasOlderChat` |
| Planning | `planner`, `newPlanner`, `answerPanel`, `savePlan`, `defaultPanel`, `planningRounds`, `seatLabel` |
| Quick fix, Git, knowledge, Excalidraw, Issues | `quickfix`, `issues`, `issuesEnabled`, `pulls`, `reviews`, `knowledge`, `excalidraw`, `checkExcalidraw` |
| Metrics, models | `metrics`, `classifierMetrics`, `profileLabel` |

**Terminal only** (they stay on `LobbyHost`): `rows`, `theme`, `hide`, `requestRender`, `now`, `keys`, `panels`, `savePanels`, `editText`, `openSettings`.

**Rules for the split:**
- `createLobbyService(state)` is built in `initLobby` from the same `Runtime` object `host()` uses today. `host()` becomes `{ ...service, ...terminalBits }`.
- **Stateful objects are exposed as they are.** The quick-fix queue, planner, `PullsState`, `PullReviews`, `KnowledgeBook` and `ExcalidrawBook` are not wrapped in new methods. The web API calls their methods directly, as the terminal's key handlers do.
- **`answerPanel` and `savePlan` go through the prompt hub** (§7), not `panelAsker` alone.
- **The service starts in any interactive session.** Today `initLobby` returns unless `ctx.mode === "tui"` (`runtime.ts:830`). Phase 1 splits it:
  - `startLobbyService()` runs when the mode is `tui`, or when the web server is on;
  - `mountTerminalLobby()` (the anchor widget, the overlay) runs only in `tui` mode.

## 4. Change notifications (topics)

Today every store calls `rerender()` and the terminal repaints everything. The web cannot reread everything 25 times a second, so each change is tagged with a topic (`src/lobby/topics.ts`):

| Source of the change | Topic | Delta sent with it |
| --- | --- | --- |
| `lobbyFeed.onChange` (chat, activity, thoughts, the streaming reply) | `lobby` | `feed`: new entries after the page's last id. `reply`: the reply's text so far |
| `onRunUpdates`, task transitions (`onTransition`) | `lobby`, `tasks` | none |
| task, plan, comment, archive files (polled every 2 s while a page is connected) | `tasks`, `plans` | none |
| `QuickFixQueue` `onChange` | `quickfix` | none |
| `PlanningSession` `onChange`, `onRound` | `planner` | none |
| `SessionRegistry` `sessionsChanged`, background session feeds | `sessions` | the feed delta for the session being viewed |
| `appendMetrics`, metrics files (polled) | `metrics` | none |
| `PullsState`, `PullReviews`, `IssuesState` `onChange` | `git` (and `issues`) | none |
| `KnowledgeBook` writes | `knowledge` | none |
| `ExcalidrawBook` writes, check results | `excalidraw` | none |
| the prompt hub (opened, answered, withdrawn) | `prompts` | none |
| `ctx.ui.notify` from bot-lobby, owner events | `notices` | the notice text and level |
| busy/idle, `ui_prompt_start` / `ui_prompt_end`, workspace, model | `status` | none |

**How it works:**
- `LobbyTopics` keeps a version per topic. The terminal subscribes to everything and calls `rerender()`, which is today's behaviour.
- The server subscribes and coalesces to one message per topic per 40 ms (`FRAME_MS`).
- File-backed topics are polled only while at least one page is connected, as the terminal reads files only while it is open (`DATA_REFRESH_MS`).

## 5. The API

**Conventions:**
- Every call is `POST /api/<group>.<action>` with a JSON object body.
- Answers are `{ ok: true, result }` or `{ ok: false, error, code }`, where `code` is one of `bad_request`, `unauthorized`, `forbidden`, `not_found`, `unsupported`, `too_large`, `conflict` or `failed`.
- Requests are validated with TypeBox schemas (bot-lobby already depends on `typebox`) before the handler runs.
- Actions answer with the same notice text the terminal shows (`"comment sent to the oracle — it will amend the plan"`), and the page shows it as a toast.

| Group | Calls (request → result) | Backed by |
| --- | --- | --- |
| `auth` | `login {token}` → sets the cookie · `logout` | `src/webui/auth.ts` |
| `status` | `get` → workspace, branch, session name/id, busy, a terminal dialog open, server port, other windows' links | service: Session group, `ui_prompt_*` |
| `lobby` | `snapshot` → task header and steps, runs, chat (newest 100), reply, activity (400), thoughts (40), older-history flag · `history {before}` → older chat · `send {text}` → notice · `abort` | `zen`, `feed`, `chatHistory`, `toOracle`, `abortMaster` |
| `tasks` | `list` → task rows (`taskRows` view model) · `archived` · `comments {taskId}` · `comment {taskId, text}` · `archive`, `restore`, `delete {taskId, where}` · `auto {taskId, on}` · `message {taskId, text}` | Tasks group |
| `plans` | `start {planId, where: "here" \| "session", auto?}` · `discard {planId}` | `startPlanned`, `startSession`, `discardPlan` |
| `sessions` | `list` → background sessions with status and dialogs, plus live sessions in other terminals · `chat {sessionId, before?}` · `start {request \| planId, auto?}` · `stop {key}` · `message {sessionId \| key, text}` · `switch {target}` · `answer {key, dialogId, answer}` | Sessions group, `BackgroundSession.answer` |
| `planner` | `get` → seats, members' states, messages, draft, questions, notes, round, limit, retryable · `new {seed?, seats?}` · `send {text}` · `toggleSeat {member}` · `retry` · `commentLine {line, text}` · `answer` (opens the questions through the prompt hub) · `save` | `PlanningSession` |
| `quickfix` | `list` → jobs newest first · `submit {text}` · `cancel {id}` · `runAnyway {id}` · `movedToTask {id}` | `QuickFixQueue` |
| `metrics` | `get {groupBy, query?}` → tiles, groups, time share, classifier summary | `readMetrics`, `tabs/metrics.ts` models |
| `git` | `pulls` (refreshes) · `pull {number}` → detail, review, Jev read · `review {number, focus?}` · `cancelReview {number}` · `jev {number}` | `PullsState`, `PullReviews` |
| `issues` | `list` · `get {number}` · `create {text}` (only when `lobby.issues`) | `IssuesState` |
| `knowledge` | `files` · `open {agent, file}` → entries with refs and notes · `edit`, `add`, `remove {agent, file, ref, text?}` · `replaceFile {agent, file, text}` · `comment {agent, file, ref, text}` · `unnote {id}` | `KnowledgeBook` (its stale-entry refusal becomes `conflict`) |
| `excalidraw` | `list` → sessions with **masked** links · `add {link, name?}` · `create {name?}` · `remove`, `rename`, `toggleAgent`, `toggleAll`, `toggleContribute` · `check {id}` · `reveal {id}` → the full link (separate call, D-12) | `ExcalidrawBook`, `checkSession` |
| `prompts` | `list` → open questions with their kind and payload · `answer {id, answer}` · `dismiss {id}` | `src/lobby/prompts.ts` |
| `settings` | `get` → config + the models Pi offers · `set {patch}` (validated by `resolveConfig`, `src/schemas/configuration.ts`) | P5-01 |

**Not under `/api`:**
- `GET /api/events` is the stream (§4, D-11).
- `GET /files/preview/<task>/<name>` serves preview images, only files under `previewDir(task)` (`src/ask/relay.ts`), and only image types (P2-07).

## 6. The page

- **State.**
  - `lib/store.ts` keeps one record per topic: `{ version, data, loading, error }`.
  - On `hello`, it rereads the topics the current screen uses. On `changed`, it rereads that topic if a screen uses it, and otherwise marks it stale.
  - Deltas (`feed`, `reply`) patch the `lobby` record in place.
- **Routing:** the hash is the route, so a reload keeps the place:
  - `#/lobby`, `#/tasks`, `#/tasks/<id>`, `#/plan`, `#/quickfix/<id>`;
  - `#/metrics`, `#/git/<number>`, `#/knowledge/<agent>/<file>`, `#/excalidraw/<id>`;
  - `#/issues`, `#/sessions/<key>`, `#/settings`.
- **Layouts (D-09).**
  - **Phones:** each tab is one column. Selecting an item opens its detail as a full-screen sheet with a back button.
  - **Tablets:** list and detail sit side by side when there is room, otherwise the detail slides over.
  - **Desktop:** the terminal's arrangement.
- **The composer** is one component used by the Lobby, Plan, Quick fix and session views.
  - **Keys:** Enter sends with a physical keyboard; on touch, Enter is a new line and the button sends; Shift+Enter is always a new line.
  - **While the oracle works:** it steers, with a Stop button beside it.
- **Markdown** goes through `ui/Markdown.tsx` only (D-10). Code blocks get a copy button, and wide tables scroll in their box.
- **Connection.**
  - The header shows Live, Working, Reconnecting… or "Pi is not reachable".
  - A reconnect rereads everything.
  - A 401 shows the sign-in page ("run `/bot-lobby web` in Pi for the link").

## 7. Questions (the prompt hub)

```
engine / tool / planner           PromptHub (src/lobby/prompts.ts)          surfaces
 ask_user_question ─┐            ┌─ open(kind, payload, signal) ─────────┬─▶ terminal: our custom() questionnaire,
 choose (approval) ─┼──────────▶ │  id, created, from                    │            select/confirm/input with a signal
 panel / split     ─┤            │  first answer resolves, the rest are  └─▶ web: topic `prompts` → page shows a sheet;
 background dialog ─┘            └─ withdrawn (done()/abort)                      POST prompts.answer {id, answer}
```

- **Kinds:**
  - `questionnaire`: `AskQuestion[]`, answered with an `AskResult`;
  - `choose`: a title and options, answered with one option;
  - `text`: a title and an optional prefill, answered with text;
  - `confirm`;
  - `sessionDialog`: a background session's `SessionDialog`, answered by `BackgroundSession.answer`.
- **Surfaces.** The terminal surface exists only in `tui` mode. The web surface counts only while a page is connected, so with no page open, behaviour is exactly today's.
- **Cancelling.** A prompt whose caller's `signal` aborts is withdrawn everywhere, for example when the task is cancelled.
- **Images.** The questionnaire's option images become `/files/preview/…` URLs in the web payload. The terminal keeps file paths.
- **Questions the hub does not own:** Pi's own dialogs and other extensions' dialogs. The page shows a banner from `ui_prompt_start` / `ui_prompt_end` while one is open.

## 8. Lifetime

**Starting and stopping:**
- **Start:** `/bot-lobby web`, or `lobby.web.enabled` on `session_start`. One server per process, held in a module-level variable like the session registry.
- **Session switch:** `session_shutdown` does not stop the server. The new session's `initLobby` calls `server.rebind(service)`, which detaches the old topics, attaches the new ones and sends `hello` with new versions. Open pages reread everything.
- **Stop:** `/bot-lobby web stop`, or the process exits (`process.once("exit")`, like `SessionRegistry`).

**Ports and links:**
- **Ports:** the server tries `lobby.web.port` (7347), then up to 20 more. The port in use goes into this session's presence file, so other windows' pages can link to it.
- **The link:** printed with `ctx.ui.notify` (and opened, D-15), and shown in the status line under the editor while the lobby is hidden.

**Terminal safety:**
- **No output:** the server writes nothing to stdout or stderr, which would corrupt Pi's screen. Errors go to `lobbyFeed.log("LOBBY", …)`, which the activity log shows.

## 9. Fences that must have tests

Each of these has a test before its phase ends:
1. Every fence in D-12 (the starter's `test/server.test.ts` covers 1–6).
2. **No secrets in responses:** no full Excalidraw link except from `excalidraw.reveal`, and no `web.json` secret, API key or token in any response. The test scans every fixture response.
3. `/files/preview` serves nothing outside `previewDir`, and nothing that is not an image.
4. Only `ui/Markdown.tsx` uses `dangerouslySetInnerHTML` (a source scan).
5. The server never writes to stdout or stderr (a test runs it with both streams spied).
6. With no page connected, the prompt hub behaves exactly as today: the terminal surface only, and the same results.
7. **Session switch:** pages stay connected, get `hello` and see the new session's data.

## 10. Sizes and speed

- **Feed caps:**
  - the feed keeps 400 activity entries, 40 thoughts and 100 chat messages (`MAX_ACTIVITY`, `MAX_THOUGHTS`, `MAX_CHAT`), so a snapshot is bounded;
  - older chat is paged with `lobby.history`.
- **The streaming reply** goes out in frames of 40 ms or more. Each frame carries the reply's text so far, at most `MAX_REPLY_TEXT` (8,000 characters), not a diff. That is simple and survives a dropped frame.
- **Rendering cost on phones:** the page re-renders only the reply's Markdown while it streams. The other messages are memoised by id.
- **First load:** under 150 KB gzipped (D-07). Syntax highlighting and Mermaid load on first use.
