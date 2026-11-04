# 04. Shell: layout, page strip, sessions, project binding

Goal: a herdr layout named **Bot Lobby** that frames every page, a page strip, the sessions list, and a clean "not running here" state with a Start button.

## Read first

- herdr `AGENTS.md`: "Layouts", "The look", "Pane frames", "Floating blocks", "Keys", "Commands" (`layout.select`, `layout.toggle`, `tab.new`, `terminal.open`, `agent.focus`).
- herdr shipped `layouts/main.json`, mods `spaces`, `agents`, `tabs`, `workspace-chrome`, `workspace-status`.
- Bot Lobby: `webui/src/app/Shell.tsx`, `Sidebar.tsx`, `TabIcons.tsx`, `SessionMenu.tsx`, `sessionList.ts`, `router.ts`, `tabs/registry.tsx`; `src/webui/api/sessions.ts`.

## Step 1. The layout file `herdr/layouts/bot-lobby.json`

Start from `herdr-app do layout.clone '{"name":"main","as":"bot-lobby"}'`, then edit the copy into this tree and save it to the repo:

```json
{ "id": "root", "type": "row", "preview": "layouts/bot-lobby.svg",
  "theme": { "light": "paper", "dark": "graphite" },
  "colors": { "accent": "#c96442" },
  "children": [
    { "id": "sidebar", "type": "column", "size": { "px": 260 }, "min": 44, "max": 420,
      "children": [
        { "id": "spaces", "type": "block", "content": { "mod": "spaces" } },
        { "id": "sessions", "type": "block", "content": { "mod": "bot-herdr", "props": { "view": "sessions" } } },
        { "id": "agents", "type": "block", "size": { "weight": 0.6 }, "content": { "mod": "agents" } } ] },
    { "id": "work", "type": "column", "padding": [5, 5],
      "children": [
        { "id": "strip", "type": "block", "size": { "px": 40 }, "content": { "mod": "bot-herdr", "props": { "view": "strip" } } },
        { "id": "body", "type": "row", "gap": 6,
          "children": [
            { "id": "pages", "type": "stack", "active": "lobby",
              "children": [
                { "id": "lobby", "type": "block", "content": { "mod": "bot-herdr", "props": { "view": "lobby" } } },
                { "id": "tasks", "type": "block", "content": { "mod": "bot-herdr", "props": { "view": "tasks" } } },
                { "id": "plan", "type": "block", "content": { "mod": "bot-herdr", "props": { "view": "plan" } } },
                { "id": "knowledge", "type": "block", "content": { "mod": "bot-herdr", "props": { "view": "knowledge" } } },
                { "id": "settings", "type": "block", "content": { "mod": "bot-herdr", "props": { "view": "settings" } } } ] },
            { "id": "side", "type": "stack", "active": "terminals", "hidden": true, "size": { "weight": 0.8 }, "min": 320,
              "children": [
                { "id": "terminals", "type": "block", "content": { "tab": "active",
                  "pane": { "gap": 6, "radius": 10, "border": { "width": 1, "color": "border" }, "focus": { "width": 1, "color": "accent" } } } },
                { "id": "code", "type": "block", "content": { "mod": "bot-herdr", "props": { "view": "code" } } } ] } ] } ] } ] }
```

