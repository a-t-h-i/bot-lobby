# Guide for agents building the web UI

Read this before taking a task from [PLAN.md](PLAN.md). It covers how to work, the rules this code must keep, the traps already found, and what "done" means.

## 1. Start here

**Everyone reads:**
1. [README.md](README.md);
2. [DECISIONS.md](DECISIONS.md);
3. your task's card in [PLAN.md](PLAN.md);
4. this guide.

Then read the extra documents for your lane:

| Lane | Also read |
| --- | --- |
| A · service | [ARCHITECTURE.md](ARCHITECTURE.md) §3, §4 and §7; [SURFACE-MAP.md](SURFACE-MAP.md); `src/lobby/runtime.ts`, `src/lobby/view.ts` (the `LobbyHost` interface); the tests named in your card |
| B · server | ARCHITECTURE §5, §8 and §9; [reference/PI-NOTES.md](reference/PI-NOTES.md); `web-ui-mode/starter/server/` and its tests |
| C · page | ARCHITECTURE §6; D-07…D-10, D-19; [FEATURE-INVENTORY.md](FEATURE-INVENTORY.md) for your tab; the wireframes in `docs/web-ui/design/`; the terminal tab's file in `src/lobby/tabs/`; `web-ui-mode/starter/client/` |
| D · infra, tests and design | [DEV-ENVIRONMENT.md](DEV-ENVIRONMENT.md), [TESTING.md](TESTING.md), the starter's `README.md` |

## 2. How to work

- **One task at a time, claimed first** (PLAN, "Rules for every task"). Read the whole card, including its "Done when".
- **The terminal lobby is the specification.**
  - Keep its behaviour, its notice texts and its limits.
  - Read its tests: they state the behaviour exactly.
  - When the web does something differently on purpose (D-14), say so in the PR and in `docs/web-ui/parity.md`.
- **Keep it small.** A PR does its card and nothing else. If you see another problem, note it in `docs/web-ui/status.md` or tell the coordinator; don't widen the PR.
- **Write code that reads like bot-lobby:**
  - comments say *why*, in a short sentence above the code;
  - plain full-word names;
  - small pure functions with tests;
  - user-facing text in plain English;
  - no clever abstractions;
  - in the page: components small, one tab per folder, no global state outside `lib/store.ts`.
- **Git:**
  - commit as `a-t-h-i <aonlysmith@gmail.com>`, with **no `Co-Authored-By` trailers**;
  - commit messages start with the task id (`P2-02: keep the web secret in web.json, 0600`);
  - commit the rebuilt `webui/dist/` in the same commit as the source change that needs it (D-08).
- **When stuck** longer than it should take:
  1. write down what you tried, with verbatim errors, in the PR or the spike note;
  2. set the task to `blocked: <reason>` in `docs/web-ui/status.md`;
  3. move on.

## 3. Rules this code keeps

1. **The terminal keeps working.**
   - Every existing test passes on every PR.
   - With no page connected, behaviour is exactly today's: no polling, no extra work, questions only in the terminal (ARCHITECTURE §9.6).
2. **The server never writes to stdout or stderr.** That would scribble over Pi's screen. Log to `lobbyFeed.log("LOBBY", …)` or nowhere.
3. **No logic in the server or the page that the service should own** (D-05, D-06). If the page needs a derived value, add a view model next to the terminal's.
4. **Everything shown is untrusted** (D-10).
   - Markdown goes through `ui/Markdown.tsx` only.
   - No other `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`.
   - No inline `style=""` attributes from data.
5. **No secrets in responses or logs** (D-12): room links (masked unless `reveal`), the web secret, tokens and API keys.
6. **The fences in D-12 are never weakened.** A new route goes through the same Host, cookie, Origin and JSON checks. There is no "debug" bypass.
7. **Phone first** (D-09).
   - Build the narrow layout first, then widen.
   - Touch targets are 44 px; no hover-only actions; no sideways page scroll.
   - Text fields use a 16 px font.
8. **No new runtime dependency for the server.** Page libraries are devDependencies, bundled into `webui/dist`. Adding any library needs the coordinator's agreement and a size check (D-07 budget).
9. **No network from the page except to its own server** (CSP `connect-src 'self'`). No CDN, web fonts or analytics.

## 4. Traps already found

