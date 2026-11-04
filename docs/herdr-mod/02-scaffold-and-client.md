# 02. Scaffold and client

Goal: the mod lives in the Bot Lobby repo, installs into herdr with one command, and has one tested client layer (find server, cookie, API calls, event stream, store) that every view uses.

## Read first

- This spec's `01-spike.md` and your `STATUS.md` answers (especially check 7).
- Bot Lobby: `webui/src/lib/api.ts` (call shape, error handling), `webui/src/lib/events.ts` (reconnect, `activityAfter` / `thoughtsAfter` / `chatAfter`), `webui/src/lib/store.ts` (topic → what to refetch), `src/lobby/topics.ts` (`LOBBY_TOPICS`), `src/webui/protocol.ts` (`ApiReply`, `ErrorCode`, `StreamEvent`).

## Files to write

```
herdr/
  README.md                     how to install, herdr version built against
  install.mjs                   copies mods/ and layouts/ into the app home
  layouts/bot-lobby.json        phase 04
  keys.json                     phase 04 (merged, never overwritten)
  mods/bot-herdr/
    mod.json                    { "place": "none", "focusable": true }
    jsconfig.json               checkJs against the app home .d.ts files
    main.js                     default export: picks a view from props().view
    lib/server.js               find the project's server for a space
    lib/hmac.js                 HMAC-SHA256 on crypto.createHash
    lib/auth.js                 cookie value from web.json
    lib/api.js                  call(server, name, body)
    lib/stream.js               SSE over net.connect, chunked decoding, reconnect
    lib/store.js                topic versions, cached results, feed
    lib/look.js                 radii, sizes, accent helpers, shared row builders
    lib/words.js                shared words
    views/…                     one file per view (later phases)
    icons/*.svg                 one-colour icons (tinted with svg())
```

## Step 1. Install script

`herdr/install.mjs` (Node, run from the repo):

