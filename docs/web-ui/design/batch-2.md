# Batch 2 wireframes — Tasks, Plan, Quick fix, Sessions, Metrics, Git, Knowledge, Excalidraw, Issues, Settings

**Status:** for the user's approval before Phase 4 (plan P0-07, batch 2). Phase 4's tabs build to this document; Settings is Phase 5 (P5-01) and builds to the same drawings.

**Changed by D-21 (2026-10-02):** the user asked for the page to look like the terminal lobby, with the tabs part of the page rather than pills. Pi's theme colours replace the shadcn defaults, the face is monospace, the tab strip is drawn as cells of the title line (number printed, the chosen cell lit, no pills), panes are frames with the title in the border, and notices sit at the top right. Where this document says pills, a filled pill or the shadcn defaults, read `web-ui-mode/DECISIONS.md` D-21; layouts, content, wording and behaviour stand as drawn.

**Scope:** desktop/tablet only, ≥ 768 px (D-02, D-09). The shell, tab strip, Lobby tab, questionnaire slideout and Alt+H overlay are batch 1 (`batch-1.md`) and are not redrawn here: every drawing below is the **main pane** of that shell, between the 48 px tab strip and the composer. The composer, hint line, notices and the connection banner behave exactly as batch 1 (a) unless a screen says otherwise.

**Sources read for this document:** `src/lobby/prompts.ts` (TAB_IDS, TAB_LABELS, visibleTabs), `src/lobby/keys.ts` (LOBBY_ACTIONS, tabJumpKey, webKeyMap), `src/lobby/view.ts` (tab bar, the session picker `pickerBody`/`sessionPreview`, tab key help, hint chips), `src/lobby/tabs/tasks.ts`, `plan.ts`, `quickfix.ts`, `metrics.ts`, `git.ts`, `knowledge.ts`, `issues.ts`, `excalidraw.ts`, `src/lobby/layout.ts` (box/columns/split/bar/meter/sparkline semantics), `src/pi/settings-ui.ts` (every settings menu and wording), `src/pi/model-support.ts` (`kindLabel`), `src/lobby/knowledge.ts` + `src/knowledge/paths.ts` (AGENT_LABELS, AGENT_DIR_NAMES), `src/excalidraw/sessions.ts` (EXCALIDRAW_AGENTS, AGENT_LABELS, MAX_SESSIONS), `web-ui-mode/DECISIONS.md` (D-09, D-12, D-13, D-14, D-19), `web-ui-mode/FEATURE-INVENTORY.md` (W-50…W-154), `web-ui-mode/PLAN.md` (P0-07, P4-01…P4-09, P5-01), `docs/web-ui/parity.md` (Phase 3 verdicts), `docs/web-ui/design/batch-1.md` (conventions), `webui/src/components/ui/*` (the components we hold).

**Not in this batch:** batch 1 (shell, tab strip, Lobby, questionnaire, Alt+H); P4-09 "other windows" (a settings/Sessions affordance, drawn as part of Sessions); P5-02 notifications and P5-03 install, which have no screen of their own (they are the shell + Settings).

---

## Decisions for the user

Five choices to approve or change before Phase 4 starts.

1. **The one-pane rule and its breakpoint.** D-09 says "one main pane plus a Sheet" below 1024 px and "the same single pane, wider, with a Sheet for details" at ≥ 1024 px. The terminal shows list and detail side by side at its `*_COLUMNS_MIN` (90 or 100 columns). **Recommendation: at 768–1023 px show the list only and open the detail in a right-hand `Sheet`; at ≥ 1024 px show the terminal's two-pane split (list + detail) side by side.** This keeps the desktop layout at parity with the terminal and gives the tablet a real one-pane flow. If you want the Sheet at every width, say so and Phase 4 draws it identically at 1440.
2. **Plan at 768 px.** The terminal stacks the conversation over the draft below 100 columns. **Recommendation: stack them at 768–1023 px (conversation first, draft under it), side by side at ≥ 1024 px** — the same rule batch 1 (c3) uses for the Lobby's conversation and activity.
3. **Confirmations replace the terminal's arming.** The terminal arms destructive keys (`a` then `a`, `d d`, `x x`); the web can both arm-with-undo and confirm. **Recommendation: act immediately with an undo toast (`sonner`) where the action is reversible (archive, take back a note), and an `alert-dialog` where it is not (delete a task/plan/entry/session, stop a background session, discard a plan).** This is a `sheet`/`states` improvement, not a wording change.
4. **Excalidraw links.** D-12 and Q-03 require masking. **Recommendation: the link reads `https://excalidraw.com/#room=…` with the room id and key masked as `••••`; a `Reveal` button and a `Copy` button sit beside it, and `Open board` opens the room in a new tab** (`rel="noopener noreferrer"`). The terminal prints the link whole; this is the approved `mouse` deviation.
5. **Settings shape.** Pi's settings are a set of nested `SelectList` menus (`src/pi/settings-ui.ts`). **Recommendation: one Settings pane with a section rail at ≥ 1024 px and a section list at 768 px; every submenu is a `Sheet` pushed over the pane with the same title and the same item labels.** Agent model/thinking pickers show the registry's label + description exactly as `modelItems` does, including `custom…` and `inherit`.

---

## Conventions used below

Reused from batch 1, unchanged:

- Drawings are monospace, `1 char ≈ 8 px`; the 768 px box is ~78 chars wide, the 1440 px box ~110. `768×1024` = tablet portrait, `1440×900` = desktop.
- **Colour is named only by shadcn token:** `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`. Light/dark are token remappings only (`.dark`). Semantic marks keep a glyph as well as a colour (D-19): `☐ ☑ ☒`, `✓ ✗ ● !`, `⠋`, `‖`, `⟳`.
- Type: body 16 px / 1.5; labels and metadata 13 px / 1.4; headings 20 px / 1.2. Spacing on the 4/8 px scale. Radii from `--radius`. **Touch targets ≥ 40 px (D-19); rows and pills are 44 px.** No sideways page scroll at any width: tables, code, diffs and checklists scroll inside their own `scroll-area`.
- **`Deviation:` lines** name one approved D-14 improvement (`mouse`, `sheet`, `slideout`, `pills`, `md`, `states`, `alt-h`) or write `none` when the state matches the terminal exactly.
- **One shadcn inventory.** Base components available today: `badge`, `button`, `card`, `empty`, `kbd`, `questionnaire`, `scroll-area`, `separator`, `sheet`, `spinner`, `sonner`, `tabs`, `textarea`, `tooltip`. Phase 4 adds **`chart`** (Metrics, W-152) and **`alert-dialog`** (destructive confirmations; the Radix dialog is already pulled in by `sheet`). No other component is introduced.
- **State coverage.** P0-07.5 asks for empty, loading, error, busy, a long list and a long Markdown reply per screen. Each tab below ends with a **States** block naming each one and its exact wording; busy and long-list/long-Markdown are drawn in the main figure.

**Per-tab split breakpoints** (the terminal constant mapped to px):

| Tab | Terminal | 768–1023 px | ≥ 1024 px |
| --- | --- | --- | --- |
| Tasks | `TASKS_COLUMNS_MIN` 90 | list + `Sheet` detail | list (36%) + detail (64%) |
| Plan | `PLAN_COLUMNS_MIN` 100 | conversation over draft | conversation (46%) + draft (54%) |
| Quick fix | `QUICKFIX_COLUMNS_MIN` 90 | list + `Sheet` detail | list (36%) + detail (64%) |
| Git | `GIT_COLUMNS_MIN` 90 | list + `Sheet` detail | list (40%) + detail (60%) |
| Issues | `ISSUES_COLUMNS_MIN` 90 | list + `Sheet` detail | list (40%) + detail (60%) |
| Knowledge | `KNOWLEDGE_COLUMNS_MIN` 90 | files + `Sheet` entries | files (34%) + entries (66%) |
| Excalidraw | `EXCALIDRAW_COLUMNS_MIN` 90 | sessions + `Sheet` detail | sessions (34%) + detail (66%) |
| Metrics | width ≥ 100 | tiles, bars, meters, table stacked | bars beside meters; table full width |
| Sessions | picker ≥ 90 | list + preview `Sheet` | list (42%) + preview (58%) |

---

## (f) Tasks — list and detail

The whole tab: the checklist of every task and saved plan (`taskRows` sections `THIS SESSION`, `OTHER SESSIONS`, `PENDING`, `FINISHED`, `ARCHIVED`), the row's check mark and plan pips, then the selected row's detail — header, Request, Progress, Approved plan, Comments, Amendments, Waiting on, Recent runs, or the saved plan's Agreed plan and start/discard keys. List on the left, detail on the right (≥ 1024 px); at 768 px the list fills the pane and the detail opens in a `Sheet`.

**shadcn:** `card` (list pane, detail pane/sheet), `scroll-area` (list, detail), `separator` (section rules), `badge` (state, `⟳ auto`, comment counts, archive age), `button` (row actions, `Start here`/`Start in a new session`, `Discard`), `empty`, `spinner`, `tabs` (the `archived` filter toggle), `sheet` (detail at 768 px), `alert-dialog` (delete / delete for good / discard), `tooltip` (row key hints), `kbd`, `sonner` (undo).

### (f1) 768 × 1024 — list only; detail opens in a Sheet

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Tasks                                          3 open · 2 finished · 1 arch│  list pane
├────────────────────────────────────────────────────────────────────────────┤
│ THIS SESSION                                                             1 │
│ ▸ ☑ Give the lobby a search bar              ▰▰▰▰▰▱▱▱▱▱ 5/8                │
│     implementing · this session · ⟳ auto                                    │
│                                                                              │
│ OTHER SESSIONS                                                           1 │
│   ☐ Fix the release notes wording             ▰▱▱▱▱▱▱▱▱▱ 1/5                │
│     planning · background · session 3f9a12bc                                 │
│                                                                              │
│ PENDING                                                                  1 │
│   ☐ Split the metrics work (2/3)                                            │
│     planned · saved 2h ago · #42                                             │
│                                                                              │
│ FINISHED                                                                 2 │
│   ☑ Remove the legacy flag                    3h                            │
│   ☒ Old spike idea                            1d                            │
│                                                                              │
│ ARCHIVED                                                                 1 │
│   ☑ Retire the old route                      4d                            │
├────────────────────────────────────────────────────────────────────────────┤
│ [archived off]                                                            │  filter row
└────────────────────────────────────────────────────────────────────────────┘
   ▸ = selected row, 44 px · tapping a row opens the Detail Sheet (f2)
   the active row gets a 2 px --ring inset outline; check marks keep their glyph
