# 07. Client foundation: host API, live updates, shared UI pieces (3 days)

## Goal

Everything phase 08's screens need, before any screen is built: a host API that the browser can call, a live update stream, a small client store, the dsh slot packages wired in `inject`, Bot Lobby's styles mapped to dsh theme tokens, and the shared pieces Bot Lobby keeps (working indicators, markdown).

## Read first

- Bot Lobby `src/webui/api/index.ts` (`routeApiCall`, `ApiContext`, `HttpError`, `sendJson`), `src/webui/protocol.ts` (`Api`, `ApiName`, `StreamEvent`), `src/webui/events.ts` (`EventHub`, `COALESCE_MS`, `HEARTBEAT_MS`), `src/lobby/topics.ts` (`LOBBY_TOPICS`), `src/lobby/host.ts` (`LobbyService`)
- Bot Lobby `webui/src/lib/api.ts`, `webui/src/lib/events.ts`, `webui/src/lib/store.ts`
- dsh `packages/host/open-in-app/src/index.ts` lines 180-240 (a prefix route with `requestRejection`)
- dsh `packages/client/ui-schedule/src/client/index.ts` (slots: `main`, `sidebar.panellist`, `sidebar.right.pane.tab`, `conversation.chat.turnTail`; `ctx.uiWorkspace.startSession`, `ctx.sidebarRight.openTab`)
- dsh `packages/client/ui-goal/src/client/index.ts` (`conversation.input.dock` with `inject: (sessionId) => ...`)
- dsh `packages/client/ui-theme` (the `--dsw-alias-*` token list) and Creator `references/ui-plugin.md`

## Step 1. Host API: `src/plugin/http/`

One prefix route: `/bot-lobby/api`. Keep Bot Lobby's call shape, `POST /bot-lobby/api/<group>.<action>` with a JSON body, so the old handlers move with small changes.

```ts
ctx.effect(() => ctx.webServer.register({
  kind: "prefix", path: "/bot-lobby/api",
  handler: async (req, res) => {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection !== undefined) { res.statusCode = rejection; res.end(); return; }
    // GET /bot-lobby/api/events → step 2. POST /bot-lobby/api/<name> → routeApiCall.
  },
}));
```

