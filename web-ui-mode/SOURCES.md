# Sources

Everything this handbook rests on, with versions.

## Pi (the base)

| What | Where | Version |
| --- | --- | --- |
| The coding agent (extension API, SDK, RPC mode) | npm `@earendil-works/pi-coding-agent`; installed here as a devDependency; docs in `node_modules/@earendil-works/pi-coding-agent/docs/` | 0.87.0 |
| The terminal UI library | npm `@earendil-works/pi-tui` | 0.87.0 |
| Docs used | `docs/extensions.md` (events, `ctx.ui`), `docs/rpc.md` (modes, extension UI over RPC), `docs/sdk.md` (`createAgentSession`), `docs/packages.md` (install runs `npm install`), `docs/termux.md` | 0.87.0 |
| Types used | `dist/core/extensions/types.d.ts`: `ExtensionMode`, `ExtensionUIContext`, `ExtensionUIDialogOptions`, `sendUserMessage` | 0.87.0 |
| Website | [pi.dev](https://pi.dev) | |

## bot-lobby (what the web UI shows)

| What | Where |
| --- | --- |
| Repository | [github.com/a-t-h-i/bot-lobby](https://github.com/a-t-h-i/bot-lobby), this repo |
| Version mapped | 0.6.9 + the Excalidraw connection fix (commit `0a2c14d`) |
| User documentation | [README.md](../README.md) at the repo root, in particular "The lobby", "Planning" and "Questions and the web" |
| The terminal lobby | `src/lobby/` (runtime, view, tabs, stores), `src/ask/` (the questionnaire) |
| Screenshots of the terminal | `docs/*.png` at the repo root |

## The page's libraries (bundled into `webui/dist`, devDependencies)

| Library | Version checked | Licence | For |
| --- | --- | --- | --- |
| [Preact](https://preactjs.com) | 11.0.0 | MIT | Components and hooks |
| [marked](https://marked.js.org) | 18.0.14 | MIT | Markdown |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 | Apache-2.0 or MPL-2.0 | Sanitizing rendered Markdown |
| [esbuild](https://esbuild.github.io) | 0.28.2 | MIT | Bundling |
| [playwright-core](https://playwright.dev) | 1.56.1 | Apache-2.0 | UI checks |
| highlight.js (P3-04, lazy) | to be pinned | BSD-3-Clause | Code highlighting |
| Mermaid (P5-05, lazy, if Q-05) | to be pinned | MIT | Diagrams |

## Web platform references

| Topic | Reference |
| --- | --- |
| Server-sent events and `EventSource` | [MDN: Using server-sent events](https://developer.mozilla.org/docs/Web/API/Server-sent_events/Using_server-sent_events) |
| Secure contexts (why `http://127.0.0.1` can use service workers and notifications) | [MDN: Secure contexts](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts) |
| Fetch metadata (`Sec-Fetch-Site`) | [MDN: Sec-Fetch-Site](https://developer.mozilla.org/docs/Web/HTTP/Headers/Sec-Fetch-Site) |
| DNS rebinding and Host checks | [OWASP: DNS rebinding](https://owasp.org/www-community/attacks/DNS_Rebinding) |
| CSRF defences (JSON-only, SameSite) | [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) |
| The on-screen keyboard and the viewport | [MDN: `<meta name="viewport">` (`interactive-widget`)](https://developer.mozilla.org/docs/Web/HTML/Viewport_meta_tag) |
| Web app manifest | [MDN: Web app manifests](https://developer.mozilla.org/docs/Web/Manifest) |

## Tooling used for the verified facts

| Tool | Version |
| --- | --- |
| Node.js | 22.22.2 |
| TypeScript | 5.7.3 |
| Chromium | Playwright build 1194 |

## History

This folder was `dsh-port/`, a handbook for porting bot-lobby to a DeepSeek Harness plugin, until the user chose a localhost web UI on Pi instead. That handbook is in git history at commit `463d241`.
