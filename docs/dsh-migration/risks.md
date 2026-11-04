# Risks, decisions, accepted losses

## Decisions (owner, 2026-11-04)

| Question | Decision |
|---|---|
| Host | dsh only. The pi layer goes completely (phase 09). No dual-host code |
| Web UI | Bot Lobby's own web app goes. Screens are built from dsh slots and primitives; Bot Lobby panels only where dsh has nothing |
| Questionnaire | keep Bot Lobby's design (drawer, mockups, notes, put away). Transport stays Bot Lobby's `promptHub`, because dsh's question answer has no notes or mockups |
| Working indicators | keep Bot Lobby's role words, working mark, live activity and thought lines |
| Web tools | keep Bot Lobby's `web_search` / `fetch_content` (they block private addresses; dsh's fetch does not) |
| Subagents | dsh subagents, in-process `spawn` backend |
| Third-party harnesses | dsh's Codex, Claude Code and ACP backends; `src/harness` deleted |
| Data | `~/.bot-lobby` and `<project>/.bot-lobby`, copied once from the old `.pi` folders, old folders left alone |
| Orchestrator model | the dsh session's model (dsh's picker). Bot Lobby settings set models for subagents only |
| Compaction summary | dsh's wording; Bot Lobby's `CHECKPOINT` text dropped. Knowledge digest made by a second small model call |

## Risks

1. **dsh API churn.** dsh is a developer preview; 11 upgrade guides so far. Fix: pin one exact version (`engines.dsh` + dev types), read every upgrade guide before upgrading, rerun phase 10's table.
2. **Spec names can be stale.** Every dsh name here was read on dsh main `8bd07339`. The builder confirms each with `cordis_inspect_query` and writes differences in `STATUS.md`.
3. **One process for all agents.** Workers share one Node process. Module-level state is moved into per-agent `RunSettings` and closures (phase 03). A hot loop in one tool slows every agent.
4. **Slot props are internal.** dsh slot props (toolview, composer chain, input dock) are less stable than host APIs. Keep each Bot Lobby slot component thin, with the logic in `src/client/kit/` and the API layer, so a prop change is a small fix.
5. **Plugin version lock.** dsh refuses a bundle whose `engines.dsh` does not match. Each dsh release may need a Bot Lobby release.
6. **No security audit.** dsh's `SAFETY.md` says it is not audited. Bot Lobby agents run with full access, as on pi today.
7. **Panels need a workspace.** The Tasks / Plans / Knowledge pages are per project. If dsh's client has no clear "current workspace folder", the panels need a project picker of their own (phase 07 step 1 decides).

## Accepted losses

- Bot Lobby's own look outside the kept pieces: its sidebar, tab pills, composer surface, goo toasts, themes, fonts, 90% scale. dsh's look is used.
- Background sessions as a Bot Lobby feature (dsh sessions cover the need).
- Bot Lobby's code viewer and terminal drawer (dsh's panes are used).
- `@mention` tray for chat agents.
- Long paste turned into a `.txt` attachment (dsh composer behaviour applies).
- Classifier-type models (`classify` in pi-ai); only chat models and the remote classifier remain.
- pi terminal features (TUI renderers, shortcuts, status line).
- Usage cost when dsh has no price table (phase 06 step 4).

## Later (not in this spec)

- Use dsh's agent team (`ui-agent-team`) for parallel workers instead of the desk and board, if it fits.
- Publish to npm and dsh's plugin market after the owner's go-ahead.
