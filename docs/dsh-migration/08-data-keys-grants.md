# 08. Data folder, API keys, grants and the questionnaire (2 days)

## Goal

The last host-specific pieces: where Bot Lobby keeps its files on dsh, how users give model keys, where Settings gets the MCP tools and skills to grant, and how questions reach Bot Lobby's questionnaire instead of dsh's own web client.

## Part A. Data folder

Today: `~/.pi/bot-lobby` (global, `src/state/project.ts` line ~64, overridable with `BOT_LOBBY_CONFIG_DIR`) and `<project>/.pi/` (per project, via `CONFIG_DIR_NAME`).

Decision: keep the same folders on dsh. Users who switch between pi and dsh keep one set of tasks, plans, knowledge and settings, and nothing needs copying. `Host.configDirName` stays `".pi"` on dsh (phase 05 already does this).

Only the dsh-only files are new: `<global data>/dsh-sessions/` (side store, phase 05) and `<task dir>/sessions/dsh-session-id` (phase 06).

Add a short note to `README.md` under the dsh install section: "Bot Lobby on dsh uses the same `~/.pi/bot-lobby` folder as on pi."

## Part B. API keys

On pi, keys live in pi's auth store. On dsh they live in dsh's credentials service and settings, and dsh calls the models itself. Bot Lobby never needs a key on dsh, except to answer "can this model be used?" (phase 07 `getApiKeyForProvider`).

1. Settings → Classifier and Settings → Agents list only models dsh can call (from `HostModels.getAvailable()`).
2. Where Settings says "sign in to pi" or "pi key", show on dsh: "Add model keys in DeepSeek Harness settings." Find these strings with `grep -rni "pi key\|sign in\|/login" webui/src src/lobby`. Put the host-specific text behind a `host` field the UI already gets (add `host: "pi" | "dsh"` to the workspace info `LobbyService.workspace()` returns, if it has no such field). This is a small UI change: run `npm run web:build` and commit `webui/dist`.

## Part C. MCP tools and skills to grant

`LobbyService.grants()` returns `{ mcpTools, skills }` for Settings → Tools & skills. On pi, `src/pi/grants.ts` reads them from pi (`getAllTools()` filtered to `mcp__*`, and `loadSkills`).

On dsh:

- MCP tools: from `host.getAllTools()` (phase 04), the names dsh's MCP manager registered. Check their naming with `cordis_inspect_query` (`Tool`). Bot Lobby expects `mcp__<server>__<tool>`; if dsh names them differently, map in `dsh/src/host/grants.ts` and keep the reverse map so a grant names the real dsh tool.
- Skills: `Host.skills()` from dsh's skill service (inspect `Service` list; `dsh-skill-filesystem` provides them). Map to `{ name, description, path }`.

## Part D. Questionnaire bridge

Bot Lobby asks the user through its own questionnaire (`src/ask/`, shown in the Lobby). dsh tools that need the user (approvals, dsh's own questions) go through dsh's `user-questions/request` waterfall.

1. Bot Lobby's own `ask_user_question` tool needs nothing new: it already calls Bot Lobby's questionnaire through the Host (`ui.select` / `ui.editor`, and the relay for subagents).
2. Implement `HostUI.select`, `confirm`, `editor` on dsh (phase 05 left placeholders) with Bot Lobby's web prompt flow: read `src/ask/web.ts` for the function the web UI answers, call it, and fire `ui_prompt_start` / `ui_prompt_end` around it.
3. For Bot Lobby agents only, answer dsh's own questions in Bot Lobby's UI: register one `user-questions/request` listener (waterfall) on the plugin's ctx; if `request.agent` is a Bot Lobby agent, turn `request.questions` into Bot Lobby `AskQuestion`s, ask through step 2, and return `{ answers: [{ id, selected, custom? }] }`; otherwise `return next()`.
4. Approvals: Bot Lobby on pi runs without tool approvals. Give Bot Lobby agents dsh's `danger-full-access` permission preset (sandbox `danger-full-access`, approval `never`) so dsh does not stop workers for approval prompts nobody sees. Find how a session selects a permission preset (`docs/subsystems/permission-presets.md`, `Service permissionPresets`) and set it in phase 05 step 4 and phase 06 step 4. Write in the README that Bot Lobby on dsh runs with full access, like on pi.

## Tests

- `grants.test.ts`: dsh tool names → Bot Lobby grant rows and back.
- `questions.test.ts`: a `user-questions/request` for a Bot Lobby agent is answered by the bridge; for another agent it calls `next()`.

## Done when

- [ ] Tests pass; `npx tsc --noEmit -p dsh`; pi checks pass; `npm run web:build` if the UI changed.
- [ ] Settings → Tools & skills lists the MCP servers and skills dsh has.
- [ ] A worker using bash is never stopped by an approval prompt.
- [ ] A dsh question to a Bot Lobby agent shows in the Lobby questionnaire.

Commit: `dsh port: phase 08 data, keys, grants, questions`.
