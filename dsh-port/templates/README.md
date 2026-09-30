# Templates

Starting points for the new repo. Each says exactly how far it was verified. See [../reference/VERIFIED-FACTS.md](../reference/VERIFIED-FACTS.md) for the environment the checks ran in.

| Template | What it is | Verified |
| --- | --- | --- |
| [`probe-js/`](probe-js) | A plain-JS DSH bundle: host half + client half | **Ran in DSH Web 0.2.0-rc.2 in Chromium.** The page opened, the host API answered 200 behind login (401 without), the tool registered, and the models listed |
| [`skeleton-ts/`](skeleton-ts) | The TypeScript starting point for the plugin repo: esbuild build, host + client halves, a smoke test | **Typecheck, build and tests pass** (Node 22.22, TypeScript 5.7, `@types/react` 18, `@deepseek-ai/dsh-tools` 0.2.0-rc.2 types). The host bundle imports under Node. **Not yet run inside DSH**: P0-02's first job |
| [`scripts/`](scripts) | Start/stop DSH Web and a Playwright UI check | Adapted from the commands and script that verified `probe-js`; syntax-checked, not run in this form |

## `probe-js/`: what DSH needs, and nothing else

```
probe-js/
├── package.json       exports ".", "./client", "./package.json"; dsh.bundle.patch; dsh.client { platform: "web", inject: [...] }
├── cordis.patch.yml   inserts the plugin row
├── index.js           host half: name, inject, apply(ctx)
└── client.js          client half: window.__ModuleLoader__.load({ id, factory(require) { … } })
```

What each part shows:
- **`index.js`:**
  - a web route under `/bot-lobby-probe` that admits only the logged-in page (`ctx.connection.admit(req)`);
  - JSON endpoints `ping`, `tools` and `models` (`ctx.llm.listProviders()` + `listModels(route.id)`);
  - one model-facing tool (`defineTool` from `@deepseek-ai/dsh-tools`, resolved from DSH at runtime with no dependency declared).
- **`client.js`:**
  - React from the page's module table (`require('react')`);
  - a page in the `main` slot keyed `bot-lobby-probe`, and its entry in `sidebar.panellist`;
  - a `conversation.composer.dock` decoration, which showed nothing on the home page (the slot belongs to a session's composer; not yet checked inside one);
  - `window.__botLobbyProbe.selectPanel()` for automation.

**Try it.** With DSH installed as in [../DEV-ENVIRONMENT.md](../DEV-ENVIRONMENT.md):

```sh
DSH_HOME=$PWD/.dsh-home npx dsh plugin --profile web add /absolute/path/to/probe-js
```

Then start DSH Web and click **Bot Lobby** in the left sidebar. Its names (`bot-lobby-probe`) do not collide with the real plugin's (`bot-lobby`).

## `skeleton-ts/`: the new repo's first commit

```
skeleton-ts/
├── package.json        name to change (P0-01), exports, dsh block, scripts, devDependencies
├── cordis.patch.yml    the plugin row
├── tsconfig.json       strict, NodeNext, jsx react-jsx, DOM + Node types
├── scripts/build.mjs   esbuild: src/host → lib/index.js (ESM, Node 22); src/client → lib/client.js (CJS wrapped for DSH's module loader)
├── src/host/index.ts   apply(ctx): the /bot-lobby/api/* route behind admission; a `models` endpoint; one placeholder tool
├── src/client/api.ts   the page's only transport function (grows into HostApi, P0-06)
├── src/client/index.tsx the Bot Lobby page (lists the user's DSH models) and its sidebar entry
└── test/api.test.ts    smoke test for the client transport
```

**Steps:**

```sh
npm install        # installs the devDependencies, including the pinned @deepseek-ai/dsh-tools (types only)
npm run typecheck
npm test
npm run build      # lib/index.js + lib/client.js
```

**Things to know:**
- **Externals.** DSH packages (`@deepseek-ai/*`), React and Node built-ins are **external** in both bundles. DSH provides them at runtime. Never add them to `dependencies`: a second copy of React or of a DSH service breaks the page or the host. Add a DSH package to `devDependencies` only for its types, pinned to the DSH version (D-17).
- **The module id.** The client module id is the package name (`scripts/build.mjs` reads it). Rename the package and the loader id changes with it.
- **The `inject` lists** (host: `connection`, `webServer`, `tools`, `llm`; client: `slots`, `layout`) are the services each half needs. DSH activates a half only when they exist. Add each service you use (`subagents`, `commands`, `userQuestions`, `systemPrompt`, `storageDomain`, …) as you use it.
- **Typing the context.** `HostContext` and `ClientContext` are hand-written slices of the Cordis `Context` type. Replace them with the real types (`import type { Context } from '@deepseek-ai/cordis'` plus each service's module augmentation) once the matching packages are devDependencies.
- **Replacing an installed plugin.** Replacing an already installed package needs a DSH restart to load new JavaScript; a new bundle can activate through HMR (`reference/dsh/skills/cordis-plugin-development/references/host-plugin.md`). In development, stop and start DSH after `npm run build`.

## `scripts/`

Copy these to `scripts/dsh/` in the plugin repo. They assume the repo root is two levels up, and they keep their pid and log in `$DSH_HOME`:
- **`start-web.sh`:** starts DSH Web in its own process group from `DSH_WORKSPACE` (DSH's default workspace root is the directory it starts in), waits for the tokenized URL and prints it.
- **`stop-web.sh`:** stops that process group. Never use `pkill -f`: it matches the invoking shell too.
- **`ui-check.mjs`:** Playwright.
  1. Opens the URL (or reads it from `$DSH_HOME/web.log`).
  2. Dismisses the first-run Preview Notice.
  3. Clicks the sidebar entry by label.
  4. Checks a `data-testid`, logs console errors and saves a screenshot.

  It exits 1 on failure.

Add `playwright-core` as a devDependency. On a machine without Playwright's browsers, set `CHROMIUM_PATH` to a Chromium binary.
