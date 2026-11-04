# Lookup tables: what replaces what

Checked on Bot Lobby main `94b436a` and herdr-app `93b097f` (0.1.13). Confirm every herdr name with the app home's `.d.ts` files and every harness flag with the installed CLI (builder rules, section B).

## pi → daemon and harnesses

| pi / today | bot-herdr | Phase |
|---|---|---|
| `src/index.ts` pi extension entry | `bot-lobby serve` daemon (`src/daemon/main.ts`) running the same registration on a `Host` | 02 |
| `ExtensionAPI` calls across 34 files | `Host` interface (`src/host/host.ts`) | 02 |
| `pi.registerTool` | `Host.registerTool` → Bot Lobby MCP server (`src/daemon/mcp/`), tools seen as `mcp__bot-lobby__<name>` | 03 |
| `pi.registerCommand` (`/bot-lobby …`) | daemon commands typed in the Lobby (`status.get` → `commands`) and `bot-lobby` CLI subcommands | 05 |
| pi main session (the oracle / Orchestrator) | `OrchestratorSession`: a resumed harness session (Claude Agent SDK / `claude -p --resume`, `codex exec resume`, ACP `session/prompt`) | 03 |
| `before_agent_start` system prompt + tool list | harness instructions (append system prompt / prompt prefix) + MCP tool allowlist per run | 03 |
| `agent_start`, `agent_end`, `tool_execution_*`, `message_update` | the harness stream mapped onto the feed (driver code in `src/harness/*`) | 03 |
| `pi.sendUserMessage` (steer / follow-up) | `sendToOrchestrator`: steer where the harness supports it (Claude streaming input), else queue | 03 |
| `ctx.ui.select` / `editor` / `confirm`, `ask_user_question` | `promptHub` + MCP tool that waits (raised MCP timeout) | 03 |
| `ctx.ui.notify`, `setStatus` | `Host.notify` → `notice` events → herdr toasts; OSC 7501 on the daemon's terminal | 02 |
| `runPiAgent` → `spawnPiProcess` (`pi --mode rpc`) | `runHarnessAgent` only | 04 |
| pi model registry, API keys | harness model lists (`harnessModels`), each harness's own sign-in | 04 |
| thinking levels | `harnessEffort` | 04 |
| pi auto compaction / "Compact at" | the harness's own compaction; mapped where it has a setting | 03 |
| classifier on pi models | remote classifier or rule fallback; harness one-shot when picked | 04 |
| titles, knowledge digest, synthesis on pi models | `Host.complete` = harness one-shot with no tools | 04 |
| background sessions (pi processes) | more `OrchestratorSession`s | 04 |
| `~/.pi/bot-lobby`, `<project>/.pi/` | `~/.bot-lobby`, `<project>/.bot-lobby/` (copied once) | 02 |
| pi TUI (renderers, shortcuts, status line) | gone; the herdr UI and the daemon's log tab | 05 |

## Web app pieces → herdr pieces

