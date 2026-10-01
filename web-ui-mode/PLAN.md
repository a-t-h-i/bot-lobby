# Plan

Phases 0–5 deliver the localhost web UI at parity with the terminal lobby. Phase 6 is the later standalone app and is not scheduled.

Every task is a card with these fields:
- **Lane:** A · service (`src/lobby`), B · server (`src/webui`), C · page (`webui/`), D · infra, tests and design.
- **Depends on:** the tasks that must be merged first.
- **Owns:** the paths the task may change. Touching others needs the coordinator's agreement.
- **Starts from:** the starter or source to begin with.
- **Do** and **Done when:** the work and its acceptance criteria.

Every card also has to meet [AGENT-GUIDE.md](AGENT-GUIDE.md) §6, the definition of done.

## Rules for every task

1. **Claim before starting.** Set the task to `in progress: <agent>` in `docs/web-ui/status.md`. One agent per task.
2. **One task, one PR, on a branch named `web/<task-id>-<slug>`.** The commit message starts with the task id. Commit as `a-t-h-i <aonlysmith@gmail.com>`, with no co-author trailers.
3. **The terminal keeps working.** `npm test` and `npm run typecheck` pass on every PR, and no existing test changes its assertions unless the card says so.
4. **No behaviour change outside the web UI** unless the card says so.
5. **Keep the status file current:** update `docs/web-ui/status.md` and the touched rows of `docs/web-ui/parity.md`. P0-01 copies both from this folder.

## The phases at a glance

| Phase | Goal | Ends with |
| --- | --- | --- |
| **0 · Groundwork** | Toolchain, the design, and spikes that settle what could change the plan | Spike notes; approved wireframes |
| **1 · The service seam** | The terminal lobby runs on `LobbyService`, topics and the prompt hub, with no visible change | All existing tests green; P1-X review |
| **2 · The server** | `/bot-lobby web` serves an authenticated API and stream over the real service | P2-X: curl walkthrough and security tests |
| **3 · Shell, Lobby tab, questions** | A usable web lobby on tablet and desktop | **P3-X: first usable release** (opt-in) |
| **4 · Every other tab** | Parity with the terminal | P4-X parity walkthrough |
| **5 · Settings, notifications, app** | Settings, browser notifications, installable PWA, accessibility, release | P5-07 release |
| **6 · Standalone (later)** | A headless host and an Electron app | not scheduled |

**Parallelism:**
- Phase 0's spikes run in parallel.
- Phase 1 is mostly serial, since all of it touches `runtime.ts`.
- From P2-03 and P2-09 on, Lane B (server) and Lane C (page) run in parallel: the page builds against the mock server while the server fills in the real API.
- In Phase 4, each tab is its own task.

---

## Phase 0 · Groundwork

### P0-01 · Workspace and toolchain (Vite + shadcn)
- **Lane:** D · **Depends on:** none · **Owns:** `webui/` (new), `package.json`, `tsconfig.json`, `.gitignore`, `docs/web-ui/` (new)
- **Starts from:** `web-ui-mode/starter/` (`tsconfig.json`, `package.json`).
- **Do:**
  1. Create `webui/` with `src/`, `index.html`, `vite.config.ts` and its own `tsconfig.json` (DOM, JSX for React, `noEmit`).
  2. Set it up with `shadcn init -t vite -b radix`, and pin the devDependencies exactly: `vite` 8, `react` 19.3, `radix-ui`, `tailwindcss` 4, `marked`, `dompurify`, `playwright-core`. Check every package against npm and the shadcn registry, including `Questionnaire`; if one does not exist, say so, and build the slideout from RadioGroup, Checkbox and Card instead.
  3. Prove the CSP nonce reaches Radix's injected `<style>` before Phase 3: the nonce is passed in a `<meta>` tag and set on `window.__webpack_nonce__` before any Radix portal mounts.
  4. The Vite build writes `dist/build.json`: a hash of the sources **and** `index.html`, the build time and the file names.
  5. Add the scripts:
     - `web:build`;
     - `web:dev` (a placeholder until P2-09);
     - `web:check` (the Playwright checks, P3-X);
     - `check` = `typecheck` + `web:typecheck` + `test`.
  6. Add `webui/dist` to `files`. Add a test (`test/webui-dist.test.ts`) that fails when the `dist/` hash does not match the sources (D-08).
  7. Copy `STATUS-TEMPLATE.md` → `docs/web-ui/status.md`, and FEATURE-INVENTORY → `docs/web-ui/parity.md`.
