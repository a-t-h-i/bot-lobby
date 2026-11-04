# 11. Code view and terminal

Goal: see what the agents changed (list, file, diff, light edits) beside the page, and use real terminals, all inside the Bot Lobby layout.

## Read first

- `webui/src/app/code/*` (CodeViewer, CodeSurface, codeStore, FileLink), `webui/src/app/TerminalDrawer.tsx`, `TerminalView.tsx`, `runInTerminal.ts`.
- `src/webui/code.ts`, `src/webui/api/index.ts` routes `code.changes`, `code.read`, `code.save`; `src/webui/protocol.ts` (`CodeChanges`, `CodeFile`, `CodeSaved`).
- herdr: `EditorState` / `Editor` in `gpui-kit.d.ts`; shipped mods `changes` and `files` (read them; do not edit them).

## Part A. Code view (`views/code.js`, shown in the layout's `side` stack, child `code`)

1. **Changes list** (`code.changes`): files with status letter (M / A / D / R / U) and +/− counts, grouped by folder, 30 px rows. `truncated` → "Showing the first N".
2. **Open a file** (`code.read { path }` → `CodeFile` with `contents` and `original` when changed):
   - Mode switch: **Code** | **Diff** | **Split**.
   - Code: `Editor.new(EditorState.new({ language, value: contents, readonly: true, font_family: settings().font_family, syntax: { keyword: theme().ansi5, string: theme().ansi2, comment: theme().dim, function: theme().ansi4, type: theme().ansi3, number: theme().ansi1 } }))`. Language from the extension (map in `lib/lang.js`; unknown → no highlighting).
   - Diff (unified): compute a line diff of `original` vs `contents` in `lib/diff.js` (Myers, O(ND); cap at 5000 lines per side, else "Too big to diff here" and Code mode). Draw rows in a `v_virtual_list`: gutter with old/new line numbers, `+` rows on a green tint, `−` rows on a muted red tint (owner prefers muted reds), context rows plain; 3 lines of context, folded runs as "⋯ 42 lines".
   - Split: two columns of the same rows, aligned.
   - Binary / too large: say so (`binary`, `tooLarge`).
3. **Edit**: an Edit button turns the Code editor writable (`readonly: false`, a new `EditorState`); Save (ctrl-s via `mod:bot-herdr` key → `nextCommand`) → `code.save { path, contents, mtimeMs }`; a conflict (file changed on disk) shows the server's notice and offers Reload.
4. **Open from elsewhere**: chat links, the files card, delivery review call `openCode(path, mode)` which does `setShared("bot-herdr/code", { path, mode })`, `layout.show { id: "side" }`, `layout.select { stack: "side", child: "code" }`. The code view reacts to the shared value.
5. Optional: "Open in herdr pane" button: `pane.split { direction: "right", mod: "files", props: { … } }` is herdr's own viewer; check the shipped `files` mod's props first.

## Part B. Terminal

Bot Lobby's terminal drawer (server-side ptys streamed to xterm.js) is **not** ported. herdr's terminals are better: real panes kept by herdr-core, scrollback, search, images, splits.

- The strip's **Terminal** toggle shows the `side` stack's `terminals` child, which is the space's active tab (`{ "tab": "active" }`).
- If the space has no plain shell tab, Terminal runs `terminal.open { folder: <project root>, place: "tab", name: "Terminal" }` first.
- "Run in terminal" actions (today's `runInTerminal.ts`, e.g. a command in a task): `terminal.open { argv: [...], folder, place: "down" }`; or send to an existing shell with `hc(["send", <terminal>, text])`.
- The Orchestrator's own tab ("Orchestrator", phase 04) is a terminal too; the strip's status opens it with `agent.focus`.

## Done when

- `herdr-app check` passes.
- After an agent edits files: the list shows them, Diff and Split look right on a 300-line change, a light edit saves, a link in chat opens the right file on its diff.
- Terminal toggle opens a shell in the project folder beside the page.
