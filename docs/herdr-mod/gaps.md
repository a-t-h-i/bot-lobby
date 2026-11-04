# Gaps, risks and accepted losses

## What herdr mods cannot do (herdr-app 0.1.13), and what bot-herdr does instead

| # | Gap | Effect on Bot Lobby | Workaround in this spec |
|---|---|---|---|
| 1 | No HTML, CSS, web view, React | Not one React component carries over. Every screen is rewritten (~120 web app files → ~40 mod files) | Pure TS helpers are bundled and reused (phase 08 Part A); words and data shapes carry over |
| 2 | No backdrop blur, no custom shadows (only preset `shadow_*`), no SVG filters | Glass under the top bar, goo composer, goo toast bubble, keycap bevels go | Flat cards with hairline borders; herdr's own toasts; keycaps as flat buttons with a 1 px lip |
| 3 | Motion only on opacity, width, height, left, top (+ `svg().spin`, `.frames`); one shared clock, no per-element phase | Per-letter shimmer, composer focus scale spring, paper-plane send, page-flip icon, poof, staggered loops | Whole-word pulse; small top/left bobs; transitions with delays for stagger on appear only |
| 4 | No reduced-motion signal | Can't follow the OS setting | "Calm motion" setting in bot-herdr |
| 5 | `fetch` returns text/JSON only, 30 s timeout, 8 MiB | No binary downloads | Images copied (local path) or fetched with `curl` into the app home |
| 6 | `image()` reads only under the app home | Can't show project images in place | Copy to `appHome()/data/bot-herdr/img/` first |
| 7 | No EventSource; WebSocket refuses credential headers | Live stream needs custom code | Raw `net` socket with chunked + SSE parsing (phase 06 step 5). Optional later: a WebSocket route in the engine with a token in the URL |
| 8 | No file picker for files (`pickFolder` only) | Attach button can't open a picker | Drop files on the composer; "Attach file…" with a path box and recent files |
| 9 | Paste of a clipboard image gives no data (`paste_other`) | Pasting screenshots doesn't attach | Toast "Drop the image file instead". Later: `exec` a platform clipboard tool (`pngpaste`, `xclip -t image/png`, PowerShell `Get-Clipboard -Format Image`) into a temp file |
| 10 | HTML mockups can't render | Questionnaire HTML previews aren't inline | Open in the system browser from a locked-down file (phase 09); Markdown and image previews stay inline |
| 11 | No drag and drop between elements | Knowledge: drag a note onto an agent | "Move to…" menu |
| 12 | Shiki highlighting and its themes | Code colours differ from today | herdr `Editor` with syntax colours from the theme's ANSI colours |
| 13 | No Mermaid / UML rendering | Agent diagrams written as Mermaid show as code | Show the code block with "Open in browser" (writes an HTML file using a pinned Mermaid from a CDN; owner's go-ahead needed because it fetches a script) or ask agents to also save an SVG, which `svg()`/`image()` can show |
| 14 | Remote spaces (SSH machines) | The server is loopback on this computer | v1: Bot Lobby only for spaces on this computer. Later: `hc exec --on <machine> curl …` as a transport |
| 15 | No browser access from phones or other computers | Today's link can open from anywhere on loopback-forwarded setups | Keep the web app alongside if needed; bot-herdr doesn't remove it |
| 16 | Linux needs a working Vulkan driver | Some VMs and WSL setups can't run herdr-app | Keep the web app as the fallback there |

## What going harness-only costs

| # | Gap | Effect | Workaround |
|---|---|---|---|
| H1 | Harness start-up takes seconds | One-shot calls (classifier, titles) are slow | Remote classifier or rule fallback on the typing path; one-shots only off it (phase 04 step 3) |
| H2 | Not every harness can take a message mid-turn | Steering the Orchestrator while it works | Steer on Claude Code (streaming input); queue as the next turn elsewhere |
| H3 | MCP calls time out | `ask_user_question` waits minutes or hours | Raise the harness's MCP timeout; else answer arrives as the next message (phase 03 step 1) |
| H4 | Harnesses keep their own context and compaction | Bot Lobby's "Compact at" and its checkpoint text don't apply to the Orchestrator | Map to the harness setting where one exists; accept the harness's own summaries |
| H5 | Assigned execution is refused on harnesses today | Structured assignments | Allow with a weaker guarantee (phase 04 step 1), owner's call |
| H6 | Six CLIs, six flag sets, all changing | More breakage on harness updates | Pin and test per harness; `src/harness/status.ts` reports versions |
| H7 | Headless sessions are not herdr terminals | Workers don't show as herdr panes while they run | Bot Lobby shows them in the Lobby; "Open in herdr" resumes a finished session in a herdr tab |

## Risks

1. **herdr changes fast.** App 0.1.x, updates often, the mod API is young (gpui-kit is vendored and modified). Pin the version you build against, read the `.d.ts` files after each update, rerun every `herdr-app check`. A breaking change means a bot-herdr release.
2. **Billing of headless Claude Code.** In October 2026 a headless Claude Code run from Bot Lobby on this project's sandbox account got "Third-party apps now draw from your extra usage" (project memory, harness work in PR #91). If that applies to the owner's plan, every Orchestrator and worker turn on Claude Code is billed as extra usage, not the plan. Spike check A6 finds out. If it does, prefer Codex or another harness for the Orchestrator, or run Claude Code interactively in a herdr terminal (its own TUI, input sent with `hc send`, replies read from its session file), which is a larger design change. Do not work around the billing policy.
3. **Two UIs to keep.** As long as the web app stays, every new Bot Lobby feature needs UI twice. Decide early whether bot-herdr replaces the web app or sits beside it.
4. **Two engine rewrites at once.** bot-herdr's phases 02 to 05 and the dsh port both take Bot Lobby off pi, in different directions. Running both wastes the work of one. Pick one (see `compare-dsh.md`).
5. **Copies and state.** If each mod copy has its own JS runtime (spike check 7), the shared-state design must stay small; large data in `setShared` is written to `shared.json` and would be slow.
6. **Mod trust.** Mods run with the person's full access (herdr's own warning). bot-herdr reads `web.json` (the secret); it must never send it anywhere but loopback.
7. **herdr telemetry is on by default.** It doesn't send mod names or content, but tell the owner (Settings → Privacy).

## Accepted losses (unless the owner says otherwise)

- Bot Lobby's own theme picker, fonts, 90% scale, goo effects, glass blur, sounds (already removed), PWA install.
- The terminal drawer and pop-out (herdr terminals replace them).
- Project switcher and folder browser (herdr spaces replace them).
- Inline HTML mockups (open in the browser instead).
- Image paste in v1.
- pi itself: its TUI, its model registry and keys, `pi --mode rpc` workers.
- Bot Lobby's own compaction checkpoint text for the Orchestrator (the harness compacts its own way).
