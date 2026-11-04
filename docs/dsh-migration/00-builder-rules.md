# 00. Rules for the builder

Read this before every phase. These rules beat anything a phase file says.

## A. Never do these

1. Never delete or rewrite engine code that has no pi import (`src/state`, `src/schemas`, `src/workflow`, `src/master`, `src/roles`, `src/delivery`, `src/agents`, `src/scripts`, most of `src/classifier`, `src/knowledge`, `src/execution`). Change it only when a phase file names the exact file and change.
2. Never break the pi build. After every phase, `npm run typecheck` and `npm test` must pass on pi (see section E).
3. Never change the React web UI in `webui/src` unless a phase file says so. The UI talks to `LobbyService`; the port must keep that contract.
4. Never write the dsh profile's `package.json` or `cordis.patch.yml` by hand, never create packages under `$DSH_HOME`, and never run pnpm inside a profile folder. Install with `plugin_manager` (`action: install_bundle`, `target`: absolute path of `dsh/`). This is how dsh's Creator mode works.
5. Never append session events with a new `type` to a dsh Session. dsh refuses to reopen sessions with unknown event types. Bot Lobby keeps its own data in its own files (it already does, in `src/state`).
6. Never listen to `system-prompt/assemble` to add text or tools. Use `ctx.systemPrompt.section()` and `ctx.tools.restrict()`.
7. Never poll `agent/status` in a loop. Wait on `session/event` (`turn/end`, `assistant/message`, `tool/result`) or `agent.whenIdle()`.
8. Never skip, disable or delete a test to get green. If a test is pi-only, move it behind the pi host (phase 02 says how) and keep it running.
9. Never add screenshots, GIFs or browser tests. UI checks are `npm run typecheck` and `npm run web:build`.
10. Never invent a dsh API. If you are not sure a method or event exists, check it (section B). If it does not exist, write that in `STATUS.md` and stop.

## B. How to check a dsh API before using it

dsh changes fast. The names in this spec were true on dsh main `8bd07339`. Before you use any service method, event or config key:

1. In a dsh Creator session, call `cordis_inspect_query` with kind `Service` (for example `agents`, `tools`, `systemPrompt`, `commands`, `webServer`, `connection`, `llm`, `compaction`, `credentials`) or `Event` (for example `agent/created`, `tools/pre-execute`, `user-questions/request`, `session/event`).
2. For a plugin's config keys, call `cordis_inspect_query` with `Config.listConfigs`, filter by package name, then query the entry. Read `<packageDir>/README.md`.
3. If that is not available, read the installed package's `lib/types/**/*.d.ts`, or the source checkout at `packages/<group>/<name>/src`.

If what you find differs from this spec, follow what you found, and note the difference in `STATUS.md`.

## C. Pin dsh

- Use one exact dsh version for the whole port. Write it in `dsh/package.json` under `engines.dsh` as an exact version (for example `"0.2.1-rc.5"`).
- Do not upgrade dsh in the middle of a phase. To upgrade, finish the phase, read every folder under dsh's `docs/upgrade-guide/<version>/` between the old and new version, apply what applies, and rerun phase 09's parity test.

## D. Code style (Bot Lobby's rules)

- TypeScript, ES modules, `.ts` imports with the extension (the repo uses `allowImportingTsExtensions`).
- Only erasable TypeScript syntax (no `enum`, no parameter properties, no `namespace`). Node 24 strips types; it cannot compile those.
- Small files, one job each. Short comments that say why, not what.
- New px sizes in UI code go through `webui/src/lib/uiScale` (only if a phase touches UI, which should be rare).

## E. Checks to run

On the Bot Lobby repo, after every phase:

```sh
npm run typecheck        # tsc for src and webui
npm test                 # node --test, pi host
npm run web:build        # only if anything under webui/ changed; commit webui/dist too
```

On the dsh bundle, from phase 03 on:

```sh
cd dsh && npx tsc --noEmit -p .   # bundle typecheck
node --test dsh/test/*.test.ts     # bundle tests (phase files say which to add)
```

Then in dsh: install or reinstall with `plugin_manager install_bundle`, read the result's `application` and `warnings` fields (not logs), and confirm the plugin rows with `cordis_inspect_query`. `application: applied` means live. `restart-required` means restart dsh before testing.

## F. Commit rules

- Branch: `dsh-port` (created in phase 02).
- One commit per phase, message `dsh port: phase NN <short name>`.
- Commit `webui/dist` only if the web build changed.

## G. When stuck

Write into `docs/dsh-migration/STATUS.md`:

```
## Phase NN: blocked
What I tried:
What failed (exact error):
What I think is needed:
```

Then stop. Do not guess past a failed check.
