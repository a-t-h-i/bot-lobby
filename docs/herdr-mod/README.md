# bot-herdr: Bot Lobby on herdr, with no pi — build spec

Version 2, 2026-11-04. Checked against Bot Lobby main `94b436a` (v0.7.9) and the Herdr desktop app `herdrdev/herdr-app` master `93b097f` (app 0.1.13, gpui-kit vendored, herdr-core separate).

This folder is a spec that AI builders follow step by step to build **bot-herdr**: Bot Lobby running with **no pi**, on whatever coding-agent harnesses are installed (Claude Code, Codex CLI, Gemini CLI, OpenCode, Antigravity, any ACP agent), with its screens (Lobby chat, Tasks, Plan, Knowledge, Settings, questionnaire, working indicators, code view, terminal) drawn natively inside the Herdr desktop app as a herdr mod. Every phase says which files to read, which files to write, what the code should look like, and how to prove the phase is done.

Before choosing between this and the dsh port, read [`compare-dsh.md`](compare-dsh.md).

## What changes

| Today | With bot-herdr |
|---|---|
| Bot Lobby is a pi extension; pi runs the Orchestrator and spawns `pi --mode rpc` workers | Bot Lobby is its own program, `bot-lobby serve` (a Node daemon). No pi anywhere |
| The Orchestrator is a pi session on a model from pi's registry (API keys in pi) | The Orchestrator is a session of an installed harness (Claude Code first by default), resumed turn after turn. No API keys in Bot Lobby: each harness uses its own sign-in |
| Bot Lobby's tools are pi tools | Bot Lobby's tools are served over **MCP** to the harness (`mcp__bot-lobby__start_task`, `ask_user_question`, `web_search`, …), reviving the MCP bridge removed in `36ea826` |
| Workers run on pi, or on a harness when one is set | Workers always run on a harness (the runners in `src/harness` already exist) |
| Classifier, titles, knowledge digest call pi's models | Remote classifier or rule fallback; other one-shot calls go to a harness |
| pi prints a link; the browser opens the React web app | herdr shows Bot Lobby in its window. The daemon still serves the same HTTP API, so the web app can stay as a fallback |
| Projects switcher | herdr **spaces** |
| Terminal drawer (server ptys) | herdr's own terminals |
| Data in `~/.pi/bot-lobby`, `<project>/.pi/` | `~/.bot-lobby`, `<project>/.bot-lobby/`, copied once (same as the dsh spec) |

What stays: the engine's logic. Master, workflow, roles, tasks, state files, delivery, knowledge, web tools, the HTTP API and event stream.

## How to use this spec

1. Read `00-builder-rules.md` first. Its rules apply to every phase.
2. Do the phases in order. Do not start a phase until the previous phase's "Done when" checks pass. Phases 06 to 15 (the mod) only need the API, so a second builder can start them after phase 01 against today's pi server, while phases 02 to 05 move the engine.
3. Work on branch `bot-herdr` from `main`. One commit per phase (or a few small ones).
4. If a check fails and you cannot fix it inside the phase, write it into `docs/herdr-mod/STATUS.md` and stop.
5. Phase 01 is a go / no-go test. If it fails, stop.

## Files

