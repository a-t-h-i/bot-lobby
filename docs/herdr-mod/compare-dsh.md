# bot-herdr vs the dsh port

Written 2026-11-04 to help pick which route is worth the time. Updated after the owner's call that bot-herdr drops pi and runs on whatever harnesses are installed.

The dsh port spec is `docs/dsh-migration/` (v2, on main); its work is on branch `dsh-port` (phase 01 spike passed "go", phase 02 restructure done).

## Both routes now drop pi. They replace it with different things

- **bot-herdr**: Bot Lobby becomes its own small daemon. Every model turn runs on an installed coding-agent CLI (Claude Code, Codex, Gemini CLI, OpenCode, Antigravity, ACP). Bot Lobby's tools reach them over MCP. The UI is a native herdr mod; the existing web app keeps working against the same API.
- **dsh port**: Bot Lobby becomes a plugin inside DeepSeek Harness. dsh runs the agent loop and calls models through its providers (API keys, or Codex OAuth); Claude Code / Codex / ACP are available as dsh subagent backends. The UI is dsh's web client with Bot Lobby panels.

## Side by side

| | bot-herdr | dsh port |
|---|---|---|
| What runs the models | Installed harness CLIs, on their own sign-ins (plans/subscriptions). No keys in Bot Lobby | dsh's model providers (keys or OAuth); harness CLIs only as subagent backends |
| "Use whatever is installed" | Yes, that is its design | Partly (subagents yes; the Orchestrator is a dsh agent on a provider model) |
| What Bot Lobby depends on | Its own daemon + six harness CLIs (+ herdr for the UI) | dsh for everything: agent loop, tools, sessions, subagents, UI |
| Engine work | New `src/daemon/`, a `Host` interface, MCP server (revived from `b72c8c3`), Orchestrator session per harness; 34 pi-importing files reworked or deleted | Same 34 files moved onto dsh services and events, plus dsh-specific bundle/preset/plugin structure |
| UI | Native herdr mod with Bot Lobby's own screens and design (minus web effects). The React web app also keeps working | dsh's look; Bot Lobby keeps its questionnaire and working indicators; its own web app is deleted |
| Fallback if the UI base disappoints | Keep using the web app; the daemon doesn't care | None: UI and engine are both on dsh |
| Speed | Each harness turn starts a CLI process (seconds); classifier must stay remote or rule-based | In-process subagents, direct model calls: faster per call |
| Steering the Orchestrator mid-turn | Claude Code yes; others queue | Yes (`agent.steer`) |
| Compaction and context | Each harness's own | dsh's compaction plugin |
| Stability risk | herdr 0.1.x (UI only) and six CLIs' flags | dsh developer preview, engine-wide, plugin locked to one dsh version |
| Cost risk | Headless Claude Code may bill as extra usage (spike check A6) | Provider API costs per token |
| Main losses | Inline HTML mockups (open in browser), image paste (v1), drag between items, web effects, Bot Lobby's compaction text | Bot Lobby's own look, `@mention` tray, code viewer and terminal drawer (dsh's), long-paste-to-file |
| Progress | Spec only | 2 of 10 phases done |
| Work size (agents build both) | Larger than before (engine + UI): 16 phases; bottleneck is real harness runs and you trying screens | 10 phases; bottleneck is dsh API churn and checking engine behaviour |

## Recommendation

**If "use whatever harnesses are installed" is the goal, bot-herdr is the better fit. Run its spike first, then pause the dsh port.**

- dsh's Orchestrator is a dsh agent on a provider model, so the dsh port does not give you "any installed CLI as the brain". bot-herdr does.
- bot-herdr keeps Bot Lobby's engine on its own feet. Only the UI depends on herdr, and the web app stays as a fallback. The dsh port puts everything on a preview framework.
- Doing both is two pi removals in different directions. Pick one.

**Run the spike first** (phase 01, part A): it checks the two things that could sink bot-herdr: whether a harness Orchestrator works well with Bot Lobby's MCP tools (resume, long questions), and **how headless Claude Code is billed on your plan** (gaps.md risk 2). If Claude Code turns out to bill as extra usage and you want Claude as the Orchestrator, that changes the picture.

**Stay with the dsh port instead** if you would rather pay per token through providers and want dsh's in-process speed and its UI, and don't mind depending on dsh for everything.
