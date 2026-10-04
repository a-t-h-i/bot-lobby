# Bot-Lobby

A [Pi](https://pi.dev) extension for intentional, multi-agent software development.
Describe a change, agree on a plan with the oracle, and follow the domain agents in a local browser lobby.
The engine enforces approvals, domain boundaries and QA before completion.

## Install

```bash
pi install npm:@a-t-h-i/bot-lobby
```

Try without installing: `pi -e npm:@a-t-h-i/bot-lobby`.
From a checkout: `pi -e ./src/index.ts` (keep `prompts/` beside `src/`).
Questionnaire and web tools are included; don't also install extensions registering the same tool names.

## Quick start

1. Run `/bot-lobby add a login page` in Pi; the lobby opens in your browser.
2. Answer the oracle's questions and approve its proposal, or use Plan to agree on a task first.
3. Follow the agents in Lobby; configure models, effort and time limits in Settings.

The Project selector switches among already-running, authorized project lobbies on one localhost origin.
Upgrading? Reattach older temporary files; previews and attachments are now isolated per project.

Small self-contained changes can route to Quick fix. `--task` forces a task;
`--fast` / `--full` picks its workflow, and `--branch` / `--worktree` selects git isolation.
Completed isolated tasks push their branch and attempt a GitHub PR through `gh`.
Missing isolation, base branch, remote or authentication records a note without blocking completion; nothing auto-merges.

## Agent split

| Agent | Responsibility |
| --- | --- |
| Master / oracle | Your Pi session: questions, decisions, plan, delegation and approvals |
| DESIGN | Browser UI, frontend logic, styling and accessibility |
| DEV | Backend, APIs, data, security and integrations |
| QA | Targeted tests and the final quality gate |
| RESEARCH | External facts and cited evidence |

The planning panel brings these domains together before implementation.
Own ordinary Plan messages and Task comments can be edited; Plan edits rerun the panel.

## Shortcuts

Browser navigation is ignored while typing, composing with an IME or using an overlay.

| Key | Action |
| --- | --- |
| `Alt+1`…`Alt+9`, bare `1`…`9` | Jump to the corresponding visible tab |
| `Alt+[` / `Alt+]` | Previous / next tab |
| `j` / `k` | Next / previous selectable list row |
| `g` then a letter | Jump to a named tab (mapping below) |
| `/` | Focus the current tab's search, when available |
| `?`, `Alt+H` | Shortcut help |
| `Esc` | Close the top overlay or cancel a pending navigation prefix |
| `Alt+S` | Settings |
| `Alt+O` | Sessions |
| `Alt+A` / `Alt+T` | Fold / expand Activity / Thinking |
| `Ctrl+S` | Save the plan on Plan |

`g` mapping: `l` Lobby, `p` Plan, `t` Tasks, `i` Issues, `u` Git,
`s` Sessions, `n` Knowledge, `q` Quick fix, `m` Metrics, `e` Settings, `x` Excalidraw.
Configured Alt/Ctrl actions are rebindable through `lobby.keys`; defaults live in
[`src/lobby/keys.ts`](src/lobby/keys.ts). Bare browser aliases are additional navigation keys.
In Pi, `Alt+G` toggles auto mode and `Ctrl+Shift+M` minimizes/restores the plugin.

## Configuration and docs

Settings are user-global in `~/.pi/bot-lobby/config.json`;
`BOT_LOBBY_CONFIG_DIR` overrides the directory. `/bot-lobby config` shows effective settings.
Tasks and project knowledge stay under `.pi/bot-lobby/` in the project.

See [Architecture and guide](docs/architecture.md) for commands, workflow, planning,
classifier, web tools, Excalidraw, configuration, recovery and development details.