```

**Detail at 768 px opens as a right `Sheet`** (≈ 90% width, `--popover`, a scrim `--foreground/30`; `Esc` closes and returns to the list with the row still selected):

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Detail                                                          [×]        │
├────────────────────────────────────────────────────────────────────────────┤
│ ☑ Give the lobby a search bar                                               │
│   implementing · this session · started 12m ago                             │
│   T-2026-03-04-1200 · fast track (2) · DEV, QA                              │
│   ⎇ feature-search · from main                                              │
│   ▰▰▰▰▰▱▱▱▱▱ 5 of 8 steps                                                    │
│                                                                              │
│   Request                                                                   │
│   Add a search bar to the lobby; every pane filters as you type.            │
│                                                                              │
│   Progress                                            5/8 steps              │
│   ☑ 1. scout the existing filters                                           │
│   ☑ 2. add the input                                                        │
│   ☑ 3. wire ctrl+f                                                          │
│   ☑ 4. highlight matches                                                    │
│   ☑ 5. counts in the pane header                                            │
│   ☐ 6. search the activity log                          ◂ now                │
│   ☐ 7. tests                                                                │
│   ☐ 8. QA gate                                                              │
│                                                                              │
│   Approved plan                                                             │
│   ## Search behaviour                                                       │
│   - the strip shows an input; **3 matches** in the header                   │
│                                                                              │
│   Comments                                             1 open               │
│   ○ Keep the input on the strip.  — waiting for the owning session, 8m ago  │
│                                                                              │
│     [Comment on the plan]  [Open its session]  [Auto]  [Archive]  [Delete]  │
└────────────────────────────────────────────────────────────────────────────┘
```

### (f2) 1440 × 900 — list and detail side by side

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Tasks                                   3 open · 2 finished · 1 archived │ Detail                           │
├──────────────────────────────────────────┬─────────────────────────────────────────────────────────────────┤
│ THIS SESSION                          1 │ ☑ Give the lobby a search bar                                                    │
│ ▸ ☑ Give the lobby a search bar          │   implementing · this session · started 12m ago                                  │
│     implementing · this session · ⟳ auto │   T-2026-03-04-1200 · fast track (2) · DEV, QA                                  │
│                                          │   ⎇ feature-search · from main                                                  │
│ OTHER SESSIONS                        1 │   ▰▰▰▰▰▱▱▱▱▱ 5 of 8 steps                                                        │
│   ☐ Fix the release notes wording        │                                                                                  │
│     planning · background · session 3f9a │   Request                                                                        │
│                                          │   Add a search bar to the lobby; every pane filters as you type.                 │
│ PENDING                               1 │                                                                                  │
│   ☐ Split the metrics work (2/3)         │   Progress                                       5/8 steps                       │
│     planned · saved 2h ago · #42         │   ☑ 1. scout the existing filters                                                │
│                                          │   ☑ 2. add the input                                                             │
│ FINISHED                              2 │   ☑ 3. wire ctrl+f                                                               │
│   ☑ Remove the legacy flag            3h │   ☑ 4. highlight matches                                                         │
│   ☒ Old spike idea                    1d │   ☑ 5. counts in the pane header                                                 │
│                                          │   ☐ 6. search the activity log                    ◂ now                          │
│ ARCHIVED                              1 │   ☐ 7. tests                                                                     │
│   ☑ Retire the old route              4d │   ☐ 8. QA gate                                                                   │
│                                          │                                                                                  │
│                                          │   Approved plan                                                                  │
│                                          │   ## Search behaviour                                                            │
│                                          │   - the strip shows an input; **3 matches** in the header                        │
│                                          │                                                                                  │
│                                          │   Comments                                       1 open                          │
│                                          │   ○ Keep the input on the strip. — waiting for the owning session, 8m ago         │
│                                          │                                                                                  │
│                                          │   Waiting on                                                                     │
│                                          │   ! approval for DESIGN: the pill layout                                          │
│                                          │                                                                                  │
│                                          │   Recent runs                                                                    │
│                                          │   DEV ✓ added search to tabs/home.ts · 40s                                       │
├──────────────────────────────────────────┴─────────────────────────────────────────────────────────────────┤
│ TYPE  enter send · esc browse                                          ⠋ DESIGN editing 2m · DEV running 40s  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

A saved plan's detail (both sizes) keeps the terminal's start/discard block:

```
│   ☐ Split the metrics work (2/3)                                             │
│     pending · saved 2h ago                                                    │
│     plan-2026-03-04-1200                                                      │
│     from issue #42 — Metrics are slow https://github.com/…/issues/42          │
│     part 2 of 3 of one plan that was split into tasks                         │
│       1. Split the read path · 2. Split the write path · 3. Split the UI      │
│                                                                              │
│     s start it in a new session   h start it here   d d discard it           │
│                                                                              │
│   Agreed plan                                                                │
│   - measure first; only split what the profile blames                        │
```

**TUI wording reused (verbatim):**

- Section titles `THIS SESSION`, `OTHER SESSIONS`, `PENDING`, `FINISHED`, `ARCHIVED`; box marks `☐ ☑ ☒`; marker `▸` — `tasks.ts` `SECTION_TITLES`, `CHECK_MARKS`, `listLines`.
- Row facts `implementing · this session · started 12m ago`, `planning · background · session 3f9a12bc`, `planned · saved 2h ago · #42`, `⟳ auto`, `awaiting approval`, `implementing · paused` — `tasks.ts` `detailsLine`, `stateWords`, `ownerLabel`.
- Progress `▰▰▰▰▰▱▱▱▱▱ 5/8` and `5 of 8 steps` — `tasks.ts` `pips`, `progressText`, `taskDetailLines`.
- Detail sections `Request`, `Progress` (right `5/8 steps`), `Approved plan`, `Proposal`, `Proposal (no plan yet)`, `Plan`, `Comments` (right `1 open`), `Amendments`, `Waiting on`, `Recent runs`; current step `◂ now` — `tasks.ts` `taskDetailLines`.
- Plan empty `No proposal or plan yet — the oracle is still clarifying or scouting.`; finished `It ended before a plan was made.`; comments empty `No comments yet — press c to comment on the plan; the oracle amends it.` / `No comments.`; comment words `waiting for the owning session`, `sent to the oracle`, `plan amended` — `tasks.ts`.
- Saved plan: `pending`, `saved 2h ago`, `from issue #42 — <title> <url>`, `part 2 of 3 of one plan that was split into tasks`, `s start it in a new session`, `h start it here`, `d d discard it`, `Agreed plan` — `tasks.ts` `planDetailLines` (with the real key labels from `lobby.keys`).
- Archived: `archived 4d ago`, `a restore it to the list`, `d d delete it for good` — `view.ts` `tasksBody`.
- Empty list `No tasks yet. Start one from the Lobby tab, or plan one in the Plan tab.` / `No task or plan mentions "<query>".` — `tasks.ts` `renderTasks`.
- Actions `Comment on the plan`, `Open its session`, `Auto`, `Archive`, `Delete`, `Start here`, `Start in a new session`, `Discard`, `New task`; hint chips `↑↓ select`, `c comment`, `o open its session`, `a archive`, `d d delete`, `s start in a new session`, `h start here`, `d discard`, `v archived`, `n new task` — `view.ts` `tabKeys("tasks")`, `hintChips()`.

**Deviations:**
- **Deviation:** the detail is a `Sheet` at 768 px and the terminal's two panes at ≥ 1024 px — **sheet**.
- **Deviation:** delete and delete-for-good ask with an `alert-dialog` (`Delete "Old spike idea" for good? This cannot be undone. [Cancel] [Delete]`); archive and restore offer an undo toast; discard asks — **sheet** + **states**.
- **Deviation:** the archived view is a filter toggle (`tabs`) with a count badge; the terminal binds `v` — **mouse** (the `v` shortcut stays).
- **Deviation:** Request, Approved plan and comments are real Markdown with code blocks and copy buttons — **md**.
- **Deviation:** every row, badge and button is clickable/tappable — **mouse**.
- **Deviation:** pips, section rules and wording are unchanged — **none**.

**States:** empty list (above; `empty` card with a `[Plan a task]` action); empty detail / search (`No task or plan mentions "<query>".`); loading (skeleton rows + `⠋ Connecting…` in the header, no TUI wording); error (`Could not load tasks. Retry`, page-only); busy (working rows show `⠋ editing…` in place of the state); long list (list scrolls in its `scroll-area`, sections keep their rule); long Markdown (Approved plan/Request scroll inside the detail, code blocks scroll sideways inside their box).

---

## (g) Plan — seats, rounds, draft, comments

The whole tab: the seating intro before a session (`Describe a task below and the panel questions you until the plan is clear.`), the roster (oracle chairing, DEV, DESIGN, QA, RESEARCH), the round counter and limit, the panel's conversation with attributed questions and answers, and the draft plan with line comments and `What each seat needs`. Side by side at ≥ 1024 px (conversation left, draft right); stacked at 768 px.

**shadcn:** `card` (conversation, draft), `scroll-area` (both panes), `separator`, `badge` (`round 3/5`, `sat out · 0.42`, `2 questions`), `button` (seat toggles with `aria-pressed`, `Answer`, `Save`, `Retry`, `Stop`, `New plan`), `empty`, `spinner`, `sheet` (line-comment input), `textarea` (the line comment), `tooltip`, `kbd`, `sonner`.