- App home = `$HERDR_APP_HOME` or `$XDG_CONFIG_HOME/herdr-app` or `~/.config/herdr-app`.
- Copy `herdr/mods/bot-herdr/` to `<home>/mods/bot-herdr/` (replace the folder; it is ours).
- Copy `herdr/layouts/bot-lobby.json` to `<home>/layouts/` only if missing or if `--force` (the person's clicks live in `layouts/.state/` anyway).
- Merge `herdr/keys.json` into `<home>/keys.json`: add missing sections and keys; never replace a key the person already bound (print it instead).
- Add `"herdr:install": "node herdr/install.mjs"` to `package.json` scripts.
- Do not ship `herdr/` in the npm package yet (phase 12 decides).

## Step 2. Find the server (`lib/server.js`)

```js
// Returns { port, cwd, id } for the Bot Lobby server of this folder, or null.
export async function findServer(folder) { … }
```

- Config dir: `home() + "/.pi/bot-lobby"`. A setting in `localStorage` (`bot-herdr.configDir`) overrides it (for `BOT_LOBBY_CONFIG_DIR` users; mods cannot read env vars, `exec("printenv", ["BOT_LOBBY_CONFIG_DIR"])` is the fallback).
- List `<configDir>/web-projects/` with `fs.readdir`, read each `^[a-f0-9]{32}\.json$` with `readTextFile`. Keep records whose `cwd` equals `folder` (normalise: no trailing slash; on Windows compare lower-case with `/`).
- The record's `pid` may be dead (the registry cleans up only on its own start). Confirm with `status.get`; on a refused connection treat it as not running.
- Several records for one folder: the newest `startedAt` that answers.
- The dsh port (see `compare-dsh.md`) will serve the same calls at `/bot-lobby/api/<call>?workspace=<folder>`. Keep the base path in one constant (`API_BASE = "/api/"`) so switching is a one-line change plus auth.

## Step 3. Cookie (`lib/hmac.js`, `lib/auth.js`)

- `web.json` = `{ "secret": "<base64 of 32 bytes>" }` at `<configDir>/web.json`.
- `sessionValue = base64url(HMAC_SHA256(secret, "bot-lobby session v1"))` with no padding (matches `src/webui/auth.ts` `derive`).
- Cache per config dir. On any `401` from the server: re-read `web.json` once (the person may have run `/bot-lobby web reset`), retry once, then show "Sign-in failed" in the view.
- Unit check: a `herdr/test/hmac.test.mjs` run by `node --test` that imports `lib/hmac.js` with a tiny shim for `crypto.createHash` (Node's) and compares against `crypto.createHmac`. Add it to `npm test`'s file list.

## Step 4. API calls (`lib/api.js`)

```js
export async function call(server, name, body = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}${API_BASE}${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `bl_session=${await cookieFor(server)}` },
    body: JSON.stringify(body),
  });
  const reply = await res.json(); // { ok, result } | { ok: false, error, code }
  if (!reply.ok) throw Object.assign(new Error(reply.error), { code: reply.code, status: res.status });
  return reply.result;
}
```

- Body limit 1 MB (server). Uploads use `upload(server, path)` (phase 05): `POST /api/files.upload?name=<n>&type=<mime>` with the raw bytes (`fs.readFile(path)` → `Uint8Array`) and content-type of the file. `fetch` sends `Uint8Array` bodies; its limit is 8 MiB.
- `503` with code `failed` and message "switching" means pi is between sessions: retry after 500 ms, up to 5 times.
- `fetch` has a 30 s timeout and returns text/JSON only (no binary). Binary files are never fetched; see phase 05 for images.

## Step 5. Event stream (`lib/stream.js`)

```js
// Opens GET /api/events on a raw socket. Calls onEvent(StreamEvent) for each frame.
// Returns { close() }. Reconnects with 0.5 s, 1 s, 2 s, 4 s, then every 8 s.
export function openStream(server, query, onEvent, cx) { … }
```

- Request line and headers exactly as in spike check 4. `query` carries `activityAfter`, `thoughtsAfter`, `chatAfter` (last ids seen) so a reconnect gets only what was missed.
- Parse the status line; on 401 re-auth (step 3) once; on other non-200 back off.
- Decode `Transfer-Encoding: chunked` (hex size line, data, CRLF; size 0 ends). Then split on `\n\n`, ignore lines starting with `:`, join `data:` lines, `JSON.parse`.
- Events: `hello {versions}`, `changed {topic, version}`, `feed {activity, thoughts, chat}`, `reply {text}`, `notice {text, level}`.
- Read loop in `cx.spawn(async (cx) => { … })`. `close()` sets a flag and calls `socket.close()`. In the view's `async close(cx)` call it.

## Step 6. Store (`lib/store.js`)

Two designs; choose by spike check 7.

- **Copies share module state** (one runtime): one store object per server in a module-level `Map`. One stream per server for topics, opened by the first view that needs it and closed when the last view closes. Views subscribe and call `cx.notify()` on change.
- **Each copy has its own runtime** (likely): the `strip` view (phase 04, always present in the layout) owns the topic stream and writes only small facts into herdr shared state: `setShared("bot-herdr/<port>/versions", {topic: version})` and `setShared("bot-herdr/<port>/notice", {text, level, at})`. Every view re-renders when shared state changes (herdr does that), compares versions with what it last loaded, and refetches only its own topics. The Lobby view opens the second stream (feed + reply) for itself. That keeps it at two streams.

Topic → calls (from `webui/src/lib/store.ts`; check it):

| Topic | Refetch |
|---|---|
| `lobby` | `lobby.snapshot` (Lobby view only) |
| `tasks` | `tasks.list`, open task's `tasks.get` |
| `plans` | `plans.get` for the open plan |
| `planner` | `planner.get` |
| `sessions` | `sessions.list` |
| `knowledge` | `knowledge.files`, `knowledge.ledger` |
| `prompts` | `prompts.list` |
| `status` | `status.get` |
| `metrics`, `notices` | as the web app does |

## Step 7. `main.js`

```js
import { View, div } from "gpui-kit";
import { props } from "herdr";
import { views } from "./views/index.js";
export default class BotHerdr extends View {
  init(p, cx) { this.view = new (views[p.view] ?? views.missing)(p, cx); }
  render(cx) { return this.view.render(cx); }
  async close(cx) { await this.view.close?.(cx); }
}
```

Each view module is a plain class with `init`, `render`, `close`. Start with `views.missing` ("Unknown view") and `views.debug` (server found, port, signed in, last event).

## Done when

- `npm run herdr:install` installs; `herdr-app check` passes; `herdr-app status` shows no bot-herdr error.
- A block `{ "mod": "bot-herdr", "props": { "view": "debug" } }` shows the port, "signed in", and the last stream event, live, in a space whose folder runs pi with Bot Lobby.
- Kill pi: the debug view says "Not running" within 10 s and recovers when pi restarts, without reloading the mod.
- `node --test herdr/test/hmac.test.mjs` passes.
