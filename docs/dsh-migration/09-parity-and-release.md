# 09. Parity test and release (2 days)

## Goal

Prove Bot Lobby on dsh does what Bot Lobby on pi does, then package the bundle so others can install it.

## Part A. Parity checklist

Run each row on pi and on dsh, same project, same model where possible. Write results in `docs/dsh-migration/PARITY.md` as a table (row, pi result, dsh result, notes). A row passes when both behave the same from the user's point of view.

| # | Check |
|---|---|
| 1 | Open the Lobby, chat "hi", get a reply; working indicator shows while it runs |
| 2 | `/` command tray and `@` mention tray list the same commands and agents |
| 3 | A request big enough for `start_task` becomes a task; the task card shows its checklist |
| 4 | Plan tab: plan a task with the panel, comment a line, start it |
| 5 | Task runs scout → workers → review → QA to done; Tasks tab shows each agent's live activity and thoughts |
| 6 | Steer a running worker; it changes course |
| 7 | A worker asks a question; it shows in the Lobby; the answer reaches it |
| 8 | Cancel a task; workers stop within a few seconds |
| 9 | Auto mode on a task: it runs without stopping |
| 10 | Parallel workers share files through the desk without clashes |
| 11 | Knowledge tab: entries appear after a task; search finds them |
| 12 | Settings: change an agent's model, effort, tools, skills; the next run uses them |
| 13 | Settings → Harnesses: a Codex or Claude Code agent (if installed) runs a step |
| 14 | Long task with a low "Compact at": it compacts and keeps working |
| 15 | New session, switch session, rename, archive, delete in the sidebar |
| 16 | Background session from the sidebar: runs, shows working / idle, can be stopped |
| 17 | Restart the host: the Lobby resumes its chat; unfinished tasks show as resumable |
| 18 | Code viewer and terminal drawer open and work |
| 19 | Web tools: researcher searches and fetches; a `http://127.0.0.1` fetch is refused |
| 20 | Attach a document in the composer; the agent can read it |

Fix every failed row in the phase it belongs to (go back, fix, re-run that phase's checks), then re-run this table. Do not release with a failed row unless the owner accepts it in writing in `PARITY.md`.

## Part B. Package the bundle

dsh loads a linked folder from the repo, but an installed npm package lives under `node_modules`, where Node will not strip TypeScript types. So the published bundle needs JavaScript:

1. Add `dsh/tsconfig.build.json`: `rootDir` = repo root, `outDir` = `dsh/lib`, include `dsh/src/**/*.ts` and the `src/**/*.ts` files it imports, `rewriteRelativeImportExtensions: true` (TypeScript 5.7+) so `.ts` imports become `.js`.
2. `dsh/package.json`:
   - `exports["."]` → `./lib/dsh/src/index.js`
   - `files` → `["lib", "cordis.patch.yml", "locale/*.json", "icon.svg", "../webui/dist"]`. npm cannot include a parent folder, so add a `prepack` script that copies `webui/dist` into `dsh/webui-dist` and point `BOT_LOBBY_WEBUI_DIST` (read by `src/webui/static.ts`) at it from `dsh/src/web.ts`.
   - `scripts.prepack`: `tsc -p tsconfig.build.json && node scripts/copy-dist.mjs`
   - Runtime dependencies the engine needs (check root `package.json` `dependencies`, for example `typebox`, `node-pty` if the terminal uses it): list them in `dsh/package.json` `dependencies` at the same versions.
3. `npm pack --dry-run` in `dsh/`: check the file list has `lib/`, the patch, locales, icon and the web dist.
4. Install the packed file into a fresh dsh profile with `plugin_manager` → `install_bundle` (target = the `.tgz` path) and run parity rows 1, 3, 5.

## Part C. Docs

- Root `README.md`: a short "Run on DeepSeek Harness (preview)" section: install command, that it uses the same data folder, that it runs with full access, link to this folder.
- `docs/dsh-migration/STATUS.md`: final state, dsh version pinned, known gaps.

## Part D. Release

Do not publish to npm without the owner's go-ahead. Open a PR from `dsh-port` to `main` with: summary of phases, `PARITY.md` table, `STATUS.md` gaps, and the dsh version pinned.

## Done when

- [ ] `PARITY.md` has every row passing (or accepted by the owner).
- [ ] The packed bundle installs and runs in a fresh dsh profile.
- [ ] pi: `npm run typecheck`, `npm test`, `npm run web:build` pass; Bot Lobby on pi still works.
- [ ] PR open.

Commit: `dsh port: phase 09 parity and packaging`.