- Check `connection` with inspect (`connectionOf(ctx)` in open-in-app, or `ctx.connection`). Declare it in `inject`.
- Body size limit 1 MB; non-JSON body → 400.
- **Which project.** Every call carries `?workspace=<dir>` (a session-bound slot can send `?session=<id>` instead; the host maps it to that session's working directory). The host runs `detectProjectRoot(dir, CONFIG_DIR)` and caches one `ProjectService` per root. Find how a dsh client reads the current workspace folder (inspect `dsh-api-workspace-controller`, used by ui-schedule) and write it in `STATUS.md`.
- Move `src/webui/api/*.ts` handlers to `src/plugin/http/api/` and `routeApiCall` to `src/plugin/http/router.ts`. `ApiContext` becomes `{ service: ProjectService }` (no `port`).

### Which calls stay

| Group | Keep | Drop (dsh has it) |
|---|---|---|
| `status` | `get` | |
| `lobby` | | all (`snapshot`, `history`, `send`, `abort`, `retention`): the Lobby chat is a dsh session |
| `tasks` | all | |
| `plans` | all | |
| `planner` | all | |
| `knowledge` | all | |
| `settings` | `get`, `set`, `linters`, `lintSetup`, `lintRule`, `lintCreate`, `grants`, `harnesses` | |
| `prompts` | `list`, `answer`, `dismiss` (phase 08 questionnaire) | |
| `sessions` | | all: dsh sessions |
| `terminal` | | all: dsh terminal |
| `code` | | all: dsh files and changes panes |
| `projects` | | all: dsh workspaces |
| `themes` | | all: dsh theme |
| `files.upload` | | dsh attachments |

Remove dropped names from `Api` in `protocol.ts` (move the kept part to `src/plugin/http/protocol.ts`, shared by host and client with `import type`).

### `ProjectService`

`LobbyService` (`src/lobby/host.ts`) is session-bound and pi-backed. Write `src/plugin/http/project-service.ts` with only the methods the kept calls use, each calling the same engine function `src/lobby/service.ts` calls today. Copy the bodies, not the class. Where a method needs "the current session" (for example `tasks.message` to the orchestrator), take a `session` field in the body and find that orchestrator through phase 03's agent registry; deliver with `followup` / `steer` like phase 04 step 3.

## Step 2. Live updates: `GET /bot-lobby/api/events`

Server-sent events, one stream per open browser tab.

- Move `EventHub` from `src/webui/events.ts` to `src/plugin/http/events.ts`. Keep `COALESCE_MS` (40) and `HEARTBEAT_MS` (15000) and the max streams cap.
- Topics: `LOBBY_TOPICS` minus `lobby`. The engine bumps topics today (`lobbyTopics.bump(...)`); keep those calls.
- Add one topic, `runs`, bumped (coalesced) on every `AgentStreamEvent` from phase 05, with the task id. Phase 08 uses it for working indicators.
- Notices: the `notice` stream event stays (phase 08 shows them as dsh toasts).
- On `ctx` dispose, end every open stream.
- Event payload stays `{ topic, version }`: the client refetches what changed. Do not push full objects.

Check that a long-lived response works through `ctx.webServer` (headers `content-type: text/event-stream`, `cache-control: no-cache`, flush the first line at once). If dsh's web server buffers it, fall back to a WebSocket with `ctx.webServer.registerUpgrade` (see dsh `experimental/inspector/src/host/plugin.ts`) and write which in `STATUS.md`.

## Step 3. Client plumbing: `src/client/lib/`

- `api.ts`: `call<N extends ApiName>(name, body, where: { workspace } | { session })` → `fetch("/bot-lobby/api/" + name + query, { method: "POST", ... })`. Throws an `Error` with the server's message on non-2xx. Port from `webui/src/lib/api.ts`, drop the auth header code (dsh's cookie covers it; check with the spike's route).
- `events.ts`: one shared `EventSource` per workspace, reference-counted, reconnect with backoff 1 s → 30 s. `useTopic(topic, where)` returns the topic's version; components refetch on change. Port from `webui/src/lib/events.ts`.
- `store.ts`: `useCall(name, body, deps, topic?)` → `{ data, error, loading, reload }`, refetching when the topic version changes. Keep it under 80 lines; use `useSyncExternalStore`.
- `where.ts`: `useWorkspace()` reads the current dsh workspace folder (from step 1's finding).

Close the `EventSource` when the last user unmounts and in `ctx.effect` cleanup.

## Step 4. `package.json` `dsh.client.inject`

List every package whose slots or services the client uses. Start from:

```json
"inject": [
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-api-session-controller",
  "@deepseek-ai/dsh-api-workspace-controller",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-workspace",
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-chat",
  "@deepseek-ai/dsh-client-ui-sidebar-right",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-tool"
]
```

Then for each slot name phase 08 uses, run `Slots.listSubTree` (inspect) to find the declaring package, and fix the list. Remove any package you do not use. Copy exact names from dsh's own `package.json` files.

## Step 5. Styles and theme

Bot Lobby's CSS used its own variables (`webui/src/index.css`, `surface.css`). dsh pages use `--dsw-alias-*` tokens.

1. Make `src/client/tokens.css`: one line per Bot Lobby variable that phase 08's pieces still use, mapped to the nearest dsh token. Example: `--accent: var(--dsw-alias-accent-...)`. Find the real token names in `ui-theme`. Write the full map as a table in `STATUS.md`.
2. Bot Lobby's design rules still apply inside its own pieces where dsh's tokens allow: radii 12 outer / 10 controls / 8 nested, very light bevel, light blur, springy animations, `prefers-reduced-motion` respected. Prefer dsh's primitives (buttons, inputs, menus, dialogs, tabs) over Bot Lobby's own; keep Bot Lobby's own markup only for the pieces in step 6 and phase 08's questionnaire.
3. Scope every class under `.bl-` so nothing leaks into dsh. Rename `.cs-*` classes you move to `.bl-*`.
4. Load CSS as text (the esbuild `.css: text` loader from phase 02) and inject one `<style data-bot-lobby>` in `apply` through `ctx.effect`, removed on dispose.
5. Light and dark follow dsh's theme. Drop Bot Lobby's theme picker.
6. Desktop size: Bot Lobby drew its UI at 90% (`uiScale`). Inside dsh, use dsh's sizes; drop `uiScale` and the px→rem PostCSS step.

## Step 6. Shared pieces Bot Lobby keeps

The owner wants Bot Lobby's per-agent working indicators kept. Move these to `src/client/kit/` and make them build against dsh (React from the platform module, no Bot Lobby store, no Tailwind classes; plain `.bl-*` CSS):

| From `webui/src/` | To `src/client/kit/` | What it is |
|---|---|---|
| `ui/WorkingMark.tsx` | `WorkingMark.tsx` | the animated mark that shows an agent is working |
| `tabs/lobby/RoleWord.tsx` (+ `.cs-rw[data-fx]` rules in `surface.css`) | `RoleWord.tsx`, `role-word.css` | the per-role working word with its effect |
| `tabs/lobby/InlineActivity.tsx` | `InlineActivity.tsx` | one live line: role, what it is doing now |
| `tabs/lobby/InlineThinking.tsx` | `InlineThinking.tsx` | the folded thought text |
| `lib/useElapsed.ts`, `lib/useGradual.ts` | same | timers used by the above |
| `lib/markdown.ts` + its renderer | `markdown.tsx` | only if dsh primitives have no markdown component; check first and prefer dsh's |

Rules:
- Props in, no fetching inside. Phase 08 feeds them from `useCall("tasks.get", ...)` and the `runs` topic.
- Agent names keep their agent colour; no agent icons and no coloured dots (owner's design rules).
- Every animation stops under `prefers-reduced-motion: reduce`.
- `src/client/kit/index.ts` exports them.

## Step 7. Locale

`locale/en.json` gets a `client` namespace for every string phase 08 shows. Use dsh's client locale helper (`t(...)` from `dsh-client-locale`; copy the pattern from ui-schedule's `MANAGER_NS`). No raw English strings in components except agent role names that come from data.

## Tests

- `test/plugin-http.test.ts`: a rejected request gets the rejection status and no handler runs; `POST tasks.list` with `?workspace=` routes to the right `ProjectService`; a dropped name (`sessions.list`) gets 404; body over 1 MB gets 413.
- `test/plugin-events.test.ts`: two bumps within 40 ms send one event; heartbeat after 15 s (fake timers); dispose ends streams.

## Done when

- [ ] Typecheck, build, tests pass.
- [ ] From the placeholder page (phase 02), `call("tasks.list", {}, { workspace })` shows the project's tasks as raw JSON, and bumping a task (start one) refetches within a second.
- [ ] The placeholder page renders a `RoleWord` and a `WorkingMark` with dsh's light and dark themes, and both stop animating with reduced motion on.

Commit: `dsh port: phase 07 client foundation`.
