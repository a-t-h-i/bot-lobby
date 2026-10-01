# Verified facts

What was actually run for this plan, and what it showed.
- **Each fact:** the command and the result, so it can be repeated.
- **Not here:** anything only read in documentation. That is in [PI-NOTES.md](PI-NOTES.md), marked **documented**.

**Environment:**
- 2026-10-01, Linux x86-64, Node 22.22.2;
- Chromium build 1194 through `playwright-core` 1.56.1;
- bot-lobby at `0a2c14d`, Pi packages 0.87.0.

## 1. The starter builds, and the page is small

```
cd web-ui-mode/starter && npm install && npm run build
app-GTQVD6XZ.js   94.7 KB      (gzip: about 33 KB)
app-QR6TX6ZV.css   6.6 KB
```

- **Libraries:** Preact 11.0.0, marked 18.0.14 and DOMPurify 3.4.16, bundled by esbuild 0.28.2 with content-hashed names.
- **Typecheck:** `npm run typecheck` (TypeScript 5.7.3, strict, `exactOptionalPropertyTypes`) is clean.

## 2. The server's fences hold

`npm test` → **10 of 10 pass** (`starter/test/server.test.ts`). The tests:
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

## 3. The page works at phone, tablet and desktop sizes

`CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run ui-check` → **92 of 92 checks pass**.

**Sizes:** 360×780, 412×915, 800×1280, 1280×800 and 1440×900, each in light and dark. Touch was on for every size below 1440.

**For every size and theme:**
- the token is gone from the address bar after sign-in;
- a streamed reply renders as Markdown, with bold, a code block and a table;
- `<img src=x onerror=alert(1)>` in the reply ran nothing: no `img[onerror]` and no dialog;
- the link has `target="_blank"` and `rel` containing `noopener`;
- **no sideways page scroll** (`scrollWidth − innerWidth ≤ 0`);
- no button or field is under 36 px tall;
- a reload stays signed in;
- no console errors. The first run had two 404s in light at 360 px, the first page load. Once the page linked an icon (`/icon.svg`), they were gone, so they were the browser's own icon request.
- **below 1024 px:** the Activity pane opens from the segmented control;
- **at 1024 px and wider:** the activity log sits beside the conversation.

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
