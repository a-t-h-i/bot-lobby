# Development environment

## 1. What you need

| Tool | Version | For |
| --- | --- | --- |
| Node.js | 22.18 or newer (22.22.2 was used) | Running `.ts` directly, tests |
| npm | the one with Node | Dependencies |
| Pi | `@earendil-works/pi-coding-agent` 0.87.0 (a devDependency here) | Running bot-lobby for real |
| A Chromium | any recent one; Playwright's (`chromium-1194`) was used | UI checks (`CHROMIUM_PATH`) |
| A model key | any provider Pi supports | Live walkthroughs only; nothing else needs one |

## 2. Working on the page without Pi (most of Lane C)

**Before P2-09 lands,** use the starter:

```bash
cd web-ui-mode/starter
npm install
npm run build && npm run serve      # prints http://127.0.0.1:<port>/#token=…
```

**From P2-09 on,** use the mock server in the repo:

```bash
npm install
npm run web:dev                      # builds webui/, watches, serves with fixtures; prints the link
# add ?scenario=busy (or empty, long, error, questions, …) to the URL to switch fixture sets
```

**To see the page as a phone does:**
- **On the desktop:** open the browser's device toolbar (Chrome DevTools → Toggle device toolbar) and pick a phone. Turn on touch.
- **On a real phone on the same machine (Termux):** see §4.

## 3. Running bot-lobby with the web UI in real Pi

```bash
npm install
npm run web:build                    # after page changes; commit webui/dist with them
pi -e ./src/index.ts                 # load this checkout as an extension
# in Pi:
/bot-lobby web                       # prints the link and opens the browser
```

- **Changing server code** (`src/webui`, `src/lobby`) needs a Pi restart. `/reload` reloads only auto-discovered extensions, and P0-02 checks that it does not leave the old server running.
- **Changing page code** needs `npm run web:build` and a page reload. Bundles are content-hashed, so the browser cannot hold a stale copy.
- **Using an installed copy instead:** install this checkout with `pi install ./` (a local path), as in Pi's `docs/packages.md`.

## 4. Android: Termux and Chrome

This is how the user runs it on a phone or tablet. P0-03 confirms each step and adds what Android needs.
1. **Install Termux and Termux:API** from GitHub or F-Droid (not Google Play). Then:

   ```bash
   pkg update && pkg upgrade
   pkg install nodejs termux-api git
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   pi install git:github.com/a-t-h-i/bot-lobby
   ```

2. **Keep Termux running** while the browser is in front:
   - pull down the Termux notification and tap **Acquire wakelock**, or run `termux-wake-lock`;
   - on Samsung devices, split screen (Termux and Chrome side by side) keeps both in the foreground.
3. **Open the page:** in Pi, run `/bot-lobby web`. It opens Chrome with `termux-open-url`, or you can tap the printed link.
4. **Optional, after P5-03:** in Chrome, use **⋮ → Add to Home screen** to open the lobby like an app.

## 5. Reaching a Pi on another machine

LAN access is off (Q-02). To view a Pi that runs on a server from your laptop, tunnel the port over SSH:

```bash
ssh -L 7347:127.0.0.1:7347 you@server
# then open the link Pi printed on the server, unchanged: http://127.0.0.1:7347/#token=…
```

The server still sees `127.0.0.1:7347` as the host, so every fence holds.

## 6. Checks

```bash
npm run check                        # typecheck (both), all node tests, webui/dist up to date
npm test                             # node tests only
CHROMIUM_PATH=/path/to/chrome npm run web:check   # Playwright checks against the mock (TESTING §4)
```

## 7. Troubleshooting

| Symptom | Cause, and what to do |
| --- | --- |
| The page says "This page needs the link Pi printed" | The cookie is missing or the secret was reset. Run `/bot-lobby web link` and open the new link |
| "Pi is not reachable" in the header | Pi exited, or Android paused Termux (§4.2). It reconnects by itself once Pi is back |
| `EADDRINUSE` | Another program has the port. The server moves to the next free one; `lobby.web.port` changes the first one tried |
| The page looks stale after an update | Reload. Bundles are content-hashed; a PWA picks the update up on the next load (P5-03) |
| A long link is cut off in the terminal | Use `/bot-lobby web` (it opens the browser) or `/bot-lobby web link` on a wider terminal |
