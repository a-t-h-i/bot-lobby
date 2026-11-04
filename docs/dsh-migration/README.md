# Bot Lobby on DeepSeek Harness: build spec

Written 2026-11-03, rewritten as a build spec 2026-11-04.
Checked against Bot Lobby main `3c33033` (v0.7.9, pi 1.4) and DeepSeek Harness (dsh) main `8bd07339` (npm `latest` 0.2.1-rc.5, `alpha` 0.2.2-alpha.3).

This folder is a spec that an AI builder (for example dsh's **Creator** agent preset) can follow step by step to make Bot Lobby run as a dsh plugin. It is written for a builder that does not know Bot Lobby or dsh well. Every phase says exactly which files to read, which files to write, what the code should look like, and how to prove the phase is done.

## How to use this spec

1. Read `00-builder-rules.md` first. It holds the rules for every phase. Do not skip it.
2. Do the phases in order. Do not start a phase until the previous phase's "Done when" checks all pass.
3. Each phase ends with a commit. One phase, one commit (or a few small ones), on branch `dsh-port`.
4. If a check fails and you cannot fix it in the same phase, stop and write what failed into `docs/dsh-migration/STATUS.md`. Do not move on.
5. Phase 01 is a go / no-go test. If it fails, stop the whole port.

## Files

| File | What it is |
|---|---|
| `00-builder-rules.md` | Rules for the builder: what never to do, how to check dsh APIs, how to install, how to test |
| `01-spike.md` | Phase 01: two-day go / no-go test in a throwaway folder |
| `02-host-seam.md` | Phase 02: put every pi call behind a `Host` interface (still runs on pi) |
| `03-bundle-skeleton.md` | Phase 03: empty dsh bundle that loads and serves the web UI at `/lobby` |
| `04-tools-and-gates.md` | Phase 04: Bot Lobby's 20 tools and its tool gates on dsh |
| `05-orchestrator-and-lobby.md` | Phase 05: the Lobby chat (orchestrator agent) and the web UI's `LobbyService` on dsh |
| `06-subagents.md` | Phase 06: workers, planner and QA as in-process dsh agents |
| `07-classifier-compaction-models.md` | Phase 07: classifier model calls, compaction, model and effort picker |
| `08-data-keys-grants.md` | Phase 08: data folder, API keys, MCP and skill grants, questionnaire |
| `09-parity-and-release.md` | Phase 09: test both hosts side by side, package and publish |
| `mapping.md` | Lookup table: every pi hook and call, and its dsh replacement |
| `risks.md` | Risks, gaps, and the decisions already made |
| `sources.md` | What was read to write this |

## The big picture

Bot Lobby today is a pi extension. Most of its code (tasks, roles, master, classifier, knowledge, state, workflow, the web UI) never imports pi. Only the "host layer" does: about 34 files, mostly in `src/pi/`, plus `src/lobby/service.ts`, `src/lobby/runtime.ts` and the subagent runner `src/execution/pi-runner.ts`.

The port keeps the engine and the web UI and swaps the host layer:

```
          today                                   after the port
  ┌───────────────────────┐              ┌───────────────────────────────┐
  │ Bot Lobby web UI      │              │ Bot Lobby web UI (unchanged)  │
  │ (React, webui/src)    │              │ own port, linked at dsh /lobby│
  └──────────┬────────────┘              └──────────────┬────────────────┘
             │ LobbyService (src/lobby/host.ts)         │ same LobbyService
  ┌──────────┴────────────┐              ┌──────────────┴────────────────┐
  │ engine (no pi imports)│              │ engine (unchanged)            │
  └──────────┬────────────┘              └──────────────┬────────────────┘
             │ pi ExtensionAPI                          │ Host interface (phase 02)
  ┌──────────┴────────────┐              ┌──────────────┴────────────────┐
  │ pi + pi RPC children  │              │ dsh plugin + in-process agents│
  └───────────────────────┘              └───────────────────────────────┘
```

Two seams already exist in the code and make this much easier:

- `LobbyService` in `src/lobby/host.ts`: everything the web UI calls. The dev server `src/webui/dev/serve.ts` already runs the UI on a fake `LobbyService`.
- `ProcessRunner` and `runPiAgent()` in `src/execution/pi-runner.ts`: everything the master uses to run a subagent. A dsh runner with the same result type slots in.

## Decisions already made (from the owner)

- Keep pi working. Ship the dsh bundle side by side. pi stays the default until dsh is 1.0.
- Keep Bot Lobby's own web UI. Do not rebuild it inside dsh's web client.
- Keep Bot Lobby's own `web_search` / `fetch_content` tools (they block private addresses; dsh's fetch does not).
- Workers run as in-process dsh agents first.
- No screenshots or GIFs unless asked. UI work: typecheck and build only.

## What you gain, what you don't

Gains: less code to own (dsh already does subagents, Codex/Claude Code/ACP runners, worktrees, compaction, commands, user questions), config hot reload, dsh's desktop app and SDK, first-class DeepSeek models.

Not a gain: speed. dsh publishes no speed numbers.

## Time

About 29 working days for one builder: phase 01 2 days, 02 4 days, 03 2 days, 04 2 days, 05 5 days, 06 7 days, 07 3 days, 08 2 days, 09 2 days.
