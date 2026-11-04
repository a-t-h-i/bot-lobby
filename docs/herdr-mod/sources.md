# Sources

Read on 2026-11-04.

## herdr

- `herdrdev/herdr-app` master `93b097f` (app 0.1.13): `README.md`, `docs/mods.md`, `docs/security.md`, `docs/commands.md`, `defaults/AGENTS.md` (the mod and layout guide, written into the app home on start), `defaults/herdr.d.ts` (the `herdr` module), `defaults/layouts/main.json`, `defaults/mods/*` (shipped mods), `src/mods.rs` (mod capabilities: read home, write app home, exec, network, storage, clipboard all granted), `src/SKILL.md`.
- Vendored gpui-kit in herdr-app: `vendor/gpui-kit/crates/shell/src/typings.rs` (source of `gpui-kit.d.ts`: elements, components, motion, `fetch`, `net`, `websocket`, `fs`, storage), `style.rs` (style methods; `shadow` with arguments not bound), `engine/quickjs/standard/fetch.rs` (30 s timeout, 8 MiB, forbidden headers: host, content-length, connection, expect, proxy-*, te, trailer, transfer-encoding, upgrade; `cookie` allowed), `net.rs` (raw TCP, 30 s read timeout), `websocket.rs` (ws/wss only, credential headers refused).
- `bdsanxz/herdr-mods`: community mods and the OSC 7501 format used by agent integrations (`ESC]7501;state=<word>:app=<name>ESC\`).
- herdr.dev mods index and heise.de article on the Herdr desktop app (background only).
- Earlier assessments: project memory note `bot-lobby-herdr` (2026-10-28 and 2026-11-01).

## Bot Lobby (main `94b436a`)

- Server: `src/webui/server.ts`, `auth.ts`, `events.ts`, `protocol.ts`, `projects.ts`, `command.ts`, `api/index.ts` (every call name and body schema), `api/*.ts`.
- Engine bits touched by phase 03: `src/pi/events.ts`, `src/lobby/prompt-hub.ts`, `src/lobby/topics.ts`, `src/state/project.ts`, `src/schemas/configuration.ts`, `src/ask/types.ts`.
- Web app: `webui/src/app/*`, `webui/src/tabs/*`, `webui/src/prompts/*`, `webui/src/ui/*`, `webui/src/lib/*` (file headers and API calls per screen).
- dsh port: `docs/dsh-migration/*` (v2) and branch `dsh-port` `docs/dsh-migration/STATUS.md` (phases 01-02).
