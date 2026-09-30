# Development environment

How to install DSH, load the plugin into it and look at it in a browser. Commands marked ✓ were run while this handbook was written (DSH 0.2.0-rc.2, Node 22.22, Linux; see [reference/VERIFIED-FACTS.md](reference/VERIFIED-FACTS.md)). The rest are adapted from those, or from DSH's docs.

## Requirements

- Node **22** or newer. Tests run `.ts` files directly (`node --test test/*.test.ts`), which needs Node ≥ 22.18.
- npm, and the pnpm that DSH runs internally for `dsh plugin` (it comes with DSH).
- A Chromium for UI checks. `playwright-core` finds its own browsers when they are installed. Otherwise set `CHROMIUM_PATH`: in Claude Code cloud containers it is `/opt/pw-browsers/chromium-*/chrome-linux/chrome`, and you must not run `playwright install` there.
- Model access is optional for Phases 0, 1 and 3 (the host tests use fakes and the UI can use the mock API). Phase 2 needs at least one provider with a key added to DSH (DSH's own Settings → Models page).

## One-time setup in the plugin repo

```sh
npm install                                        # devDependencies include @deepseek-ai/dsh (pinned) and playwright-core
export DSH_HOME="$PWD/.dsh-home"                   # keep DSH's profiles, storages and logs inside the repo (gitignored)
npm run build                                      # lib/index.js + lib/client.js
npx dsh plugin --profile web add "$PWD"            # ✓ installs this repo into the web profile as a pnpm link
npx dsh --profile web --dump-config | grep -n bot-lobby   # ✓ the plugin's row is in the composed tree
```

`dsh plugin --profile <name> <args>` forwards to pnpm in the profile directory, so `remove <package name>` uninstalls (✓). The `desktop` profile is reserved for the Electron app and cannot be managed by the npm CLI.

## Every session

```sh
scripts/dsh/start-web.sh           # starts DSH Web detached, prints http://127.0.0.1:4817/?token=…
node scripts/dsh/ui-check.mjs      # opens it, clicks "Bot Lobby", checks the page, screenshot → ui-check.png
scripts/dsh/stop-web.sh            # stops the whole process group
```

**What the script runs.** `start-web.sh` does what was verified by hand (✓):

```sh
cd "$DSH_WORKSPACE"      # DSH's default workspace root is the directory it starts in
setsid node node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --port 4817 --host 127.0.0.1 > "$DSH_HOME/web.log" 2>&1 < /dev/null &
echo $! > "$DSH_HOME/web.pid"
```

**A workspace for Phase 2 walkthroughs.** Set `DSH_WORKSPACE` to a small sample project (a git repo with a README, a web page and a test or two), so the agents work there and not in the plugin repo.

**After rebuilding the plugin, restart DSH.** A replaced package needs a restart to load its new JavaScript.

## Looking at it by hand

1. Open the printed URL (it carries a one-time token and logs your browser in).
2. On the first run of a DSH home, click **Continue** on the Preview Notice.
3. Click **Bot Lobby** in the left sidebar, between Plugins and Workspaces.
4. For the dock, the Agents view and tool cards, open or start a session: those surfaces belong to a session, not the home page.

## Useful commands

| Command | Does |
| --- | --- |
| `npx dsh --profile web --dump-config` | The composed plugin tree, with our row (✓) |
| `npx dsh --profile web --dump-config-schema` | JSON Schema of every mounted plugin's config: our `Config` included |
| `npx dsh --profile web --help` | The web app's own flags |
| `npx dsh --profile headless "job"` | One persisted session, final answer, exit. Handy for host smoke tests with a real model once the plugin is in the `headless` profile too |
| `tail -f "$DSH_HOME/web.log"` | Host output, including plugin errors on activation |
| `ls "$DSH_HOME/logs/"` | Startup logs, one per boot |

**Inside a DSH session, the agent can inspect the live system for you.** Ask it to use `cordis_inspect_list` and `cordis_inspect_query`:
- `Service` / `Event` for exact methods and event modes;
- `Tool` for the tools this agent can call;
- `Slots` for the live slot tree and each slot's options;
- `Theme` for tokens;
- `Config.listConfigs` for a plugin's schema and `packageDir`.

This is how DSH's own plugin-development skill says to discover APIs (`reference/dsh/skills/cordis-plugin-development/SKILL.md`).

## Where DSH keeps things

```
$DSH_HOME/profiles/web/package.json      bundles list + our link dependency
$DSH_HOME/profiles/web/cordis.patch.yml  the user's patch layer (Config overrides land here)
$DSH_HOME/storages/*.json                storage-domain records (ours will be here, e.g. Excalidraw links)
$DSH_HOME/logs/startup-*.log             one per boot
$DSH_HOME/.credentials.yaml              credential records (never commit)
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| The page is blank or doesn't list the plugin | Check `$DSH_HOME/web.log` for an activation error. `--dump-config` must show the row. Did you rebuild and restart? |
| `slot entry crashed in '<slot>'` in the console | A component threw. Check the error above it. Never import DSH client UI packages (practices) |
| 401 from our API | The request lacks the login cookie: call it from the page opened through the tokenized URL |
| 405 from our API | The route isn't registered (the plugin didn't activate), so the static server answered |
| *no adapter registered for provider "…"* (`NO_ADAPTER`) listing models | Pass the provider route **id**, not its name |
| Port busy after stopping | Something started DSH through `npx`; find the process on the port and stop it. Use the scripts next time |
| Your shell died when stopping DSH | `pkill -f` matched the shell; use `stop-web.sh` |
| Nothing changes after editing the client | Rebuild (`npm run build`), restart DSH, hard-reload the page |

## Machines

- **Linux containers** (CI, cloud agents): everything above works headless. The scripts need `setsid` (util-linux).
- **macOS:** replace `setsid … &` with `nohup … &`, and stop the recorded pid alone (no process-group kill), or run DSH in a terminal tab.
- **Windows:** use WSL, or run `node node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --port 4817` in a terminal and stop it with Ctrl+C.
- **DSH Desktop** (Electron, macOS/Windows) was not tested. Its profile is managed by the Desktop-installed command, not the npm CLI. See R-02 and P5-02.
