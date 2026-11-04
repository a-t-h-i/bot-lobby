# 01. Spike: go / no-go

Goal: prove in 2 days that a herdr mod can sign in to Bot Lobby's server, call the API, follow the live event stream, and draw a chat list with markdown and a text box. If any **must** check fails, stop the whole plan and write why in `STATUS.md`.

## Read first

- herdr: `~/.config/herdr-app/AGENTS.md` sections "Mods", "A mod", "UI", "The herdr module"; `gpui-kit.d.ts` (`TextView`, `TextareaState`, `Textarea`, `v_virtual_list`); the shipped `mods/agents/main.js`.
- Bot Lobby: `src/webui/server.ts` (`route`, `routeApi`, `openStream`), `src/webui/auth.ts` (`sessionValue`, `COOKIE_NAME`, `isHostAllowed`, `isCrossSite`), `src/webui/events.ts`, `src/webui/protocol.ts` (`StreamEvent`, `LobbySnapshot`), `src/webui/projects.ts` (`registryDirectory`, `ProjectRecord`), `src/state/project.ts` (`globalConfigDir`).

## Setup

1. Install herdr-app (README of herdrdev/herdr-app). Start it once so it writes its app home.
2. In a terminal in a test repo, run `pi` with Bot Lobby on. The web server starts and writes `~/.pi/bot-lobby/web-projects/<id>.json` (`{ id, name, cwd, port, pid, startedAt }`).
3. Make `~/.config/herdr-app/mods/bl-spike/` with `main.js` and `mod.json` `{ "place": "right", "size": 420 }`.

## Checks

| # | Must? | Question | How |
|---|---|---|---|
| 1 | must | Find the server | `fs.readdir` `home() + "/.pi/bot-lobby/web-projects"` (mods get no `~` expansion), `readTextFile` each `*.json`, pick the one whose `cwd` equals the focused space's folder (`spaces().find(s => s.active).folder`; compare after removing a trailing `/`) |
| 2 | must | Compute the cookie | `readTextFile(home() + "/.pi/bot-lobby/web.json")` → `secret` (base64, 32 bytes). Cookie value = base64url(HMAC-SHA256(key = secret, msg = "bot-lobby session v1")). gpui-kit's `crypto` has `createHash` but no `createHmac`: write HMAC from `createHash("sha256")` (RFC 2104: 64-byte block, ipad 0x36, opad 0x5c). Test it against `node -e` output on the same secret |
| 3 | must | Call the API | `fetch("http://127.0.0.1:<port>/api/status.get", { method: "POST", headers: { "content-type": "application/json", cookie: "bl_session=<value>" }, body: "{}" })` → `{ ok: true, result: StatusInfo }` |
| 4 | must | Live events | `import { connect } from "net"`; `connect("127.0.0.1", port)`; write `GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:<port>\r\nCookie: bl_session=<value>\r\nAccept: text/event-stream\r\n\r\n`; read in a `cx.spawn` loop. Node sends `Transfer-Encoding: chunked`: decode chunks, then split SSE frames on `\n\n`, parse `data: {json}`. See `hello`, then `changed` when you send a message from pi, and `:ping` every 15 s. The socket read timeout is 30 s, so the 15 s ping keeps it open |
| 5 | must | Chat list | `lobby.snapshot` → `chat[]`; draw each with `TextView.markdown(id, text)` in a scrolling column. Check headings, lists, bold, inline code, fenced code, tables, links |
| 6 | must | Send | A `Textarea` (`TextareaState.new({ placeholder })`, `set_auto_grow(1, 8)`); on `submit` call `lobby.send { text }`. The reply streams in through `reply` events |
| 7 | must | Copies share data? | Put the spike in two blocks. Log from a module-level `const started = Date.now()` in each. If both copies see the same value, module state is shared; if not, each copy has its own runtime. Write the answer in `STATUS.md`: phase 02's store design depends on it |
| 8 | nice | Images | Copy a PNG into `~/.config/herdr-app/data/bl-spike/x.png` with `exec("cp", …)` and show `image("data/bl-spike/x.png")` |
| 9 | nice | HTML text | `TextView.html(id, "<p><b>hi</b> <code>x</code></p>")`: what tags work? (Decides the mockup fallback in phase 06) |
| 10 | nice | Speed | 500 chat rows in `v_virtual_list`: scrolling stays smooth |

## Done when

- Checks 1 to 7 pass, each with a line in `STATUS.md` (what you saw, exact error if any).
- `herdr-app check ~/.config/herdr-app/mods/bl-spike` passes.
- `bl-spike` is deleted afterwards (it is not part of the build).

## If a must check fails

- 2 fails (HMAC wrong): fall back to `exec("node", ["-e", …])` to compute it, if `node` is on PATH (it is, because pi needs it). Note it.
- 4 fails (socket can't stream): fall back to the WebSocket module only if phase 03 adds a WebSocket route (it does not today). Otherwise stop: live chat is the heart of the Lobby.
- 5 fails (markdown too weak): stop and tell the owner; rendering markdown by hand is out of scope.