- **Done when:**
  - a placeholder page builds to `webui/dist/`;
  - the staleness test fails after editing a source without rebuilding, and passes after;
  - `npm pack --dry-run` lists `webui/dist/*`.

### P0-02 · Spike: a server inside Pi's TUI process
- **Lane:** B · **Depends on:** none · **Owns:** `docs/web-ui/spikes/p0-02-server-in-pi.md`, a throwaway branch
- **Do:**
  1. In a throwaway branch, start the starter's server from bot-lobby's `session_start`, with the fake service and the real `webui/dist` or the starter's.
  2. Run Pi interactively (tmux is fine), and check:
     - nothing reaches the screen;
     - the server survives `/resume` to another session and `/bot-lobby switch`;
     - it closes on exit (no port left open);
     - `/reload` re-runs the extension without leaving the old server on its port;
     - two Pi windows get two ports;
     - Pi's TUI stays responsive while a page streams.
  3. Note how `ctx.ui.notify` shows a long link, and whether the terminal makes it clickable.
- **Done when:** the spike note answers each point, with commands and output.

### P0-04 · Spike: answering questions in two places
- **Lane:** A · **Depends on:** none · **Owns:** `docs/web-ui/spikes/p0-04-prompts.md`, a throwaway branch
- **Do:** prove each withdrawal path in D-13 against Pi 0.87:
  1. close our `ctx.ui.custom()` questionnaire from outside with `done()`;
  2. dismiss `select`, `confirm` and `input` with `signal`;
  3. settle what to do with `ctx.ui.editor()`, which takes no signal. Try bot-lobby's own multi-line component in `custom()`, and otherwise leave `text` prompts in the terminal while a terminal is present;
  4. what happens to a background session's TUI dialog when the web answers first;
  5. that `ui_prompt_start` / `ui_prompt_end` fire for each kind.
- **Done when:** the note confirms or replaces D-13, with the code that worked.

### P0-05 · Spike: the event stream under desktop and tablet emulation
- **Lane:** C · **Depends on:** none · **Owns:** `docs/web-ui/spikes/p0-05-stream.md`
- **Do:** with the starter, measure under Chromium's desktop and tablet emulation:
  1. reconnect time after the page is backgrounded and after Pi restarts;
  2. that `hello` after a reconnect is enough to resync;
  3. CPU use during a long streamed reply at 40 ms frames, compared with 80 ms;
  4. the six-connections-per-origin limit with several tabs open (one stream per tab).
- **Done when:** the note gives the frame time and heartbeat to use, and says whether `Last-Event-ID` is needed.

### P0-06 · Spike: the lobby without a terminal
- **Lane:** A · **Depends on:** none · **Owns:** `docs/web-ui/spikes/p0-06-headless.md`
- **Do:** list everything in `src/lobby/runtime.ts` and the stores it builds that needs a `TUI`, `ctx.ui` or `ctx.mode === "tui"`. For each, say whether the service can do without it (P1-05) and what a headless host would need (Phase 6). Run Pi with `--mode rpc` and confirm `ctx.mode` and `ctx.hasUI` (PI-NOTES §1).
- **Done when:** the note has the list and a recommendation for P1-05.

