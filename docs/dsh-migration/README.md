# Bot Lobby as a DeepSeek Harness plugin: build spec

Version 2, 2026-11-04. Checked against Bot Lobby main `3c33033` (v0.7.9) and DeepSeek Harness (dsh) main `8bd07339` (npm `latest` 0.2.1-rc.5, `alpha` 0.2.2-alpha.3).

This folder is a spec that an AI builder (for example dsh's **Creator** agent preset) follows step by step to turn Bot Lobby into a plugin that runs **only** on dsh. It is written for a builder that does not know Bot Lobby or dsh well. Every phase says which files to read, which files to write, what the code should look like, and how to prove the phase is done.

## What changes from today

| Today | After the port |
|---|---|
| A pi extension (`pi.extensions` in `package.json`) | A dsh bundle (`dsh.bundle` + `dsh.client` in `package.json`). No pi code, no pi dependencies |
| Bot Lobby's own React web app in `webui/` on its own port | Gone. Bot Lobby's screens live inside dsh's web client, built from dsh's slots and components, plus Bot Lobby panels where dsh has nothing |
| Subagents are `pi --mode rpc` child processes | dsh subagents (`ctx.subagents`, in-process `spawn` backend) |
| Codex / Claude Code / ACP runners in `src/harness` | dsh's `dsh-subagent-codex`, `dsh-subagent-claude-code`, `dsh-subagent-acp` backends |
| Bot Lobby's own sessions sidebar, background sessions, session switching | dsh's own sessions |
| Bot Lobby's questionnaire and `ask_user_question` tool | Kept: same tool, same questionnaire design, shown inside dsh in place of the composer |
| Data in `~/.pi/bot-lobby` and `<project>/.pi/` | `~/.bot-lobby` and `<project>/.bot-lobby/`, imported once from the old folders |

What stays: the engine. Tasks, roles, the master, the workflow, the classifier, knowledge, state files, delivery, web tools. These folders do not import pi today and keep their logic.

## How to use this spec

1. Read `00-builder-rules.md` first. Its rules apply to every phase.
2. Do the phases in order. Do not start a phase until the previous phase's "Done when" checks all pass.
3. Work on branch `dsh-port`. One commit per phase (or a few small ones).
4. If a check fails and you cannot fix it inside the phase, write it into `docs/dsh-migration/STATUS.md` and stop.
5. Phase 01 is a go / no-go test. If it fails, stop the port.

## Files

| File | What it is |
|---|---|
| `00-builder-rules.md` | Rules for every phase |
| `01-spike.md` | Go / no-go test: preset, subagent with custom tools, one UI panel calling the host |
| `02-restructure.md` | Make the repo a dsh bundle; host and client builds |
| `03-agents-tools-prompts.md` | Bot Lobby presets, per-agent setup, all tools, tool gates, prompt sections, commands |
| `04-orchestrator.md` | The Lobby chat is a dsh session; task lifecycle, `start_task`, `orchestrate` |
| `05-subagents.md` | Workers, scouts, reviewers, QA, planner panel as dsh subagents; harness backends; desk and board |
| `06-models-compaction-knowledge.md` | Classifier on `ctx.llm`, compaction, model and effort, knowledge learning |
| `07-client-foundation.md` | Client bundle, host API routes, live updates, locale, theme |
| `08-ui-panels.md` | Tasks, Plans, Knowledge panels; task dock; tool cards; settings pages; toasts |
| `09-remove-pi-and-old-ui.md` | Delete every pi file, the old web app and the session code; data import |
| `10-parity-and-release.md` | Feature checklist against today's Bot Lobby; packaging |
| `mapping.md` | Lookup tables: every Bot Lobby screen and every pi hook, and what replaces it |
| `risks.md` | Risks, decisions, accepted losses |
| `sources.md` | What was read |

## The big picture

```
                          dsh web client (dsh's UI)
  ┌───────────────────────────────────────────────────────────────────────┐
  │ left sidebar: dsh sessions + Bot Lobby panels (Tasks, Plans, Knowledge)│
  │ main: dsh conversation (the Lobby chat) or a Bot Lobby panel page      │
  │ composer: dsh composer + Bot Lobby task dock                           │
  │ right sidebar: dsh files / terminal / changes + Bot Lobby plan sheet   │
  │ settings: dsh settings + Bot Lobby sections                            │
  └───────────────┬───────────────────────────────────────────────────────┘
                  │ slots (client plugin)      HTTP routes + events (host plugin)
  ┌───────────────┴───────────────────────────────────────────────────────┐
  │ Bot Lobby host plugin: presets, tools, gates, prompts, commands,       │
  │ orchestrator hooks, subagent runner, API routes                        │
  ├───────────────────────────────────────────────────────────────────────┤
  │ Bot Lobby engine (same logic): master, workflow, roles, state,         │
  │ classifier, knowledge, delivery, web tools                             │
  ├───────────────────────────────────────────────────────────────────────┤
  │ dsh: agents, sessions, tools, subagents, llm, compaction, commands,    │
  │ user questions, worktrees, terminal, files                             │
  └───────────────────────────────────────────────────────────────────────┘
```

## Decisions (from the owner, 2026-11-04)

- dsh only. The pi layer goes completely. No dual-host code.
- Bot Lobby's own web app goes. Use dsh's UI components and slots; build Bot Lobby panels only where dsh has no matching component.
- Keep Bot Lobby's own `web_search` / `fetch_content` tools (they block private addresses; dsh's fetch does not).
- Keep Bot Lobby's questionnaire design (drawer, mockups, notes) and the per-agent working indicators (role word, working mark, live activity and thought lines).
- No screenshots or GIFs unless asked. UI checks: typecheck and build only.

## Size

No day estimates: an AI builder (dsh Creator mode) runs this, so speed depends on the model, not on a person's working days. Relative size per phase, to judge progress:

| Size | Phases |
|---|---|
| Small | 01 spike, 02 bundle, 06 models and compaction, 09 remove pi |
| Medium | 04 orchestrator, 07 client foundation, 10 parity and release |
| Large | 03 tools and prompts, 05 subagents, 08 UI |

Phase 08 is the biggest (most screens to port). Phase 01 decides whether to go on at all.
