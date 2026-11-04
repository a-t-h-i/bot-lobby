# Gaps, risks and accepted losses

## What herdr mods cannot do (herdr-app 0.1.13), and what bot-herdr does instead

| # | Gap | Effect on Bot Lobby | Workaround in this spec |
|---|---|---|---|
| 1 | No HTML, CSS, web view, React | Not one React component carries over. Every screen is rewritten (~120 web app files → ~40 mod files) | Pure TS helpers are bundled and reused (phase 05 Part A); words and data shapes carry over |
| 2 | No backdrop blur, no custom shadows (only preset `shadow_*`), no SVG filters | Glass under the top bar, goo composer, goo toast bubble, keycap bevels go | Flat cards with hairline borders; herdr's own toasts; keycaps as flat buttons with a 1 px lip |
| 3 | Motion only on opacity, width, height, left, top (+ `svg().spin`, `.frames`); one shared clock, no per-element phase | Per-letter shimmer, composer focus scale spring, paper-plane send, page-flip icon, poof, staggered loops | Whole-word pulse; small top/left bobs; transitions with delays for stagger on appear only |
| 4 | No reduced-motion signal | Can't follow the OS setting | "Calm motion" setting in bot-herdr |
| 5 | `fetch` returns text/JSON only, 30 s timeout, 8 MiB | No binary downloads | Images copied (local path) or fetched with `curl` into the app home |
| 6 | `image()` reads only under the app home | Can't show project images in place | Copy to `appHome()/data/bot-herdr/img/` first |
| 7 | No EventSource; WebSocket refuses credential headers | Live stream needs custom code | Raw `net` socket with chunked + SSE parsing (phase 02 step 5). Optional later: a WebSocket route in the engine with a token in the URL |
| 8 | No file picker for files (`pickFolder` only) | Attach button can't open a picker | Drop files on the composer; "Attach file…" with a path box and recent files |
| 9 | Paste of a clipboard image gives no data (`paste_other`) | Pasting screenshots doesn't attach | Toast "Drop the image file instead". Later: `exec` a platform clipboard tool (`pngpaste`, `xclip -t image/png`, PowerShell `Get-Clipboard -Format Image`) into a temp file |
| 10 | HTML mockups can't render | Questionnaire HTML previews aren't inline | Open in the system browser from a locked-down file (phase 06); Markdown and image previews stay inline |
| 11 | No drag and drop between elements | Knowledge: drag a note onto an agent | "Move to…" menu |
| 12 | Shiki highlighting and its themes | Code colours differ from today | herdr `Editor` with syntax colours from the theme's ANSI colours |
| 13 | No Mermaid / UML rendering | Agent diagrams written as Mermaid show as code | Show the code block with "Open in browser" (writes an HTML file using a pinned Mermaid from a CDN; owner's go-ahead needed because it fetches a script) or ask agents to also save an SVG, which `svg()`/`image()` can show |
| 14 | Remote spaces (SSH machines) | The server is loopback on this computer | v1: Bot Lobby only for spaces on this computer. Later: `hc exec --on <machine> curl …` as a transport |
| 15 | No browser access from phones or other computers | Today's link can open from anywhere on loopback-forwarded setups | Keep the web app alongside if needed; bot-herdr doesn't remove it |
| 16 | Linux needs a working Vulkan driver | Some VMs and WSL setups can't run herdr-app | Keep the web app as the fallback there |

## Risks

1. **herdr changes fast.** App 0.1.x, updates often, the mod API is young (gpui-kit is vendored and modified). Pin the version you build against, read the `.d.ts` files after each update, rerun every `herdr-app check`. A breaking change means a bot-herdr release.
2. **Two UIs to keep.** As long as the web app stays, every new Bot Lobby feature needs UI twice. Decide early whether bot-herdr replaces the web app or sits beside it.
3. **Engine host change.** If the dsh port lands, Bot Lobby's own server goes; the dsh plugin serves the same calls at `/bot-lobby/api/<call>?workspace=<folder>` behind dsh's own auth (dsh-port `STATUS.md`, phase 01 note 6: `ctx.connection.requestRejection`, cookie set by `/?token=`). bot-herdr then needs: a new `findServer` (dsh's port and token), a new `cookieFor`, `API_BASE = "/bot-lobby/api/"`, and the Orchestrator started as `dsh` instead of `pi`. Keep those in `lib/server.js` and `lib/auth.js` only.
4. **Copies and state.** If each mod copy has its own JS runtime (spike check 7), the shared-state design must stay small; large data in `setShared` is written to `shared.json` and would be slow.
5. **Mod trust.** Mods run with the person's full access (herdr's own warning). bot-herdr reads `web.json` (the secret); it must never send it anywhere but loopback.
6. **herdr telemetry is on by default.** It doesn't send mod names or content, but tell the owner (Settings → Privacy).

## Accepted losses (unless the owner says otherwise)

- Bot Lobby's own theme picker, fonts, 90% scale, goo effects, glass blur, sounds (already removed), PWA install.
- The terminal drawer and pop-out (herdr terminals replace them).
- Project switcher and folder browser (herdr spaces replace them).
- Inline HTML mockups (open in the browser instead).
- Image paste in v1.
