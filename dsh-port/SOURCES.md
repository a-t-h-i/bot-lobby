# Sources

Everything this handbook is based on, with versions, so a reader can check a claim at its origin.

## DeepSeek Harness (DSH)

| What | Where | Version used | Licence |
| --- | --- | --- | --- |
| The CLI (`dsh`) and every `@deepseek-ai/dsh-*` package | npm: [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh), dist-tag `next` | 0.2.0-rc.2 | MIT, © 2026 DeepSeek |
| Source monorepo | [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (per each package's `repository` field) | — | MIT |
| Plugin framework | npm: `@deepseek-ai/cordis` (vendored in the monorepo at `vendor/cordis`) | 4.0.1-rc.4 | MIT, © 2021-present Shigma |
| DSH's own plugin-development guidance: the skills shipped in `@deepseek-ai/dsh-agent-preset` | vendored in [reference/dsh/skills/](reference/dsh/skills) | 0.2.0-rc.2 | MIT |
| Package READMEs (English) | vendored in [reference/dsh/packages/](reference/dsh/packages) | 0.2.0-rc.2 | MIT |
| Type definitions (`lib/types/*.d.ts`) | in each installed package; not vendored (read them in `node_modules/@deepseek-ai/<pkg>/lib/types/`) | 0.2.0-rc.2 | MIT |

**Where to read it in the monorepo.** READMEs link to monorepo paths such as `../../../docs/subsystems/subagent.md` and `.agents/notes/…`. Those links resolve only in a checkout of the DSH monorepo, not in this folder.

**Which docs matter most for the port:**
- `reference/dsh/skills/cordis-plugin-development/`: the whole skill, above all `references/practices.md`;
- `reference/dsh/skills/cordis-composition-reference/references/packages.md`: every installable package, with one line each;
- `reference/dsh/packages/`: `dsh-subagent`, `dsh-subagent-spawn-in-process`, `dsh-tools`, `dsh-llm`, `dsh-agent`, `dsh-user-questions`, `dsh-tool-ask-user`, `dsh-commands`, `dsh-system-prompt`, `dsh-storage-domain`, `dsh-session-projection`, `dsh-settings`, `dsh-credentials`, `dsh-host-webserver`, `dsh-client-connection`, `dsh-client-ui-slots`, `dsh-client-ui-layout`, `dsh-client-ui-sidebar-right`, `dsh-client-ui-conversation`, `dsh-client-locale`, `dsh-workspace`, `dsh-tool-web`, `dsh` (the CLI).

## Community DSH plugins (prior art; MIT)

| Plugin | Link | Version read | Why it matters |
| --- | --- | --- | --- |
| dsh-cron-panel | [github.com/a792883583/dsh-cron-panel](https://github.com/a792883583/dsh-cron-panel), npm `dsh-cron-panel` | 0.1.13 | A plugin page with a web-route API (our D-12 pattern); esbuild client wrapped for `__ModuleLoader__` |
| dsh-archive-manager | [github.com/Jasonrale/dsh-archive-manager](https://github.com/Jasonrale/dsh-archive-manager), npm `dsh-archive-manager` | 1.1.1 | Uses `connection.rpc.handle` / `rpc.call`, the path that fails for plugins in rc.2 |
| dsh-agent-canvas | [github.com/Lhy723/dsh-agent-canvas](https://github.com/Lhy723/dsh-agent-canvas), npm `dsh-agent-canvas` | 0.1.0 | A `conversation.view` tab drawing a session's agents, subagents, workflows and tool calls from `useSession` / `useSessions`: prior art for the Agents view |

Their code is not vendored. Read it from npm (`npm pack <name>`) or GitHub when a task needs it.

## bot-lobby (the source of the port)

| What | Where |
| --- | --- |
| Repository | [github.com/a-t-h-i/bot-lobby](https://github.com/a-t-h-i/bot-lobby), this repo |
| Version the handbook maps | 0.6.8 plus the Excalidraw feature (commit `f07bc1e`) |
| User documentation | [README.md](../README.md) at the repo root |
| Source, prompts, tests | `src/`, `prompts/`, `test/` at the repo root |
| Screenshots of the TUI | `docs/*.png` at the repo root |
| Pi (the host bot-lobby was written for; not used by the port) | [pi.dev](https://pi.dev); packages `@earendil-works/pi-coding-agent`, `pi-tui`, `pi-ai` 0.87.0 |

## Services bot-lobby talks to (unchanged by the port)

| Service | Used by | Link |
| --- | --- | --- |
| Excalidraw collaboration server (socket.io, end-to-end encrypted rooms) | F-50 | `https://oss-collab.excalidraw.com` (default); protocol in [github.com/excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) (`excalidraw-app/collab/`) and [github.com/excalidraw/excalidraw-room](https://github.com/excalidraw/excalidraw-room) |
| Jev (System-One classifier) | F-40…F-49 | [github.com/FrancoisChastel/jev-code](https://github.com/FrancoisChastel/jev-code); hosts: OpenCode Zen, TypeSafe |
| GitHub CLI | F-38, F-39 | [cli.github.com](https://cli.github.com) (`gh` owns sign-in; the plugin holds no token) |

## Tooling

| Tool | Version checked | Used for |
| --- | --- | --- |
| Node.js | 22.22.2 | runtime, tests (`node --test` with `.ts`) |
| TypeScript | 5.7.3 | `tsc --noEmit` |
| esbuild | 0.25.12 | bundling both halves |
| @types/react | 18.3 | client types |
| playwright-core + Chromium | chromium-1194 build | UI checks |
