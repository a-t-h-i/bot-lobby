# 12. Parity and release

Goal: prove bot-herdr covers today's web app (or names what it drops), then package it.

## Step 1. Parity table

Fill `docs/herdr-mod/PARITY.md` with one row per feature: **works**, **changed** (say how), or **dropped** (link the `gaps.md` row). Every row is checked by hand in herdr against a real pi + Bot Lobby.

| Area | Feature |
|---|---|
| Shell | page strip and keys; sessions list (new, switch, rename, archive, delete, archived shelf); project = space; Start Bot Lobby; Orchestrator status in strip and in herdr's agents list |
| Lobby | history and older history; grouped headers; your bubble + "to Agent"; long message fold; notes; streaming reply with dot; activity runs (folded, open, live step, clock); thinking row; `alt-a`, `alt-t`; jump to latest; empty state |
| Indicators | working mark everywhere; role words (5 per role, 30-60 s swap, shared pick); speaker shimmer; Calm motion |
| Composer | Enter / Shift+Enter; `/` and `@` suggestions by keyboard and pointer; agent chips; attach by drop and by path; long paste → .txt; Stop with confirm; per-page target (Lobby, task, planner, knowledge) |
| Images | thumbnails, image window |
| Questionnaire | single, multi, free text, notes, Markdown preview, image preview, HTML mockup in browser, put away / reopen, dismiss, all pages |
| Tasks | list/detail split, archived switch, interventions with confirms, force close by title, skip step, delivery review, comments, message to task, auto, archive/restore/delete |
| Plan | seating, conversation, edit/retry, rail, plan split with `v`, line comments, save as task, previous plans |
| Knowledge | notes, rail, tags, filters, sort, new, inbox (accept N confident), note sheet, editors, move (menu), ask + answer card |
| Settings | all seven sections, effort slider, number boxes, lint wizard, retention, shortcuts window |
| Code | changes, code, unified diff, split diff, edit + save + conflict, open from links |
| Terminal | herdr terminals in the side column, run-in-terminal |
| Notices | `notice` events as herdr toasts |
| Robustness | pi restart, `web reset`, server switching (503), two herdr windows, a browser open at the same time (streams ≤ 8) |

## Step 2. Package

- Keep `herdr/` in the Bot Lobby repo. `npm run herdr:install` stays the developer path.
- Add `bot-lobby herdr install` (a pi command `/bot-lobby herdr install`) that runs the same copy from the installed npm package: add `herdr/` to `package.json` `files`, build `shared.js` in `prepack`.
- Share it on herdr.dev: a public folder (or a small repo `bot-herdr`) with `layouts/bot-lobby.json`, `mods/bot-herdr/`, `keys.json`, a `RECIPE.md` written in herdr's recipe order (AGENTS.md "Layouts and mods other people made"), `preview.png` (only when the owner asks for a screenshot), GitHub topic `herdr-layout`. Owner's go-ahead first; it is public.
- `herdr/README.md`: install, the herdr version built against, how to switch layouts (`ctrl-shift-l`), how to remove (delete the two folders and the layout file).

## Done when

- `PARITY.md` has no unchecked row.
- `npm run typecheck`, `npm test`, `herdr-app check` pass.
- A clean machine with herdr + pi + Bot Lobby installs with one command and shows the Bot Lobby layout.