### P0-07 · Design: wireframes, in batches
- **Lane:** D · **Depends on:** none · **Owns:** `docs/web-ui/design/`
- **Do:**
  1. Use static HTML built with the shadcn tokens and components, so the wireframes are real pages, plus screenshots.
  2. **Batch 1 (gates Phase 3):** the shell, the tab strip in all its overflow states, the Lobby tab and every state of the questionnaire slideout.
  3. **Batch 2 (gates Phase 4):** every remaining tab, the sessions view and settings.
  4. Draw each wireframe at **768 and 1440 px**, in light and dark.
  5. Cover these states for each screen: empty, loading, error, busy, a long list and a long Markdown reply.
  6. Note on each wireframe where it differs from the TUI, and why.
  7. Use the terminal's screenshots in `docs/*.png` and the README's tab descriptions as the content.
- **Done when:** **the user approves the wireframes, batch by batch.** Phase 3's UI tasks build to batch 1; Phase 4's to batch 2.

---

## Phase 1 · The service seam (no visible change)

### P1-01 · `LobbyService`
- **Lane:** A · **Depends on:** P0-06 · **Owns:** `src/lobby/service.ts` (new), `src/lobby/runtime.ts`, `src/lobby/view.ts` (the `LobbyHost` type only)
- **Do:**
  1. Define `LobbyService` with the members ARCHITECTURE §3 puts in it.
  2. Implement `createLobbyService(state)`, which moves the bodies out of `host()`.
  3. Make `LobbyHost` = `LobbyService & TerminalBits`, and have `host()` spread the service.
  4. Expose `currentLobbyService()` for the server.
- **Done when:**
  - `host()` has no logic of its own, only the terminal-only members;
  - every existing test passes unchanged;
  - a new `test/lobby-service.test.ts` drives the service with no TUI (the fake session from `test/fake-session.ts`).

### P1-02 · Topics
- **Lane:** A · **Depends on:** P1-01 · **Owns:** `src/lobby/topics.ts` (new), `src/lobby/runtime.ts`
- **Do:**
  1. Write `LobbyTopics`, an emitter with a version per topic.
  2. Route every source in ARCHITECTURE §4 through it.
  3. Have the terminal subscribe and call `rerender()`.
  4. Add file polling that runs only while a non-terminal listener is attached.
- **Done when:**
  - a test drives each source and sees the right topic;
  - the terminal repaints exactly as before (`lobby-runtime` tests pass);
  - no polling runs with no web listener.

### P1-03 · View models out of the tab files
- **Lane:** A · **Depends on:** P1-01 · **Owns:** `src/lobby/models/` (new), `src/lobby/tabs/*.ts` (moving functions only)
- **Do:** for each function in [SURFACE-MAP.md](SURFACE-MAP.md) §3, move or split its data part into `src/lobby/models/`. The tab file keeps the string rendering and imports the model.
- **Done when:**
  - the tab tests (`lobby-view`, `lobby-layout`, `lobby-state`, `mini`, …) pass unchanged;
  - each model has a test of its own;
  - no model imports `@earendil-works/pi-tui`.

### P1-04 · The prompt hub
- **Lane:** A · **Depends on:** P1-01, P0-04 · **Owns:** `src/lobby/prompts.ts` (new, shared strings), `src/lobby/prompt-hub.ts` (new, PromptHub), `src/ask/dialog.ts`, `src/ask/tool.ts`, `src/pi/tools.ts` (the `ask`/`choose` deps), `src/lobby/runtime.ts` (`answerPanel`, `savePlan`, `answerDialog`)
- **Do:**
  1. Write `PromptHub` (ARCHITECTURE §7) with a terminal surface that wraps today's code. Use the withdrawal mechanisms P0-04 settled.
  2. Route the questionnaire, `choose`, `ask`, the panel and the split through it.
  3. Have background-session dialogs show up as `sessionDialog` prompts.
- **Done when:**
  - with no web surface, every existing test passes unchanged (`ask`, `lobby-ask`, `relay`, `workflow`, `lobby-sessions`);
  - a test with a fake second surface shows that the first answer wins, the other is withdrawn, and a cancelled caller withdraws both.

