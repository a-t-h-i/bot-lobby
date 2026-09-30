# bot-lobby → DeepSeek Harness: porting handbook

This folder is the handover for porting **bot-lobby** (a Pi extension with a terminal UI) to a **DeepSeek Harness (DSH) plugin with a GUI**. It holds:
- the plan;
- the decisions;
- a map from every bot-lobby feature and file to its place in the port;
- DSH's own plugin documentation, vendored;
- starting code that was checked against a real DSH.

The port is built in a **new repository** by a swarm of agents. This folder stays here as the original handover.

## What we are building

- **A standalone DSH plugin.** It has no link to Pi: no Pi packages, paths, config or data (D-01).
- **In a new repo**, by default `a-t-h-i/dsh-bot-lobby`, published as `@a-t-h-i/dsh-bot-lobby` (D-02).
- **On the models the user added to DSH**, as bot-lobby runs on the models added to Pi (D-03).
- **With the same behaviour.** The oracle plans and delegates to Designer, Backend and QA agents, scouts and a researcher. The engine enforces the workflow, the QA gate, budgets, the file desk and knowledge. The quick fix, planning panel, metrics, Git review, knowledge editing, Excalidraw sessions and Jev all come across, now as a GUI inside DSH.

## Reading order

| # | File | Read it for |
| --- | --- | --- |
| 1 | [DECISIONS.md](DECISIONS.md) | What is fixed, what is adopted, what waits on a spike, and open questions with defaults |
| 2 | [ARCHITECTURE.md](ARCHITECTURE.md) | The target shape: host and client halves, the three seams, how a task flows, API, data, security |
| 3 | [PLAN.md](PLAN.md) | The phased plan: task cards with lanes, dependencies and acceptance criteria |
| 4 | [AGENT-GUIDE.md](AGENT-GUIDE.md) | How to work, DSH's rules for plugins, traps already found, the definition of done |
| 5 | [PORT-MAP.md](PORT-MAP.md) | Pi concept → DSH mechanism; every source file → COPY / ADAPT / REWRITE / REPLACE / DROP |
| 6 | [FEATURE-INVENTORY.md](FEATURE-INVENTORY.md) | Every feature (F-01…F-60) with source, tests and target task: the parity checklist |
| 7 | [DEV-ENVIRONMENT.md](DEV-ENVIRONMENT.md) | Installing DSH, loading the plugin, seeing it in a browser |
| 8 | [TESTING.md](TESTING.md) | Test levels, porting the old tests (the legacy-runner adapter), the fake context, UI checks |
| 9 | [RISKS.md](RISKS.md) | What could go wrong, and who owns it |
| 10 | [SOURCES.md](SOURCES.md) | Where everything comes from, with versions and licences |
| — | [reference/API-NOTES.md](reference/API-NOTES.md) | The DSH APIs the port uses, with shapes, marked verified or documented |
| — | [reference/VERIFIED-FACTS.md](reference/VERIFIED-FACTS.md) | What was actually run against DSH, and what it showed |
| — | [reference/dsh/](reference/dsh) | DSH's plugin-development skills and 68 package READMEs (MIT, 0.2.0-rc.2) |
| — | [templates/](templates) | A verified plain-JS plugin, the TypeScript skeleton for the new repo, and the dev scripts |

## Where things stand at handover

| Status | Item |
| --- | --- |
| ✅ Verified in DSH Web 0.2.0-rc.2 | A plugin with a host half and a client half: its page in the main area with a sidebar entry, a JSON API behind DSH's login, a registered tool, the user's DSH models listed (`templates/probe-js`) |
| ✅ Checked | The TypeScript skeleton typechecks against DSH's real tool types, builds both halves, and passes its test (`templates/skeleton-ts`) |
| ⬜ First swarm task | Load the skeleton into DSH and see its page (P0-02) |
| ⬜ Spikes (Phase 0) | Tool names, subagents, the oracle's hooks, Desktop transport, session per task, settings storage, questions: P0-03…P0-09 |
| ⬜ Everything else | Phases 1–5 in [PLAN.md](PLAN.md) |

## How the swarm should start

1. **Day one, in parallel:**
   - one agent on **P0-01** (bootstrap the repo), then **P0-02** (DSH dev loop);
   - one agent on **P1-01** (data root and config seam), which unblocks the rest of the core.
2. **When P1-01 lands:** up to nine agents on Lane A (P1-02…P1-11). These need no DSH.
3. **When P0-02 lands:** up to seven agents on the spikes P0-03…P0-09.
4. **When P2-12a** (the API contract and mock) lands: Lane C can build every tab against the mock while Lane B builds the host.

Coordination lives in the new repo (`docs/status.md`, `docs/parity.md`, `docs/plan.md`), copied from this folder at P0-01.

## Rules everyone follows

These are expanded in [AGENT-GUIDE.md](AGENT-GUIDE.md):
- Commit as **`a-t-h-i <aonlysmith@gmail.com>`**, with **no co-author trailers**.
- bot-lobby is the specification: keep its behaviour, messages and limits unless a decision says otherwise.
- Follow DSH's plugin rules (`reference/dsh/skills/cordis-plugin-development/references/practices.md`):
  - the session log is the source of truth;
  - registrations are effects;
  - use the weakest mechanism;
  - theme tokens only, and no DSH UI imports;
  - children cannot ask the user.
- Never put secrets in the project or in API responses. Room links and keys live in DSH's storage and credentials.
- Pin the DSH version; upgrade on purpose (AGENT-GUIDE §7).

## Glossary

| Term | Meaning |
| --- | --- |
| **DSH** | DeepSeek Harness: an agent runtime with a CLI, a Web GUI and Desktop apps, built from plugins |
| **Cordis** | The plugin framework DSH is built on: contexts (`ctx`), services, `inject`, effects |
| **Host half / client half** | The plugin's code in the DSH Node process (`lib/index.js`) and in the page (`lib/client.js`) |
| **Slot** | A named place in the DSH page where plugins register React components (`main`, `sidebar.panellist`, `conversation.composer.dock`, …) |
| **Profile** | A DSH composition under `$DSH_HOME/profiles/<name>` (`web` for the browser GUI) |
| **Oracle / Master** | The session's own agent, which plans, delegates and decides (bot-lobby's term) |
| **Domain agents** | DESIGN (Designer + Frontend), DEV (Backend), QA |
| **Roles** | scout (read-only survey), worker (implements), reviewer (the QA gate), researcher (web evidence) |
| **Track** | Fast track (small, clear, low-risk) or full workflow |
| **File desk** | Claims that stop parallel workers editing the same file |
| **Jev** | An optional fast classifier that answers yes/no and score questions to save tokens |
| **Spike** | A short experiment that answers one question about DSH before building on it |
