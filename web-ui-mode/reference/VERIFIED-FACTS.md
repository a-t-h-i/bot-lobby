# Verified facts

What was actually run for this plan, and what it showed.
- **Each fact:** the command and the result, so it can be repeated.
- **Not here:** anything only read in documentation. That is in [PI-NOTES.md](PI-NOTES.md), marked **documented**.

**Environment:**
- 2026-10-01, Linux x86-64, Node 22.22.2; §1–3 were run again on 2026-10-02 after the page was restyled like the terminal (D-21);
- Chromium build 1194 through `playwright-core` 1.56.1;
- bot-lobby at `0a2c14d`, Pi packages 0.87.0.

## 1. The starter builds, and the page is small

```
cd web-ui-mode/starter && npm install && npm run build
app-DCDCSCUN.js   98.4 KB      (gzip: about 34 KB)
app-SSWXTZGT.css  10.0 KB      (gzip: about 3 KB)
```

- **Libraries:** Preact 11.0.0, marked 18.0.14 and DOMPurify 3.4.16, bundled by esbuild 0.28.2 with content-hashed names.
- **Typecheck:** `npm run typecheck` (TypeScript 5.7.3, strict, `exactOptionalPropertyTypes`) is clean.

## 2. The server's fences hold

`npm test` → **11 of 11 pass** (`starter/test/server.test.ts`). The tests:
- **The link:** it is `http://127.0.0.1:<port>/#token=<43 chars>`, with no query string. The server listens on loopback.
- **No cookie:** the API and the stream answer 401, as does a guessed cookie.
- **Wrong links:** ten wrong tokens give 401; the eleventh gives 429.
- **With the cookie:** calls work, and answers are `Cache-Control: no-store`.
- **The cookie:** it is `HttpOnly` and `SameSite=Strict`.
- **Another host (DNS rebinding):** a `Host` of `evil.example` gets 403, even with the cookie. `localhost:<port>` is accepted.
- **Cross-site:**
  - a foreign `Origin` gets 403;
  - `Sec-Fetch-Site: cross-site` gets 403;
  - `Content-Type: text/plain` gets 415;
  - the same origin gets 200;
  - no `Access-Control-Allow-Origin` is ever sent.
- **Bad requests:**
  - a body over 1 MB gets 413;
  - bad JSON gets 400;
  - a wrong field type gets 400;
  - `/api/toString` (an inherited name) gets 404.
- **The page:** it is served with the CSP (`default-src 'self' … frame-ancestors 'none'`) and `nosniff`. `/../server/server.ts`, `/%2e%2e/%2e%2e/etc/passwd`, `/..%2fpackage.json` and unknown files get 404.
- **The stream:** it answers `text/event-stream`. The first event is `hello`; a send produces `changed`. The streaming reply arrives in coalesced `reply` frames: fewer frames than words for a reply of about 120 words, with 10 ms frames and 5 ms steps.
- **Frame order:** the reply's last frame, carrying the whole reply, arrives before the `changed` that ends the reply. Before the fix, the held frame came after it (#43 after #42) and the page showed the finished reply as still streaming; the test fails on the old `server.ts`.

## 3. The page works at phone, tablet and desktop sizes

`CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run ui-check` → **146 of 146 checks pass**.

**Sizes:** 360×780, 412×915, 800×1280, 1280×800 and 1440×900, each in light and dark. Touch was on for every size below 1440.

**For every size and theme:**
- the token is gone from the address bar after sign-in;
- a streamed reply renders as Markdown, with bold, a code block and a table;
- `<img src=x onerror=alert(1)>` in the reply ran nothing: no `img[onerror]` and no dialog;
- the link has `target="_blank"` and `rel` containing `noopener`;
- **no sideways page scroll**, at rest and while the oracle works, measured against the device's width: `max(scrollWidth, innerWidth) − width ≤ 0`. Mobile Chrome widens `innerWidth` to fit overflowing content, so the first version of this check (`scrollWidth − innerWidth`) missed a page 71 px too wide at 360 px. The send key stays on screen while the stop key shows;
- a finished reply is no longer shown as streaming;
- no button or field is under 36 px tall;
- **contrast:** every visible element with text is at least 4.5:1 against the background behind it, disabled controls and `aria-hidden` marks excepted (`lowContrastText`);
- another tab opens, and a draft in the composer survives the switch back;
- a reload stays signed in;
- no console errors. The first run had two 404s in light at 360 px, the first page load. Once the page linked an icon (`/icon.svg`), they were gone, so they were the browser's own icon request.
- **below 1024 px:** the Activity pane opens from its title in the frame;
- **at 1024 px and wider:** the activity log sits beside the conversation, and the tabs sit in the title line.

**Also checked:** with no token, and with a wrong token, the page shows the sign-in message.

**Screenshots** are in [screenshots/](screenshots): `phone-light.png`, `phone-dark-activity.png`, `tablet-landscape-dark.png` and `desktop-light.png`.

## 4. Node runs the server's TypeScript directly, with one limit

`node server/dev.ts` and `node --test test/*.test.ts` run `.ts` files with Node 22's type stripping, as bot-lobby's own tests do.
- **The limit:** a constructor **parameter property** (`constructor(private readonly x: T)`) fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not supported in strip-only mode`.
- **The fix:** use plain fields (AGENT-GUIDE §4). The page's code goes through esbuild and is not affected, but keep one style.

## 5. Pi's dialog types allow withdrawing all but `editor`

Read from the installed types (`dist/core/extensions/types.d.ts`), not run:
- `select`, `confirm` and `input` take `ExtensionUIDialogOptions { signal?, timeout? }`;
- `editor(title, prefill)` takes none.

This is listed here because P0-04 starts from it. The run is P0-04's.

## Read but not run

- **Pi inside a TUI process with a server:** not run. Pi was not run interactively for this plan, because no model key was available in the sandbox. That is P0-02.
- **Android and Termux:** not run. That is P0-03, on the user's device.
- **The live collaboration server, `oss-collab.excalidraw.com`:** not reachable from the sandbox (its proxy answers 403). That does not affect this plan.
