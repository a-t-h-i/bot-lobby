# Verified facts

What was run against a real DSH while this handbook was written, and what it showed. Anything not on this list is documented at best: treat it as a claim to check.

## Environment

| | |
| --- | --- |
| Date | 2026-09-30 |
| OS | Linux (container), no display; Chromium driven by `playwright-core` |
| Node | v22.22.2 |
| DSH | `@deepseek-ai/dsh@0.2.0-rc.2` (npm dist-tag `next`); `@deepseek-ai/cordis` 4.0.1-rc.4 in the tree. Upstream monorepo: `github.com/deepseek-ai/deepseek-harness` |
| Profile | `web`, auto-initialised on first use, in a throwaway `DSH_HOME` |
| Model access | No API key configured. Model *listing* works without keys; no model was *called* |

## Install and profiles

1. **Install.** `npm install @deepseek-ai/dsh@next` works on Node 22.22. It installs about 540 packages in about a minute.
2. **`DSH_HOME` decides where everything lives:**
   ```
   $DSH_HOME/
   ├── profiles/web/
   │   ├── package.json        dsh.profile.bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "<your plugin>"]
   │   │                       dependencies: { "<your plugin>": "link:<absolute path>" }
   │   ├── cordis.yml          profile root, an empty list; not to be edited
   │   ├── cordis.patch.yml    the user's patch layer (starts as [])
   │   ├── pnpm-lock.yaml, pnpm-workspace.yaml, node_modules/, .plugin-manager/
   ├── storages/workspace.json storage-domain records (unit "workspace", version 2)
   ├── logs/startup-<timestamp>-<uuid>.log
   ├── .credentials.yaml       credential records (the browser-session grant is stored here)
   └── .anonymous-user-id
   ```
3. **Adding a local plugin.** `dsh plugin --profile web add <absolute dir>` installs it as a pnpm `link:` dependency and adds it to `dsh.profile.bundles`. `dsh plugin` forwards its arguments to pnpm in the profile directory.
4. **Removing it.** `dsh plugin --profile web remove <package name>` removes it from both.
5. **Inspecting the tree.** `dsh --profile web --dump-config` prints the composed tree, including the plugin's row.
6. **The workspace root.** DSH's default workspace root is the directory it is started from (`@deepseek-ai/dsh` README: "The invoking directory is the default workspace root").

## Running DSH Web

7. **The start command.** `dsh web --no-open --port 4817 --host 127.0.0.1` prints `dsh web: http://127.0.0.1:4817/?token=…`. Opening that URL logs the browser in, with a cookie. Without it:
   - `/api` answers **401**;
   - a `POST` to an unknown path answers **405** from the static server.
8. **The first-run notice.** The first run of a DSH home shows a **Preview Notice** modal; its **Continue** button dismisses it.
9. **Starting and stopping.**
   - Start: `setsid node node_modules/@deepseek-ai/dsh/lib/bin.js web …` with the pid recorded; stop: kill that process group.
   - Through `npx`, a wrapper child kept the port after the parent was killed.
   - `pkill -f <pattern>` also matched the invoking shell and killed it.

## Host half

