# 08. Lobby

Goal: the Lobby page: the live chat with the team, activity and thinking folded in place, the per-agent working indicators, the composer (with `/` and `@` suggestions and attachments), and the tasks and files cards on a wide pane.

This is the biggest phase. Do the parts in order; commit after each.

## Read first

- Bot Lobby web app: `webui/src/tabs/lobby/*` (all), `webui/src/app/Composer.tsx`, `webui/src/app/composer/ComposerCommandMenu.tsx`, `webui/src/ui/WorkingMark.tsx`, `webui/src/ui/Markdown.tsx`, `webui/src/ui/Attachments.tsx`, `webui/src/ui/Lightbox.tsx`, `webui/src/lib/uploads.ts`, `webui/src/lib/composerContext.ts`.
- API: `src/webui/api/lobby.ts`, `src/webui/protocol.ts` (`LobbySnapshot`, `UploadInfo`, `StatusInfo.commands`), `src/webui/uploads.ts`.
- herdr: `gpui-kit.d.ts` (`TextView`, `TextareaState`, `Textarea`, `Popup`, `v_virtual_list`, `VirtualListScrollHandle`, `Accordion`, motion methods), `AGENTS.md` "Animate natively".

## Part A. Reuse the pure helpers (no rewrite)

Several web app files are pure TypeScript with no React: `tabs/lobby/weave.ts`, `thoughtSteps.ts`, `route.ts`, `busy.ts`, `types.ts`, `lib/format.ts`, `lib/taskTitles.ts`, `lib/phaseTiming.ts`, the role words list behind `RoleWord.tsx`. Do not rewrite them.

- Add `herdr/shared/entry.ts` that re-exports just those functions.
- Add `"herdr:build": "esbuild herdr/shared/entry.ts --bundle --format=esm --platform=neutral --outfile=herdr/mods/bot-herdr/shared.js"` (esbuild comes with Vite; add it as a devDependency if `npx esbuild` is missing). `herdr:install` runs `herdr:build` first.
- If a helper imports React or the DOM, leave it out and port only the pure part into `herdr/mods/bot-herdr/lib/` by hand, with a comment naming the source file.
- `shared.js` is generated: add it to `.gitignore`.

## Part B. Conversation (`views/lobby/conversation.js`)

Data: `lobby.snapshot` once, then the Lobby's own stream (feed + reply, phase 06 step 6) appends `chat`, `activity`, `thoughts` and updates `reply`. Older chat: `lobby.history { before: <oldest id> }` when the person scrolls to the top and `hasOlderChat` is true.

Layout (centred column, max width 900 px, like today):

