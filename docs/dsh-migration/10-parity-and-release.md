# 10. Parity check and release (size: medium)

## Goal

Prove that Bot Lobby on dsh does what Bot Lobby on pi did (minus the screens dsh replaces), then package the bundle so others can install it.

## Part A. Parity checklist

Use a Bot Lobby checkout of `main` before the port (tag it `pre-dsh` first) for the "before" column, and the `dsh-port` build in dsh for "after". Same project, same model where possible. Write `docs/dsh-migration/PARITY.md` as a table: row, before, after, pass / fail, notes.

| # | Check | After: where to look |
|---|---|---|
| 1 | Chat "hi" in the Lobby, get a reply | a `bot-lobby` dsh session |
| 2 | `/bot-lobby` commands listed and working (`status`, `settings`, the kept ones from phase 03) | dsh command tray |
| 3 | A big request becomes a task via `start_task`; its checklist shows | task dock above the composer; `start_task` tool card |
| 4 | Plan a task in the planner with seats, comment a line, start it | Plans panel; plan sheet in the right pane |
| 5 | Task runs scout → workers → review → QA to done | Tasks panel |
| 6 | Each agent's live activity and thoughts show while it works, with Bot Lobby's working indicators | Tasks panel rows, turn tail, tool cards |
| 7 | Steer a running worker; it changes course | Tasks panel "message" / dsh subagent view |
| 8 | A worker asks a question with a mockup option; Bot Lobby's questionnaire shows; the answer (with a note) reaches it | questionnaire in place of the composer |
| 9 | Put the questionnaire away, use the composer, reopen it | same |
| 10 | Cancel a task; all its agents stop within a few seconds | Tasks panel |
| 11 | Auto mode on a task: it runs to done without stopping | Tasks panel toggle |
| 12 | Parallel workers share files through the desk without clashes | task run records |
| 13 | Mid-task message to the orchestrator is triaged (step / separate task / itself) | Lobby session |
| 14 | Knowledge entries appear after a task and after the orchestrator compacts; search finds them | Knowledge panel |
| 15 | Settings: change a worker's model, effort, Compact at, tools, skills; the next run uses them | Bot Lobby settings sections |
| 16 | Settings → Harnesses: a Codex or Claude Code agent (if installed) runs a step | Tasks panel |
| 17 | Linting wizard sets up a linter | Settings → Linting |
| 18 | A worker with a low Compact at compacts and keeps working | Tasks panel / child session |
| 19 | Restart dsh: the Lobby session reopens with its chat; unfinished tasks show as resumable; resume works | dsh sessions; Tasks panel |
| 20 | Researcher searches and fetches; a fetch of `http://127.0.0.1` is refused | task run records |
| 21 | Files an agent changed open in dsh's file view | task dock, Tasks panel |
| 22 | Delivery review: accept, defer, deliver | Tasks panel |
| 23 | Bot Lobby notices show as toasts | dsh toasts |
| 24 | Old data from `~/.pi/bot-lobby` and `<project>/.pi/bot-lobby` is there after the first run | panels |
| 25 | Light and dark theme: every Bot Lobby piece follows dsh's theme; reduced motion stops all Bot Lobby animations | all panels |

Rows that are **replaced, not compared** (mark "dsh" in the table, no pass / fail): sessions sidebar and background sessions, code viewer, terminal drawer, project picker, theme picker, PWA, login page, long paste to `.txt`, composer attach menu.

Fix every failed row in the phase it belongs to (go back, fix, rerun that phase's checks), then rerun this table. Do not release with a failed row unless the owner accepts it in writing in `PARITY.md`.

## Part B. Package

1. `npm run build`. `lib/plugin/index.js` and `lib/client/index.js` exist.
2. `npm pack --dry-run`. The file list has `lib/`, `prompts/`, `scripts/builtin/`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, `THIRD_PARTY_NOTICES.md`, and nothing from `src/`, `test/`, `webui/`, `spike/`, `docs/`.
3. Runtime `dependencies`: only what `lib/plugin` imports at run time (check with `node -e "import('./lib/plugin/index.js')"` in a clean `npm ci --omit=dev` copy). `@deepseek-ai/*` packages are provided by dsh and stay dev-only (types), unless dsh's publish docs say otherwise.
4. `engines.dsh` is the exact version the port was tested on.
5. `npm pack`. In a fresh dsh profile, `plugin_manager` → `install_bundle` with `target` = the `.tgz` path. Read `application` and `warnings`. Run parity rows 1, 3, 5, 6, 8.

## Part C. Docs

- `docs/dsh-migration/STATUS.md`: final state, dsh version, known gaps, every "accepted" row.
- Root `README.md` already rewritten in phase 09; add the npm install line once published.
- `CHANGELOG` (or release notes): "Bot Lobby now runs on DeepSeek Harness. The pi version and the standalone web app are retired. Old data is copied from `~/.pi/bot-lobby` on first run."

## Part D. Release

Do not publish to npm, tag a release or merge to `main` without the owner's go-ahead. Open a PR from `dsh-port` to `main` with: one line per phase, the `PARITY.md` table, the `STATUS.md` gaps, the dsh version, and the list of deleted tests.

## Done when

- [ ] Every `PARITY.md` row passes, or the owner accepted it in writing.
- [ ] The packed bundle installs and runs in a fresh dsh profile.
- [ ] Typecheck, tests, build pass.
- [ ] PR open.

Commit: `dsh port: phase 10 parity and packaging`.