### (g1) 768 × 1024 — stacked, conversation over draft

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Planning · Give the lobby a search bar      ⠋ round 3/5                     │
│ panel  ORACLE ⠋ chairing · DEV ✓ ready · DESIGN ⠋ thinking · QA 2 questions │
│ · RESEARCH sat out · 0.42                                                   │
├────────────────────────────────────────────────────────────────────────────┤
│ Conversation                                              ↓12   Alt+←/→     │
│ Panel                                                    12:04              │
│  01. DEV      Should search be server- or client-side?                       │
│      ○ Client: instant, small diffs        — filters the loaded panes        │
│      ○ Server: correct across sessions     — a round trip per keystroke      │
│                                                                              │
│ You ●                                                     12:07             │
│   Client — the panes are already local.                                     │
│                                                                              │
│ Panel                                                     12:08             │
│   ✓ [DESIGN] Which empty state? → No matches for "x". · decided by the      │
│     classifier (0.91); comment on the plan to overrule                      │
├────────────────────────────────────────────────────────────────────────────┤
│ Draft plan                                              Plan ✓  3-7/12      │
│                                                                              │
│ ## Search behaviour                                                         │
│ - the strip shows an input; **3 matches** in the header                     │
│ ◆ - every match is highlighted in the pane body                             │
│     ↳ Keep italics for the empty state too.                                 │
│ - ctrl+f focuses the input                                                  │
│                                                                              │
│ What each seat needs                                                        │
│ QA      a test for filterFeed                                               │
│ DESIGN  the empty state reads "No matches for "x"."                          │
├────────────────────────────────────────────────────────────────────────────┤
│ BROWSE  a answer · Ctrl+S save · c comment on a line · x stop · 1-4 seats   │
└────────────────────────────────────────────────────────────────────────────┘
```

### (g2) 1440 × 900 — conversation beside draft

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Planning · Give the lobby a search bar    ⠋ round 3/5 · ◆ 1 comment to send                                 │
│ panel  ORACLE ⠋ chairing · DEV ✓ ready · DESIGN ⠋ thinking · QA 2 questions · RESEARCH sat out · 0.42        │
├───────────────────────────────────────────────────────────┬────────────────────────────────────────────────┤
│ Conversation                                  ↓12         │ Draft plan                             3-7/12  │
│ Panel                                            12:04     │                                                │
│  01. DEV      Should search be server- or client-side?     │ ## Search behaviour                            │
│      ○ Client: instant, small diffs  — filters the panes    │ - the strip shows an input; **3 matches**      │
│      ○ Server: correct across sessions — a round trip       │ ◆ - every match is highlighted in the body     │
│                                                             │     ↳ Keep italics for the empty state too.    │
│ You ●                                            12:07       │ - ctrl+f focuses the input                     │
│   Client — the panes are already local.                     │                                                │
│                                                             │ What each seat needs                           │
│ Panel                                            12:08       │ QA      a test for filterFeed                  │
│   ✓ [DESIGN] Which empty state? → No matches… · decided by  │ DESIGN  the empty state reads "No matches…"    │
│     the classifier (0.91); comment on the plan to overrule  │                                                │
├───────────────────────────────────────────────────────────┴────────────────────────────────────────────────┤
│ BROWSE  a answer · Ctrl+S save · c comment on a line · x stop · n new · 1-4 seats                          │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Before a session exists the pane shows the seating intro instead (both sizes, draft column empty):

```
│ Plan                                                                         │
│ Describe a task below and the panel questions you until the plan is clear    │
│ (at most 5 rounds; the last one the oracle settles alone).                    │
│                                                                              │
│ ORACLE     openai/gpt-5 · high                                                │
│ DEV        openai/gpt-5 · medium                                             │
│ DESIGN     not seated                                                         │
│ QA         not seated                                                         │
│ RESEARCH   not seated                                                         │
```

**Line comments** (the `◆` marker and `↳ note`) come from clicking/tapping a draft line. At 1440 px the input is a small `Sheet` at the bottom of the draft column titled `Comment on this line`; at 768 px it is the same bottom `Sheet` docked above the composer (reusing the questionnaire slideout chrome, but a plain `textarea`). Keys: `enter add the comment`, `esc cancel`.

**TUI wording reused (verbatim):**

- Intro `Describe a task below and the panel questions you until the plan is clear.` and `(at most <n> rounds; the last one the oracle settles alone)` — `plan.ts` `intro`.
- Status `round 3/5`, `final round 5/5`, `round 6 · past the limit, revising`, `✓ ready — Ctrl+S saves it`, `● 2 questions — enter answers them`, `◆ 1 comment to send`, `the next round is the last: the oracle settles the rest` — `plan.ts` `roundLabel`, `statusLine`.
- Roster `panel` and seat cells `ORACLE ⠋ chairing`, `DEV ✓ ready`, `DESIGN ⠋ thinking`, `QA 2 questions`, `RESEARCH sat out · 0.42`, `off`, `done`, `✗ failed — r retries` — `plan.ts` `rosterLines`, `seatCell`.
- Box titles `Conversation`, `Draft plan`, `Plan ✓`; right notes `3-7/12`, `↓12` — `plan.ts` `renderPlan`.
- Speaker marks `Panel`, `You ●`; question numbering `01.` and option marks `○` / `●` / `☑` / `☐`; seeded `from issue #42 — <title>`; classifier line `· [DESIGN] … → … · decided by the classifier (0.91); comment on the plan to overrule` — `plan.ts` `conversationLines`, `questionLines`; `home.ts` `speakerLine`.
- Draft empty `The draft appears after the panel's first round.` / `No draft yet.`; heading `What each seat needs`; line comment mark `◆` and `↳ <note>` — `plan.ts` `draftLines`.
- Empty conversation search `Nothing in the conversation matches "<query>".` — `plan.ts`.
- Hint chips `a answer`, `Ctrl+S save`, `c comment on a line`, `x stop`, `n new`, `1-4 seats`; keys `enter / ← →`, `↑ ↓`, `c / click`, `m` — `view.ts` `hintChips()`, `tabKeys("plan")`.
- Settings entry for the oracle's profile is `m` → Planner settings — `view.ts`.

**Deviations:**
- **Deviation:** seats are toggle `button`s with a visible `seated`/`not seated` state and `aria-pressed`, instead of `1-4`; the `1-4` shortcut stays — **mouse**.
- **Deviation:** a draft line is clicked/tapped to comment, and the comment is typed in a `Sheet` (`Comment on this line`) rather than the terminal's prompt — **mouse** + **sheet**.
- **Deviation:** the panel's questions open the batch-1 questionnaire slideout, with answered questions never asked again — **slideout**.
- **Deviation:** the draft and conversation render as real Markdown — **md**.
- **Deviation:** the draft's line position reads `3-7/12` as the terminal does; line paging on mouse click matches the terminal's click-a-line — **none**.
- **Deviation:** at 768 px the panes stack exactly as the terminal does below 100 columns; **none** otherwise.

**States:** empty/no session (seating intro above); busy (`⠋ round 3/5` in the status line, seat cells spin); awaiting answers (`● 2 questions — enter answers them`; the slideout opens; `lobby.autoAsk` opens it as the round ends while Plan is in view); error (`✗ <message> — r retries`); long conversation (scroll `scroll-area`, `↓12`); long draft (scroll `scroll-area`, `3-7/12`); saved (`saved as plan-…` or `saved as 2 tasks, from plan-…`).

---

## (h) Quick fix — jobs, live steps, report

The whole tab: the intro before the first fix (`Describe a small change below and one agent makes it now, beside any running task.`), then the job list newest first with a status mark and elapsed time, and the selected job's detail — facts, the request as Markdown, `Steps`, `Edited`, the error, and the `Report`. List left, detail right at ≥ 1024 px; at 768 px the list fills the pane and the detail opens in a `Sheet`.

**shadcn:** `card` (list, detail), `scroll-area` (both), `separator` (`Steps`, `Edited`, `Report`), `badge` (status, model), `button` (`Cancel`, `Run anyway`, `As a task`, `Model`), `empty`, `spinner` (running + pending step), `sheet` (detail at 768 px), `alert-dialog` (cancel), `tooltip`, `kbd`, `sonner`.

### (h1) 768 × 1024 — list only; detail in a Sheet

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Quick fixes                                                             2  │
├────────────────────────────────────────────────────────────────────────────┤
│ ⠋ Fix the broken icon on the strip                         40s             │
│ ✓ Bump the dev server port                                 12s             │
├────────────────────────────────────────────────────────────────────────────┤
│ BROWSE  ↑↓ select · x cancel · r run anyway · t as a task · m model         │
└────────────────────────────────────────────────────────────────────────────┘
   tapping a job opens the Detail Sheet (h2)
```

### (h2) 1440 × 900 — list and detail side by side

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Quick fixes                                    2 │ Detail                                                   │
├─────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┤
│ ⠋ Fix the broken icon on the strip        40s   │ qf-2026-03-04-1204-7                                                 │
│ ✓ Bump the dev server port                12s   │ running · 40s · openai/gpt-5 · medium · 2 tools · $0.02             │
│                                                 │                                                                     │
│                                                 │ ## The icon is broken on the tab strip                              │
│                                                 │ The selected pill shows a missing glyph when the label is long.     │
│                                                 │                                                                     │
│                                                 │ Steps                                                               │
│                                                 │ 12:04 ⠋ reading webui/src/components/ui/tabs.tsx…                   │
│                                                 │ 12:04 · found the fallback icon path                                │
│                                                 │ 12:05 ⠋ patching it…                                                │
│                                                 │                                                                     │
│                                                 │ Edited                                                              │
│                                                 │ · webui/src/components/ui/tabs.tsx                                  │
│                                                 │                                                                     │
│                                                 │ Report                                                              │
│                                                 │ The pill now falls back to the label text when no icon is set.      │
├─────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┤
│ TYPE  enter run it · esc browse                                                                              │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

A held job (classifier says "looks like a task") and a routed job keep the terminal's lines:

```
│ ‖ Held: this looks like a multi-step task. r runs it anyway · t starts it as a task in a new session.        │
│ ↓ routed the metrics tuning to a quick fix — the oracle said it was a one-file change                        │
```

**TUI wording reused (verbatim):**

- Intro `Describe a small change below and one agent makes it now, beside any running task.` and the `QUICK FIX` label with the profile — `quickfix.ts` `intro`.
- Box titles `Quick fixes` (right count / `2 matches`) and `Detail` (right elapsed/profile) — `quickfix.ts` `renderQuickFix`.
- Job facts `running · 40s · openai/gpt-5 · medium · 2 tools · $0.02`; status words `queued`, `running`, `success`, `failed`, `timeout`, `cancelled`, `held` — `quickfix.ts` `jobDetailLines`.
- Steps: `Waiting for the quick fix ahead of it.`, `⠋ starting…`, `No tool calls.`, `Not started.`; `Edited`; `Report`; error `✗ <error>` — `quickfix.ts`.
- Held `‖ Held: <note>. r runs it anyway · t starts it as a task in a new session.`; routed `↓ routed <route>` — `quickfix.ts`.
- Empty search `No quick fix mentions "<query>".` — `quickfix.ts` `renderQuickFix`.
- Hint chips `↑↓ select`, `x cancel`, `r run anyway`, `t as a task`, `m model`; keys `type`, `enter / ← →` — `view.ts` `hintChips()`, `tabKeys("quickfix")`.

**Deviations:**
- **Deviation:** the detail is a `Sheet` at 768 px, the terminal's two panes at ≥ 1024 px — **sheet**.
- **Deviation:** the report renders as real Markdown (and the request too, as the terminal does when its markdown palette is on) — **md**.
- **Deviation:** `Cancel` is a button; cancelling asks with an `alert-dialog` instead of arming `x`; `Run anyway` / `As a task` are buttons on a held job — **mouse** + **states**.
- **Deviation:** status marks keep `⠋ ✓ ✗ … ‖` glyphs and their colours — **none**.

**States:** empty (`Describe a small change…` intro); loading/queued (`Waiting for the quick fix ahead of it.`); running (`⠋ starting…`, pending step spins); held (`‖ Held: …`); failed/timeout (`✗ <error>`, with a `Retry` action); cancelled (`· cancelled`); long list (scrolls in its `scroll-area`); long report (Markdown scrolls in the detail).

---

## (i) Sessions

The session browser (`alt+o`): this window, the background sessions it started, other terminals' sessions and tasks nobody runs — grouped `THIS WINDOW`, `BACKGROUND`, `OTHER TERMINALS`, `NOT RUNNING` — each row with its where-mark, name, status and badges, and a preview of the picked one: who and where, its task and progress, `⟳ auto mode`, `● n questions waiting for you`, what `enter`/`s`/`x x` do, then the end of its conversation. List left, preview right at ≥ 1024 px; at 768 px the list fills the pane and the preview opens in a `Sheet`.

**shadcn:** `card` (list, preview), `scroll-area`, `separator`, `badge` (where-mark, `⟳`, `● n`, progress), `button` (`View`, `Move here`, `Stop`, `New session`), `empty`, `spinner` (starting), `sheet` (preview at 768 px), `alert-dialog` (stop), `tooltip`, `kbd`, `sonner`.

### (i1) 768 × 1024 — list only; preview in a Sheet

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Sessions                                                                4  │
├────────────────────────────────────────────────────────────────────────────┤
│ THIS WINDOW                                                              1 │
│ ▸ ● this window's session           working · ⟳                     ● 2     │
│                                                                              │
│ BACKGROUND                                                               1 │
│   ◆ Fix the release notes wording   working · ⟳                     ● 1     │
│                                                                              │
│ OTHER TERMINALS                                                          1 │
│   ◇ Spike: the new cache            implementing                              │
│                                                                              │
│ NOT RUNNING                                                              1 │
│   ○ Retire the old route            blocked                                   │
├────────────────────────────────────────────────────────────────────────────┤
│ BROWSE  ↑↓ browse · enter view · s switch here · x x stop · n new · esc close│
└────────────────────────────────────────────────────────────────────────────┘
```

