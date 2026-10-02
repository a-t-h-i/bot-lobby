# Web UI status

P0-01 copies this file to `docs/web-ui/status.md`. Agents claim and update tasks here, with one line per task.

**States:**
- `todo`
- `in progress: <agent>`
- `review: <PR>`
- `done: <PR>`
- `blocked: <reason>`

| Task | Title | State | Notes |
| --- | --- | --- | --- |
| P0-01 | Workspace and toolchain | done: Step 12 | React 19 + shadcn/ui workspace, `web:build`/`web:check`/dist-staleness fence green |
| P0-02 | Spike: a server inside Pi's TUI process | done: Step 5 | Answered by the in-process loopback server (`src/webui/server.ts`) |
| P0-03 | Spike: Android, Termux and Chrome | blocked: dropped | Phones out of scope per approved plan (≥768 px only, D-09) |
| P0-04 | Spike: answering questions in two places | done: Step 4 | PromptHub first-answer-wins + D-13 race semantics |
| P0-05 | Spike: the event stream on phones | done: Step 5 | SSE stream built (P2-04); phone aspect dropped with P0-03 |
| P0-06 | Spike: the lobby without a terminal | done: Step 7 | `web:dev` mock serves the page with no Pi |
| P0-07 | Design: wireframes for every screen | review: user approval | Batch 1 (shell, Lobby, questionnaire) in `docs/web-ui/design/batch-1.md`; needs the user's approval; batch 2 pending |
| P1-01 | `LobbyService` | done: Step 2 | Seam behind the TUI; TUI unchanged |
| P1-02 | Topics | done: Step 3 | Versioned topics |
| P1-03 | View models out of the tab files | done: Step 3 | Snapshot builders |
| P1-04 | The prompt hub | done: Step 4 | Ids, first answer wins |
| P1-05 | Start the service without a terminal | done: Step 7 | Fixture service + mock server |
| P1-X | Review checkpoint | done: Step 4 | Lobby tests green, TUI unchanged |
| P2-01 | Server core and lifecycle | done: Step 5 | Loopback server, single instance, port scan |
| P2-02 | Authentication | done: Step 5 | Cookie auth, origin checks, lockout |
| P2-03 | Protocol and router | done: Step 5 | Strict schemas, `{ok:false,error,code}` |
| P2-04 | The event stream | done: Step 5 | SSE hello/changed/deltas/ping |
| P2-05 | Read calls | done: Step 6 | status/lobby/tasks/plans/... reads |
| P2-06 | Action calls | done: Step 6 | send/abort/answer/dismiss, 409 races |
| P2-07 | Preview images | done: Step 6 | `/files/preview` jail |
| P2-08 | Command, config and opening the browser | done: Step 6 | `web`, `web stop`, `web link`, `web reset`, `lobby.web` |
| P2-09 | Mock server and fixtures | done: Step 7 | Ten scenario sets under `webui/fixtures/` |
| P2-X | Server checkpoint | done: Step 7 | Server/security tests green |
| P3-01 | Tokens and base components | done: Step 8 | shadcn tokens, tabs/sonner additions; since D-21, Pi's theme colours, monospace, key cells, `Frame` and `Rule` |
| P3-02 | App shell and layouts | done: Step 9 | Header, tab strip, routing, keys, help sheet; since D-21, the tabs are cells of the title line, not pills |
| P3-03 | Data layer | done: Step 8 | Store, topics, event hook, API client |
| P3-04 | Markdown | done: Step 10 | Real Markdown, no raw HTML, XSS-covered |
| P3-05 | The Lobby tab | done: Step 10 | Task header, runs, conversation, activity, thoughts, composer |
| P3-06 | Questions in the page | done: Step 11 | Slideout, badges, widened task header |
| P3-07 | Sessions | todo | Route + placeholder only; body pending |
| P3-X | First usable release | in progress: Step 12 | Harness (`web:check`, dist fence, parity) lands here; needs the user's go-ahead |
| P4-01 | Tasks tab | todo | |
| P4-02 | Plan tab | todo | |
| P4-03 | Quick fix tab | todo | |
| P4-04 | Metrics tab | todo | |
| P4-05 | Git tab | todo | |
| P4-06 | Knowledge tab | todo | |
| P4-07 | Excalidraw tab | todo | |
| P4-08 | Issues tab | todo | |
| P4-09 | Other windows | todo | |
| P4-X | Parity walkthrough | todo | |
| P5-01 | Settings page | todo | |
| P5-02 | Notifications | todo | |
| P5-03 | Installable app (PWA) | todo | |
| P5-04 | Accessibility and keys | todo | |
| P5-05 | Performance and extras | todo | |
| P5-06 | Docs | todo | |
| P5-07 | Release | todo | |
