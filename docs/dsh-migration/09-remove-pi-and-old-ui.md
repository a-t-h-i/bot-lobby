# 09. Remove pi, the old web app and the session code; move the data folders (size: small)

## Goal

Nothing in the repo imports pi or ships the old web app. Bot Lobby's data lives in its own folders, and a user's old data is imported once. After this phase `grep -rn "earendil-works\|pi-coding-agent\|pi-ai\|pi-tui" src test package.json` prints nothing.

Only start when phases 03 to 08 pass their checks. Deleting first makes failures impossible to trace.

## Read first

- `package.json` (`pi` block, `files`, scripts, dependencies)
- `src/state/project.ts` (`DEFAULT_CONFIG_DIR`, `DATA_DIR`, `LEGACY_DATA_DIRS`, `dataRoot`, `readDataRoots`, `globalConfigPath`)
- `STATUS.md` ("to remove" list from phases 02 to 08)
- `.gitignore`, `README.md`, `AGENTS.md` / `CLAUDE.md` if present, `docs/`

## Step 1. Delete

Delete these, then fix what no longer compiles **by removing the dead caller**, never by restoring the file. If a kept file needs something from a deleted one, the thing it needs should already have moved in an earlier phase; if it did not, move it now into a file with no pi import and write that in `STATUS.md`.

| Delete | Why it can go |
|---|---|
| `src/index.ts` (pi entry) | `src/plugin/index.ts` is the entry |
| `src/pi/` (all) | replaced by `src/plugin/` (phases 03, 04, 06) |
| `src/harness/` (all) | dsh subagent backends (phase 05) |
| `src/execution/pi-runner.ts` and the old-name type aliases in `agent-run.ts` | `launcher.ts` (phase 05) |
| `src/ask/relay.ts`, `viaWindow` / `relayAsker` leftovers | one process (phase 05 step 4) |
| `src/desk/client-extension.ts` | desk tools are registered by the host plugin (phase 03) |
| `src/lobby/runtime.ts`, `pi-commands.ts`, `service.ts`, `host.ts`, `sessions.ts`, `saved-sessions.ts`, `resume.ts`, `recovery.ts`, `session-files.ts`, `session-questions.ts`, `profile.ts`, `keys.ts`, `exec.ts` | dsh sessions; `ProjectService` (phase 07). Before deleting each, grep its exports; keep (move) any engine function still called |
| `src/webui/` (all; the kept parts moved to `src/plugin/http/` in phase 07) | dsh web client |
| `webui/` (all, including `dist`, `vite.config.ts`, `scripts/make-icons.cjs`) | dsh web client; kept pieces moved to `src/client/` in phases 07 and 08 |
| `playwright.config.ts` and any `e2e` / web check tests | no browser tests (builder rule 9) |
| Tests that only test deleted files | they go with their code (builder rule 8). List each deleted test file in the commit message |

Keep `src/lobby/topics.ts`, `feed.ts`, `prompt-hub.ts` (moved to `src/ask/hub.ts` in phase 08), `planner.ts`, `chat-agents.ts`, `knowledge.ts`, `task-rows.ts`, `blocks.ts`, `prompts.ts`, `ask.ts` only if `src/plugin` or the engine still imports them. Otherwise delete.

## Step 2. `package.json`

- Remove the `pi` block, the `pi` keyword, `webui/dist` from `files`.
- Remove `@earendil-works/*` from `peerDependencies` and `devDependencies`.
- Remove web app dev dependencies: `vite`, `@vitejs/*`, `tailwindcss` and its plugins, `@fontsource-variable/*`, `@axe-core/playwright`, `@playwright/test`, Radix packages, and any other package only `webui/` imported. Check each with `grep -rn "<name>" src scripts` before removing.
- Scripts: remove `web:dev`, `web:build`, `web:typecheck`, `web:check`. `typecheck` becomes `tsc --noEmit && tsc -p src/client --noEmit`.
- Run `npm install` and commit the lock file.

## Step 3. Names

- Rename any leftover "pi" or "oracle" in user-facing strings and prompts to dsh words: "orchestrator", "DeepSeek Harness", "session". `grep -rni "\bpi\b\|oracle" src prompts locale`. Code identifiers may keep `oracle` where renaming would touch engine logic (builder rule 1); strings may not.
- Prompts in `prompts/` that tell agents about pi tools or pi commands: reword for the dsh tool names from phase 03.

## Step 4. Data folders

New homes:

| What | Old | New |
|---|---|---|
| Global config and data | `~/.pi/bot-lobby/` (and `~/.pi/dev-lobby`, `~/.pi/dev-house`) | `~/.bot-lobby/` |
| Per project | `<project>/.pi/bot-lobby/` (and `.pi/dev-lobby`, `.pi/dev-house`) | `<project>/.bot-lobby/` |

Changes in `src/state/project.ts`:

1. `DEFAULT_CONFIG_DIR = ".bot-lobby"`. `dataRoot(root)` returns `<root>/.bot-lobby` (no extra `bot-lobby` level).
2. `readDataRoots(root)`: `[<root>/.bot-lobby, <root>/.pi/bot-lobby, <root>/.pi/dev-lobby, <root>/.pi/dev-house]`, existing ones only after the first. Writes still go only to the first.
3. `detectProjectRoot(cwd)` also stops at a folder that has `.pi/bot-lobby` (so old projects are found before import).
4. `globalConfigPath()`: `~/.bot-lobby/config.json`; `BOT_LOBBY_CONFIG_DIR` still overrides. Old global paths stay in the read fallback list.

One-time import, `src/state/import.ts`, run from the host plugin's `apply` (global) and on first use of a project root (per project):

- If the new folder does not exist and an old one does: **copy** the old folder to the new one (`fs.cp`, recursive, no overwrite). Never move or delete the old folder.
- Write `<new>/imported-from.json` with the old path and the time. If that file exists, do nothing.
- On error: notify once ("Could not import old Bot Lobby data from ...") and go on with the read fallback in point 2.
- Tests (`test/state-import.test.ts`, temp dirs): copies once; second run does nothing; an existing new folder is never touched; old folder still there after.

`.gitignore` template that Bot Lobby writes into projects (search for where it adds `.pi/bot-lobby`): add `.bot-lobby/`.

## Step 5. Docs

- `README.md`: install on dsh (`plugin_manager` → `install_bundle`, or the npm name once published), what a `bot-lobby` session is, the Tasks / Plans / Knowledge panels, where data lives, that old `~/.pi/bot-lobby` data is copied once. Remove pi install steps and web app sections.
- Delete docs that only describe the pi build or the old web app. Keep `docs/dsh-migration/`.

## Step 6. Prove it

```sh
grep -rn "earendil-works\|pi-coding-agent\|pi-ai\|pi-tui" src test scripts package.json   # nothing
grep -rn "webui/" src scripts package.json                                              # nothing
npm run typecheck && npm test && npm run build
```

Then reinstall the bundle in dsh and rerun the "Done when" checks of phases 04, 05 and 08.

## Done when

- [ ] Both greps print nothing. Typecheck, tests, build pass.
- [ ] Test count in `STATUS.md` updated, with the list of tests deleted together with their code.
- [ ] In a project that had `.pi/bot-lobby`, the first Bot Lobby session copies it to `.bot-lobby/`, and old tasks and knowledge show in the panels.
- [ ] Phases 04, 05 and 08 checks still pass.

Commit: `dsh port: phase 09 remove pi and old web app`.
