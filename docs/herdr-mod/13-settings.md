# 13. Settings

Goal: Bot Lobby's settings inside herdr: Agents, Harnesses, Tools & skills, Workflow (with the lint wizard), Lobby, Classifier, Appearance & notifications.

## Read first

- `webui/src/tabs/settings/*` (all), `webui/src/ui/EffortChoice.tsx`, `webui/src/ui/effortLevels.ts`, `webui/src/ui/Segmented.tsx`.
- `src/webui/api/settings.ts`, `src/webui/api/retention.ts`, `src/schemas/configuration.ts` (`BotLobbyConfig`), `src/webui/protocol.ts` (`SettingsInfo`, `SettingsGrants`, `SettingsHarnesses`).

## Steps

1. Section switch at the top (segmented, springy thumb: `.spring("left")` on the thumb element). Sections as today: Agents, Harnesses, Tools & skills, Workflow, Lobby, Classifier, Appearance & notifications.
2. Data: `settings.get` → `{ config, models, classifierModels }`; save with `settings.set` (same body as `SettingsForm.tsx` sends: check whether it is a patch or the whole config). Save on change with a 400 ms debounce through `cx.timer.after` (data timer, allowed).
3. Controls (from gpui-kit, styled by us; base controls are unstyled):
   - Model pickers: `Select` / `Combobox` with search.
   - **Effort**: owner wants an elaborate drag slider. Use `Slider` + `SliderTrack` + `SliderIndicator` + `SliderThumb` (h 44 px track, per-level tone on the indicator, round white thumb, "Faster" / "Smarter" ends, a "Recommended" tick). Keep the levels from `effortLevels.ts`.
   - Thresholds (Compact at, limits): `NumberInput` with styled − / + buttons, never sliders (owner rule).
   - On/off: `Switch`.
   - Lists (MCP tools, skills, grants): `Checkbox` rows.
4. **Harnesses**: `settings.harnesses` status rows (installed, signed in, models). There is no model-key setting any more: each harness uses its own sign-in. Every agent row (Orchestrator included) has a **Harness** picker listing installed harnesses, then the model and effort that harness offers (phase 03 step 4, phase 04 step 4).
5. **Tools & skills**: `settings.grants`.
6. **Workflow → Linting wizard**: `settings.linters`, `settings.lintSetup`, `settings.lintRule`, `settings.lintCreate`, step by step as `LintWizard.tsx`.
7. **Lobby**: chat retention (`lobby.retention`, `lobby.setRetention`) and the rest of `LobbyGroup`.
8. **Appearance & notifications**: Bot Lobby's own theme picker and fonts are **dropped** (herdr owns the look; its theme picker is in herdr's Settings). Keep: "Calm motion" (phase 08 part D), notification choices that are about the engine. Add one line: "Colours and fonts follow herdr. Change them in herdr's Settings" with a button `run("app.settings", { section: "look" })`.
9. Keyboard shortcuts page (today's `?` sheet): a `window` overlay listing `keys()` filtered to `layout:bot-lobby` and `mod:bot-herdr`.

## Done when

- `herdr-app check` passes.
- Change an agent's model and effort, a threshold, a harness setting and a lint rule from herdr; the daemon picks them up (check `~/.bot-lobby/config.json` or the project's).
