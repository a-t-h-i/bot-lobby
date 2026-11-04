# 00. Rules for the builder

Read this before every phase. These rules beat anything a phase file says.

## A. Never do these

1. Never use HTML, CSS, a web view, React, `document`, `window.setTimeout`, `setInterval`, top-level `await` or Node built-ins other than the ones herdr lists (`fs/promises` read in home / write under the app home, `path`, `crypto` hashes, `buffer`, `net`, `websocket`, `fetch`). Mods are gpui-kit JavaScript.
2. Never keep a `cx` and use it later. Every callback gets its own `cx` (`on_click((e, cx) => …)`, `cx.spawn(async (cx) => …)`, `cx.timer.every(ms, (cx) => …)`).
3. Never animate with a timer. Use `.frames([...], ms)`, `svg(path).spin(ms)`, `.loop(prop, {from, to, period})`, `.transition(prop, ms)` or `.spring(prop, …)`. Timers are only for data.
4. Never poll Bot Lobby. Refetch a topic only when the event stream says it `changed`. The one allowed timer is the reconnect backoff.
5. Never open more than two event streams per Bot Lobby server from one herdr window (the server keeps at most 8 and drops the oldest, which would kick a browser that is also open).
6. Never edit herdr's shipped layouts or mods. Clone them (`layout.clone`, `mod.clone`) or write new ones.
7. Never edit `AGENTS.md`, `herdr.d.ts` or `gpui-kit.d.ts` in the app home. Herdr rewrites them on every start.
8. Engine changes only where phases 02 to 05 name them. Never change the logic of `src/state`, `src/schemas`, `src/workflow`, `src/master`, `src/roles`, `src/delivery`, `src/knowledge` beyond their imports and the `Host` interface. The mod lives in `herdr/`.
9. Never hard-code colours in views. Use `theme()` names (`background`, `canvas`, `chrome`, `surface`, `popover`, `raised`, `hover`, `selected`, `border`, `input`, `foreground`, `muted`, `dim`, `accent`, `accent_foreground`, `solid`, `solid_foreground`, `working`, `blocked`, `done`, `idle`). The layout file sets the accent override.
10. Never send the secret or the cookie anywhere but `127.0.0.1:<port>`. Never log them.
11. Never add screenshots, GIFs or browser tests. Never delete a test file without asking the owner.
12. Never invent a herdr API. Check it (section B). If it does not exist, write that in `STATUS.md` and stop.

## B. How to check a herdr API before using it

Herdr updates often (0.1.x). Names in this spec were true on herdr-app `93b097f` (0.1.13). Before you use a function, element, style, command or argument:

1. Read `~/.config/herdr-app/herdr.d.ts` (the `herdr` module) and `~/.config/herdr-app/gpui-kit.d.ts` (elements, components, styles, `Context`). Both are written by the installed app and match it exactly.
2. Read `~/.config/herdr-app/AGENTS.md` (the guide).
3. `herdr-app commands` for every command and its arguments.
4. Read the shipped mods in `~/.config/herdr-app/mods/` (`agents`, `spaces`, `tabs`, `files`, `changes`, `menu`, `prompt`, `toast`, `worktree`) for working examples.

For harness flags (Claude Code, Codex CLI, Gemini CLI, OpenCode, Antigravity, ACP): run the installed CLI's `--help` and read `src/harness/*` before trusting a flag named here; harness CLIs change often too.

If what you find differs from this spec, follow what you found and note the difference in `STATUS.md`.

## C. Pin herdr

- Write the herdr-app version you built against in `herdr/README.md` (`herdr-app --version`).
- Do not update herdr inside a phase. Herdr updates itself on quit; turn that off while building (Settings → Updates) or note the version at the start of each phase.
- After a herdr update, run every mod check (section E) before anything else.

## D. Code style

- Plain JavaScript ES modules (herdr runs QuickJS, no TypeScript build). Add JSDoc types and a `jsconfig.json` with `checkJs: true` pointing at the app home's `.d.ts` files, so `npx tsc -p herdr/mods/bot-herdr --noEmit` type-checks.
- Small files, one job each. Short comments that say why.
- UI text in `words.js` per view, sentence case, short and plain (the owner wants human, few-word wording).
- Sizes in px at zoom 1. herdr's zoom scales everything.
- Every interactive element gets a stable `.id(...)`.
- Lists longer than ~50 rows use `v_virtual_list` (see `gpui-kit.d.ts`).

## E. Checks to run after every phase

```sh
npm run herdr:install            # copies herdr/ into the app home (phase 06 writes it)
herdr-app check ~/.config/herdr-app/mods/bot-herdr
herdr-app status                 # no errors for bot-herdr, layout.error empty
npx tsc -p herdr/mods/bot-herdr --noEmit
npm run typecheck && npm test    # every engine phase (02 to 05)
```

`herdr-app check` loads the mod and renders it once. It does not prove the screen looks right; the person tries it in the app. Never call a phase done without a passing check.

## F. Commits

- Branch `bot-herdr` from `main`.
- Message `bot-herdr: phase NN <short name>`.

## G. When stuck

Write into `docs/herdr-mod/STATUS.md`:

```
## Phase NN: blocked
What I tried:
What failed (exact error):
What I think is needed:
```

Then stop.
