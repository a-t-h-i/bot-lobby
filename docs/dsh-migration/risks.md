# Risks, gaps and open questions

## Risks

1. **API churn.** dsh is a developer preview and says breaking changes will come. 11 upgrade guides so far; `v0.2.2-alpha.2` alone has 18 notes, including subagent and session projection changes. Fix: pin an exact version, keep the host layer thin, budget time for each upgrade.
2. **No security audit.** dsh's SAFETY.md says it is not audited and its sandbox is not a full guarantee. Same as pi in practice, but worth saying in our README.
3. **One process for all agents.** In-process children share one Node process. A crash or a hot loop in one worker can hurt the whole Lobby. pi children today are separate processes. `dsh-sdk` children are separate but only return final text.
4. **Two hosts to maintain.** If we keep pi as the default while dsh matures, every engine change must work on both. Step 1 (host interface) keeps this cheap.
5. **Plugin version locks.** dsh checks `engines.dsh` on install and refuses a mismatch unless the user adds an exemption. Every dsh release may need a Bot Lobby release.

## Gaps (no clean dsh match)

- pi terminal features (shortcuts, entry renderers, pi-tui renderers, status line). Drop them.
- Session branches (`getBranch`, leaf id). dsh sessions are a straight event log.
- Live tool events from out-of-process children.
- `web_fetch` exists in dsh now but does not block private addresses: keep Bot Lobby's own web tools.
- Saved data lives under pi's `.pi` folders: needs a new home and a one-time copy.
- API keys live in pi's store: users sign in again through dsh credentials.
- 31 test files import pi: need a fake host.

6. **Spike before committing.** Live child events in our Tasks page, steering, and our questionnaire answering a dsh child are not proven yet. The 2-day spike (README step 0) checks them first.

## Open questions for you

1. Keep pi as the default and ship dsh side by side, or switch fully? (Recommended: side by side until dsh 1.0.)
2. Web UI at `/lobby` inside dsh's web server, or keep its own port? (Recommended: `/lobby`, one less server.)
3. Workers in-process (faster, live events) or separate processes (safer)? (Recommended: in-process first.)
4. Replace `src/harness` with dsh's Codex / Claude Code / ACP backends, or keep ours? (Recommended: replace where they match, keep Gemini / OpenCode / Antigravity on ACP.)
