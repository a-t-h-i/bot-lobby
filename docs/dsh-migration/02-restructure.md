# 02. Make the repo a dsh bundle (3 days)

## Goal

The repo root becomes an installable dsh bundle with a host plugin and a client plugin, both building and loading in dsh. The old pi entry stays in the tree but is no longer wired (it is deleted in phase 09). After this phase, dsh loads an empty "Bot Lobby" plugin with a placeholder panel.

## Read first

- `package.json`, `tsconfig.json`, `webui/tsconfig.json`, `webui/vite.config.ts`
- dsh `docs/user/develop/basic/publish.md` (bundle manifest)
- dsh Creator skill `references/host-plugin.md` (display checklist, `Config`, `configEditor`) and `references/ui-plugin.md` (client module format)
- dsh `packages/client/tsdown.client.ts` (how dsh builds client bundles: closure factory, externals from the module table, CSS modules) and `packages/client/web/src/platform.ts` (`PLATFORM_MODULES`)

## Step 1. Branch

```sh
git checkout main && git pull && git checkout -b dsh-port
npm test 2>&1 | tail -5     # save the pass/fail counts in STATUS.md
```

## Step 2. New folders

```
src/
├── plugin/                 # NEW: host plugin (Node)
│   ├── index.ts            # apply(ctx, config)
│   └── config.ts           # Config schema
├── client/                 # NEW: browser plugin (React)
│   ├── index.tsx           # factory: apply(ctx) registers slots
│   └── locale.ts
├── (engine folders stay where they are)
locale/en.json              # NEW: bundle title/description + client strings
icon.svg                    # NEW: the Bot Lobby app icon (from the existing favicon set)
cordis.patch.yml            # NEW
scripts/build-client.mjs    # NEW
```

## Step 3. `package.json`

Change these fields (keep `name`, `version`, `license`, `repository`):

```json
{
  "description": "Structured multi-agent software engineering orchestrator for DeepSeek Harness",
  "keywords": ["dsh-plugin", "deepseek-harness", "multi-agent", "subagents", "orchestrator", "code-review", "web-search"],
  "exports": {
    ".": "./lib/plugin/index.js",
    "./client": "./lib/client/index.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["lib", "prompts", "scripts/builtin", "cordis.patch.yml", "locale/*.json", "icon.svg", "THIRD_PARTY_NOTICES.md"],
  "engines": { "node": ">=24.9.0", "dsh": "<exact pinned version>" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": false, "inject": ["<packages that declare the slots you use; fill in phase 07>"] }
  },
  "scripts": {
    "typecheck": "tsc --noEmit && tsc -p src/client --noEmit",
    "build": "tsc -p tsconfig.build.json && node scripts/build-client.mjs",
    "test": "node --test --test-reporter=dot test/*.test.ts"
  }
}
```

- Remove the `pi` block and the `@earendil-works/*` peer and dev dependencies **in phase 09**, not now (the old code still compiles until then). Mark them in `STATUS.md` as "to remove".
- Add `devDependencies`: the `@deepseek-ai/*` packages you import, at the exact pinned version (types only), and `esbuild` for the client build.
- Runtime `dependencies` the engine needs (for example `typebox`) stay.

## Step 4. Host build: `tsconfig.build.json`

- `rootDir: "src"`, `outDir: "lib"`, `rewriteRelativeImportExtensions: true` (turns `.ts` imports into `.js`), `declaration: false`, `exclude: ["src/client/**", "webui/**", "test/**"]`.
- Why build at all: an installed npm package lives under `node_modules`, where Node will not strip TypeScript types. Local `install_bundle` from the folder links it, but the same `lib/` keeps one path for both.

## Step 5. Client build: `scripts/build-client.mjs`

Bundle `src/client/index.tsx` into `lib/client/index.js` in dsh's client module format:

```js
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'

// Modules the dsh page already provides through the loader's require (dsh packages/client/web/src/platform.ts).
const external = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', 'zod',
  '@tanstack/react-virtual', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit']

const result = await build({
  entryPoints: ['src/client/index.tsx'], bundle: true, write: false, format: 'cjs', platform: 'browser',
  target: 'es2022', jsx: 'automatic', external, loader: { '.css': 'text', '.svg': 'dataurl' }, minify: true,
})
const body = result.outputFiles[0].text
const id = JSON.parse(await readFile('package.json', 'utf8')).name
await writeFile('lib/client/index.js',
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory(require) {\n` +
  `const module = { exports: {} }; const exports = module.exports;\n${body}\n` +
  `return module.exports.default ?? module.exports; } });\n`)
```

- Check the list against `PLATFORM_MODULES` at your pinned dsh version and copy it exactly.
- CSS: import `.css` files as text and inject them inside `apply` with `ctx.effect` (create a `<style>` element in a component that renders it, or use dsh's style API if `cordis_inspect_query` shows one). Never leave styles behind on dispose.
- If dsh's own `tsdown.client.ts` preset is published as a package at your version, prefer it and note that in `STATUS.md`.

## Step 6. Host plugin skeleton

`src/plugin/config.ts`: a `Config` built with the schema helper dsh plugins use (copy the import from a shipped plugin's `config.ts`, for example `packages/compaction/compaction-basic/src/config.ts`). Fields for now: none, or `{ dataDir?: string }`.

`src/plugin/index.ts`:

```ts
import type { Context } from "@deepseek-ai/cordis";
export const name = "bot-lobby";
export { Config } from "./config.ts";
export function apply(_ctx: Context): void {
  // Filled in from phase 03.
}
```

`cordis.patch.yml`:

```yaml
- insert:
    - id: bot-lobby
      name: '@a-t-h-i/bot-lobby'
      config: {}
```

`locale/en.json`:

```json
{
  "meta": { "title": "Bot Lobby", "description": "Multi-agent orchestrator: a lobby chat, planned tasks, workers, review and a knowledge base." }
}
```

## Step 7. Client plugin skeleton

`src/client/index.tsx` exports default `{ inject: ['slots'], apply(ctx) {...} }`. Register one `sidebar.panellist` entry and its keyed `main` page (copy the pattern from dsh `packages/client/ui-schedule/src/client/index.ts`, `PANEL_ID`) that renders "Bot Lobby" using a dsh primitive (for example the page header component; find its name in `@deepseek-ai/dsh-client-ui-primitives` types).

`src/client/tsconfig.json`: `jsx: "react-jsx"`, `lib: ["dom", "es2022"]`, `types` for the dsh client packages.

## Step 8. Install

1. `npm run build`.
2. `plugin_manager` → `install_bundle`, `target` = absolute path of the repo root. Read `application` and `warnings`.
3. `cordis_inspect_query` shows the `bot-lobby` row active; the panel shows in the left sidebar.

## Done when

- [ ] `npm run typecheck`, `npm run build` pass. `npm test` counts match `STATUS.md`.
- [ ] Plugin Manager shows title "Bot Lobby", the description and the icon.
- [ ] The placeholder panel opens a main page in dsh's web client.

Commit: `dsh port: phase 02 bundle restructure`.
