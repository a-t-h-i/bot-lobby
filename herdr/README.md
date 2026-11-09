# Bot Lobby for herdr

Bot Lobby's interface redrawn as a [herdr](https://github.com/herdrdev/herdr-app) desktop mod, so one Bot Lobby-style window drives every agent herdr runs (Claude Code, Codex, pi, Gemini, any harness and model you set up there).

herdr mods are JavaScript that describe native GPUI elements. There is no web view, so the React app can't be dropped in. Each piece is redrawn to match the web app's design (`webui/src`, `docs/web-ui/composer-design`).

Round 1 is **the composer**.

## Install

```sh
node herdr/install.mjs --switch
```

This copies `mods/bot-composer` into herdr's app home (`~/.config/herdr-app`, or `$HERDR_APP_HOME`). It also adds the `bot-lobby` layout and its Claude light and dark themes, and binds **ctrl+shift+m** to the composer. Then it runs `herdr-app check` on the mod and switches the window to the layout. `ctrl+shift+l` cycles layouts, so you can switch back to herdr's own.

Edits under `herdr/` take effect after another `node herdr/install.mjs`, because herdr hot-reloads the copied mod.

## The composer

It's the web app's bubble: the text on top, and a tools row under it with attach, the space chip, key hints, stop and a round send key. The suggestions, attach menu and spaces list grow out of its top edge, joined by curved fillets.

- **Enter** sends. **Shift+Enter** starts a new line.
- A message goes to the agent you were last in: the focused pane's agent, else the newest in that tab. Its name shows as "to …" in the tools row.
- **@** lists agents:
  - running ones (this space first)
  - `@all` (every agent in this space)
  - `@new-<agent>` for each installed agent, which starts it in a new tab with your message
  - Mention several agents to send to all of them. Up, Down, Enter, Tab and Esc work as in the web app.
- **/new** starts an agent. **/all** sends to everyone here. **/stop** presses the agent's stop key. **/peek** peeks at its terminal. Any other `/command` goes to the agent as typed, so `/compact`, `/model` and the rest still work.
- **Attach**: drop files on the composer, use "Attach document…" (the system file picker), or use "Attach folder…". Each path is added to the message on its own line. For agents on another machine, files go over with `hc put` first.
- **Stop** (red key) shows while the target agent is working.
- The **space chip** lists spaces and has "Open folder…".

Sending uses `hc send` (paste, then Enter), stopping uses `hc interrupt`, and starting uses `tab.new {argv, task}`.

## Files

| Path | What |
|---|---|
| `mods/bot-composer/main.js` | the view |
| `mods/bot-composer/route.js` | pure logic: triggers, rows, what a send does (tested) |
| `mods/bot-composer/look.js` | colours, sizes and motion from the web app's CSS |
| `mods/bot-composer/icons/` | Lucide icons (ISC licence) and the fillet shapes |
| `layouts/bot-lobby.json` | herdr's main layout plus a 136px composer block under the panes |
| `themes/bot-lobby-{light,dark}.json` | the web app's Claude palette for terminals and panels |
| `test/route.test.mjs` | `npm run test:herdr` |

## Not checked yet

This was written without a running herdr, so `herdr-app check` and a first look in the app are the real test. Three things are most likely to need a tweak:

1. **The bubble floats in a `Popup`** anchored to the block's foot, so it can grow upward over the panes. If that misbehaves, set the block's props to `{ "float": false }` in the layout. The bubble then sits inside the block.
2. **Enter to send** relies on our key binding beating the text box's own Enter at the same depth. If Enter adds a newline instead, the `submit` fallback still sends.
3. Exact method names for `flex_col_reverse`, `shadow_md` and `border_0` come from GPUI's style macros. `herdr-app check` will name any that are missing.

## Next rounds

Sidebar and tab pills floating 5px from the edges, then the Lobby chat view, then the rest of the web app's screens.