### P1-05 · Start the service without a terminal
- **Lane:** A · **Depends on:** P1-01, P0-06 · **Owns:** `src/lobby/runtime.ts`
- **Do:** split `initLobby` into `startLobbyService()` and `mountTerminalLobby()`, as P0-06 recommended. `startLobbyService` runs when `ctx.mode === "tui"`, or when the web server is on. Keep the subagent check.
- **Done when:**
  - in `tui` mode nothing changes;
  - a test starts the service with `mode: "rpc"` and no `setWidget`, and reads tasks and the feed.

### P1-X · Review checkpoint
- **Lane:** coordinator · **Depends on:** P1-01…P1-05
- **Do:** a full manual pass of the terminal lobby on a real task (every tab, a questionnaire, a background session, a session switch), compared with `main`.
- **Done when:** no visible difference; any difference found is fixed or listed.

---

## Phase 2 · The server

### P2-01 · Server core and lifecycle
- **Lane:** B · **Depends on:** P1-01, P0-02 · **Owns:** `src/webui/server.ts`, `src/webui/static.ts`
- **Starts from:** `starter/server/server.ts`, the routing, static and listen parts.
- **Do:**
  1. One server per process.
  2. Ports: `lobby.web.port`, then the next free one up to +20.
  3. `rebind(service)` on a session switch.
  4. Close on exit.
  5. Static files from `webui/dist`, with the CSP and caching rules.
  6. Nothing written to stdout or stderr.
- **Done when:**
  - tests cover the port fallback, rebind (a connected stream gets `hello` again), close (the port is free again) and the stdout/stderr spy;
  - static serving refuses `..`, encoded `..`, unknown extensions and missing files.

### P2-02 · Authentication
- **Lane:** B · **Depends on:** P2-01 · **Owns:** `src/webui/auth.ts`
- **Starts from:** the starter's token, cookie, Host, Origin and rate-limit code.
- **Do:**
  1. Keep the secret in `~/.pi/bot-lobby/web.json` (the folder from `BOT_LOBBY_CONFIG_DIR`, `src/state/project.ts`). Create it with mode 0600 and correct it if wider.
  2. Make the link and cookie HMACs (D-12).
  3. Add `reset`.
  4. Make the cookie's `Max-Age` 30 days.
- **Done when:** every test in `starter/test/server.test.ts` is ported and passes, and added tests cover:
  - the file's mode;
  - reset signing out an old cookie;
  - a corrupt `web.json` being replaced, with a notice.

### P2-03 · Protocol and router
- **Lane:** B · **Depends on:** P2-01 · **Owns:** `src/webui/protocol.ts`, `src/webui/api/index.ts`
- **Do:**
  1. Type every call in ARCHITECTURE §5 (request, result) and every stream event.
  2. Write the router: name lookup with no prototype names, a TypeBox schema per request, the body limit and the error codes.
  3. Write a test helper that calls the router with a fake service.
- **Done when:**
  - an unknown call, a bad body and a wrong field type each give the right code;
  - the page's `api.ts` (P3-03) can import the types with `import type` only.