10. **Resolving DSH packages.** `import { defineTool } from '@deepseek-ai/dsh-tools'` resolves at runtime with no dependency declared: DSH packages come from the DSH installation.
11. **Tools.** `ctx.tools.register(defineTool({ name, description, parameters, output: { schema, render }, execute }))` registered a global tool that the page could see through `ctx.tools.schemas()`.
12. **Tool visibility.** `ctx.tools.schemas()` from the plugin's root context listed **only globally registered tools** (just the probe's). DSH's built-in tools are agent-scoped and not in that list.
13. **Listing providers.** `ctx.llm.listProviders()` returned `[{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'deepseek-account', name: 'DeepSeek Account' }]` in a fresh web profile.
14. **Listing models.** `await ctx.llm.listModels('deepseek-official')` returned two models:
    - `{ provider, id: 'deepseek-flash', name: 'DeepSeek-V41-Flash', inputModalities: ['text', 'image'] }`
    - `{ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description, inputModalities: ['text'] }`

    `listModels(route.name)` failed with *no adapter registered for provider "DeepSeek"* (the `NO_ADAPTER` failure in `dsh-llm`'s vocabulary): pass the route **id**.

## Transport

15. **A web route with admission works.** `ctx.webServer.register({ kind: 'prefix', path: '/bot-lobby-probe', handler })` served the plugin's JSON endpoints. `ctx.connection.admit(req)` returns `{ rejection: <status> }` for a request without the login cookie (**401** from curl) and admits the logged-in page's `fetch(…, { credentials: 'same-origin' })` (**200**).
16. **`ctx.connection.rpc.handle(...)` fails from a plugin** with *cannot get property "webServer" without inject*. It fails the same way when `connection` and `webServer` are declared in the module's `inject`, in the patch row's inject, or through `ctx.inject(['connection', 'webServer'], …)`. Reading the code, the handler registration resolves `webServer` on the connection service's own context, not the caller's. Re-test on every DSH upgrade; if it starts working, it may be the better transport (D-12).

## Client half

17. **The module loader.** The module-loader format loads, and `require('react')` returns the page's React:
    ```js
    window.__ModuleLoader__.load({ id: '<package name>', factory(require) { …; return { inject, apply } } })
    ```
18. **The page and its sidebar entry.** Two registrations:
    - `ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Page))`;
    - `ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 90, label: () => 'Bot Lobby' }, Icon))`.

    They show a **Bot Lobby** entry in the left sidebar, between Plugins and Workspaces. `ctx.layout.selectPanel(PANEL)` opens the page.
19. **The composer dock showed nothing on the home page.** A `conversation.composer.dock` registration was accepted, and the page's home view rendered none of it. DSH's docs place the slot in a session's composer. Seeing it inside a session was not tried; it is P3-12's first check.
20. **`dsh.client.inject` only orders activation.** `dsh.client.inject: ['@deepseek-ai/dsh-client-ui-conversation']` in `package.json` only orders activation. The plugin does not import that package.

## TypeScript skeleton (`templates/skeleton-ts`)

21. **Checks pass.** With Node 22.22, TypeScript 5.7.3, `@types/react` 18.3, `@types/node` 22 and `@deepseek-ai/dsh-tools` 0.2.0-rc.2 installed, these all pass:
    - `tsc --noEmit`;
    - `node scripts/build.mjs`;
    - `node --check lib/index.js`;
    - `node --test test/*.test.ts`.

    `lib/client.js` starts with `window.__ModuleLoader__.load({ id: "dsh-bot-lobby", …`. Importing `lib/index.js` under Node exports `API_BASE`, `apply`, `inject` and `name`.
22. **Not yet run inside DSH.** Loading the skeleton into DSH Web and opening its page is task P0-02.

## Read but not run (the spikes' job)

None of these has been exercised. Their shapes are in [API-NOTES.md](API-NOTES.md) from types and READMEs:
- **Agents and subagents:**
  - `ctx.subagents.start` and child events;
  - `agent.ctx` registrations;
  - `agent.inject` / `followup` / `steer`;
  - `ctx.agents.create`.
- **User-facing services:** `ctx.userQuestions.ask`, `ctx.commands.register`, `ctx.systemPrompt.section`.
- **Storage and settings:** `ctx.storageDomain`, `ctx.sessionProjections`, `ctx.settings` volatile config, `dsh-credentials`.
- **UI:** the right-sidebar and `conversation.view` slots, `tool.call.toolview`, and `ctx.locale`.
- **Tool names:** DSH's built-in agent tool names.
- **Desktop:** anything about DSH Desktop.

## Prior art read (community plugins, MIT)

| Plugin | Version | What it shows |
| --- | --- | --- |
| `dsh-cron-panel` (github.com/a792883583/dsh-cron-panel) | 0.1.13 | A plugin page whose API is a `ctx.webServer.register` prefix route, the same approach as D-12 |
| `dsh-archive-manager` (github.com/Jasonrale/dsh-archive-manager) | 1.1.1 | Uses `connection.rpc.handle` / `rpc.call` for its page: the path fact 16 found failing for plugins in rc.2 |
| `dsh-agent-canvas` (github.com/Lhy723/dsh-agent-canvas) | 0.1.0 | A `conversation.view` tab showing agents, subagents, workflows and tool calls of a session, from `useSession` / `useSessions` snapshots. Closest prior art for the Agents view (P3-11) |
| DSH's own Plugin Manager page | (dsh-client-ui-plugin-manager) | `ctx.slots.inject('main', …register({ name: 'main', key: PANEL_ID, … }))` + a `sidebar.panellist` entry: the pattern our page uses |

All three community plugins build their client with esbuild and wrap it for `__ModuleLoader__`, like `templates/skeleton-ts/scripts/build.mjs`.