- The accent override is the light value. A dark-only override is not possible per appearance in one `colors` map; check `AGENTS.md` "The look" for the current rule and, if needed, ship `themes/bot-lobby-light.json` and `themes/bot-lobby-dark.json` (Bot Lobby's palette from `src/webui/palette-core.ts`: light background `#faf9f5`, card `#ffffff`, primary `#c96442`; dark background `#262624`, card `#30302e`, primary `#d97757`) and set `"theme": { "light": "bot-lobby-light", "dark": "bot-lobby-dark" }`. That is the better choice; it keeps Claude-style light and dark.
- Draw `herdr/layouts/bot-lobby.svg` (a simple frame picture of the tree above) for Settings' layout picker.
- Every page copy stays alive while hidden (herdr keeps stack children running). Keep their timers off when hidden: none of them should have timers anyway (rule A4).

## Step 2. Page strip (`views/strip.js`)

- Left: page pills **Lobby, Tasks, Plan, Knowledge, Settings**. Each runs `run("layout.select", { stack: "pages", child: "<id>" })` and remembers it in `setShared("bot-herdr/page", id)`. The chosen pill is a neutral recess (`selected` bg, radius 10), not accent-filled, like today's tab pills. Icons from `webui/src/app/TabIcons.tsx` redrawn as one-colour SVGs in `icons/`. Show a count badge on Tasks (running tasks) and Knowledge (inbox items), from the shared versions.
- Right: **Terminal** and **Code** toggles. Terminal: `layout.show {id: "side"}` + `layout.select {stack: "side", child: "terminals"}`; again hides it. If the space has no terminal tab yet, `terminal.open { folder: <space folder>, place: "tab" }` first. Code: same with child `code`.
- Far right: the Orchestrator status (from `agents()` filtered to the space, `app === "bot-lobby"`): working mark when working (phase 05 part D), "Needs you" in `blocked` colour when blocked. Click → `agent.focus { terminal }`.
- This view owns the topic stream when copies do not share state (phase 02 step 6). It also turns `notice` events into `notify({ title: text, level })`.

## Step 3. Space ↔ project binding

Every view resolves its server the same way:

1. `focused().space` → `spaces().find(s => s.id === …)`.
2. Folder = the space's first terminal's live folder (`panes().find(p => p.tab === activeTab && p.cwd)?.cwd`), else `space.folder`. Walk up to the git root with `exec("git", ["rev-parse", "--show-toplevel"], { cwd })` (Bot Lobby's project root is the git root; see `detectProjectRoot`).
3. `findServer(root)` (phase 02).
4. Remote spaces (`space.machine` not null): not supported in v1. Show "Bot Lobby runs on this computer only" (see `gaps.md`).

Cache the answer per space id; re-resolve when the space's folder changes or the stream drops.

## Step 4. "Not running here" state (every page view)

When no server answers for the space:

- Title "Bot Lobby isn't running here", one line "Start it to use this project with Bot Lobby.", button **Start Bot Lobby**.
- Start: `run("tab.new", { space, name: "Orchestrator", folder: root, argv: ["pi"] })`. The person's shell runs pi; phase 03 keeps the browser shut. Then wait for a new `web-projects` record for `root`: `watchFolder(<configDir>/web-projects)` in a `cx.spawn` loop, up to 30 s, then resolve again.
- If `pi` is not installed (`exec("pi", ["--version"])` rejects): show "pi isn't installed" and the install line from `README.md`.
- Never start pi on your own. Only the button does.

## Step 5. Sessions list (`views/sessions.js`)

Port of `webui/src/app/Sidebar.tsx` sessions part:

- Header row: "Sessions", **New session** row button (`sessions.new`, then `sessions.switch`).
- Rows 36 px, 14 px text, one line, truncated; current session in `selected`; a busy session shows the working mark on the left (phase 05 part D); a session waiting on the person shows `blocked` text "needs you".
- Hover "…" menu (a `Popover` anchored to the button): Rename (inline `Input`), Archive, Delete (confirm with herdr's `confirm` mod: `openOverlay({ mod: "confirm", kind: "dialog", props: {…} })`; read `mods/confirm/main.js` for its props). Keys R / A / D inside the menu.
- Archived shelf collapsed at the bottom ("Archived (n)").
- Click a row: `sessions.switch { sessionId }`; the Lobby page refetches on the `sessions` / `lobby` topic change.
- Narrow sidebar (< 160 px, herdr folds to 44): draw nothing but the New session icon.

## Step 6. Keys (`herdr/keys.json`)

```json
{ "layout:bot-lobby": {
    "alt-1": { "command": "layout.select", "args": { "stack": "pages", "child": "lobby" } },
    "alt-2": { "command": "layout.select", "args": { "stack": "pages", "child": "tasks" } },
    "alt-3": { "command": "layout.select", "args": { "stack": "pages", "child": "plan" } },
    "alt-4": { "command": "layout.select", "args": { "stack": "pages", "child": "knowledge" } },
    "alt-5": { "command": "layout.select", "args": { "stack": "pages", "child": "settings" } },
    "ctrl-shift-j": { "command": "layout.toggle", "args": { "id": "side" } },
    "ctrl-shift-n": "bot-herdr.new-session" },
  "mod:bot-herdr": { "escape": "bot-herdr.escape" } }
```

Check each against today's shortcuts (`status.get` → `keys`, and `webui/src/lib/hotkeys.ts`) and herdr's defaults (`keys()`); never take a plain ctrl+letter (AGENTS.md "Keys").

## Done when

- `npm run herdr:install`, then `herdr-app do layout.switch '{"name":"bot-lobby"}'` shows the layout with no `layout.error`.
- In a space running pi + Bot Lobby: pills switch pages, Terminal opens herdr terminals beside the page, sessions list switches sessions.
- In a space without Bot Lobby: every page shows the Start state; Start opens an "Orchestrator" tab and the pages come alive within 30 s.
- `ctrl-shift-l` switches back to herdr's own layout and nothing of bot-herdr is left on screen.
