# Risks, gaps and decisions

## Risks

1. **dsh API churn.** dsh is a developer preview and says breaking changes will come. 11 upgrade guides so far; `v0.2.2-alpha.2` alone has 18 notes. Fix: pin one exact version (`engines.dsh`), keep all dsh code in `dsh/`, read upgrade guides before each upgrade, rerun the parity table.
2. **Spec names can be stale.** Every dsh name in this spec was checked on dsh main `8bd07339`. The builder must confirm each with `cordis_inspect_query` (rules, section B) and record differences in `STATUS.md`.
3. **One process for all agents.** In-process workers share one Node process and its module-level state. Phase 02 step 4b and phase 06 steps 2 and 5 handle the known cases. A crash or hot loop in one worker can slow the whole Lobby.
4. **No security audit.** dsh's SAFETY.md says it is not audited. Bot Lobby agents run with full access (phase 08), same as on pi today.
5. **Two hosts to maintain.** Every engine change must keep working on both. The `Host` interface keeps this cheap, and phase 02's fake host lets tests cover both.
6. **Plugin version lock.** dsh refuses a bundle whose `engines.dsh` does not match unless the user adds an exemption. Each dsh release may need a Bot Lobby bundle release.

## Known gaps (accepted)

- pi terminal features (shortcuts, entry renderers, tool renderers, status line): not ported.
- Bot Lobby's checkpoint wording for compaction: only if `dsh-compaction-basic` lets us set its summary instructions (phase 07).
- Session branches: dsh sessions are a straight event log; Bot Lobby only reads the current branch, so a flat list is enough.

## Decisions made

| Question | Decision |
|---|---|
| Default host | pi stays default; dsh bundle ships side by side until dsh 1.0 |
| Web UI | Bot Lobby's own UI and server on its own port, linked from dsh at `/lobby` (the UI uses absolute `/api` paths and dsh owns `/api`) |
| Web tools | keep Bot Lobby's (they block private addresses) |
| Workers | in-process dsh agents through a fake-pi process runner |
| Background sessions | separate process unless the module-state audit in phase 06 step 5 is clean |
| Third-party harnesses | keep `src/harness` |
| Data folder | same `~/.pi/bot-lobby` and `<project>/.pi` on both hosts |
| Tool approvals | Bot Lobby agents use dsh's `danger-full-access` preset, like pi |

## Later (not in this spec)

- Serve the UI from dsh's own web server (needs a base path for every UI request and a different API prefix than `/api`).
- Replace `src/harness` with dsh's `dsh-subagent-codex`, `-claude-code`, `-acp`.
- A Bot Lobby panel inside dsh's own web client through slots.
- Make dsh the default host after dsh 1.0.
