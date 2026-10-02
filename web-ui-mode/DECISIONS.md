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

## D-02 · A loopback web UI for desktop and tablet · Fixed

- **Where it is served:** from the user's own machine, on `127.0.0.1`.
- **Where it is opened:** in any browser on that machine.
- **Which screens it works on:** desktop and tablet widths, from **768 px up**, in portrait and landscape, as first-class layouts (D-09). Phones are out of scope: below 768 px the page shows a "use a larger window" notice.

## D-03 · Built in this repository · Adopted

The web UI lives in `a-t-h-i/bot-lobby`, beside the code it shows. There is no new repository and no separate package.

| Path | What |
| --- | --- |
| `src/lobby/service.ts`, `src/lobby/topics.ts`, `src/lobby/prompts.ts` (shared strings), `src/lobby/prompt-hub.ts` (PromptHub) | The seam both UIs use (D-05, D-11) |
| `src/webui/` | The server, in Pi's process (`src/web/` is already taken by the web-search tools) |
| `webui/src/` | The page: React 19 + shadcn/ui on Radix (D-07) |
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

## D-07 · The page: React 19 + shadcn/ui on Radix, bundled with Vite · Adopted

- **Why React 19:** JSX, hooks and no runtime compiler; shadcn/ui's components are written for it.
- **Why shadcn/ui on Radix:** accessible primitives (tabs, dialog, sheet, tooltip) with the source in this repository, so we own and can audit it.
- **Why Vite:** it replaces the starter's `build.mjs`, and the build writes `dist/build.json` (D-08).
- **Markdown:** `marked`, sanitized with `DOMPurify` (D-10).
- **Styles:** Tailwind 4 with shadcn's tokens (D-19). There is no hand-written CSS framework.
- **Icons:** inline SVG paths. There is no icon font.
- **Charts:** Recharts, loaded lazily in the Metrics tab. There is no chart library in the first load.
- **Budget:** the first load stays under **250 KB gzipped**, re-measured in P0-01. Heavy extras load lazily on first use: syntax highlighting, charts and Mermaid if Q-05 says yes.
- **CSP:** the per-response nonce must reach Radix's injected `<style>`, proved in P0-01 (D-12).

## D-08 · The built page is committed and shipped · Adopted

- **Why committed:** Pi installs a package from npm or from git by running `npm install` (**documented**, PI-NOTES §6). It does not run a build, and a git install does not install devDependencies for us to build with. So `webui/dist/` is committed and listed in `package.json` → `files`.
- **Build:** Vite replaces the starter's `build.mjs`; `webui/index.html` is the template, and a post-build step writes `dist/build.json`.
- **Staleness check:** a test fails when `webui/dist/` is older than the sources. It compares a hash of `webui/src/` **and** `webui/index.html` with the one the build writes into `dist/build.json`.
- **Dependencies:** client libraries (React, shadcn/ui on Radix, Tailwind) are **devDependencies**, because they are bundled into `dist/`. The server needs no new runtime dependency, since it uses `node:http`.

## D-09 · Desktop and tablet layouts: top tabs, one pane, a Sheet · Adopted

Tabs sit at the top at every supported width, and one main pane is shown at a time. Details open in a **Sheet** that slides in from the side instead of replacing the view (D-14).

| Width | Layout |
| --- | --- |
| **768–1023 px** (tablet portrait, small laptops) | Tabs at the top. One main pane plus a Sheet that slides in from the side. |
| **≥ 1024 px** (tablet landscape, desktops) | Tabs at the top; the same single pane, wider, with a Sheet for details. |
| **< 768 px** (phones) | Not supported. The page shows a "use a larger window" notice. |

**Rules for every screen:**
- **Touch targets:** at least 40×40 px (D-19). Hover is never the only way to an action.
- **No sideways page scroll at any width.** Code blocks and tables scroll inside their own box.
- **Safe areas:** handle `env(safe-area-inset-*)`. The viewport meta has `viewport-fit=cover, interactive-widget=resizes-content`, so the on-screen keyboard resizes the page and never covers the composer.
- **Text fields:** 16 px font, so touch keyboards do not zoom in on focus.
- **Preferences:** follow `prefers-color-scheme` and `prefers-reduced-motion`. A manual light/dark switch goes in Settings.
- **Keyboard:** every action reachable from a keyboard. Shortcuts mirror the terminal's where the browser allows (D-19, P5-04).

**Verified in the starter at 360, 412, 800, 1280 and 1440 px wide**, light and dark: no sideways scroll and no control under 36 px (VERIFIED-FACTS 3). The 40 px rule is enforced from P3-01.

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

## D-14 · Mirror the terminal almost exactly, plus agreed GUI improvements · Adopted

- **Full parity:** the web UI ends at parity with the terminal lobby, covering all eight tabs, Issues, sessions, questions and settings. FEATURE-INVENTORY is the checklist.
- **Order:** it ships in stages behind `lobby.web.enabled`:
  - the Lobby tab and questions first (Phase 3: the most used);
  - then the other tabs (Phase 4);
  - then settings, notifications and install-as-app (Phase 5).
- **Almost exactly:** the same tabs in the same order, the same content and wording, the same flows and the same keyboard shortcuts. Anything else is a parity bug unless it is logged in `docs/web-ui/parity.md` with a reason.
- **The only permitted GUI improvements:**
  - the mouse and touch work everywhere: click tabs, rows and buttons, scroll, and select text;
  - details open in a side **Sheet** instead of replacing the view;
  - the questionnaire is a slideout above the chat input, with a badge on the other tabs;
  - the tab strip uses compact pills, scrolls with chevrons, and shows shortcut hints in tooltips;
  - Markdown, code and charts are drawn properly, and file previews open inline;
  - separate empty, loading, error and reconnecting states, plus an Alt+H help overlay.

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