| File | What it is |
|---|---|
| `00-builder-rules.md` | Rules for every phase |
| `01-spike.md` | Go / no-go: (A) a harness as Orchestrator with MCP tools, (B) a herdr mod reading the API and live stream |
| `02-engine-daemon.md` | `Host` interface, the `bot-lobby serve` daemon, data folders, status to herdr |
| `03-orchestrator-on-a-harness.md` | Bot Lobby MCP server, launching each harness with it, the Orchestrator session, picking the harness |
| `04-agents-and-models.md` | Workers, planner, background sessions, one-shot calls, classifier, models and effort on harnesses |
| `05-remove-pi.md` | Delete pi code, dependencies and pi-only tests |
| `06-mod-client.md` | Mod folder in the repo, install script, API client, cookie, event stream, store |
| `07-shell-layout.md` | The `bot-lobby` layout, page strip, sessions list, space ↔ project, Start Bot Lobby |
| `08-lobby.md` | Lobby chat, activity and thinking, working indicators, composer, attachments, tasks and files cards |
| `09-questionnaire.md` | Questions in place of the composer, mockups, notes |
| `10-tasks.md` | Tasks list and detail |
| `11-plan.md` | Planning panel, plan sheet, line comments, previous plans |
| `12-knowledge.md` | Notes, inbox, note sheet, editors, ask |
| `13-settings.md` | Settings sections, harness pickers, effort slider |
| `14-code-and-terminal.md` | Code view and diff; herdr terminals; open a harness session in herdr |
| `15-parity-and-release.md` | Feature checklist; packaging and sharing |
| `mapping.md` | Lookup tables: pi → daemon/harness; web app piece → herdr piece; API call → screen |
| `gaps.md` | What herdr and the harnesses cannot do, risks, accepted losses |
| `compare-dsh.md` | bot-herdr vs the dsh port, side by side, and the recommendation |
| `sources.md` | What was read |

## The big picture

```
                         Herdr desktop app (GPUI, native)
 ┌──────────────┬──────────────────────────────────────────────────────────┐
 │ spaces       │ bot-herdr page strip: Lobby Tasks Plan Knowledge Settings│
 │ sessions     │ pages (bot-herdr mod views)          │ herdr terminals / │
 │ agents       │                                      │ code view         │
 └──────────────┴──────────────────┬───────────────────┴───────────────────┘
                                   │ HTTP POST /api/<call>, SSE /api/events (loopback, cookie)
 ┌─────────────────────────────────┴───────────────────────────────────────┐
 │ bot-lobby serve  (runs in a herdr tab "Bot Lobby", kept by herdr-core)  │
 │  engine: master, workflow, roles, tasks, knowledge, prompts, web API    │
 │  Bot Lobby MCP server ── tools ──┐                                      │
 └──────────────────────────────────┼──────────────────────────────────────┘
          headless sessions, JSON streams, MCP tools
 ┌────────────────┬─────────────────┼──────────────┬────────────────────────┐
 │ Orchestrator:  │ workers: Dev, QA, Design, Research, scouts, reviewers,   │
 │ Claude Code /  │ planner seats: each on its own harness                   │
 │ Codex / ACP    │ (claude, codex, gemini, opencode, antigravity, acp)      │
 └────────────────┴──────────────────────────────────────────────────────────┘
```

## Decisions

- Name: **bot-herdr** (owner, 2026-11-04). Mod folder `mods/bot-herdr/`, layout `layouts/bot-lobby.json`.
- **No pi** (owner, 2026-11-04). Bot Lobby uses whatever harnesses are installed.
- The engine is a standalone daemon serving the same HTTP API as today. The mod is one client; the React web app can stay as a second client.
- Harness sessions run headless (structured JSON). "Open in herdr" resumes a finished session in the harness's own TUI in a herdr tab.
- One mod folder, many views (`props.view`).
- Look: Claude-style light and dark, accent `#c96442` / `#d97757`, radii 12 / 10 / 8, flat cards, at most two levels of nesting, no agent icons, names in agent colour.
- No screenshots or GIFs in the repo.

## Size

Built by agents, so the limit is not typing time. It is checking: engine phases need real harness runs (each harness signed in), and the mod phases need the person to try each screen in herdr (agents can run `herdr-app check`, which loads and renders a mod once, but cannot judge how a screen looks or feels).

Relative size: large 03 (Orchestrator on harnesses), 04 (workers and models), 08 (Lobby); medium 02, 05, 06, 07, 10; small 01, 09, 11, 12, 13, 14, 15. About 40 new mod files; engine: one new `src/daemon/` folder, a `Host` interface, ~34 pi-importing files reworked or deleted.