### (i2) 1440 × 900 — list and preview side by side

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Sessions                                       4 │ Preview                                                  │
├─────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┤
│ THIS WINDOW                                  1  │ ● this window's session                                 │
│ ▸ ● this window's session   working · ⟳   ● 2   │   this window · working · started 18m ago               │
│                                                 │   T-2026-03-04-1200 · ▰▰▰▰▰▱▱▱▱▱ 5/8                     │
│ BACKGROUND                                   1  │   ⟳ auto mode · ● 2 questions waiting for you           │
│   ◆ Fix the release notes…  working · ⟳   ● 1   │   enter back to this window                             │
│                                                 │                                                         │
│ OTHER TERMINALS                              1  │   Conversation                                          │
│   ◇ Spike: the new cache    implementing        │   ◆ Oracle   I'll measure the cache hit rate first.     │
│                                                 │   You ●      Sounds good — keep the old path behind a   │
│ NOT RUNNING                                  1  │              flag.                                       │
│   ○ Retire the old route    blocked             │   ◆ Oracle   The flag works; here is the plan…          │
│                                                 │                                                         │
│                                                 │   [View]  [Move here]  [Stop]                           │
├─────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┤
│ BROWSE  ↑↓ browse · enter view · s switch here · x x stop · n new · esc close                                │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The "not running" preview's action line keeps the terminal's distinction between resuming and taking over:

```
│   enter view it   s resume it in this window               (a session id exists)                            │
│   enter view it   s take it over in this window            (no session ever owned it)                      │
```

**TUI wording reused (verbatim):**

- Sections `THIS WINDOW`, `BACKGROUND`, `OTHER TERMINALS`, `NOT RUNNING` and marks `● ◆ ◇ ○` — `view.ts` `SECTION_OF`, `WHERE_MARKS`.
- List `Sessions` right `${entries.length}`; status `working`, `starting`, `ended`, `idle`, `no task`, `<state>`; badges `⟳`, `● n` — `view.ts` `pickerBody`.
- Preview facts `<where> · <status> · pid <pid>`; task line `<id> · ▰… 5/8`; flags `⟳ auto mode`, `● 2 questions waiting for you`; the `does` lines `enter back to this window` / `enter view it   s move it into this window   x x stop it` / `enter view it and message it   switch in its own terminal` / `enter view it   s resume it in this window` — `view.ts` `sessionPreview`.
- `Conversation`; empty `Nothing said yet.` — `view.ts` `sessionPreview`.
- Hint chips `↑↓ browse`, `enter view`, `s switch here`, `x x stop`, `n new`, `esc close` — `view.ts` `hintChips()` (`picking`).
- Other-terminal note `This session runs in another terminal: its conversation shows here and your messages reach its oracle within seconds, but live activity only streams from sessions started in this window.` and not-running note `No session is running this task. Press esc, then s to resume it in this window; a message you send now waits until a session picks it up.` — `view.ts` `otherSessionBody`.

**Deviations:**
- **Deviation:** the preview is a `Sheet` at 768 px, the terminal's picker list + preview at ≥ 1024 px — **sheet**.
- **Deviation:** `View`, `Move here`, `Stop`, `New session` are buttons; `Stop` asks with an `alert-dialog` (`x x` becomes one confirmation) — **mouse** + **states**.
- **Deviation:** the conversation in the preview is real Markdown — **md**.
- **Deviation:** where-marks keep their glyphs so status never rests on colour — **none**.

