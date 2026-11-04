# Lookup tables: what replaces what

Checked on Bot Lobby main `94b436a` and herdr-app `93b097f` (0.1.13). Confirm every herdr name with the app home's `.d.ts` files (builder rules, section B).

## Web app pieces → herdr pieces

| Bot Lobby web app (`webui/src`) | bot-herdr | herdr piece used | Phase |
|---|---|---|---|
| `main.tsx`, `App.tsx`, router | `main.js` + `props.view` | mod with props, layout `stack` | 02, 04 |
| `lib/api.ts` | `lib/api.js` | `fetch` with `cookie` header | 02 |
| `lib/events.ts` (EventSource) | `lib/stream.js` | `net.connect` raw socket, chunked + SSE parsing | 02 |
| `lib/store.ts` | `lib/store.js` | module state or `shared` / `setShared` | 02 |
| `app/SignIn.tsx` (link token) | `lib/auth.js` | `readTextFile` of `web.json`, HMAC | 02 |
| `app/Shell.tsx`, tab pills, `TabIcons.tsx` | `views/strip.js` | `layout.select`, `layout.toggle`, `svg()` icons | 04 |
| `app/Sidebar.tsx`, `SessionMenu.tsx` | `views/sessions.js` | sidebar block, `Popover`, herdr `confirm` mod | 04 |
| `app/ProjectSwitcher.tsx`, project folder dialog | herdr spaces | `spaces()`, `space.new`, `pickFolder` | 04 |
| `app/AppTools.tsx`, appearance popover | herdr Settings | `app.settings`, themes | 10 |
| `tabs/lobby/Conversation.tsx`, `ChatParts.tsx` | `views/lobby/conversation.js` | `TextView.markdown`, `v_virtual_list` | 05 |
| `tabs/lobby/InlineActivity.tsx`, `InlineThinking.tsx` | `views/lobby/activity.js` | `Accordion` or own fold, `cx.timer` clock | 05 |
| `tabs/lobby/weave.ts`, `thoughtSteps.ts`, `route.ts`, `busy.ts`, `lib/format.ts` | `shared.js` (bundled, reused as is) | esbuild bundle | 05 |
| `ui/WorkingMark.tsx` | `lib/working.js` | `svg().spin()`, `.loop("opacity")` | 05 |
| `tabs/lobby/RoleWord.tsx` | `lib/roleword.js` | `.loop("opacity")`, `.loop("top"/"left")`, `setShared` for the pick | 05 |
| `tabs/lobby/TaskWidgets.tsx`, `SessionFiles.tsx` | floating cards in the Lobby view | `on_size_change`, `Accordion`, `Checkbox` look | 05 |
| `app/Composer.tsx`, `composer/*` | `lib/composer.js` | `TextareaState` + `Textarea`, inline tokens, `Popup`, `on_drop` | 05 |
| `composer/ToastBubble.tsx`, `lib/toast.ts` | `notify()` | herdr `toast` mod | 04 |
| `ui/Attachments.tsx`, `lib/uploads.ts` | composer chips | `fs.readFile`, `fetch` with `Uint8Array` body | 05 |
| `ui/Lightbox.tsx` | image window | `openOverlay({ kind: "window" })`, `image()` | 05 |
| `prompts/Drawer.tsx`, `payload.ts`, `nav.ts`, `putAway.ts` | `lib/question.js` | own drawer, `Input`, `Textarea` | 06 |
| `prompts/MockupViewer.tsx`, `StaticPreview.tsx` | mockup window + browser | `window` overlay, `exec` open, `TextView.html` thumbnail | 06 |
| `tabs/tasks/*` | `views/tasks/*` | `h_flex` split, `confirm` dialogs | 07 |
| `tabs/plan/*` | `views/plan/*` | split column, `Input` under a line | 08 |
| `tabs/knowledge/*` | `views/knowledge/*` | cards, `Editor` in a window | 09 |
| `tabs/settings/*`, `ui/EffortChoice.tsx`, `ui/Segmented.tsx` | `views/settings/*` | `Slider`, `NumberInput`, `Switch`, `Select`, `Combobox`, `.spring()` | 10 |
| `app/code/*` (Shiki) | `views/code.js` | `Editor` (readonly, syntax), own diff rows | 11 |
| `app/TerminalDrawer.tsx`, `TerminalView.tsx` (xterm.js) | not ported | herdr terminals: `{ "tab": "active" }`, `terminal.open` | 11 |
| `ui/TipLayer.tsx` (tooltips) | herdr `HoverCard` | `HoverCard` with `open_delay` | all |
| `ui/ScrollHints.tsx` | `Scrollbar` mode `hover` | `Scrollbar` | all |
| `lib/hotkeys.ts`, `app/useLobbyKeys.ts` | `herdr/keys.json` + `nextCommand()` | keys sections `layout:bot-lobby`, `mod:bot-herdr` | 04 |
| `app/install.ts` (PWA), `public/` icons | not needed | herdr is the app | — |
| `lib/uiScale.ts` (90% scale) | not needed | herdr `zoom` | — |
| themes, `palette-core.ts` picker | herdr themes | `themes/bot-lobby-light.json`, `-dark.json` | 04 |

## API calls → screens

| Calls | Screen |
|---|---|
| `status.get` | strip, composer (`commands`), shortcuts |
| `lobby.snapshot`, `lobby.history`, `lobby.send`, `lobby.abort`, `lobby.retention`, `lobby.setRetention` | Lobby, Settings → Lobby |
| `sessions.list`, `.new`, `.switch`, `.rename`, `.archive`, `.delete`, `.chat`, `.start`, `.stop`, `.message`, `.answer` | sessions list, questionnaire (background dialogs) |
| `tasks.list`, `.archived`, `.get`, `.open`, `.resume`, `.accept`, `.skipStep`, `.forceClose`, `.resolveApproval`, `.deliveryReview`, `.deliver`, `.deliveryDefer`, `.comments`, `.comment`, `.editComment`, `.archive`, `.restore`, `.delete`, `.auto`, `.message` | Tasks, Lobby tasks card |
| `plans.get`, `.start`, `.discard` | Tasks (plan rows) |
| `planner.get`, `.new`, `.send`, `.editMessage`, `.toggleSeat`, `.retry`, `.commentLine`, `.answer`, `.save`, `.previous`, `.previousGet`, `.previousArchive`, `.previousDelete`, `.previousOpen` | Plan |
| `prompts.list`, `.answer`, `.dismiss` | questionnaire |
| `knowledge.files`, `.ask`, `.open`, `.edit`, `.add`, `.remove`, `.replaceFile`, `.comment`, `.ledger`, `.pin`, `.restore`, `.move`, `.accept`, `.dismiss`, `.unnote` | Knowledge |
| `code.changes`, `.read`, `.save` | code view, files card, delivery review |
| `settings.get`, `.set`, `.linters`, `.lintSetup`, `.lintRule`, `.lintCreate`, `.grants`, `.harnesses` | Settings |
| `themes.*` | not used (herdr owns themes) |
| `terminal.*`, `GET /api/terminal.stream` | not used (herdr terminals) |
| `projects.self`, `.list`, `.browse`, `.open` | not used (spaces) |
| `POST /api/files.upload` | composer attachments |
| `GET /files/preview/<task>/<name>` | images (via curl cache) |
| `GET /api/events` | stream (topics, feed, reply, notice) |