### P2-04 · The event stream
- **Lane:** B · **Depends on:** P2-03, P1-02, P0-05 · **Owns:** `src/webui/events.ts`
- **Starts from:** the starter's `openStream` and reply coalescing.
- **Do:**
  1. Send `hello` with every topic's version, and `changed` per topic, coalesced per P0-05.
  2. Send the `feed` delta (entries after the client's last ids, given as query parameters on connect) and the `reply` delta.
  3. Add the heartbeat and a cap of 8 streams per server (the oldest is closed).
- **Done when:**
  - tests cover: hello, a change per topic, coalescing (100 changes in 40 ms give one message), feed deltas without gaps or repeats, the heartbeat and the cap;
  - a stream left open for 10 minutes with no changes holds no growing memory.

### P2-05 · Read calls
- **Lane:** B · **Depends on:** P2-03, P1-03 · **Owns:** `src/webui/api/{status,lobby,tasks,sessions,planner,quickfix,metrics,git,issues,knowledge,excalidraw}.ts` (reads)
- **Do:** every read call in ARCHITECTURE §5, built from the service and the P1-03 view models.
  - Excalidraw links are masked.
  - Knowledge entries carry their refs, so edits can be checked.
- **Done when:**
  - each call has a test against a real service over a temp project (the fixtures used by the lobby tests);
  - a scan of every response finds no full room link, token or key (ARCHITECTURE §9.2).

### P2-06 · Action calls
- **Lane:** B · **Depends on:** P2-05, P1-04 · **Owns:** `src/webui/api/*.ts` (actions), `src/webui/api/prompts.ts`
- **Do:** every action in ARCHITECTURE §5, returning the terminal's notice text.
  - `excalidraw.reveal` is the only call that returns a full link.
  - `prompts.answer` and `prompts.dismiss` go through the web surface of the prompt hub.
- **Done when:**
  - each action has a test that checks its effect on disk or in the store, and its notice;
  - a knowledge edit on a stale ref returns `conflict` with the terminal's refusal text.

### P2-07 · Preview images
- **Lane:** B · **Depends on:** P2-01 · **Owns:** `src/webui/files.ts`
- **Do:** serve `GET /files/preview/<task>/<name>`:
  - only files under `previewDir(task)` (`src/ask/relay.ts`), resolved with `realpath`;
  - only `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp`, with their types and `nosniff`;
  - only with the cookie.

  Rewrite questionnaire option images to these URLs in web payloads.
- **Done when:** tests refuse traversal, symlinks out of the folder, other types and requests without the cookie.

### P2-08 · Command, config and opening the browser
- **Lane:** B · **Depends on:** P2-02 · **Owns:** `src/webui/command.ts`, `src/webui/open.ts`, `src/pi/commands.ts` (the `web` case), `src/schemas/configuration.ts` (`lobby.web`), `src/pi/settings-ui.ts` (the Lobby entries), `src/lobby/mini.ts` (the link in the status line), `README.md` (Commands)
- **Do:**
  1. Add the commands and the `lobby.web.*` config from D-17.
  2. Open the browser per platform (D-15).
  3. Show the link in the status line.
  4. Add the presence file's `webPort`.
- **Done when:**
  - tests cover each command, the config's defaults and normalisation, the opener chosen per platform (with `spawn` injected) and the presence field;
  - the README documents the commands.

### P2-09 · Mock server and fixtures
- **Lane:** D · **Depends on:** P2-03 · **Owns:** `src/webui/dev/`, `webui/fixtures/`
- **Starts from:** `starter/server/service.ts`, `dev.ts`.
- **Do:**
  1. `npm run web:dev` serves `webui/dist` with a fake service that answers **every** call in the protocol from fixtures.
  2. The fixtures cover each state P0-07 drew (empty, busy, long lists, long Markdown, errors).
  3. `?scenario=<name>` switches between fixture sets.
  4. A scripted oracle streams replies, and a scripted questionnaire arrives after a send.
  5. The page rebuilds on change through Vite and reloads.
- **Done when:**
  - Lane C can build every tab with no Pi and no model;
  - a test checks that every protocol call has a fixture.

### P2-X · Server checkpoint
- **Lane:** coordinator · **Depends on:** P2-01…P2-08
- **Do:** with real Pi, run `/bot-lobby web` and walk the API with `curl` (with the cookie), following `docs/web-ui/verification/phase2.md`. Run the security tests.
- **Done when:** the walkthrough is recorded and every ARCHITECTURE §9 fence has a passing test.

---

## Phase 3 · Shell, Lobby tab and questions (first usable release)

### P3-01 · shadcn tokens and base components
- **Lane:** C · **Depends on:** P0-07, P0-01 · **Owns:** `webui/src/styles/`, `webui/src/ui/`
- **Starts from:** `shadcn init -t vite -b radix`.
- **Do:** build these from the wireframes:
  - the shadcn tokens (light and dark), plus type and spacing scales;
  - the components: Button, IconButton, Tabs, Segmented, List/Row, Badge, Sheet (a side panel), Dialog, Toast, Empty/Loading/Error, Markdown (wrapping P3-04), Field and TextArea;
  - a component gallery page in the mock server (`#/gallery`).
- **Done when:**
  - the gallery passes TESTING §4 at every size, in both themes;
  - every touch target is ≥ 40 px;
  - contrast is ≥ 4.5:1 (checked by the UI check).

### P3-02 · App shell and the tab strip
- **Lane:** C · **Depends on:** P3-01 · **Owns:** `webui/src/app/`
- **Starts from:** the shadcn shell and tabs.
- **Do:**
  1. The header: workspace, branch, task state, connection.
  2. The **tab strip** per D-09 and P0-07: compact pills at the top at every width; the WAI-ARIA tabs pattern; the active tab always scrolls into view; a chevron at each edge that has hidden tabs, 40 px, not reachable with Tab; a fade that shows there is more; no visible scrollbar. Alt+1…8 jumps to a tab, from `tabJumpKey` in `src/lobby/keys.ts`; next and previous tab have shortcuts. A waiting question shows a badge on any tab other than Lobby.
  3. Hash routing.
  4. The sign-in gate.
  5. The banner for a terminal dialog that is open.
  6. Toasts from `notices`.
  7. The empty, loading, error and reconnecting states.
- **Done when:**
  - every route renders a placeholder at every size;
  - back and forward work;
  - a reload keeps the route;
  - all eight pills fit on one line at 1024 px and up, and the strip scrolls with chevrons below that;
  - nothing scrolls sideways.

### P3-03 · Data layer
- **Lane:** C · **Depends on:** P2-03, P2-09 · **Owns:** `webui/src/lib/api.ts`, `events.ts`, `store.ts`
- **Starts from:** `starter/client/api.ts`.
- **Do:**
  1. Typed `call()`.
  2. Sign-in.
  3. The `EventSource` with the connection state.
  4. The topic store (ARCHITECTURE §6).
  5. Helpers: `useTopic(topic)` and `useAction(name)`. `useAction` disables its button while running and shows the notice.
- **Done when:** unit tests (in Node, with a fake `fetch` and `EventSource`) cover: hello resync, a change rereading only used topics, delta patching, 401 → signed out, and reconnecting.

### P3-04 · Markdown
- **Lane:** C · **Depends on:** P3-01 · **Owns:** `webui/src/lib/markdown.ts`, `webui/src/ui/Markdown.tsx`
- **Starts from:** `starter/client/markdown.ts`.
- **Do:**
  1. Sanitize as in D-10.
  2. Code blocks get a copy button; tables scroll in a box.
  3. Syntax highlighting loads lazily (highlight.js, a common-languages build), only when a block has a language.
  4. A streaming reply re-renders only itself.
  5. Add a source-scan test: only `Markdown.tsx` sets HTML.
- **Done when:** the starter's checks (bold, code, table, a script that does not run, links with `noopener`) pass in the gallery, plus a 2,000-line reply that renders without freezing a mid-range tablet (P0-05's CPU numbers).

