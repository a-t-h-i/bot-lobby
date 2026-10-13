# Bot-Lobby

A [Pi](https://pi.dev) extension for multi-agent software development. Describe a change, agree on a
plan with the oracle, and follow the agents in a local browser lobby. Approvals, domain boundaries and QA
are enforced before anything is called done.

## Install

```bash
pi install npm:@a-t-h-i/bot-lobby
```

Try it first with `pi -e npm:@a-t-h-i/bot-lobby`, or from a checkout with `pi -e ./src/index.ts`.
The questionnaire and web tools are built in, so don't also install extensions with the same tool names.
Requires **Pi 1.0.x** (1.0.1 or later).

## Use

1. In Pi, run `/bot-lobby add a login page`. The lobby opens in your browser. `Ctrl+Shift+M` or
   `/bot-lobby on|off` switches bot-lobby on or off; a new Pi session starts with it off.
2. Answer the oracle's questions and approve its plan, or agree on one with the panel in **Plan** first.
3. Follow the agents in **Lobby** and **Tasks**. Their steps fold into one line in the conversation
   and open in place.

Small changes go to **Quick fix**. `--task` forces a full task, `--fast` / `--full` picks the workflow,
and `--branch` / `--worktree` isolates it in git. Workers never commit: the oracle commits only the
files the task changed, after the project's linter and a QA pass sized to the change's risk.

## The lobby

- **Lobby**: the conversation with the oracle, each run of agent steps inline, and **Thinking** for
  their reasoning.
- **Plan**: plan with a panel of agents. **View plan** (`V`) opens the draft in a slide-out, where
  any line takes a comment.
- **Tasks**: every task across sessions as a list or a board, with its steps, timings and **Resume**.
- **Issues** and **Git**: plan from an open issue, or have an agent review a pull request read-only.
  Both read GitHub through `gh` and post nothing.
- **Knowledge**: what each agent has learned about the project, which you can edit, annotate or ask
  about.

The sidebar holds your sessions, settings, the key list, the theme and sounds. The project switcher
(`P`) sits in the message box and opens any folder on the machine running bot-lobby.

| Agent | Does |
| --- | --- |
| Oracle | Your Pi session: questions, plan, delegation and approvals |
| DESIGN | UI, frontend logic, styling and accessibility |
| DEV | Backend, APIs, data, security and integrations |
| QA | The final quality gate, at the depth the change's risk calls for |
| RESEARCH | External facts, with sources |

## Keys

Every action button shows its key. `Alt+1`…`Alt+9` switch tabs, `j` / `k` move through lists, `/`
focuses search or the message box, `p` switches project, `d` flips the theme and `?` lists every key.

## Configuration

Settings live in `~/.pi/bot-lobby/config.json` (`BOT_LOBBY_CONFIG_DIR` moves them), and
`/bot-lobby config` shows what is in effect. Most are also in the lobby's **Settings**. Tasks and
project knowledge stay in `.pi/bot-lobby/` inside your project.

The [guide](docs/guide.md) covers the rest: delivery and commits, crash recovery, knowledge and
shared scripts, the classifier, delegation, time limits, compaction and MCP tools.