`http://127.0.0.1` is a secure context, so a web app manifest and a service worker work there. On desktop and tablet Chrome, "Install app" then opens the lobby in its own window with no browser bar.
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
- **The page:** Playwright (`playwright-core`, with the Chromium in `CHROMIUM_PATH`) against the mock server (P2-09), run by `npm run web:check`:
  - at 768×1024, 800×1280, 1280×800 and 1440×900;
  - in light and dark;
  - with screenshots kept as CI artifacts, not in the repo.
- **Live:** a walkthrough with real Pi and a real model before each phase ends (P2-X, P3-X, P4-X, and P5-07).

See [TESTING.md](TESTING.md).

## D-19 · Accessibility and language · Adopted

- **Accessibility:**
  - semantic HTML first (buttons are `<button>`, lists are lists, tabs use `role="tab"` and the WAI-ARIA tabs pattern);
  - visible focus;
  - labels for every control;
  - `aria-live="polite"` on the streaming reply and on notices;
  - contrast of at least 4.5:1 for text in both themes;
  - touch targets are at least 40×40 px;
  - an **Alt+H** help overlay lists the web key map, built from `keyLabel` in `src/lobby/keys.ts`;
  - tab pills show their Alt+digit hint in a tooltip and an `aria-keyshortcuts` attribute, so the hint is never available only on hover.
- **Language:** English, with the terminal's wording for the same things. User-visible strings come from shared modules such as `src/lobby/prompts.ts`, so the TUI and the page cannot drift; there is no translation layer until someone asks for one.

## D-20 · A standalone app is a later phase · Adopted

The user wants this possible later, not now. **Phase 6 (not scheduled):**
- **A headless host:** a Node program that runs Pi through its SDK (`createAgentSession`, **documented**, PI-NOTES §5) with bot-lobby loaded, and serves the same web UI. The page then also shows the main conversation, since there is no terminal.
- **A desktop app:** Electron (Pi needs Node, which Electron has).

**What Phases 0–5 must keep possible:**
- the service has no TUI imports (D-05);
- the server takes its service as a parameter (the starter already does);
- nothing in the page assumes a terminal exists.

## D-21 · The page looks like the terminal lobby · Fixed

The user asked for the web UI to look close to bot-lobby in the terminal, with tabs that look like part of the page rather than separate pill-shaped selectors (2026-10-02). The starter is built this way, and every screen follows it:
- **Colours:** Pi's own themes (`dark.json` and `light.json` in `@earendil-works/pi-coding-agent`) as CSS tokens. These cover the background, text, accent and selection colours, your message's background, the Markdown colours, and each agent's colour (`SOURCE_COLORS` in `src/lobby/tabs/home.ts`). Where one of Pi's colours is under 4.5:1 on the page (D-19), its token is a step lighter in dark or darker in light; `styles.css` notes Pi's value beside it.
- **Type:** one monospace face for everything, from the system, with no web font (the CSP and D-07's budget). 13 px on phones and 14 px from 768 px. Vertical space comes in whole lines.
- **The title line,** as the terminal's top line: `◆ name (⎇ branch) │ 1 Lobby 2 Tasks … 8 Excalidraw … status`.
  - The tabs are cells of that line: the chosen one lit with the selection colour, the rest plain text on the page. The numbers are the `alt+1…9` keys.
  - Below 1024 px, the tabs take a line of their own under the title, which scrolls sideways.
  - There are no pills, no segmented controls and no tab bar with a background of its own.
- **Panes:** rounded frames with the title set into the top border. The pane you are in is drawn in the focus colour, as the terminal draws its focused pane. On phones, the Lobby's frame carries both pane titles, and tapping one switches the pane.
- **The conversation:**
  - the oracle as `◆ Oracle ··· 12:04`, with its reply indented under it;
  - you on the right as `12:04  You ●`, your words in the accent colour on the user-message background;
  - events as a centred rule;
  - messages from one speaker within five minutes share a header.
- **Activity:** `time WHO mark text`, with each agent in its colour and the terminal's marks (`·` `✓` `!` `✗` and the spinner).
- **Markdown,** as Pi renders it: headings in the heading colour, with `###` kept from level 3; fenced code with its fences and language; `- ` bullets; inline code in the code colour. Tables, images and links are real HTML, which is what the web UI is for.
- **The composer** is the terminal's prompt: a label set into a rule (`message the oracle · enter sends`), with the rules in the typing colour while you type.
- **The key line** under it shows the mode (`TYPE` or `BROWSE`) and the keys, and a notice takes its place for a few seconds, as in the terminal. Touch screens hide the keys and show only notices.
- **Kept from D-09:** 44 px targets on touch, no sideways scroll, 16 px fields on phones, `prefers-color-scheme`, and `prefers-reduced-motion` (the spinner stands still).

**Custom Pi themes:** the page uses Pi's built-in dark and light themes. P3-01 checks whether Pi gives an extension the active theme's colours; if it does, the server sends them as tokens (nudged for contrast the same way), so a custom Pi theme carries over.

**Verified in the starter** at all five sizes, light and dark (VERIFIED-FACTS 3):
- every visible piece of text is at least 4.5:1 against what is behind it;
- from 1024 px, the tabs sit in the title line.

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