### P3-05 · The Lobby tab
- **Lane:** C · **Depends on:** P3-02, P3-03, P3-04 · **Owns:** `webui/src/tabs/lobby/`, `webui/src/ui/Composer.tsx`
- **Starts from:** `starter/client/app.tsx` (`LobbyTab`, `Composer`).
- **Do:**
  1. **The task header:** the task, its state, its track, plan progress, the current step and its budget.
  2. **The runs strip:** each agent with its status and elapsed time.
  3. **The conversation:** Markdown, the live reply, older history on scroll-up, and a "jump to latest" button.
  4. **The composer:** send, steer while busy, and stop.
  5. **The activity log:** colour per source and pending marks.
  6. **Thoughts:** each agent's latest, with the live one marked.
  7. **Pane toggles** (the terminal's `alt+c`, `alt+a` and `alt+k`) for wide screens.
  8. **Search** within the tab (the terminal's `ctrl+f`), using `filterFeed`.
- **Done when:**
  - every behaviour in FEATURE-INVENTORY's Lobby rows is checked in the mock;
  - a real Pi session shows the same conversation as the terminal, live.

### P3-06 · Questions in the page
- **Lane:** C · **Depends on:** P3-05, P2-06 · **Owns:** `webui/src/prompts/`
- **Do:**
  1. **The questionnaire:** a step per question (tabs on wide screens), options with descriptions, Markdown previews beside the list or under it at narrow widths, and images from `/files/preview`. Multi-select, an answer in your own words, and a leave confirmation, all as in the README's questionnaire section.
  2. **`choose`, `confirm` and `text`.**
  3. **Background-session dialogs.**
  4. **Showing them:** an open prompt shows as a sheet over any tab, plus a badge on the Lobby tab. When the terminal answers first, the sheet closes with "answered in the terminal".
- **Done when:**
  - each kind is answerable in the mock at every size;
  - with real Pi, a questionnaire answered in the browser lands in the conversation, and the terminal's copy closes;
  - the reverse also works.

### P3-07 · Sessions
- **Lane:** C · **Depends on:** P3-05 · **Owns:** `webui/src/tabs/sessions/`
- **Do:** the sessions view (the terminal's `alt+o`):
  - this window, the background sessions and the sessions in other terminals;
  - each one's conversation, sending it a message, and answering its dialogs;
  - starting a task in a new session (`alt+n`), stopping one, and switching this window to one;
  - links to other windows' web UIs (presence `webPort`).
- **Done when:** the Sessions rows of FEATURE-INVENTORY are checked in the mock and once with real Pi.

### P3-X · First usable release
- **Lane:** coordinator · **Depends on:** P3-01…P3-07, P2-X
- **Do:**
  1. Run a real task in Chromium at emulated tablet and desktop sizes, following `docs/web-ui/verification/phase3.md`: start it, approve the proposal, answer a question, watch it finish.
  2. Run `npm run web:check` (TESTING §4).
  3. Write the README's "Web UI (preview)" section.
  4. Bump the minor version.
- **Done when:** **the user tries it and agrees it is usable.** Release with `lobby.web.enabled: false` (it is opt-in).

---

## Phase 4 · Every other tab

Each card builds one tab to its wireframe, over the mock, and then checks it once with real Pi. **Every card is done when:**
- every FEATURE-INVENTORY row of its tab is checked;
- the tab passes TESTING §4 at every size;
- one real-Pi walkthrough is recorded in `docs/web-ui/verification/phase4.md`.

| Task | Tab | Lane · Owns | Notes |
| --- | --- | --- | --- |
| **P4-01** | Tasks | C · `webui/src/tabs/tasks/` | Checklists from `taskRows`; plans and their comments; start here or in a new session; archive, restore and delete with confirmation; the auto toggle; messaging a task's oracle; the archived view |
| **P4-02** | Plan | C · `webui/src/tabs/plan/` | Seats (tap to toggle), round and limit, members thinking; the panel's conversation; the draft plan with **tap a line to comment**; questions through the prompt hub; retry, new and save (with the split question) |
| **P4-03** | Quick fix | C · `webui/src/tabs/quickfix/` | Submit; jobs newest first; live steps; edited files; the report as Markdown; cancel; run anyway; moved to a task; the "routed here by the oracle" note |
| **P4-04** | Metrics | C · `webui/src/tabs/metrics/` | Tiles; bars of run time and success per model and per agent (SVG); the time share; the cost and token table (scrolls in its box); the classifier summary; group-by and search |
| **P4-05** | Git | C · `webui/src/tabs/git/` | Pull requests with checks and size; detail with files, description, reviews and comments; review with an agent (with a focus), cancel; Jev's read; stale marks; "nothing is posted to GitHub" |
| **P4-06** | Knowledge | C · `webui/src/tabs/knowledge/` | Files by agent, with compaction marks; entries; edit, add and delete with the conflict refusal; whole-file edit; notes (add, take back); archive notice |
| **P4-07** | Excalidraw | C · `webui/src/tabs/excalidraw/` | Up to five sessions; add a link or make a room; the agent checklist; look-only; check with its reason; rename and remove. **Links masked; reveal and copy on tap; "Open board" opens it in a new tab** (Q-03) |
| **P4-08** | Issues | C · `webui/src/tabs/issues/` | Only when `lobby.issues` is on: the list, detail and create |
| **P4-09** | Windows | B+C · `src/webui/api/status.ts`, `webui/src/app/` | Other Pi windows in this project, from presence, with links to their web UIs |

### P4-X · Parity walkthrough
- **Lane:** coordinator · **Depends on:** P4-01…P4-09
- **Do:** go through every FEATURE-INVENTORY row on a tablet and a desktop with real Pi.
- **Done when:** every row is `done` or has an agreed exception in `docs/web-ui/parity.md`.

---

## Phase 5 · Settings, notifications, app, release

| Task | What | Lane · Owns | Done when |
| --- | --- | --- | --- |
| **P5-01** | **Settings page:** every entry of `/bot-lobby settings`. Models come from Pi's registry (`ctx.modelRegistry.getAvailable()`, or the scoped models, as `src/pi/settings-ui.ts:237` does). Thinking levels per model; time limits; instructions; the lobby; `lobby.web`; Jev. Saved through `resolveConfig`. A theme switch | A+B+C · `src/webui/api/settings.ts`, `webui/src/tabs/settings/` | Every setting round-trips; invalid input is refused with the terminal's message; the terminal sees the change |
| **P5-02** | **Notifications:** toasts for notices. Opt-in browser notifications (the Notification API works on `127.0.0.1`) while the page is hidden: a task waits for you, finished or failed; a background session asks something; a quick fix is done | C · `webui/src/app/notify.ts` | Shown once per event; never while the page is visible; off by default |
| **P5-03** | **Installable app (PWA):** manifest, icons and a service worker that caches the shell by build hash and never API answers; a "Pi is not running" offline page | C+D · `webui/src/sw.ts`, `webui/public/` | Installs in desktop and tablet Chrome; an update is picked up on the next load; API answers are never served from the cache (test) |
| **P5-04** | **Accessibility and keys:** keyboard paths for every action; the terminal's shortcuts where the browser allows (tab switching, search, send, stop, auto); a help sheet; screen-reader labels; focus management for sheets | C · `webui/src/app/keys.ts`, components | axe-core finds no serious issues on any screen; a keyboard-only walkthrough is recorded |
| **P5-05** | **Performance and extras:** a long-session stress test (400 activity entries, 100 messages, a reply of 8,000 characters); lazy Mermaid (Q-05); bundle budget check in CI | C · `webui/src/lib/` | Under the 250 KB budget; no long tasks over 200 ms in the tablet emulation during a stream |
| **P5-06** | **Docs:** the README's Web UI section with tablet and desktop screenshots, setup, troubleshooting, security notes; `/bot-lobby help` | D · `README.md`, `docs/*.png` | A new user gets from install to a working page with only the README |
| **P5-07** | **Release:** settle Q-04 (start the server with each session?); changelog; version bump; publish | coordinator | Released; the parity file is complete |

---

## Phase 6 · Standalone app (later, not scheduled)

Listed so Phases 0–5 keep it possible (D-20). Plan each in detail when the user asks for it.
- **P6-01 · Headless host.** A Node program that runs Pi through its SDK (`createAgentSession`, PI-NOTES §5) with bot-lobby loaded, starts the service without a terminal (P1-05) and serves the web UI. The page gains the main conversation's full controls: model, thinking and session list.
- **P6-02 · Desktop app.** Electron around the headless host: a window per project, auto-update and signing.
- **P6-03 · Other devices (if Q-02 changes).** LAN access with TLS and device pairing.