**States:** empty (only `THIS WINDOW`); loading/starting (`starting <name>…`, `spinner`); busy (`working`, `⠋`); other-terminal (one-way note above); not-running (resume/take-over actions); error/exited (`<name> has ended.`); long list (scrolls); long conversation (scrolls, capped as the Lobby's `chatTail`).

---

## (j) Metrics — tiles, bars, cost table

The whole tab: the KPI tile row (`Runs`, `Success`, `Avg run`, `Cost`, `Tasks`), the optional `Classifier (Jev)` tile, `Average run time` bars, `Success rate` meters, `Where the time goes` (stacked share + request-to-done), and the full `All models` table with columns dropping from the right as the pane narrows. Charts at ≥ 1024 px sit bars-beside-meters; at 768 px every section is stacked. The table always fills the remaining height and scrolls in its box.

**shadcn:** `card` (tiles, chart cards, table card), `chart` (Phase 4: bar, meter, stacked share; SVG), `badge` (healthy/shaky/failing `✓ ! ✗`), `scroll-area` (the table), `separator`, `button` (`Group`, `Sort`, `Reload`), `empty`, `spinner` (`⠋ refreshing`), `tabs` (segmented `by model · thinking` / `by model · thinking · agent`, and the sort control), `tooltip`, `kbd`.

### (j1) 768 × 1024 — tiles, one chart per row, table

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Metrics                                              ⠋ refreshing            │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌ Runs ───────────┐ ┌ Success ────────┐ ┌ Avg run ────────┐                 │
│ │ 128             │ │ ✓ 91%           │ │ 1m 12s          │                 │
│ │ ▁▂▃▅▂▇▃▂▁▃▅      │ │ 11 failed · 2 st │ │ p90 2m 40s      │                 │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘                 │
│ ┌ Cost ───────────┐ ┌ Tasks ──────────┐                                     │
│ │ $4.20           │ │ 7 done          │                                     │
│ │ $0.03 per run   │ │ avg 18m · 2 act │                                     │
│ └─────────────────┘ └─────────────────┘                                     │
├────────────────────────────────────────────────────────────────────────────┤
│ Classifier (Jev)                                                            │
│ 128 calls · 99% ok · p50 240 ms · p90 900 ms · 41k tokens read · triage 60  │
│ spared 6 seat runs skipped · 9 questions answered · 3 quick fixes held · …  │
├────────────────────────────────────────────────────────────────────────────┤
│ Average run time                                    per model · thinking    │
│ openai/gpt-5 · high      ▰▰▰▰▰▰▰▰▰▰▰▰ 1m 48s p90 3m 10s                     │
│ openai/gpt-5 · medium    ▰▰▰▰▰▰▰▰ 1m 12s p90 2m 40s                         │
│ anthropic/claude · high  ▰▰▰▰▰ 42s p90 1m 20s                               │
├────────────────────────────────────────────────────────────────────────────┤
│ Success rate                                    ✓ ≥90% · ! ≥70% · ✗ below   │
│ openai/gpt-5 · medium    ▰▰▰▰▰▰▰▰▰▰ ✓ 94%  37                              │
│ anthropic/claude · high  ▰▰▰▰▰▰▰▱▱▱ ! 78%  18                              │
├────────────────────────────────────────────────────────────────────────────┤
│ Where the time goes                             share of run time by agent  │
│ ■ MASTER 42%  ■ DEV 31%  ■ DESIGN 18%  ■ QA 9%                              │
│ Request to done, by the oracle's model                                      │
│ openai/gpt-5 · high      ▰▰▰▰▰▰▰▰▰▰ 18m ×5                                  │
├────────────────────────────────────────────────────────────────────────────┤
│ All models        by model · thinking · sorted by avg · g s                 │
│ Model              Think  Agents  Runs   OK    Avg     p50     $/run        │
│ openai/gpt-5       high   DEV    37     94%   1m48s   1m30s   $0.05         │
│ openai/gpt-5       medium DEV    54     96%   1m12s   58s     $0.03         │
│ anthropic/claude   high   QA     18     78%   42s     38s     $0.02         │
├────────────────────────────────────────────────────────────────────────────┤
│ BROWSE  ↑↓ select · g group · s sort · r reread                              │
└────────────────────────────────────────────────────────────────────────────┘
```

### (j2) 1440 × 900 — bars beside meters, table full width

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Metrics                                                                                      ⠋ refreshing    │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ Runs ─────────┐ ┌ Success ──────┐ ┌ Avg run ─────┐ ┌ Cost ────────┐ ┌ Tasks ───────┐                    │
│ │ 128           │ │ ✓ 91%         │ │ 1m 12s        │ │ $4.20        │ │ 7 done        │                    │
│ │ ▁▂▃▅▂▇▃▂▁▃▅   │ │ 11 failed · 2 │ │ p90 2m 40s    │ │ $0.03/run    │ │ avg 18m · 2   │                    │
│ └───────────────┘ └───────────────┘ └───────────────┘ └──────────────┘ └───────────────┘                    │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Classifier (Jev)                                                                                            │
│ 128 calls · 99% ok · p50 240 ms · p90 900 ms · 41k tokens read · triage 60 · seats 40 · answers 28          │
│ spared 6 seat runs skipped · 9 questions answered · 3 quick fixes held · 5 runs routed down, 80% ok         │
├───────────────────────────────────────────────────────┬────────────────────────────────────────────────────┤
│ Average run time                  per model · thinking │ Success rate                ✓ ≥90% · ! ≥70% · ✗ below│
│ openai/gpt-5 · high     ▰▰▰▰▰▰▰▰ 1m48s p90 3m10s       │ openai/gpt-5 · medium  ▰▰▰▰▰▰▰▰▰▰ ✓ 94%  37          │
│ openai/gpt-5 · medium   ▰▰▰▰▰▰ 1m12s p90 2m40s         │ anthropic/claude · high ▰▰▰▰▰▰▰▱▱▱ ! 78%  18          │
│ anthropic/claude · high ▰▰▰▰ 42s p90 1m20s              │ openai/gpt-5 · high     ▰▰▰▰▰▰▰▰▰▱ ✓ 90%  37          │
├───────────────────────────────────────────────────────┴────────────────────────────────────────────────────┤
│ Where the time goes                                                 share of run time by agent              │
│ ■ MASTER 42%   ■ DEV 31%   ■ DESIGN 18%   ■ QA 9%                                                           │
│ Request to done, by the oracle's model                                                                      │
│ openai/gpt-5 · high     ▰▰▰▰▰▰▰▰▰▰ 18m ×5                                                                   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ All models                              by model · thinking · sorted by avg · g s                          │
│ Model                    Think   Agents  Runs   OK    Avg     p50     p90     Turns  Tools  Tokens  $/run  │
│ openai/gpt-5             high    DEV     37     94%   1m48s   1m30s   3m10s   8.2    12     41k     $0.05  │
│ openai/gpt-5             medium  DEV     54     96%   1m12s   58s     2m40s   6.1    9      28k     $0.03  │
│ anthropic/claude         high    QA      18     78%   42s     38s     1m20s   4.0    6      19k     $0.02  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**TUI wording reused (verbatim):**

- Tile labels `Runs`, `Success`, `Avg run`, `Cost`, `Tasks`; context `no runs yet`, `11 failed · 2 stalled`, `p90 3m 10s`, `$0.03 per run`, `7 done`, `avg 18m · 2 active` — `metrics.ts` `tileRow`.
- Threshold legend `✓ ≥90% · ! ≥70% · ✗ below`; states `healthy`, `shaky`, `failing` — `metrics.ts` `status`.
- Box titles and right notes `Average run time` / `per model · thinking`; `Success rate`; `Where the time goes` / `share of run time by agent`; `All models` / `by model · thinking` or `by model · thinking · agent`, `sorted by <sort>`, `g s` — `metrics.ts`.
- `Request to done, by the oracle's model`; `No timed runs yet.`; `No runs yet.` — `metrics.ts` `timeShare`, `timeBars`, `successMeters`.
- Table headers `Model`, `Think`, `Agent`/`Agents`, `Runs`, `OK`, `Avg`, `p50`, `p90`, `Turns`, `Tools`, `Tokens`, `tok/s`, `$/run`, `$ total`, `Stalls`; kinds `master`, `scout`, `worker`, `QA gate`, `research`, `quick fix`, `oracle (plan)`, `panel` — `metrics.ts` `COLUMNS`, `KIND_LABELS`.
- Classifier `Classifier (Jev)`, `spared`, expressions `128 calls`, `99% ok`, `p50 240 ms`, `6 seat runs skipped`, `9 questions answered`, `3 quick fixes held`, `5 runs routed down, 80% ok`, `no calls recorded` — `metrics.ts` `classifierLines`.
- Empty `No runs recorded yet. Every Master turn, subagent run, quick fix and planning round lands here with its model, thinking level, time, tokens and cost.`; search `No run matches "<query>".` — `metrics.ts` `renderMetrics`.
- Hint chips `↑↓ select`, `g group`, `s sort`, `r reread`; keys `g`, `s` — `view.ts` `hintChips()`, `tabKeys("metrics")`.

**Deviations:**
- **Deviation:** the bars, meters and the stacked share are real SVG charts (`chart`), drawn as the terminal's bars are but with hover values and accessible labels — **md** (W-152).
- **Deviation:** the full table is a real `<table>` with sortable headers; it scrolls horizontally inside its own box on the narrowest pane (as the terminal drops columns) — **mouse** (the `g`/`s` shortcuts stay).
- **Deviation:** tile cards replace the terminal's four-line boxes; labels and values are unchanged — **none**.
- **Deviation:** explicit empty/loading states — **states**.

**States:** empty (`No runs recorded yet. Every Master turn…`); search empty (`No run matches "<query>".`); loading/first paint (skeleton tiles + `⠋ Connecting…`); refreshing (`⠋ refreshing`); error (`Could not load metrics. Retry`); long table (scrolls in its `scroll-area`); long chart labels (truncated with a tooltip, as `fit`/`chartLabelWidth` truncate).

---

## (k) Git — pull requests, detail, review

The whole tab: the open pull-request list (checks mark, `draft`, title, review outcome, `+12 −3`), the selected pull's detail (facts, branch and size, checks and decision, URL, `v reviews it with an agent · f with a focus you type · t is Jev's quick read`, `Jev's read`, the `Review`, `Files`, `Description`, then each `comment`), and — the point of the tab — the agent review with its verdict, steps, findings and stale mark. List left, detail right at ≥ 1024 px; at 768 px the list fills the pane and the detail opens in a `Sheet`.

**shadcn:** `card` (list, detail), `scroll-area` (both), `separator` (`Review`, `Jev's read`, `Files`, `Description`, comment authors), `badge` (`open`/`draft`, `approved`/`changes requested`/`review required`, `mergeable`/`conflicts`, labels), `button` (`Review`, `Review with focus`, `Jev's read`, `Stop`, `Reload`), `spinner` (loading + running review), `sheet` (detail at 768 px), `alert-dialog` (stop review), `textarea` (the focus), `tooltip`, `kbd`, `sonner`.

### (k1) 768 × 1024 — list only; detail in a Sheet

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Pull requests                                          5 open               │
├────────────────────────────────────────────────────────────────────────────┤
│ #123 ✓ Add the search bar              ✓ reviewed        +48 −12             │
│ #119 ● Bump the charts library         reviewing         +2 −2               │
│ #118 ✗ Fix the flaky test                             +9 −4                 │
│ #117   draft: retry the previews                       +30 −8                │
│ #116 ✓ Split the metrics tab                           +120 −40              │
├────────────────────────────────────────────────────────────────────────────┤
│ BROWSE  ↑↓ select · v review · f review with a focus · t Jev's read · r reload│
└────────────────────────────────────────────────────────────────────────────┘
```

### (k2) 1440 × 900 — list and detail side by side, with the review

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Pull requests                                  5 │ Pull request                                             │
├─────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┤
│ #123 ✓ Add the search bar    ✓ reviewed +48−12  │ #123 Add the search bar                                                 │
│ #119 ● Bump the charts lib   reviewing   +2−2   │ open · by ada · updated 3h ago                                          │
│ #118 ✗ Fix the flaky test               +9−4    │ ⎇ feature-search → main · +48 −12 · 6 files                             │
│ #117   draft: retry previews            +30−8   │ checks passing (11) · approved · mergeable                              │
│ #116 ✓ Split the metrics tab            +120−40 │ https://github.com/…/pull/123                                          │
│                                                 │                                                                         │
│                                                 │ v reviews it with an agent · f with a focus you type · t is Jev's quick  │
│                                                 │ read                                                                    │
│                                                 │                                                                         │
│                                                 │ Jev's read                                  openai/gpt-5 · 610 ms        │
│                                                 │ Changed 6 files (+48 −12). Low risk. No security-relevant paths. No     │
│                                                 │ breaking changes found. One new branch is untested.                     │
│                                                 │                                                                         │
│                                                 │ Review                                        approve · 2m 05s         │
│                                                 │ openai/gpt-5 · high                                                      │
│                                                 │ ## Findings                                                              │
│                                                 │ - **High** the header count renders before the filter settles.           │
│                                                 │ - **Low** two helpers could share the match loop.                        │
│                                                 │ ## Tests                                                                 │
│                                                 │ No test covers filterFeed yet.                                          │
│                                                 │                                                                         │
│                                                 │ Files                                                                   │
│                                                 │ webui/src/tabs/lobby/search.tsx                 +20 −3                  │
│                                                 │ webui/src/store.ts                              +18 −6                  │
│                                                 │                                                                         │
│                                                 │ Description                                                             │
│                                                 │ Adds a search input to the strip; see the screenshots.                  │
│                                                 │                                                                         │
│                                                 │ ada · approved · 2h ago                                                 │
│                                                 │ Nice. Ship it once the count bug is fixed.                              │
├─────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┤
│ BROWSE  ↑↓ select · v review · f review with a focus · t Jev's read · r reload                              │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

A running review and a stale one keep the terminal's lines:

```
│ Review                                        ⠋ 40s                                                       │
│ openai/gpt-5 · high                                                                                         │
│ · reading the diff…                                                                                          │
│ x stops it                                                                                                   │
│                                                                                                              │
│ Review                                        approve · 2m 05s                                              │
│ the pull request has new commits since this review — v reviews it again                                      │
```

**TUI wording reused (verbatim):**

- Box titles `Pull requests` (right `5 open` / `⠋ refreshing`) and `Pull request` — `git.ts` `renderGit`.
- List row `#123`, checks marks `✓ ✗ ●`, `draft`, outcome `✓ reviewed` / `✗ reviewed` / `◆ reviewed` / `reviewing`, size `+48 −12` — `git.ts` `row`, `checkMark`, `changeSize`.
- Detail facts `open`, `draft`, `by ada`, `updated 3h ago`, `checks passing (11)`, `approved` / `changes requested` / `review required`, `mergeable` / `conflicts`, labels; branch line `⎇ feature-search → main · +48 −12 · 6 files`; URL — `git.ts` `pullDetailLines`, `decisionWords`.
- Actions line `v reviews it with an agent · f with a focus you type · t is Jev's quick read` — `git.ts`.
- `Jev's read` (right `<model> · <ms> ms`, `⠋`, `reading the diff…`, `Jev could not read it`) — `git.ts` `readLines`.
- `Review` (right verdict/time, `⠋ 40s`, `approve`, `request changes`, `comment`, `stopped`, `✗ <error>`), `kept from 5m ago`, `the pull request has new commits since this review — v reviews it again`, `x stops it` — `git.ts` `reviewLines`.
- `Files`, `Description`, `(no description)`, comment author rules and verdicts `approved` / `changes requested` / `commented` — `git.ts` `pullDetailLines`.
- Empty `Press r to load open pull requests with the GitHub CLI (gh).`, `No open pull requests.`, `⠋ loading pull requests from GitHub…` — `git.ts` `empty`.
- Hint chips `↑↓ select`, `v review`, `f review with a focus`, `t Jev's read`, `x stop`, `r reload`; `v` help `review it with a read-only agent on QA's model (nothing is posted to GitHub)` — `view.ts` `hintChips()`, `tabKeys("git")`.

**Deviations:**
- **Deviation:** the detail is a `Sheet` at 768 px, the terminal's two panes at ≥ 1024 px — **sheet**.
- **Deviation:** `Review`, `Review with focus`, `Jev's read` and `Stop` are buttons; the focus is a `textarea` `Sheet` and stopping asks in an `alert-dialog` — **mouse** + **sheet**.
- **Deviation:** the description, review, comments and `Jev's read` render as real Markdown, with links opened in a new tab — **md** (W-150).
- **Deviation:** the list is refreshable and every row is clickable; `r` stays the shortcut — **mouse**.
- **Deviation:** nothing is posted to GitHub, and the detail says so exactly as the terminal does — **none**.

**States:** not loaded (`Press r to load…`); loading (`⠋ loading pull requests from GitHub…`); empty (`No open pull requests.`); error (`✗ <error>` banner with a `Retry` action, and the list keeps its last data); review running (`⠋ 40s` + steps); review failed/timeout (`✗ <error>`); stale (`…new commits…`); long list (scrolls); long description/review (Markdown scrolls in the `Sheet`).

---

## (l) Knowledge — files, entries, edit, notes

The whole tab: the files-per-agent list (`Master (oracle)`, `Designer`, `Backend`, `QA`) with size, `· over` and `✎ n` notes, and the open file as entries, each drawn once with its notes under it and a `▸` marker on the picked entry; `Notes on entries that changed` at the end. Files left, entries right at ≥ 1024 px; at 768 px the files fill the pane and the entries open in a `Sheet`. Editing an entry (or the whole file) is a full-pane editor in the web (P4-06).

**shadcn:** `card` (file list, entry pane, editor), `scroll-area` (all three), `separator` (agent rules, `Notes on entries that changed`), `badge` (`✎ n`, `over`, entry count), `button` (`Edit`, `Add`, `Comment`, `Delete`, `Edit file`, `Save`, `Cancel`), `sheet` (entries at 768 px; the whole-file editor at both sizes), `textarea` (entry editor and note), `empty`, `spinner`, `alert-dialog` (delete entry), `tooltip`, `kbd`, `sonner` (archive notice, `409` conflict).

### (l1) 768 × 1024 — files only; entries in a Sheet

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Knowledge                                                            ✎ 6  │
├────────────────────────────────────────────────────────────────────────────┤
│ Master (oracle)                                                       ✎ 2  │
│   CLAUDE.md                                              1.2k · over         │
│   standards.md                                           812             ✎ 1  │
│                                                                              │
│ Designer                                                              ✎ 1  │
│   CLAUDE.md                                              640             ✎ 1  │
│                                                                              │
│ Backend                                                                      │
│   CLAUDE.md                                              904                 │
│                                                                              │
│ QA                                                                    ✎ 3  │
│   decisions.md                                           24k · over           │
├────────────────────────────────────────────────────────────────────────────┤
│ BROWSE  ↑↓ pick · enter entries · e edit · c comment · n new · E edit file  │
└────────────────────────────────────────────────────────────────────────────┘
```

### (l2) 1440 × 900 — files and entries side by side, notes under entries

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Knowledge                                      ✎ 6 │ Master · CLAUDE.md       3 entries · 1.2k chars        │
├───────────────────────────────────────────────────┬────────────────────────────────────────────────────────┤
│ Master (oracle)                             ✎ 2   │ over the compaction threshold — ask the oracle to       │
│   CLAUDE.md                    1.2k · over        │ compact CLAUDE.md                                      │
│   standards.md                 812           ✎ 1  │                                                        │
│                                                   │ ▸ The lobby keeps one main pane; details open in a      │
│ Designer                                    ✎ 1   │   Sheet.                                                │
│   CLAUDE.md                    640           ✎ 1  │   ✎ about "one main pane": keep the Lobby panes side   │
│                                                   │     by side at ≥ 100 columns.                           │
│ Backend                                            │                                                        │
│   CLAUDE.md                    904                │   Every write archives the version before it.           │
│                                                   │                                                        │
│ QA                                          ✎ 3   │   Prefer the existing component over a new one.         │
│   decisions.md                 24k · over          │                                                        │
│                                                   │                                                        │
│                                                   │ Notes on entries that changed                    ✎ 1    │
│                                                   │   ✎ about "the old pill strip": superseded.             │
│                                                   │                                                        │
│                                                   │ [Edit]  [Add after]  [Comment]  [Delete]  [Edit file]   │
├───────────────────────────────────────────────────┴────────────────────────────────────────────────────────┤
│ BROWSE  ↑↓ pick · enter entries · e edit · c comment · n new · d d delete · E edit file                    │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The editor (both sizes) is a full-pane route titled with the file, with the terminal's key hints:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Master · CLAUDE.md — edit                                 [Cancel] [Save]   │
├────────────────────────────────────────────────────────────────────────────┤
│ ▸ The lobby keeps one main pane; details open in a Sheet.▏                  │
│   Every write archives the version before it.                                │
├────────────────────────────────────────────────────────────────────────────┤
│ enter save · shift+enter new line · esc cancel                              │
└────────────────────────────────────────────────────────────────────────────┘
```

**TUI wording reused (verbatim):**

- Box titles `Knowledge` (right `✎ <total>`), file rows grouped under `Master (oracle)`, `Designer`, `Backend`, `QA`; sizes `812`, `1.2k`, `24k`, over mark `· over`, notes `✎ n` — `knowledge.ts` `listLines`, `fileRow`, `sizeWords`; `AGENT_LABELS`.
- Detail title `${AGENT_DIR_NAMES[agent]} · ${file}` (right `3 entries · 1.2k chars`); over warning `over the compaction threshold — ask the oracle to compact <file>`; empty `Nothing here yet. n adds the first entry.` / `reading…` — `knowledge.ts` `renderKnowledge`.
- Entry marker `▸`; note lead `✎ `; detached heading `Notes on entries that changed`; detached note `about "<entry>": <text>` — `knowledge.ts` `entryLines`, `noteLines`.
- Keys `e edit the picked entry: it comes into the prompt (Shift+Enter for a new line, enter saves)`, `c comment on it: a note every agent reads under that entry`, `n add an entry after the picked one`, `d d delete the picked entry, and its notes`, `x x take back the newest note on the picked entry`, `E edit the whole file in pi's editor`, `r reread the files from disk`; chips `enter save`, `shift+enter new line`, `esc cancel` — `view.ts` `tabKeys("knowledge")`, `hintChips()`.
- Empty file list `No knowledge files yet.` — `knowledge.ts`.

**Deviations:**
- **Deviation:** the entries open in a `Sheet` at 768 px, side by side at ≥ 1024 px; the editor is a full-pane route (P4-06's "full-screen editor") — **sheet**.
- **Deviation:** entry text and notes render as Markdown; `E` opens a real `textarea` editor with a save/cancel bar, and every write shows the archive notice `Every write archives the version before it.` — **md** + **states**.
- **Deviation:** a stale write is refused as the terminal refuses it, but the page shows a `409` conflict with `Reload` / `Overwrite` and the terminal's refusal message — **states**.
- **Deviation:** `Edit`, `Add`, `Comment`, `Delete` are buttons; delete asks in an `alert-dialog`; the newest note is taken back with an undo toast — **mouse** + **states**.
- **Deviation:** file sizes, `over` marks and note counts are unchanged — **none**.

**States:** empty file list (`No knowledge files yet.`); empty file (`Nothing here yet. n adds the first entry.`); loading (`reading…` + `spinner`); over threshold (warning above the entries); conflicted write (`409`; reload/overwrite); long file (entries scroll, the picked entry kept in view as `entryLines` does); long notes (wrap under their entry); detached notes (`Notes on entries that changed`).

---

## (m) Excalidraw — sessions, links, agent checklist, reveal

The whole tab: the shared sessions (`2/5`) with a check mark (`⠋ ✓ !`), name and `1 agent`/`no agents`, and the picked session's link (masked), its `agents may draw here (w: look only)` state, the last check, and the `Assigned to` checklist over every agent (`Master (oracle)`, `Designer`, `Backend`, `QA`, `Scouts`, `Researcher`, `Quick fix`, `Planner`), then the note about `excalidraw_read`/`excalidraw_draw`. Sessions left, detail right at ≥ 1024 px; at 768 px the sessions fill the pane and the detail opens in a `Sheet`.

**shadcn:** `card` (list, detail), `scroll-area`, `separator` (`Assigned to`), `badge` (`n agents`, check result), `button` (`Add a link`, `New room`, `Reveal`, `Copy`, `Open board`, `Check`, `Look only`/`Let agents draw`, `Rename`, `Remove`), `checkbox` (each agent; Radix `checkbox` is already a dependency of `questionnaire`), `sheet` (detail at 768 px; add-link/rename form), `textarea` (the link), `empty`, `spinner` (`⠋ checking the room…`), `alert-dialog` (remove), `tooltip`, `kbd`, `sonner` (copied).

### (m1) 768 × 1024 — sessions only; detail in a Sheet

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Sessions                                                               2/5 │
├────────────────────────────────────────────────────────────────────────────┤
│ ✓ Architecture sketch                        1 agent                       │
│ ⠋ Rollout whiteboard                         no agents                     │
├────────────────────────────────────────────────────────────────────────────┤
│   a add a link · n new room                                                │
├────────────────────────────────────────────────────────────────────────────┤
│ BROWSE  a add a link · n new room · enter agents · t check · w look only   │
└────────────────────────────────────────────────────────────────────────────┘
```

### (m2) 1440 × 900 — sessions and detail side by side

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Sessions                                     2/5 │ Architecture sketch                                     │
├───────────────────────────────────────────────────┬────────────────────────────────────────────────────────┤
│ ✓ Architecture sketch             1 agent         │ https://excalidraw.com/#room=•••••••••••••••••••••••••  │
│ ⠋ Rollout whiteboard              no agents       │ agents may draw here (w: look only)                     │
│                                                   │ ✓ reached 4 people, 12 elements, 1 key fitted           │
│                                                   │                                                        │
│                                                   │ Assigned to                                     1 agent│
│                                                   │ ▸ [x] Master (oracle)                                  │
│                                                   │   [ ] Designer                                         │
│                                                   │   [ ] Backend                                          │
│                                                   │   [ ] QA                                               │
│                                                   │   [ ] Scouts                                           │
│                                                   │   [ ] Researcher                                       │
│                                                   │   [ ] Quick fix                                        │
│                                                   │   [ ] Planner                                          │
│                                                   │                                                        │
│                                                   │ Assigned agents read the board and draw on it with      │
│                                                   │ excalidraw_read and excalidraw_draw, and appear in the  │
│                                                   │ room under their own name.                              │
│                                                   │                                                        │
│                                                   │ [Reveal] [Copy] [Open board]  [Check]  [Look only]  [×] │
├───────────────────────────────────────────────────┴────────────────────────────────────────────────────────┤
│ BROWSE  a add a link · n new room · ↑↓ agent · enter assign · t check · w look only · d d remove            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The empty tab (both sizes) keeps the terminal's three paragraphs:

```
│ No sessions yet. A session is a live Excalidraw room that you and your agents draw in together.              │
│                                                                                                              │
│ a  add one: in Excalidraw, Share → Live collaboration → Start session, then paste the link                   │
│ n  or make a new room here and open its link in Excalidraw                                                   │
│                                                                                                              │
│ Up to 5 sessions; each can be assigned to one agent or several.                                              │
```

**TUI wording reused (verbatim):**

- Box titles `Sessions` (right `2/5`) and the session name; check marks `⠋ ✓ !`; facts `1 agent` / `no agents` — `excalidraw.ts` `renderExcalidraw`, `sessionRows`, `agentCount`.
- `agents may draw here (w: look only)` / `agents may only look (w: let them draw)`; `⠋ checking the room…`; `✓ <text>` / `! <text>`; `t checks that the room can be reached` — `excalidraw.ts` `detailLines`.
- `Assigned to` (right agent count); boxes `[x]` / `[ ]`; labels `Master (oracle)`, `Designer`, `Backend`, `QA`, `Scouts`, `Researcher`, `Quick fix`, `Planner` — `excalidraw.ts`; `sessions.ts` `AGENT_LABELS`.
- `Assigned agents read the board and draw on it with excalidraw_read and excalidraw_draw, and appear in the room under their own name.` — `excalidraw.ts`.
- Empty `No sessions yet. A session is a live Excalidraw room that you and your agents draw in together.`, `a  add one: in Excalidraw, Share → Live collaboration → Start session, then paste the link`, `n  or make a new room here and open its link in Excalidraw`, `Up to 5 sessions; each can be assigned to one agent or several.` — `excalidraw.ts` `emptyLines`.
- Hint chips `a add a link`, `n new room`, `↑↓ session`/`agent`, `enter agents`/`assign`, `t check`, `w look only`/`let agents draw`, `d d remove` — `view.ts` `hintChips()`; help `enter or space assigns the picked agent`, `* assign the session to every agent, or (when they all have it) to none`, `rename the session`, `remove the session (agents lose it at once)` — `view.ts` `tabKeys("excalidraw")`.

**Deviations:**
- **Deviation:** the detail is a `Sheet` at 768 px, side by side at ≥ 1024 px — **sheet**.
- **Deviation:** the room link is masked (D-12) with `Reveal`, `Copy` and `Open board` buttons; the terminal prints it whole — **mouse** (approved by Q-03; security requirement D-12).
- **Deviation:** the agent checklist is a real `checkbox` list; `*` selects/deselects all, as the terminal's `*` does — **mouse**.
- **Deviation:** `Add a link` and `Rename` use a `Sheet` with a `textarea` and `enter add it` / `esc cancel`; `Remove` asks in an `alert-dialog` — **sheet**.
- **Deviation:** `No sessions yet.` and the check text are unchanged; glyphs `⠋ ✓ !` keep status off colour alone — **none**.

**States:** empty (above); checking (`⠋ checking the room…`); check failed (`! <reason>`); unreachable (the check's reason, as `connectFailure` gives it); five sessions (`all 5 sessions are in use — remove one first (d d)`, with `Remove`); add/rename typing (`enter add it` / `enter save`, `esc cancel`); long list (scrolls); copied (`Copied to the clipboard` toast).

---

## (n) Issues — when `lobby.issues` is on

The whole tab: the open GitHub issues (number, title, first two labels), the selected issue's detail (`#12 title`, state, author, `updated 3h ago`, labels, URL, `p plans it with the planning panel, then save it as a task`, body, comments), and a success/warning banner above. List left, detail right at ≥ 1024 px; at 768 px the list fills the pane and the detail opens in a `Sheet`. The pill only appears when `lobby.issues` is on; Issues is `Alt+5` and Excalidraw stays `Alt+9` (`visibleTabs`).

**shadcn:** `card` (list, detail), `scroll-area` (both), `separator` (comment rules), `badge` (state, labels), `button` (`Plan it`, `New issue`, `Reload`), `sheet` (detail at 768 px; the new-issue form), `textarea` (issue body), `input` (title), `empty`, `spinner`, `tooltip`, `kbd`, `sonner`.

### (n1) 768 × 1024 — list only; detail in a Sheet

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Issues                                                                5 open│
├────────────────────────────────────────────────────────────────────────────┤
│ #42 Metrics are slow [perf, p1]                                              │
│ #39 Search loses focus [bug]                                                 │
│ #35 Add a dark theme [design]                                                │
│ #30 Retry the previews [bug, p2]                                             │
│ #27 Docs: the web UI [docs]                                                  │
├────────────────────────────────────────────────────────────────────────────┤
│ BROWSE  ↑↓ select · p plan it · n new · r reload                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### (n2) 1440 × 900 — list and detail side by side

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Issues                                         5 open │ Issue                                             │
├───────────────────────────────────────────────────────┬────────────────────────────────────────────────────┤
│ #42 Metrics are slow [perf, p1]                       │ #42 Metrics are slow                              │
│ #39 Search loses focus [bug]                          │ open · by ada · updated 3h ago · perf, p1          │
│ #35 Add a dark theme [design]                         │ https://github.com/…/issues/42                    │
│ #30 Retry the previews [bug, p2]                      │                                                    │
│ #27 Docs: the web UI [docs]                           │ p plans it with the planning panel, then save it   │
│                                                       │ as a task                                          │
│                                                       │                                                    │
│                                                       │ The Metrics tab re-filters 5,000 records on every  │
│                                                       │ keystroke. Profile it and cache the groups.        │
│                                                       │                                                    │
│                                                       │ ada · 2d ago                                       │
│                                                       │ Reproduced on a slow laptop.                        │
│                                                       │                                                    │
│                                                       │ [Plan it]  [New issue]                             │
├───────────────────────────────────────────────────────┴────────────────────────────────────────────────────┤
│ BROWSE  ↑↓ select · p plan it · n new · r reload                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**TUI wording reused (verbatim):**

- Box titles `Issues` (right `5 open` / `⠋ refreshing`) and `Issue`; rows `#42 Metrics are slow [perf, p1]` — `issues.ts` `renderIssues`.
- Detail facts `open`, `by ada`, `updated 3h ago`, labels; URL; `p plans it with the planning panel, then save it as a task`; body and comment author rules — `issues.ts` `issueDetailLines`.
- Empty `Press r to load open issues with the GitHub CLI (gh).`, `No open issues. Press n to file one.`, `⠋ loading issues from GitHub…` — `issues.ts` `empty`.
- Notice (success) and error banner — `issues.ts` `renderIssues`.
- Hint chips `↑↓ select`, `p plan it`, `n new`; keys `enter`, `r` — `view.ts` `hintChips()`, `tabKeys("issues")`.

**Deviations:**
- **Deviation:** the detail is a `Sheet` at 768 px, side by side at ≥ 1024 px — **sheet**.
- **Deviation:** the issue body and comments render as GitHub Markdown, with links opened in a new tab — **md**.
- **Deviation:** `Plan it`, `New issue`, `Reload` are buttons; filing an issue uses a `Sheet` with title/body fields — **mouse** + **sheet**.
- **Deviation:** labels, state and `#number` are unchanged — **none**.

**States:** not loaded (`Press r to load open issues with the GitHub CLI (gh).`); loading (`⠋ loading issues from GitHub…`); empty (`No open issues. Press n to file one.`); error (`✗ <error>` banner + `Retry`); filed (`✓ filed #43 — <title>` notice); long list (scrolls); long body (Markdown scrolls in the `Sheet`).

---

## (o) Settings

The whole page now, not the tab pane: Pi's `/bot-lobby settings` (`alt+s`) as a web page (P5-01). Section list (`Master`, `Scout`, `Designer`, `Backend`, `QA`, `Researcher`, `Quick fix`, `Planner`, `Git isolation`, `Lobby`, `Classifier (Jev)`, `Close`), each with the terminal's summary line, and a `Sheet` per submenu with the same titles, item labels, descriptions and hint text. A section rail at ≥ 1024 px, a section list at 768 px. Every value round-trips through the same config writer, and the terminal sees the change.

**shadcn:** `card` (the section list), `scroll-area` (list, submenu), `separator`, `badge` (on/off, status), `button` (`Toggle`, `Cycle`, `Edit`, `Test connection`, `Close`), `sheet` (every submenu), `tabs` (light/dark/system theme switch per D-09), `input` (port, model id, timeout), `textarea` (instructions), a `command` popover for models (Radix `command`, already a shadcn dependency), `empty`, `spinner` (test connection), `tooltip`, `kbd`, `sonner` (saved notice).

### (o1) 768 × 1024 — section list; each section in a Sheet

```
┌────────────────────────────────────────────────────────────────────────────┐
│ bot-lobby settings                                                          │
├────────────────────────────────────────────────────────────────────────────┤
│ Master            openai/gpt-5 · high · mouse · plan…                        │
│ Scout             openai/gpt-5-mini · fixed                   [Edit]         │
│ Designer          openai/gpt-5 · medium · 10m                 [Edit]         │
│ Backend           openai/gpt-5 · medium · 10m                 [Edit]         │
│ QA                openai/gpt-5 · high · 15m · custom          [Edit]         │
│ Researcher        openai/gpt-5 · high · 20m                   [Edit]         │
│ Quick fix         openai/gpt-5-mini · low · 5m                [Edit]         │
│ Planner           openai/gpt-5 · high · 15m                   [Edit]         │
│ Git isolation     branch · each new task gets a git branch…   [Cycle]        │
│ Lobby             opens with a task · asks on enter · mouse…  [Edit]         │
│ Classifier (Jev)  on · OpenCode Zen · jev-1.13-free · key …   [Edit]         │
│ Theme             system                                      [Light|Dark|⟳] │
│ Close                                                                        │
├────────────────────────────────────────────────────────────────────────────┤
│ ↑↓ navigate · enter select · esc back                                       │
└────────────────────────────────────────────────────────────────────────────┘
```

### (o2) 1440 × 900 — section rail and the open section

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ bot-lobby settings                                                                                         │
├───────────────────────────────────────┬────────────────────────────────────────────────────────────────────┤
│ Master                                │ Lobby                                                                  │
│ Scout                                 │ ────────────────────────────────────────────────────────────────────  │
│ Designer                              │ Open with a task       on · open the lobby when this session starts    │
│ Backend                               │                        or resumes a task                              │
│ QA          ◂                         │ Ask at once            on · put the panel's questions to you as soon   │
│ Researcher                            │                        as a round ends, while the Plan tab is open    │
│ Quick fix                             │ Mouse                  on · click tabs and draft lines, scroll with    │
│ Planner                               │                        the wheel (shift+drag still selects text)     │
│ Git isolation                         │ Status line when hidden on · one line under the editor while the      │
│ Lobby                                 │                        lobby is hidden: task steps, the planning     │
│ Classifier (Jev)                      │                        round, a quick fix, or idle                    │
│ Theme                                 │ Issues tab             off · the GitHub Issues tab                    │
│                                       │ Conversation pane      on · shown on the Lobby tab; its key toggles   │
│                                       │                        it too                                        │
│                                       │ Activity log pane      on · shown on the Lobby tab                       │
│                                       │ Thinking pane          on · shown on the Lobby tab                       │
│                                       │ Planning rounds        5 rounds · enter cycles 2, 3, 5, 8, unlimited   │
│                                       │ Split long plans       over 8 steps · saving a plan with more steps    │
│                                       │                        offers to split it into up to 5 tasks            │
│                                       │ Web UI                 off · port 7347 · opens the browser · questions  │
│                                       │                        both                                          │
│                                       │                                                                       │
│                                       │ [Model…] [Thinking…] [Fallback…] [Time limit…] [Instructions…]         │
│                                       │                                                                       │
│                                       │ keys: lobby.keys in ~/.pi/bot-lobby/config.json                       │
└───────────────────────────────────────┴────────────────────────────────────────────────────────────────────┘
```

The `Web UI` submenu and the `Classifier (Jev)` submenu reproduce the terminal's item labels and summaries:

```
┤ bot-lobby settings · Web UI                            │ bot-lobby settings · Classifier (Jev)                       │
│ Web UI         off · start the loopback browser UI with  │ Classifier    on · Jev makes the obvious decisions so…     │
│                /bot-lobby web                            │ Host          OpenCode Zen (auto) · enter cycles OpenCode   │
│ Port           7347 · the base port (then the next free  │               Zen, OpenCode Go, TypeSafe                   │
│                up to +20); 0 means any free port         │ API key       key stored in pi · Loaded: sk-…abcd          │
│ Open browser   on · open the link in the browser on      │ Model         jev-1.13-free (the host's default)           │
│                /bot-lobby web                            │ Planning seats    on · each round, only the seats your…     │
│ Questions      both · where the web UI's questions are   │ Obvious answers   on · a panel question whose recommended…  │
│                answered: both, or the terminal only      │ Task triage       on · a new task's size, domains and…      │
│                [Back]                                    │ … Effort routing · Pull request read · Relevant knowledge  │
│                                                          │ Cheaper model  none: trivial steps keep their model and    │
│                                                          │               drop a thinking level                        │
│                                                          │ Test connection  one tiny call: shows the model and how…    │
│                                                          │               [Back]                                        │
```

**TUI wording reused (verbatim):**

- Titles `bot-lobby settings`, `bot-lobby settings · Lobby`, `bot-lobby settings · Web UI`, `bot-lobby settings · Classifier (Jev)`, `<kindLabel> settings`; hint `↑↓ navigate • enter select • esc back`, and `type to search • …` for search pickers — `settings-ui.ts` `frame`, `hintText`, `openSettings`, `editLobby`, `editWeb`, `editClassifier`.
- Agent labels `Master`, `Scout`, `Designer`, `Backend`, `QA`, `Researcher`, `Quick fix`, `Planner` (`kindLabel`); entry items `Model`, `Thinking`, `Fallback model`, `Fallback thinking`, `Time limit`, `Instructions`, `Back`; summaries `<model> · <thinking> · <limit> · custom · fallback <model>`; scout `Thinking` description `<SCOUT_THINKING> (fixed for scouts)`; `inherit` description `Use the session's current model`; `custom…` description `Type a provider/model id` — `settings-ui.ts` `entryItems`, `entryDescription`, `modelItems`.
- Lobby items and help `Open with a task`, `Ask at once`, `Mouse`, `Status line when hidden`, `Issues tab`, `Conversation pane`, `Activity log pane`, `Thinking pane`, `Planning rounds`, `Split long plans`, `Web UI`, `Back`; round summary `<n> rounds`/`unlimited`; split `<n> steps`/`never`; `enter cycles 2, 3, 5, 8, unlimited; the last round the oracle settles alone` — `settings-ui.ts` `LOBBY_SWITCHES`, `PANEL_SWITCH_LABELS`, `roundLimitLabel`, `splitLimitLabel`, `lobbySummary`.
- Web items `Web UI`, `Port`, `Open browser`, `Questions`, `Back`; `webSummary` `on · port 7347 · opens the browser · questions both`; port help as above; `Questions` `both · where the web UI's questions are answered: both, or the terminal only` — `settings-ui.ts` `editWeb`, `webSummary`.
- Classifier items `Classifier`, `Host`, `API key`, `Model`, the seven feature labels (`Planning seats`, `Obvious answers`, `Task triage`, `Effort routing`, `Pull request read`, `Relevant knowledge`, `File hints`), `Cheaper model`, `Test connection`, `Back`; summaries `on · OpenCode Zen · jev-1.13-free · key stored in pi`; hints `key stored in pi`, `Loaded: <masked>`; test result `Jev answered in <ms> ms (<model>).` / `Jev test failed: <error>` — `settings-ui.ts` `CLASSIFIER_FEATURE_ITEMS`, `classifierSummary`, `keyHelp`, `editClassifier`.
- Git isolation `off` / `branch` / `worktree` and its help texts; `enter cycles off, branch, worktree` — `settings-ui.ts` `gitSummary`, `GIT_ISOLATION_HELP`, `nextGitIsolation`.
- Validation messages `"<typed>" is not a positive number of minutes.`, `"<typed>" is not a port (0, or 1-65535).`, `bot-lobby: <kindLabel> <detail> — saved to <config path>` — `settings-ui.ts`.

**Deviations:**
- **Deviation:** each terminal `SelectList` menu becomes a `Sheet` over one Settings page; the same title, labels, descriptions and `↑↓ navigate • enter select • esc back` hint — **sheet**.
- **Deviation:** toggles, cycles and pickers are real controls (switch, segmented `tabs`, command popover); the terminal needs `enter` on each row — **mouse**.
- **Deviation:** the model picker shows the registry's descriptions and searches (the terminal already searches with `type to search`) — **md** (the label + description layout).
- **Deviation:** the light/dark/system theme switch is new (D-09); it is not a terminal setting — **none** beyond D-09.
- **Deviation:** every value and every summary string is the terminal's; only the chrome changes — **none**.

**States:** loading (skeleton list + `⠋ Connecting…`); saved (`<kindLabel> model → <id> — saved to <path>` toast); invalid input (the terminal's warning text inline on the field); test running (`⠋ Test connection`); test result (notice above); error (`Could not load settings. Retry`); long instructions (a `textarea` that scrolls, wrapping as `editInstructions` does).

---

## Deviations from the TUI, collected

Every difference below is one of D-14's approved improvements, a D-09/D-12 requirement, or an explicit P4 task; anything not listed must be treated as a parity bug (D-14).

| # | Where | Difference | Key / basis |
| --- | --- | --- | --- |
| 21 | Tasks | Detail in a `Sheet` at 768 px; two panes at ≥ 1024 px | sheet |
| 22 | Tasks | Delete/delete-for-good confirm; archive/restore offer undo | sheet, states |
| 23 | Tasks | Archived view is a filter toggle; `v` kept | mouse |
| 24 | Tasks | Request/plan/comments as Markdown | md |
| 25 | Plan | Seats are toggle buttons; `1-4` kept | mouse |
| 26 | Plan | Line comment typed in a `Sheet`; click a line to open it | mouse, sheet |
| 27 | Plan | Panel questions use the batch-1 slideout; `autoAsk` opens it on the Plan tab | slideout |
| 28 | Plan | Draft and conversation as Markdown | md |
| 29 | Quick fix | Detail in a `Sheet` at 768 px; report as Markdown | sheet, md |
| 30 | Quick fix | Cancel/run-anyway/as-a-task as buttons + confirm | mouse, states |
| 31 | Sessions | Preview in a `Sheet` at 768 px; stop confirmed | sheet, states |
| 32 | Sessions | Preview conversation as Markdown | md |
| 33 | Metrics | Real SVG charts with hover values and accessible labels | md (W-152) |
| 34 | Metrics | Sortable `<table>` scrolling inside its box | mouse |
| 35 | Git | Detail in a `Sheet` at 768 px; review actions as buttons | sheet, mouse |
| 36 | Git | Description/review/comments as Markdown | md |
| 37 | Knowledge | Entries in a `Sheet` at 768 px; full-pane editor | sheet |
| 38 | Knowledge | Stale write refused with reload/overwrite and the archive notice | states |
| 39 | Excalidraw | Detail in a `Sheet` at 768 px | sheet |
| 40 | Excalidraw | Link masked with `Reveal`/`Copy`/`Open board`; agent checklist as checkboxes | mouse (D-12, Q-03) |
| 41 | Issues | Detail in a `Sheet` at 768 px; body/comments as Markdown | sheet, md |
| 42 | Settings | Every submenu is a `Sheet` over one page; controls instead of `enter` rows | sheet, mouse |
| 43 | Settings | Light/dark/system switch (D-09) | D-09 |
| 44 | All | Destructive actions confirm in an `alert-dialog`; reversible ones offer undo | sheet, states |
| 45 | All | Long tables/code/diffs scroll inside their own box, never sideways on the page | D-09 |

Batch 1's table (rows 1–20) still applies to the shell, tab strip, Lobby, questionnaire and Alt+H.

---

## Gaps

- **Terminal screenshots.** P0-07.7 asks for `docs/*.png` and the README's tab descriptions as content. `docs/lobby-tasks.png`, `docs/lobby-plan.png`, `docs/lobby-quickfix.png` and `docs/lobby-metrics.png` exist but were not embedded (like batch 1); the ASCII draws the wording from the tab sources instead. A follow-up edit can paste them in.
- **Static HTML / screenshots.** As in batch 1, this is ASCII only. The token-accurate HTML gallery is the Phase 3/4 `#/gallery`; it was not built here (the brief says do not edit `webui/`).
- **Dark theme.** Batch 1 states token remappings only. Settings adds a manual switch (D-09); the wireframes are drawn once and inherit the remap.
- **Settings is Phase 5.** It is drawn here because P0-07.3 asks for it; its task (P5-01) is after Phase 4.
- **Sessions `pid` line.** `sessionPreview` prints `pid <pid>` only for other-terminal sessions; the preview in (i2) shows a background session, so no pid. Both variants are named.
- **Metrics sort.** The terminal's `sort` cycles a `SortKey`; the exact order lives in the metrics data layer (not read here). The table header always shows `sorted by <sort>`; the button cycles it.
- **Excalidraw `checkbox`.** Listed as a shadcn component; the Radix checkbox package is already pulled in by `questionnaire`, so this needs no new dependency. If Phase 4 prefers not to add the styled wrapper, a `button` with `aria-checked` draws the same `[x]`/`[ ]` rows.