| Bot Lobby web app (`webui/src`) | bot-herdr | herdr piece used | Phase |
|---|---|---|---|
| `main.tsx`, `App.tsx`, router | `main.js` + `props.view` | mod with props, layout `stack` | 06, 07 |
| `lib/api.ts` | `lib/api.js` | `fetch` with `cookie` header | 06 |
| `lib/events.ts` (EventSource) | `lib/stream.js` | `net.connect` raw socket, chunked + SSE parsing | 06 |
| `lib/store.ts` | `lib/store.js` | module state or `shared` / `setShared` | 06 |
| `app/SignIn.tsx` (link token) | `lib/auth.js` | `readTextFile` of `web.json`, HMAC | 06 |
| `app/Shell.tsx`, tab pills, `TabIcons.tsx` | `views/strip.js` | `layout.select`, `layout.toggle`, `svg()` icons | 07 |
| `app/Sidebar.tsx`, `SessionMenu.tsx` | `views/sessions.js` | sidebar block, `Popover`, herdr `confirm` mod | 07 |
| `app/ProjectSwitcher.tsx`, project folder dialog | herdr spaces | `spaces()`, `space.new`, `pickFolder` | 07 |
| `app/AppTools.tsx`, appearance popover | herdr Settings | `app.settings`, themes | 13 |
| `tabs/lobby/Conversation.tsx`, `ChatParts.tsx` | `views/lobby/conversation.js` | `TextView.markdown`, `v_virtual_list` | 08 |
| `tabs/lobby/InlineActivity.tsx`, `InlineThinking.tsx` | `views/lobby/activity.js` | `Accordion` or own fold, `cx.timer` clock | 08 |
| `tabs/lobby/weave.ts`, `thoughtSteps.ts`, `route.ts`, `busy.ts`, `lib/format.ts` | `shared.js` (bundled, reused as is) | esbuild bundle | 08 |
| `ui/WorkingMark.tsx` | `lib/working.js` | `svg().spin()`, `.loop("opacity")` | 08 |
| `tabs/lobby/RoleWord.tsx` | `lib/roleword.js` | `.loop("opacity")`, `.loop("top"/"left")`, `setShared` for the pick | 08 |
| `tabs/lobby/TaskWidgets.tsx`, `SessionFiles.tsx` | floating cards in the Lobby view | `on_size_change`, `Accordion`, `Checkbox` look | 08 |
| `app/Composer.tsx`, `composer/*` | `lib/composer.js` | `TextareaState` + `Textarea`, inline tokens, `Popup`, `on_drop` | 08 |
| `composer/ToastBubble.tsx`, `lib/toast.ts` | `notify()` | herdr `toast` mod | 07 |
| `ui/Attachments.tsx`, `lib/uploads.ts` | composer chips | `fs.readFile`, `fetch` with `Uint8Array` body | 08 |
| `ui/Lightbox.tsx` | image window | `openOverlay({ kind: "window" })`, `image()` | 08 |
| `prompts/Drawer.tsx`, `payload.ts`, `nav.ts`, `putAway.ts` | `lib/question.js` | own drawer, `Input`, `Textarea` | 09 |
| `prompts/MockupViewer.tsx`, `StaticPreview.tsx` | mockup window + browser | `window` overlay, `exec` open, `TextView.html` thumbnail | 09 |
| `tabs/tasks/*` | `views/tasks/*` | `h_flex` split, `confirm` dialogs | 10 |
| `tabs/plan/*` | `views/plan/*` | split column, `Input` under a line | 11 |
| `tabs/knowledge/*` | `views/knowledge/*` | cards, `Editor` in a window | 12 |
| `tabs/settings/*`, `ui/EffortChoice.tsx`, `ui/Segmented.tsx` | `views/settings/*` | `Slider`, `NumberInput`, `Switch`, `Select`, `Combobox`, `.spring()` | 13 |
| `app/code/*` (Shiki) | `views/code.js` | `Editor` (readonly, syntax), own diff rows | 14 |
| `app/TerminalDrawer.tsx`, `TerminalView.tsx` (xterm.js) | not ported | herdr terminals: `{ "tab": "active" }`, `terminal.open` | 14 |
| `ui/TipLayer.tsx` (tooltips) | herdr `HoverCard` | `HoverCard` with `open_delay` | all |
| `ui/ScrollHints.tsx` | `Scrollbar` mode `hover` | `Scrollbar` | all |
| `lib/hotkeys.ts`, `app/useLobbyKeys.ts` | `herdr/keys.json` + `nextCommand()` | keys sections `layout:bot-lobby`, `mod:bot-herdr` | 07 |
| `app/install.ts` (PWA), `public/` icons | not needed | herdr is the app | — |
| `lib/uiScale.ts` (90% scale) | not needed | herdr `zoom` | — |
| themes, `palette-core.ts` picker | herdr themes | `themes/bot-lobby-light.json`, `-dark.json` | 07 |

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
