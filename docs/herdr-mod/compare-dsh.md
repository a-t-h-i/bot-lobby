# bot-herdr vs the dsh port

Written 2026-11-04 to help pick which route is worth the time. The dsh port spec is `docs/dsh-migration/` (v2, on main); its work is on branch `dsh-port` (phase 01 spike passed "go", phase 02 restructure done).

## They are not the same kind of change

- **The dsh port changes the engine's host** (pi → dsh) **and** the UI (Bot Lobby's web app → dsh's web client with Bot Lobby panels).
- **bot-herdr changes only the UI** (Bot Lobby's web app → a native herdr mod). The engine stays on whatever host it is on: pi today, or dsh after the port.

So bot-herdr does not remove pi. If the goal is to drop pi, bot-herdr alone does not get there.

## Side by side

| | bot-herdr (herdr mod) | dsh port |
|---|---|---|
| What changes | UI only | Engine host + UI |
| pi | Stays (bot-herdr talks to today's server) | Goes completely |
| Fit for Bot Lobby's UI | Bot Lobby's own screens, rebuilt natively, laid out as today (Lobby, Tasks, Plan, Knowledge, Settings, questionnaire, working indicators). Loses blur, goo, per-letter shimmer and other web effects | dsh's look and components; Bot Lobby keeps its questionnaire and working indicators, the rest uses dsh's sidebar, composer, panes. Bot Lobby's look outside those goes (spec "accepted losses") |
| Code reuse | None of the React code; pure helpers and the whole HTTP API reused | Engine logic reused; React screens rewritten as dsh client components (TypeScript/React still) |
| Work size (agents build both) | Smaller: 12 phases, UI only, ~40 new mod files, 2 tiny engine changes. Bottleneck: the person trying each screen in herdr | Larger: 10 phases touching engine and UI; 2 done. Bottleneck: dsh API churn and checking engine behaviour, not just screens |
| Engine changes | Two tiny ones (no browser under herdr, status to herdr's agent list) | Large: tools, prompts, subagents, compaction, models, sessions all move onto dsh APIs |
| Speed | Native GPU UI: fast, light. Agents run as fast as pi runs them (no change) | In-process subagents (no `pi --mode rpc` child per worker): faster spawns; browser UI as today |
| Terminals | herdr's real terminals, scrollback, splits, SSH machines | dsh's terminal and file panes |
| Platforms | macOS (Apple Silicon), Linux (needs Vulkan), Windows native | Anywhere dsh + a browser run, including WSL |
| Remote / phone | No (native window only) | Browser, as today |
| Stability of the base | herdr-app 0.1.x, young mod API, updates often | dsh developer preview, 11 upgrade guides so far, plugin locked to one dsh version |
| Risk if the base changes | Fix the mod's UI code; the engine is untouched | Fix engine glue and UI glue |
| Main losses | Inline HTML mockups (open in browser), image paste (v1), drag between items, web effects, remote access | Bot Lobby's own look, `@mention` tray, code viewer and terminal drawer (dsh's instead), long-paste-to-file |
| Can it be tried cheaply? | Yes: 2-day spike (phase 01) against today's pi server | Already tried: spike passed |

## Recommendation

**Keep going with the dsh port. Don't start bot-herdr now.**

- The dsh port is the one that answers the bigger decision you already made (drop pi). It is under way and its spike passed.
- bot-herdr is a second UI for the same engine. Doing it now means building a UI against pi that you plan to remove, then re-pointing it at dsh.
- bot-herdr is designed to switch hosts cheaply (only `lib/server.js` and `lib/auth.js` know the host; see `gaps.md` risk 3). So it can wait without losing anything.

**When bot-herdr would be worth it:** after the dsh port works, if you want Bot Lobby to live in a native desktop app next to real terminals (instead of a browser tab), run bot-herdr's spike (phase 01) against the dsh plugin's `/bot-lobby/api` routes. If the spike passes, the rest is UI work only.

**If you would rather keep pi and only want a better desktop UI**, then bot-herdr is the cheaper route (UI only, tiny engine changes) and the dsh port should stop. That is the one case where bot-herdr wins.