- Timeline = `weave(chat, activity)` from Part A.
- Agent message: header row (name in the agent's colour, 13 px semibold; time in `dim`), then `TextView.markdown("m-<id>", text).selectable(true)`. Messages from one speaker within five minutes share one header. No agent icons.
- Your message: right-aligned bubble, `raised` background, radius 12, padding 10 / 14, max 80% width; "to <Agent>" in `dim` above it when not to the Master. Long messages fold after 12 lines with "Show more" (today's long-input fold).
- Notes: one centred `dim` line with a hairline on each side.
- Images in a message (`UploadInfo.kind === "image"`): see Part G.
- Links: `.on_link_click((url, cx) => …)`: a link to a project file (`code://` or a relative path, as `webui/src/app/code/FileLink.tsx` decides) opens the code view (phase 14); others open in the system browser with `exec` (`open` on macOS, `xdg-open` on Linux, `cmd /c start ""` on Windows; check `window().platform`).
- Streaming reply: the last agent message shows `reply` text and ends in a beating dot: `div().size(6).rounded(3).bg(<agent colour>).loop("opacity", { from: 0.3, to: 1, period: 900 })`.
- Scroll: a `v_virtual_list` with a `VirtualListScrollHandle`; stick to bottom while the person is at the bottom; otherwise show a "Jump to latest" pill floating above the composer.
- Empty session: today's empty state words (`webui/src/tabs/lobby/LobbyTab.tsx`).

## Part C. Activity and thinking in place

- `InlineActivity`: each folded run is one quiet row: "Worked for 2m 59s · 6 steps · Master, Dev, QA" (`format.ts`). Click toggles open; open rows list steps as `dim` lines with the agent name in colour. While a step runs: the working mark + the agent's verb (Part D) + the step text + a counting clock. The clock is the one allowed display timer: one `cx.timer.every(1000, …)` per Lobby view, only while something runs, cancelled when nothing does.
- `InlineThinking`: under the latest message, a folded row "Dev is thinking · <current step>"; open shows each agent's thought as steps (`thoughtSteps`), each step a `TextView.markdown`.
- Keys: `alt-a` folds/opens every activity run, `alt-t` the thinking row: bind them in `keys.json` section `mod:bot-herdr` as `bot-herdr.toggle-activity` / `bot-herdr.toggle-thinking`, read with `nextCommand()`.

## Part D. Working indicators (owner wants these kept)

- **Working mark** (`lib/working.js`): today a comet circling a faint ring. Draw `icons/ring.svg` (a faint full circle) under `icons/comet.svg` (a short arc with a dot head), both 14 px, stacked with `relative` / `absolute`; `svg("mods/bot-herdr/icons/comet.svg").spin(1100)`; tint both with the agent's colour (ring at 25% via a lighter colour token or a second SVG with lower stroke opacity). One function `workingMark(colour, size)` used everywhere (strip, sessions, activity rows, task card).
- **Role word**: each agent has five verbs (copy the table from `RoleWord.tsx`); one is picked at random and swapped after a random 30 to 60 s; all words for the same agent share the pick (keep the pick in `setShared("bot-herdr/roleword", {agent: {word, until}})`, so every view agrees). The word shimmers: herdr cannot stagger a per-letter shimmer (one clock for every view), so pulse the whole word: `.loop("opacity", { from: 0.55, to: 1, period: 2400 })` in the agent's colour. The small per-role motion (bob, sway…) becomes a 2 px `.loop("top", …)` or `.loop("left", …)` on the word when the role's motion is vertical or horizontal; leave it out for others.
- **Speaker name shimmer** until the reply starts: same pulse on the name in the header.
- Reduced motion: herdr has no reduced-motion signal. Add a bot-herdr setting "Calm motion" (Settings page, `localStorage`) that turns every `loop`/`spin` off.

## Part E. Composer (`views/lobby/composer.js`)

The composer is shared by Lobby, Tasks, Plan and Knowledge (it sends to whoever the page talks to). Build it as `lib/composer.js` with a `target` argument (`lobby.send`, `tasks.message`, `planner.send`, `knowledge.ask`; check each body in `src/webui/api/index.ts`).

- Box: `TextareaState.new({ placeholder: "Write a message…" })` made in `init` (never in `render`), `set_auto_grow(1, 10)`, `set_soft_wrap(true)`. Frame: `surface` background, 1 px `border`, radius 12, padding 10 / 12; focused: 1 px `accent` border. Pinned to the page bottom with 5 px gap, max width 900 px, centred. Content above scrolls under it (keep the last message clear of it with bottom padding equal to the composer's height, measured with `on_size_change`).
- Enter sends, Shift+Enter is a new line: `state.on("submit", …)`; check the `InputEvent.shift` flag.
- Tools row under the text: left **Attach** (paperclip icon), right key hint "↵ send", **Stop** while the Orchestrator works (`lobby.abort`, after herdr's `confirm` dialog: "Stop the reply? What it wrote so far is lost."), **Send** (round, accent `solid`, disabled when empty).
- `/` commands and `@` agents: on `change`, if the text starts with `/` or `@` (at the very start, like today), open a suggestions list above the box: a `Popup.new("suggest", box).anchor("bottom_left")` whose content is a column of 36 px rows (letter tile, name, what it does, a small source tag). Commands from `status.get` → `commands`; agents from the roles list in `status.get` / settings (check `ComposerCommandMenu.tsx` for the exact source). Up/Down/Enter/Tab/Esc: the textarea keeps focus; handle the keys with `.on_key_down` on the wrapper and `cx.stop_propagation()` for the ones you take. Width: the list's own width (owner: never stretch it to the composer's width). Rows fade in with `.transition("opacity", { duration: 120, delay: i * 20 })`.
- `@Agent` chips: use the textarea's inline tokens (`replace_range_with_token({ id: "agent:dev", text: "@Dev", label: "Dev" })`) so a picked agent shows as a chip; on send, the plain text (`value()`) still starts with `@Dev`, which is what the server reads.
- Long paste (over the web app's limit, `webui/src/app/Composer.tsx` → paste handling): on `change`, if one change added more than that many characters, take the pasted run out of the box, write it to `appHome()/data/bot-herdr/paste-<time>.txt` (`fs.writeFile`), upload it (Part F), and show it as an attachment chip.
- Questionnaire takes the composer's place when a prompt waits (phase 09).

## Part F. Attachments

- Attach button: herdr has no file picker for files (`pickFolder` is folders only). Offer: (1) drop files on the composer: `.on_drop((e, cx) => e.paths)`; (2) an "Attach file…" popup with an `Input` for a path and the recent files of the space (`code.changes` list) as quick picks. See `gaps.md`.
- Upload each path: `fs.readFile(path)` (works under the home folder), `POST /api/files.upload?name=<basename>&type=<mime from extension>` with the bytes; result is `UploadInfo`. Files over 8 MiB: say "Too big to attach (8 MB max)".
- Chips above the text: name, size, remove ×. Images get a 40 px thumbnail (Part G).
- `lobby.send { text, attachments: [id…] }`.
- Pasted images: the textarea's `paste_other` event fires but gives no image data. v1: show a toast "Drop the image file instead". (See `gaps.md` for a later fix.)

## Part G. Images

`image()` reads only files under the app home. For an image in chat or an attachment thumbnail:

- If its `UploadInfo` gives a local path (check `src/webui/uploads.ts` for where uploads are saved under the project's `.bot-lobby` folder after phase 02): copy it with `exec("cp", [src, dest])` (Windows: `exec("cmd", ["/c", "copy", src, dest])`) to `appHome()/data/bot-herdr/img/<id>.<ext>` once, then `image("data/bot-herdr/img/<id>.<ext>")`.
- Else (`/files/preview/<task>/<name>` URLs): `exec("curl", ["-sf", "-H", "Cookie: bl_session=…", "-o", dest, url])`. curl ships with macOS, Linux distros and Windows 10+.
- Click an image: a herdr `window` overlay (`openOverlay({ kind: "window", key: "bl-image", mod: "bot-herdr", props: { view: "image", path } })`) showing it as large as fits, Esc closes. That replaces the lightbox.

## Part H. Tasks card and files card (wide pane only)

- Show only when the Lobby view is at least 1360 px wide (`on_size_change` on the root) and something applies, as a floating card at the top left of the chat area (owner asked top-left).
- Tasks card: running tasks from `tasks.list`, one row each: name + "3 / 7". One open at a time (`Accordion`), open shows the plan as a checklist from `tasks.get` (`progress`, `activeSteps`): empty box = to do; accent outline + breathing halo (`.loop("opacity")` on a 2 px accent ring) = current; amber outline = waiting; filled accent + tick = done. Real bordered boxes, not dots (owner rejected dots).
- Files card under it: "Attached" and "Edited" folds (one open at a time). Edited files from `code.changes` filtered to this session's agents' edits (check `SessionFiles.tsx` for the source); click opens the code view on the diff (phase 14). Attached images open the image window.

## Done when

- `herdr-app check` passes; `npx tsc -p herdr/mods/bot-herdr --noEmit` passes.
- In herdr, against a real `bot-lobby serve` with a harness Orchestrator: send a message, watch the activity row and working mark while agents work, the reply streams with the beating dot, thinking opens with `alt-t`, `/` and `@` suggestions work by keyboard, an attached file reaches the agent, an image shows and opens, Stop works with a confirm.
- 1000-message session scrolls smoothly; jumping to latest works.
