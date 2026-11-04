# 00. Rules for the builder

Read this before every phase. These rules beat anything a phase file says.

## A. Never do these

1. Never change the logic of engine files that have no pi import (`src/state`, `src/schemas`, `src/workflow`, `src/master`, `src/roles`, `src/delivery`, `src/agents`, `src/scripts`, most of `src/classifier`, `src/knowledge`, `src/execution`). Change their imports or a function signature only when a phase file names the file and the change.
2. Never write the dsh profile's `package.json` or `cordis.patch.yml` by hand, never create packages under `$DSH_HOME`, never run pnpm inside a profile folder. Install with `plugin_manager` (`action: install_bundle`, `target`: absolute path of the repo root). This is how dsh's Creator mode works.
3. Never append session events with a new `type` to a dsh Session. dsh refuses to reopen such sessions. Bot Lobby keeps its own records in its own files (`src/state` already does this).
4. Never listen to `system-prompt/assemble` to add text or tools. Use `ctx.systemPrompt.section()` and `ctx.tools.restrict()`.
5. Never poll `agent/status` in a loop. Wait on `session/event` (`turn/end`, `assistant/message`, `tool/result`) or a subagent's `result` promise.
6. Never serve a page from the host and show it in an iframe. Bot Lobby UI is React components registered in dsh slots. The one allowed iframe is the questionnaire's mockup preview (`sandbox=""` with `srcDoc`, phase 08 Part E).
7. Never append to `document.body`, never read another plugin's DOM, never hard-code colours in UI. Use dsh theme tokens (`--dsw-alias-*`, list them with `cordis_inspect_query` → `Theme`).
8. Never skip, disable or delete a test to get green. A test for deleted pi code is deleted together with that code in phase 09, and only then.
9. Never add screenshots, GIFs or browser tests. UI checks are typecheck and build.
10. Never invent a dsh API. Check it (section B). If it does not exist, write that in `STATUS.md` and stop.

## B. How to check a dsh API before using it

dsh changes fast. Names in this spec were true on dsh main `8bd07339`. Before you use a service method, event, slot or config key:

1. In a dsh Creator session, call `cordis_inspect_query`: kind `Service` (for example `agents`, `subagents`, `tools`, `systemPrompt`, `commands`, `webServer`, `connection`, `llm`, `compaction`, `agentPresets`, `worktrees`, `userQuestions`), kind `Event` (for example `agent/created`, `tools/pre-execute`, `session/event`), or Client `Slots.listSubTree` for a slot and its props.
2. For a plugin's config keys: `Config.listConfigs`, filter by package name, query the entry, read `<packageDir>/README.md`.
3. Otherwise read the installed package's `lib/types/**/*.d.ts`, or the dsh source checkout at `packages/<group>/<name>/src`.

If what you find differs from this spec, follow what you found and note the difference in `STATUS.md`.

## C. Pin dsh

- One exact dsh version for the whole port, written in `package.json` `engines.dsh` (for example `"0.2.1-rc.5"`).
- Install the matching `@deepseek-ai/*` packages as `devDependencies` at exactly that version, for types only. At runtime the bundle uses the packages of the dsh install.
- Do not upgrade dsh inside a phase. To upgrade: finish the phase, read every `docs/upgrade-guide/<version>/` folder in dsh between the old and new version, apply what applies, rerun phase 10's checklist.

## D. Code style

- TypeScript, ES modules. Host code imports with `.ts` extensions (the repo uses `allowImportingTsExtensions`).
- Only erasable TypeScript syntax (no `enum`, no parameter properties, no `namespace`).
- Small files, one job each. Short comments that say why.
- UI text goes through dsh's Client locale service (`locale/en.json` and the client locale namespace). Sentence case for English labels.
- UI uses dsh components from `@deepseek-ai/dsh-client-ui-primitives` (it is a platform module the page already loads). This is allowed because Bot Lobby's client is TypeScript compiled against the pinned version. If a primitive you need is not exported, copy its markup and CSS into `src/client/ui/` under a `bl-` class prefix, keeping only `--dsw-alias-*` tokens.

## E. Checks to run after every phase

```sh
npm run typecheck      # host and client
npm test               # node --test
npm run build          # host + client bundle (from phase 02 on)
```

Then in dsh: reinstall with `plugin_manager install_bundle`, read the result's `application` and `warnings` (not logs), and confirm the plugin rows with `cordis_inspect_query`. `applied` = live. `restart-required` = restart dsh before testing.

## F. Commits

- Branch `dsh-port` from `main`.
- Message `dsh port: phase NN <short name>`.

## G. When stuck

Write into `docs/dsh-migration/STATUS.md`:

```
## Phase NN: blocked
What I tried:
What failed (exact error):
What I think is needed:
```

Then stop.