- **Node runs `.ts` files by stripping types**, and so do bot-lobby's tests. So these fail at runtime with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, even though `tsc` accepts them (VERIFIED-FACTS 4):
  - constructor parameter properties (`constructor(private x: T)`);
  - `enum`;
  - `namespace`.

  Use plain fields and string unions.
- **`ctx.ui.editor()` cannot be withdrawn.** It takes no `AbortSignal`, unlike `select`, `confirm` and `input` (PI-NOTES §2). Don't build on cancelling it; P0-04 decides the approach.
- **The lobby starts only in `tui` mode today** (`runtime.ts:830`). Anything you add to the service must not assume the overlay or `state.tui` exists (P1-05).
- **`src/web/` is the web-search tools, not the web UI.** The server lives in `src/webui/` and the page in `webui/`.
- **Cookies are not separated by port.** Every Pi window shares the same secret on purpose, so a cookie works across windows (D-12). Don't build per-port secrets that would sign users out when they open a second window.
- **The browser asks for `/favicon.ico` on its own.** Without an icon linked in `index.html`, every page load logs a 404 console error, which fails the UI check. The starter links `/icon.svg`.
- **A shared fake service keeps state between test runs.** In UI checks, wait for *this* run's change (count before and after), not for "the last message".
- **`EventSource` cannot send headers.** The stream is authenticated by the cookie alone, which is why the cookie is `SameSite=Strict` and the stream checks Host and Origin like any call.
- **Phones zoom into fields with a font under 16 px.** Keep the composer and every field at 16 px.

## 5. Conventions

| Topic | Convention |
| --- | --- |
| Layout | `src/lobby/{service,topics,prompts}.ts`, `src/lobby/models/`, `src/webui/`, `webui/src/{lib,app,ui,tabs,prompts,styles}/`, `webui/dist/` |
| Imports | `.ts` / `.tsx` extensions in relative imports; `import type` for types. The page imports only types from `src/` (through `src/webui/protocol.ts`) |
| Tests | `node:test` + `node:assert/strict`, `test/webui-*.test.ts`; Playwright checks in `test/web/` |
| Test ids | `data-testid="<tab>-<thing>"` (`tasks-row`, `composer-send`) |
| API | `POST /api/<group>.<action>`, answering `{ ok, result }` or `{ ok: false, error, code }` (ARCHITECTURE §5) |
| Notices | the terminal's exact text, returned by the action and shown as a toast |
| Config | under `lobby.web` (D-17); read with `loadConfig()`, as everything else in bot-lobby |
| Data | nothing new on disk except `~/.pi/bot-lobby/web.json` (the secret) and `webPort` in presence files |
| CSS | tokens on `:root`, redefined for dark (`prefers-color-scheme` and `[data-theme]`); no colour values outside the token block |

## 6. Definition of done

A task is done when all of these hold. Say how each was checked in the PR:
1. **Done when:** the card's criteria are met, with evidence (test names, screenshots, command output).
2. **Checks:** `npm run check` passes (typecheck, page typecheck, tests, `dist/` up to date).
3. **Tests:** new behaviour has tests; existing tests are unchanged unless the card says otherwise.
4. **Parity:** the rows the task touches in `docs/web-ui/parity.md` are updated.
5. **Docs:** if users see a change, the README says so (from P3-X on).
6. **Hygiene:** no stray logs; no `TODO` without an entry in `status.md`; no files outside the card's "Owns" (unless agreed).
7. **Page tasks only:**
   - the UI check passes at 360, 412, 800, 1280 and 1440 px, in light and dark;
   - no console errors;
   - no sideways scroll;
   - touch targets of 44 px;
   - keyboard reachable.
8. **Server tasks only:** a test per fence touched; nothing written to stdout or stderr; the stream and polling stop when the last page disconnects.

## 7. Upgrading Pi

The extension API can change between Pi versions. To move to a new Pi:
1. Read Pi's changelog (`node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md`) for changes to `ExtensionUIContext`, the `ui_prompt_*` events, `sendUserMessage`, RPC mode and packages.
2. Re-read the sources cited in [reference/PI-NOTES.md](reference/PI-NOTES.md), and update any line that changed.
3. Run `npm run check`, the UI check, and the Phase 3 walkthrough (questions answered in both places, a session switch with a page open).
