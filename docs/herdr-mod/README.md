# bot-herdr: Bot Lobby's UI as a herdr mod — build spec

Version 1, 2026-11-04. Checked against Bot Lobby main `94b436a` (v0.7.9) and the Herdr desktop app `herdrdev/herdr-app` master `93b097f` (app 0.1.13, gpui-kit vendored, herdr-core separate).

This folder is a spec that an AI builder follows step by step to build **bot-herdr**: a herdr mod that shows Bot Lobby's screens (Lobby chat, Tasks, Plan, Knowledge, Settings, questionnaire, working indicators, code viewer, terminal) inside the Herdr desktop app, natively, with no browser. It is written for a builder that does not know Bot Lobby or herdr well. Every phase says which files to read, which files to write, what the code should look like, and how to prove the phase is done.

Before you choose between this and the dsh port, read [`compare-dsh.md`](compare-dsh.md).

## What bot-herdr is (and is not)

- bot-herdr is a **front end only**. It replaces Bot Lobby's React web app (`webui/`) as the place the person looks at and talks to Bot Lobby.
- The **engine stays where it is**: the Bot Lobby pi extension (today) or the Bot Lobby dsh plugin (after the dsh port). bot-herdr talks to the engine over the same loopback HTTP API the web app uses today: `POST /api/<group>.<action>` with JSON, and the server-sent event stream `GET /api/events`.
- herdr mods are JavaScript drawn by **GPUI** (native GPU UI, Rust draws). No HTML, no CSS, no web view, no React, no Node APIs. So no React code carries over. Every screen is rebuilt with gpui-kit elements. The API layer, the data shapes and the words carry over.
- The Orchestrator (pi, or later dsh) runs in a herdr terminal tab of the project's space, so herdr's own agents list shows it, and the person can still see the raw TUI.

## Today vs with bot-herdr

| Today | With bot-herdr |
|---|---|
| pi prints a link; the browser opens `http://127.0.0.1:7347/#token=…` | herdr shows Bot Lobby in its window. No link, no browser |
| Login: link token → cookie `bl_session` | The mod reads the same secret file and computes the same cookie value (phase 02) |
| React screens in `webui/src` | gpui-kit views in `herdr/mods/bot-herdr/` |
| Bot Lobby's projects switcher | herdr **spaces**. A space whose folder is a Bot Lobby project is bound to that project's server |
| Bot Lobby's terminal drawer (server ptys) | herdr's own terminals (real panes, kept by herdr-core) |
| Bot Lobby's code viewer (Shiki) | bot-herdr code view on herdr's `Editor` element + a hand-made diff view |
| Goo toasts | herdr `notify()` toasts |
| Theme picker, fonts, 90% scale | herdr's theme (light/dark) with Bot Lobby's accent, herdr's zoom |

## How to use this spec

1. Read `00-builder-rules.md` first. Its rules apply to every phase.
2. Do the phases in order. Do not start a phase until the previous phase's "Done when" checks pass.
3. Work on branch `bot-herdr` from `main`. One commit per phase (or a few small ones).
4. If a check fails and you cannot fix it inside the phase, write it into `docs/herdr-mod/STATUS.md` and stop.
5. Phase 01 is a go / no-go test. If it fails, stop.

## Files

| File | What it is |
|---|---|
| `00-builder-rules.md` | Rules for every phase |
| `01-spike.md` | Go / no-go: auth, API call, live event stream, chat list, text box, markdown |
| `02-scaffold-and-client.md` | Mod folder in the repo, install script, API client, cookie, event stream, store |
| `03-engine-hooks.md` | The few Bot Lobby engine changes: no browser under herdr, OSC 7501 status |
| `04-shell-layout.md` | The `bot-lobby` layout, page strip, sessions list, space ↔ project binding, start the Orchestrator |
| `05-lobby.md` | Lobby chat: conversation, markdown, inline activity and thinking, working indicators, composer, task card, files card |
| `06-questionnaire.md` | `ask_user_question` drawer in place of the composer, mockups, notes |
| `07-tasks.md` | Tasks list and detail, interventions, delivery review, comments |
| `08-plan.md` | Plan conversation, plan sheet, line comments, previous plans |
| `09-knowledge.md` | Knowledge files, inbox, note sheet, editors |
| `10-settings.md` | Settings groups: agents, harnesses, tools and skills, workflow and lint wizard, lobby, classifier, appearance |
| `11-code-and-terminal.md` | Code view (changes, file, diff), terminal via herdr panes |
| `12-parity-and-release.md` | Feature checklist against today's web app; packaging and sharing |
| `mapping.md` | Lookup tables: every web UI piece → herdr piece; every API call → screen |
| `gaps.md` | What herdr cannot do, and the workaround chosen for each |
| `compare-dsh.md` | bot-herdr vs the dsh port, side by side, and the recommendation |
| `sources.md` | What was read |

## The big picture

```
                         Herdr desktop app (GPUI, native)
 ┌──────────────┬──────────────────────────────────────────────────────────┐
 │ spaces (herdr)│ bot-herdr page strip: Lobby Tasks Plan Knowledge Settings│
 │──────────────│──────────────────────────────────────────┬───────────────│
 │ bot-herdr    │ stack "pages":                           │ side column:  │
 │ sessions     │  bot-herdr {view: lobby|tasks|plan|      │  terminals of │
 │──────────────│             knowledge|settings}          │  the space's  │
 │ agents       │                                          │  tab, or      │
 │ (herdr)      │                                          │  bot-herdr    │
 │              │                                          │  {view: code} │
 └──────────────┴──────────────────────────────────────────┴───────────────┘
        │ fetch POST /api/<call> (Cookie: bl_session=…)
        │ net socket GET /api/events (server-sent events, chunked)
 ┌──────┴──────────────────────────────────────────────────────────────────┐
 │ Bot Lobby web server (127.0.0.1:7347+), started by the Orchestrator     │
 │ (pi today, running in a herdr terminal tab named "Orchestrator")        │
 ├─────────────────────────────────────────────────────────────────────────┤
 │ Bot Lobby engine: master, workflow, roles, tasks, knowledge, prompts …  │
 └─────────────────────────────────────────────────────────────────────────┘
```

## Decisions made in this spec (change them before building if you disagree)

- Name: **bot-herdr** (owner, 2026-11-04). Mod folder `mods/bot-herdr/`, layout `layouts/bot-lobby.json`.
- One mod folder, many views: `props.view` picks the screen. Shared code (API, stream, store, look) lives once in the folder.
- Engine unchanged except phase 03 (two small additions). The HTTP API is the contract.
- Look: Claude-style light and dark from herdr's theme tokens, accent `#c96442` light / `#d97757` dark (Bot Lobby's own), radii 12 outer / 10 controls / 8 nested, flat cards (herdr has no blur), at most two levels of card nesting, no agent icons, agent names in their colour.
- No screenshots or GIFs in the repo. Checks are `herdr-app check` + the person trying it.

## Size

Built by agents, so the limit is not typing time. It is how much has to be checked by a person in the herdr window (agents can run `herdr-app check`, which loads and renders a mod once, but cannot judge how a screen looks or feels).

Relative size by phase: small 01, 03, 06, 08, 09, 10, 11, 12; medium 02, 04, 07; large 05 (composer and live chat). About 40 new mod files, 2 small engine changes. Each phase ends with a "try it in herdr" check by the person.
