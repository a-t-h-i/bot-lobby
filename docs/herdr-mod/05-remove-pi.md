# 05. Remove pi

Goal: no pi code, no pi dependency, no pi process anywhere.

## Steps

1. Delete `src/host/pi-host.ts`, `src/pi/*` (after moving anything still used into `src/daemon` or the engine), `src/execution/pi-runner.ts`'s pi spawn path (`spawnPiProcess`, RPC), `src/lobby/pi-commands.ts`, `src/desk/client-extension.ts` (pi side), `src/index.ts` (the pi extension entry).
2. `package.json`: remove `pi` (`pi.extensions`), the `@earendil-works/pi-*` peer and dev dependencies, the pi keywords; keep the `bot-lobby` bin.
3. Tests: 31 test files import pi. Tests that test deleted pi glue are deleted with it (rule: never delete a test to get green; these go because their code goes). Tests of engine logic are moved onto `Host` with a fake host (`test/fake-host.ts`). List each deleted test and why in `STATUS.md`. Ask the owner before deleting any test whose code is not deleted.
4. Slash commands: commands registered with pi (`/bot-lobby web`, etc.) become daemon commands typed in the Lobby (`status.get` → `commands`). Drop the ones only pi needed (`web stop/link/reset` stays as `web link`, `web reset`).
5. Docs: `README.md`, `docs/guide.md`: install = `npm i -g bot-lobby` (or the repo), run = `bot-lobby serve` or press Start in herdr; requirements = Node + at least one harness.
6. The React web app (`webui/`) keeps working against the daemon (same API). Whether to keep it is the owner's call; bot-herdr does not need it (see `compare-dsh.md`).

## Done when

- `grep -rn "@earendil-works/pi" src test package.json` finds nothing.
- `npm run typecheck`, `npm test`, `npm run build` pass.
- On a machine without pi: install, `bot-lobby serve`, a task runs end to end on an installed harness.
