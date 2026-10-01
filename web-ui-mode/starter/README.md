# Starter: the web UI's first slice, verified

A small working copy of the shape the plan builds:
- **A local server:** a token-gated localhost server with a JSON API and an event stream.
- **A phone-first page:** the Lobby tab's conversation, with a streaming Markdown reply, the activity log and a composer.
- **A fake oracle** (`server/service.ts`) in place of Pi, so it runs anywhere.

It is not wired into bot-lobby. Tasks P0-01, P2-01…P2-04 and P3-01…P3-05 lift its files into the repo (see the "Starts from" lines in [../PLAN.md](../PLAN.md)).

## Run it

```bash
cd web-ui-mode/starter
npm install
npm run build        # dist/: index.html, app-<hash>.js, app-<hash>.css, icon.svg
npm run serve        # prints  bot-lobby web (fake oracle): http://127.0.0.1:<port>/#token=…
```

Open the printed link. On a phone with Termux, run the same commands there and open the link in Chrome on the phone.

## Check it

```bash
npm run typecheck    # tsc over server, client and tests
npm test             # 10 tests: every fence in server/server.ts
CHROMIUM_PATH=/path/to/chrome npm run ui-check   # 92 checks in Chromium, 5 sizes × light/dark; screenshots in shots/
```

## Files

| File | What it is | Becomes, in bot-lobby |
| --- | --- | --- |
| `server/protocol.ts` | API names, request/result types, stream events, topics | `src/webui/protocol.ts` (P2-03) |
| `server/server.ts` | The server: loopback only, Host check, link token → cookie, JSON-only POST, Origin and Sec-Fetch-Site checks, 1 MB body limit, static files under a strict CSP, the SSE stream with heartbeat and reply coalescing | `src/webui/server.ts`, `auth.ts`, `static.ts`, `events.ts` (P2-01, P2-02, P2-04) |
| `server/service.ts` | The `LobbyService` slice the server needs, and `FakeService` | the interface: `src/lobby/service.ts` (P1-01); the fake: `src/webui/dev/fake-service.ts` (P2-09) |
| `server/dev.ts` | Serves `dist/` with the fake | `npm run web:dev` (P2-09) |
| `client/api.ts` | `call()`, `signIn()` (fragment token → cookie), `follow()` (EventSource) | `web/src/lib/api.ts`, `events.ts` (P3-03) |
| `client/markdown.ts` | marked + DOMPurify: no raw HTML runs, links get `noopener`, only same-origin images | `web/src/lib/markdown.ts` (P3-04) |
| `client/app.tsx` | Header, tabs, Lobby tab: conversation, live reply, composer, activity; phone panes | `web/src/app/*`, `web/src/tabs/lobby/*` (P3-02, P3-05) |
| `client/styles.css` | Tokens (light/dark), phone-first layout, breakpoints at 768 and 1024 px | `web/src/styles/*` (P3-01) |
| `build.mjs` | esbuild: content-hashed bundle, `index.html` rewritten to name it | `web/build.mjs` (P0-01) |
| `test/server.test.ts` | The fences, tried from outside | `test/webui-server.test.ts` |
| `test/ui-check.mjs` | Playwright: sign-in, streaming Markdown, no HTML runs, no sideways scroll, tap sizes, reload keeps the cookie, a wrong token is refused | `test/web/ui-check.mjs` (P3-X) |

## What was verified, and how

These checks were run on 2026-10-01 with Node 22.22.2 and Chromium build 1194. They are recorded in [../reference/VERIFIED-FACTS.md](../reference/VERIFIED-FACTS.md):
- `npm run typecheck`: clean.
- `npm test`: 10 of 10 pass.
- `npm run ui-check`: 92 of 92 checks pass at 360×780, 412×915, 800×1280, 1280×800 and 1440×900, in light and dark.
- **Bundle size:** the script is 94.7 KB minified (about 33 KB gzipped), and the stylesheet is 6.6 KB.
