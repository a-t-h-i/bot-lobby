# 03. Bundle skeleton (2 days)

## Goal

A dsh bundle that installs, loads, starts Bot Lobby's web server, and adds a `/lobby` link inside dsh. The page shows Bot Lobby's UI on a fixture backend (no real agents yet).

## Decision: where the web UI lives

Bot Lobby's UI calls absolute paths (`/api/...`, `projectUrl(...)`), and dsh already owns `/api`. Mounting the UI under a dsh path would need every UI path rewritten. So:

- The bundle starts Bot Lobby's own web server on its own port (default 7347, same as on pi), with Bot Lobby's own login (`src/webui/auth.ts`). No UI change.
- The bundle registers one dsh route, `/lobby`, that checks dsh's login and redirects to Bot Lobby's link. Users open Bot Lobby from dsh with one click.

Serving the UI on dsh's own server is optional later work (see `risks.md`, "Later").

## Read first

- `src/webui/server.ts` (`startWebServer`, `WebServerOptions`, `currentWebServer`)
- `src/webui/dev/serve.ts` and `src/webui/dev/fake-service.ts` (`createFixtureService`)
- dsh `docs/user/develop/basic/publish.md` (bundle manifest)
- dsh Creator skill `cordis-plugin-development/references/host-plugin.md` (display checklist)
- dsh `docs/subsystems/web-server.md` (`ctx.webServer.register`, `ctx.connection.requestRejection`)

## Files to create

```
dsh/
├── package.json
├── tsconfig.json
├── cordis.patch.yml
├── icon.svg            # copy of the Bot Lobby app icon (see /webui/public or the favicon set)
├── locale/en.json
├── src/
│   ├── index.ts        # the plugin: apply(ctx, config)
│   ├── config.ts       # Config schema
│   └── web.ts          # starts Bot Lobby's web server, registers /lobby
└── test/
    └── web.test.ts
```

### `dsh/package.json`

```json
{
  "name": "@a-t-h-i/bot-lobby-dsh",
  "version": "0.1.0",
  "description": "Bot Lobby multi-agent orchestrator as a DeepSeek Harness plugin",
  "type": "module",
  "license": "Apache-2.0",
  "exports": {
    ".": "./src/index.ts",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["src", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "engines": { "dsh": "0.2.1-rc.5" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- Put the exact dsh version you pinned (rules, section C) in `engines.dsh`.
- Do not list dsh packages as dependencies: shipped dsh packages resolve from the dsh install.
- The engine is imported from the repo with relative paths (`../../src/...`). That works because `install_bundle` links the folder. Publishing (phase 09) adds a build step.

### `dsh/tsconfig.json`

Extend the repo's `tsconfig.json`, include `src/**/*.ts` and `test/**/*.ts`, `noEmit: true`. For dsh types, add `paths` that point `@deepseek-ai/*` at the installed dsh's `lib/types` (find it with `cordis_inspect_query` → `Config.listConfigs` → `packageDir`), or install the matching `@deepseek-ai/*` packages as devDependencies at the pinned version.

### `dsh/locale/en.json`

```json
{ "meta": { "title": "Bot Lobby", "description": "Multi-agent orchestrator: a lobby chat, planned tasks, workers, review and a knowledge base." } }
```

### `dsh/cordis.patch.yml`

```yaml
- insert:
    - id: bot-lobby
      name: '@a-t-h-i/bot-lobby-dsh'
      config:
        webPort: 7347
        openBrowser: false
```

### `dsh/src/config.ts`

Declare `Config` with `Schema` from `@deepseek-ai/cordis` (check the exact import with `cordis_inspect_query` or an existing shipped plugin's `config.ts`):

- `webPort`: natural number, default 7347
- `openBrowser`: boolean, default false
- `fixture`: string, default `""` (phase 03 only: name of a dev scenario; empty means real backend once phase 05 lands)

### `dsh/src/web.ts`

```ts
import type { Context } from "@deepseek-ai/cordis";
import { startWebServer, currentWebServer } from "../../src/webui/server.ts";
import type { LobbyService } from "../../src/lobby/host.ts";

/** Starts Bot Lobby's own web server and links it from dsh at /lobby. */
export function mountWeb(ctx: Context, service: LobbyService, port: number): void {
  let link: string | undefined;
  ctx.effect(() => {
    let stopped = false;
    startWebServer({ service, port }).then((server) => { if (!stopped) link = server.link; });
    return () => { stopped = true; void currentWebServer()?.close(); };
  });
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/lobby",
    handler(req, res) {
      const rejection = ctx.get("connection")?.requestRejection(req);
      if (rejection !== undefined) { res.statusCode = 401; res.end(); return; }
      if (!link) { res.statusCode = 503; res.end("Bot Lobby is starting"); return; }
      res.statusCode = 302; res.setHeader("location", link); res.end();
    },
  }));
}
```

Check: the real method name that stops the server (`close`, `stop`) in `src/webui/server.ts`; the shape `requestRejection` returns. Fix the code to match.

### `dsh/src/index.ts`

```ts
import type { Context } from "@deepseek-ai/cordis";
import { Config } from "./config.ts";
import { mountWeb } from "./web.ts";
import { createFixtureService } from "../../src/webui/dev/fake-service.ts";
import { resolveScenario } from "../../src/webui/dev/fixtures.ts";

export const name = "bot-lobby";
export const inject = { required: ["webServer"], optional: ["connection"] };
export { Config };

export function apply(ctx: Context, config: Config): void {
  // Phase 03: fixture backend. Phase 05 replaces this with the real LobbyService.
  const service = createFixtureService(resolveScenario(config.fixture || "full"));
  mountWeb(ctx, service, config.webPort);
}
```

Check the `inject` form for optional services in `docs/user/develop/framework/service.md`.

## Test

`dsh/test/web.test.ts` (node:test): build a fake `ctx` with `effect`, `webServer.register` and `get`; call `mountWeb`; assert `/lobby` was registered as `exact`, returns 401 when `requestRejection` returns a status, and 302 to the link otherwise.

## Install and check

1. `npx tsc --noEmit -p dsh` passes.
2. `node --test dsh/test/*.test.ts` passes.
3. `plugin_manager` → `install_bundle`, `target` = absolute path of `dsh/`. Read `application` and `warnings`.
4. If the result says dsh cannot load `.ts` files: add a build (`tsc -p dsh --outDir dsh/lib`, emit JS only), point `exports["."]` at `./lib/dsh/src/index.js`, reinstall. Write this in `STATUS.md`.
5. `cordis_inspect_query` shows the `bot-lobby` row active.
6. Open dsh's web UI, then `/lobby`. You land on Bot Lobby's page with the fixture data.

## Done when

- [ ] Steps 1 to 6 all pass.
- [ ] Bot Lobby on pi still works (`npm run typecheck`, `npm test`).
- [ ] Plugin Manager shows the title "Bot Lobby", the description, and the icon.

Commit: `dsh port: phase 03 bundle skeleton`.
