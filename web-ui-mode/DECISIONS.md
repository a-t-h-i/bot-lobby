# Decisions

Each decision has an id so plans, code comments and PRs can cite it (`per D-07`).

**Status:**
- **Fixed:** the user decided it. Do not reopen it.
- **Adopted:** this handbook decided it. Change it only through a PR to this file that says why.
- **Provisional:** it waits on a spike. The spike is named, and its result confirms or replaces the decision.

Where a decision rests on how Pi behaves, it says whether that was **verified** (run) or **documented** (read in Pi 0.87.0's docs or type definitions). See [reference/VERIFIED-FACTS.md](reference/VERIFIED-FACTS.md) and [reference/PI-NOTES.md](reference/PI-NOTES.md).

---

## D-01 · Pi stays the base · Fixed

bot-lobby stays a Pi extension: the same package (`@a-t-h-i/bot-lobby`) and the same engine, agents, prompts, data and config.
- **What is added:** a web view of the lobby. Nothing is ported off Pi, and nothing about how tasks run changes.
- **The terminal stays:** it remains a full UI. The web UI is a second view of the same state, and both can be open at once.

The earlier DeepSeek Harness plan is superseded. It is in git history at commit `463d241` (`dsh-port/`).

## D-02 · A localhost web UI, mobile responsive · Fixed

- **Where it is served:** from the user's own machine, on `127.0.0.1`.
- **Where it is opened:** in any browser on that machine, including Chrome on an Android phone or tablet running Pi in Termux.
- **Which screens it works on:** phone, tablet and desktop widths, in portrait and landscape, as first-class layouts (D-09).

## D-03 · Built in this repository · Adopted

The web UI lives in `a-t-h-i/bot-lobby`, beside the code it shows. There is no new repository and no separate package.

| Path | What |
| --- | --- |
| `src/lobby/service.ts`, `src/lobby/prompts.ts`, `src/lobby/topics.ts` | The seam both UIs use (D-05, D-11) |
| `src/webui/` | The server, in Pi's process (`src/web/` is already taken by the web-search tools) |
| `webui/src/` | The page: TypeScript + Preact (D-07) |
| `webui/dist/` | The built page, **committed** and shipped (D-08) |
| `web-ui-mode/` | This handbook |

Git author on every commit: `a-t-h-i <aonlysmith@gmail.com>`, with **no co-author trailers**.

## D-04 · One server per Pi window, inside Pi's process · Adopted

- **Who serves it:** the interactive Pi process that runs the lobby. There is no separate daemon.
- **What starts it:** `/bot-lobby web`, or `lobby.web.enabled` to start it with each session (D-17).
- **Session switches:** the server belongs to the process, not to one Pi session. A switch (`/resume`, `/bot-lobby switch`) rebinds the server to the new session's service. Open pages stay open and reread everything (P2-01).
- **Shutdown:** it closes when Pi exits.
- **Several windows:** two Pi windows in one project each serve their own UI on their own port. The page links to the other windows it finds through their presence files (P4-09).

A headless host for a standalone app is a later step (Phase 6, D-20). Nothing in Phases 0–5 depends on it, but Phase 1 keeps the service free of TUI dependencies so the step stays possible.

## D-05 · One seam: the lobby service · Adopted

Today the terminal lobby reads everything through `LobbyHost` (`src/lobby/view.ts:139`), which `host()` in `src/lobby/runtime.ts:588` builds. Phase 1 splits it in two:

- **`LobbyService`** (`src/lobby/service.ts`) holds every read and action that is not about the terminal:
  - tasks, plans, the feed, the planner, quick fix, Git, knowledge, Excalidraw, sessions and metrics;
  - `toOracle`, comments, starting and archiving tasks, auto mode, and every other action.
- **The terminal adapter:** `LobbyHost` becomes `LobbyService` plus the terminal-only parts: `rows`, `theme`, `hide`, `requestRender`, `editText`, `openSettings`, `keys` and `panels`.

**Rules:**
- **No business logic in the server or the page.** If both UIs need a behaviour, it lives in the service (or in the pure module the service calls).
- **No second store.** The web reads the same in-memory stores and files as the terminal: `lobbyFeed`, the session registry, the task files and the metrics log. The server keeps no state of its own beyond its connections and the change versions (D-11).
- **No behaviour change.** Phase 1 changes no behaviour the user can see. The existing tests (`lobby-view`, `lobby-runtime`, `lobby-sessions`, …) pass unchanged.

## D-06 · The server sends view models built by the same pure functions as the terminal · Adopted

Where the terminal computes what to show with a pure function, the server calls that same function and sends the result as JSON. Examples:
- `taskRows`, `taskProgress` and `checkState` in `tabs/tasks.ts`;
- `filterFeed` and `currentThought` in `tabs/home.ts`;
- the metric groups and `filterRecords` in `tabs/metrics.ts`;
- `newestFirst` and `filterJobs` in `tabs/quickfix.ts`;
- `roundLabel` in `tabs/plan.ts`.

The page only lays these out, so the two UIs cannot drift apart. A function that today returns terminal strings is split: the data part moves next to it (or into `src/lobby/models/`), and the string part stays in the tab file. SURFACE-MAP §3 lists each one.

## D-07 · The page: TypeScript + Preact, bundled with esbuild · Adopted

- **Why Preact:** about 4 KB, JSX, hooks, and no runtime compiler.
- **Markdown:** `marked`, sanitized with `DOMPurify` (D-10).
- **Styles:** plain CSS with tokens. There is no CSS framework.
- **Icons:** inline SVG paths. There is no icon font.
- **Charts:** hand-written SVG components for the Metrics tab. There is no chart library unless P4-04 shows one is needed.
- **Budget:** the first load stays under **150 KB gzipped**. Heavy extras load lazily on first use: syntax highlighting, and Mermaid if Q-05 says yes.

**Verified:** the starter's page (Preact 11, marked 18, DOMPurify 3) is 94.7 KB minified and about 33 KB gzipped (VERIFIED-FACTS 1).

## D-08 · The built page is committed and shipped · Adopted

- **Why committed:** Pi installs a package from npm or from git by running `npm install` (**documented**, PI-NOTES §6). It does not run a build, and a git install does not install devDependencies for us to build with. So `webui/dist/` is committed and listed in `package.json` → `files`.
- **Staleness check:** a test fails when `webui/dist/` is older than `webui/src/`. It compares a hash of the sources with the one `webui/build.mjs` writes into `dist/build.json`.
- **Dependencies:** client libraries (Preact, marked, DOMPurify) are **devDependencies**, because they are bundled into `dist/`. The server needs no new runtime dependency, since it uses `node:http`.

## D-09 · Mobile first, three layouts · Adopted

| Width | Layout |
| --- | --- |
| **< 768 px** (phones) | One pane at a time. Tabs in a bottom bar: Lobby, Tasks, Plan, Quick fix, More (Metrics, Git, Knowledge, Excalidraw, Issues, Sessions, Settings). The Lobby tab switches between Conversation, Activity and Thoughts with a segmented control. The composer is pinned above the tab bar. |
| **768–1023 px** (tablets in portrait, small laptops) | Tabs at the top. One main pane plus a panel that slides over from the side. |
| **≥ 1024 px** (tablets in landscape, desktops) | Panes side by side, like the terminal: the conversation beside the activity log, and lists beside their detail. |

**Rules for every screen:**
- **Touch targets:** at least 44×44 px on touch screens. Hover is never the only way to an action.
- **No sideways page scroll at any width.** Code blocks and tables scroll inside their own box.
- **Safe areas:** handle `env(safe-area-inset-*)`. The viewport meta has `viewport-fit=cover, interactive-widget=resizes-content`, so the on-screen keyboard resizes the page and never covers the composer.
- **Text fields:** 16 px font, so phones do not zoom in on focus.
- **Preferences:** follow `prefers-color-scheme` and `prefers-reduced-motion`. A manual light/dark switch goes in Settings.
- **Keyboard:** every action reachable from a keyboard. Desktop shortcuts mirror the terminal's where the browser allows (P5-04).

**Verified at 360, 412, 800, 1280 and 1440 px wide**, light and dark, in the starter: no sideways scroll and no control under 36 px (VERIFIED-FACTS 3). The 44 px rule is enforced from P3-01.

## D-10 · Everything shown is untrusted · Adopted

Chat, thoughts, plans, reviews, knowledge, pull-request text and board descriptions are written by models or other people. Rules:
- **Markdown:** rendered with `marked`, then sanitized with `DOMPurify`. Raw HTML never runs.
- **Links:** open in a new tab with `rel="noopener noreferrer nofollow"`.
- **Images:** only from this server (preview images, P2-07) or `data:`. The page's CSP (`img-src 'self' data: blob:`) blocks the rest, so a reply cannot load a tracking pixel.
- **No `dangerouslySetInnerHTML` except in the one Markdown component**, which receives sanitized HTML. A lint test enforces this (P3-04).

**Verified in the starter:** in a reply containing `<img src=x onerror=alert(1)>`, the handler and the remote `src` are stripped, and no dialog opens (VERIFIED-FACTS 3).

## D-11 · Transport: a JSON API and a server-sent event stream · Adopted

- **Calls:** `POST /api/<group>.<action>` with a JSON body. The answer is `{ ok: true, result }` or `{ ok: false, error, code }`.
- **Pushes:** `GET /api/events` is a server-sent event stream (`EventSource`). It carries:
  - `hello` on (re)connect, with the version of every topic;
  - `changed {topic, version}` when a topic changes, after which the page rereads that topic;
  - small deltas where rereading would be wasteful: the streaming reply's text (`reply`) and new feed entries (`feed`).
- **Topics:** `lobby`, `tasks`, `plans`, `quickfix`, `planner`, `sessions`, `metrics`, `git`, `knowledge`, `excalidraw`, `prompts`, `notices` and `status`.
- **Coalescing:** stream messages are coalesced to at most one per 40 ms per topic, the terminal's `FRAME_MS`. Topics backed by files (tasks, metrics, presence) are polled every 2 s (`DATA_REFRESH_MS`), and only while a page is connected.
- **Why server-sent events and not websockets:**
  - `node:http` serves them with no dependency;
  - `EventSource` reconnects by itself after a phone sleeps;
  - the page only needs pushes one way, and its actions are infrequent POSTs.

**Verified in the starter:** the hello, the change and the coalesced reply frames (VERIFIED-FACTS 2). Reconnecting after a phone sleeps or Pi restarts is not yet verified; that is P0-05.

## D-12 · Who may use the server · Adopted

**Threat model.**
- **Kept out:** other websites in the user's browser (CSRF, DNS rebinding) and other devices on the network.
- **Not in scope:** a malicious process running as the same user, which can already read `~/.pi`.

**The fences**, all verified in the starter's tests (VERIFIED-FACTS 2):
1. **Loopback only.** The server listens on `127.0.0.1`. A request whose `Host` is not `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` is refused, which defeats DNS rebinding.
2. **A link with a token.** The link Pi prints is `http://127.0.0.1:<port>/#token=<token>`.
   - The token is in the fragment, which browsers never send to a server.
   - The page trades it once (`POST /api/auth.login`) for an `HttpOnly; SameSite=Strict` cookie, then removes it from the address bar.
   - The token and cookie are HMACs of a 32-byte secret kept at `~/.pi/bot-lobby/web.json` (mode 0600).
   - `/bot-lobby web reset` makes a new secret, which signs every browser out.
3. **Every API call and the stream need the cookie.**
4. **No cross-site use.**
   - No CORS headers are ever sent.
   - POST takes `application/json` only, which a form or a simple cross-site request cannot send without a preflight nobody answers.
   - A foreign `Origin`, or `Sec-Fetch-Site: cross-site`, is refused.
5. **Strict CSP on the page:** `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'`, plus `nosniff`, `no-referrer` and `X-Frame-Options: DENY`.
6. **Limits.** Bodies are capped at 1 MB. Ten wrong tokens in a minute lock the login for that minute. Request fields are validated (P2-03).
7. **No secrets in responses.**
   - Excalidraw room links are masked; a separate call reveals one on an explicit tap (P4-07).
   - API keys and the secret never leave the server.

**Other devices on the network (LAN access)** are out of scope until Q-02 is decided.

## D-13 · Questions can be answered in the browser · Provisional (P0-04)

bot-lobby's own questions are offered in the terminal **and** in the page. The first answer wins, and the other copy is withdrawn. These include:
- the questionnaire (`ask_user_question`, the planning panel's questions, the plan-split question);
- approve/amend/decline (`choose` in `src/pi/tools.ts`);
- free-text asks;
- background sessions' dialogs.

**How each copy is withdrawn:**
- **The questionnaire:** a `ctx.ui.custom()` component of ours, closed by calling its `done` from outside.
- **`select`, `confirm` and `input`:** they take an `AbortSignal` (**documented**: `ExtensionUIDialogOptions.signal`, PI-NOTES §2).
- **`ctx.ui.editor()`:** it takes no signal. P0-04 decides between bot-lobby's own multi-line component and leaving editor asks in the terminal only.
- **Background sessions' RPC dialogs:** answered from the page with `session.answer()`. A terminal copy opened by the user is closed with a signal.

**Questions the page cannot answer:** dialogs raised by Pi itself or by other extensions stay in the terminal. The page shows "Pi is asking something in the terminal" while one is open, from `ui_prompt_start` / `ui_prompt_end` (**documented**).

**Setting:** `lobby.web.questions`: `"both"` (default) or `"terminal"`.

## D-14 · Feature scope and order · Adopted

- **Full parity:** the web UI ends at parity with the terminal lobby, covering all eight tabs, Issues, sessions, questions and settings. FEATURE-INVENTORY is the checklist.
- **Order:** it ships in stages behind `lobby.web.enabled`:
  - the Lobby tab and questions first (Phase 3: the most used, and what a phone needs most);
  - then the other tabs (Phase 4);
  - then settings, notifications and install-as-app (Phase 5).
- **Two things are better in the web, on purpose:**
  - real Markdown, images and diagrams;
  - charts in Metrics.

  Everything else keeps the terminal's behaviour, messages and limits.

## D-15 · Opening the link · Adopted

`/bot-lobby web` prints the link and opens it in the default browser where it can (`lobby.web.openBrowser`, default true):

| Platform | Command |
| --- | --- |
| Termux (`TERMUX_VERSION` is set) | `termux-open-url` |
| macOS | `open` |
| Windows | `start` |
| Linux | `xdg-open` |
| SSH sessions | no attempt |

The link also shows in the lobby's status line and in the Lobby tab's header. Failing to open the browser is not an error: the printed link is the fallback.

## D-16 · Installable as an app (PWA) · Adopted

`http://127.0.0.1` is a secure context, so a web app manifest and a service worker work there. On Android, "Add to home screen" then opens the lobby in its own window with no browser bar.
- **What is cached:** the service worker caches the page's shell only (versioned by the build hash). It never caches API answers.
- **When Pi is not running:** the installed app shows "Pi is not running; start it and run /bot-lobby web".

This is Phase 5 (P5-03) and is the cheap first step towards the standalone app (D-20).

## D-17 · Settings and commands · Adopted

**`lobby.web` in bot-lobby's config:**

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` (changed only by Q-04) | Start the server with each interactive session |
| `port` | `7347` | First port tried; the next free one up to `+20` is used. `0` means any free port |
| `openBrowser` | `true` | `/bot-lobby web` opens the link |
| `questions` | `"both"` | Where bot-lobby's questions show (D-13) |

**Commands:**

| Command | Does |
| --- | --- |
| `/bot-lobby web` | Starts the server if needed, prints the link and opens it |
| `/bot-lobby web stop` | Stops the server |
| `/bot-lobby web link` | Prints the link only |
| `/bot-lobby web reset` | Makes a new secret, which signs every browser out |

`/bot-lobby settings` → Lobby gets the same keys (P2-08).

## D-18 · Tests · Adopted

- **Server, service and models:** `node:test`, like the rest of bot-lobby.
- **The page:** Playwright (`playwright-core`, with the Chromium in `CHROMIUM_PATH`) against the mock server (P2-09):
  - at 360, 412, 800, 1280 and 1440 px;
  - in light and dark;
  - with screenshots kept as CI artifacts, not in the repo.
- **Live:** a walkthrough with real Pi and a real model before each phase ends (P2-X, P3-X, P4-X, and P5-07).

See [TESTING.md](TESTING.md).

## D-19 · Accessibility and language · Adopted

- **Accessibility:**
  - semantic HTML first (buttons are `<button>`, lists are lists, tabs use `role="tab"`);
  - visible focus;
  - labels for every control;
  - `aria-live="polite"` on the streaming reply and on notices;
  - contrast of at least 4.5:1 for text in both themes.
- **Language:** English, with the terminal's wording for the same things. Strings are written plainly in components; there is no translation layer until someone asks for one.

## D-20 · A standalone app is a later phase · Adopted

The user wants this possible later, not now. **Phase 6 (not scheduled):**
- **A headless host:** a Node program that runs Pi through its SDK (`createAgentSession`, **documented**, PI-NOTES §5) with bot-lobby loaded, and serves the same web UI. The page then also shows the main conversation, since there is no terminal.
- **A desktop app:** Electron (Pi needs Node, which Electron has).

**What Phases 0–5 must keep possible:**
- the service has no TUI imports (D-05);
- the server takes its service as a parameter (the starter already does);
- nothing in the page assumes a terminal exists.

---

## Open questions (each has a default the swarm uses until the user answers)

| Id | Question | Default |
| --- | --- | --- |
| **Q-01** | Should the web UI live in this repo (D-03), or in a separate package? | This repo |
| **Q-02** | Should another device (a phone viewing a desktop's Pi) be able to connect over the LAN? It needs TLS or a pairing step, since the link token would travel unencrypted. | No. Use loopback only; for a remote machine, use an SSH tunnel (`ssh -L 7347:127.0.0.1:7347 host`) |
| **Q-03** | Should the Excalidraw tab embed the live board (Excalidraw's React component joined to the room), or link out to excalidraw.com? | Link out in Phase 4; consider embedding after Phase 5 |
| **Q-04** | Should the web server start with every session (`lobby.web.enabled: true`) once the UI reaches parity? | Off until P5-07, then on |
| **Q-05** | Should Mermaid diagrams in Markdown be rendered (about 600 KB, lazily loaded)? | Yes, lazily, in P5-05 |
| **Q-06** | Is it fine to have a light theme and a dark theme of our own, rather than following Pi's terminal theme colours? | Our own, with the terminal's accent colour if Pi exposes it |
