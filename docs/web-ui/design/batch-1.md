# Batch 1 wireframes — shell, tab strip, Lobby tab, questionnaire

**Status:** for the user's approval before Phase 3 (plan P0-07, batch 1). Phase 3 builds to this document.

**Changed by D-21 (2026-10-02):** the user asked for the page to look like the terminal lobby, with the tabs part of the page rather than pills. Pi's theme colours replace the shadcn defaults, the face is monospace, the tab strip is drawn as cells of the title line (number printed, the chosen cell lit, no pills), panes are frames with the title in the border, and notices sit at the top right. Where this document says pills, a filled pill or the shadcn defaults, read `web-ui-mode/DECISIONS.md` D-21; layouts, content, wording and behaviour stand as drawn.

**Scope:** desktop/tablet only, ≥ 768 px (D-02, D-09). Below 768 px the page is replaced by the `NARROW_WINDOW` notice. Phones are dropped. Light and dark are the shadcn defaults; no custom theming.

**Sources read for this document:** `src/lobby/view.ts` (tab bar, titles, prompt labels, hints, help), `src/lobby/tabs/home.ts` (Lobby tab), `src/lobby/keys.ts` (key map), `src/lobby/prompts.ts` (shared strings), `src/lobby/tabs/tasks.ts` + `src/state/budget.ts` + `src/lobby/mini.ts` (task header, runs), `src/ask/dialog.ts` + `src/ask/view.ts` + `src/ask/state.ts` + `src/ask/types.ts` (questionnaire), `web-ui-mode/DECISIONS.md` (D-09, D-10, D-13, D-14), `web-ui-mode/FEATURE-INVENTORY.md` (Lobby rows), `web-ui-mode/PLAN.md` (P0-07, P3-01…P3-07), `webui/src/components/ui/*` and `webui/src/index.css` (the shadcn components and tokens we already have).

**Not in this batch (batch 2, gates Phase 4):** Tasks, Plan, Quick fix, Issues, Metrics, Git, Knowledge, Excalidraw tabs; the sessions view; settings. Alt+H mentions their keys only where the terminal's help does.

---

## Decisions for the user

Five choices to approve or change before Phase 3 starts.

1. **Shell frame.** A fixed header (56 px: workspace, branch, task state, connection) and a tab strip (48 px) on top; one scrolling main pane; the composer + hint line docked at the bottom. The page itself never scrolls; only the main pane does. *Recommendation: adopt.*
2. **Tab strip.** *(Superseded by D-21: cells of the title line, as the terminal draws its tab bar.)* Compact labelled pills (`Alt+1…8` moves into the tooltip, not the pill) with edge chevrons, edge fades, no visible scrollbar, the active pill filled with `--primary`. *Recommendation: adopt.* The terminal prints the number inside the cell; the web pill omits it — approve this one visible wording/layout change.
3. **Lobby tab columns.** At ≥ 1024 px the conversation and the activity log sit side by side (as the TUI does at ≥ 100 columns), each with its own scroll; below 1024 px they stack (conversation first), thinking full width under both. *Recommendation: adopt.*
4. **Questionnaire slideout.** A bottom sheet docked directly above the composer, never covering it; the option preview sits beside the options at ≥ 1024 px and below them at 768 px; `Esc` minimises it to a chip above the composer (state kept) rather than discarding. *Recommendation: adopt.*
5. **Alt+H overlay.** A modal sheet with the whole web key map: one column at 768 px, two columns at 1440 px (Everywhere | Typing/Browsing/this tab). Closes on any key or Esc. *Recommendation: adopt.*

---

## Conventions used below

- Drawings are monospace, `1 char ≈ 8 px`; the box widths are illustrative. `768×1024` = tablet portrait, `1440×900` = desktop.
- The only shadcn components available today are: `badge`, `button`, `card`, `empty`, `kbd`, `questionnaire`, `scroll-area`, `separator`, `sheet`, `spinner`, `textarea`, `tooltip`. `tabs` and `sonner` (toasts) are added in Phase 3 (P3-01); `chart` is Phase 4.
- Colour is named only by shadcn token: `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`. Light/dark differences are token *remappings* only (`.dark`), e.g. `--background`↔`--foreground` invert, `--primary` becomes the light neutral; no new colours are introduced.
- Type: body 16 px / 1.5; labels and metadata 13 px / 1.4; headings 20 px / 1.2. Spacing on the 4/8 px scale. Radius scale from `--radius` (`sm`−4, `md`−2, `lg`, `xl`+4). Touch targets ≥ 40 px (D-09); pills and buttons are 44 px.
- **Deviation lines** name the one approved GUI improvement (D-14) or write `none` when the state matches the terminal exactly.

Approved improvement keys used in the `Deviation:` lines:

| Key | Improvement (D-14) |
| --- | --- |
| **mouse** | mouse and touch work everywhere |
| **sheet** | details open in a side Sheet |
| **slideout** | questionnaire slideout above the composer + tab badge |
| **pills** | compact pills, chevrons, tooltip shortcut hints |
| **md** | real Markdown/code/charts/inline previews |
| **states** | explicit empty/loading/error/reconnecting states |
| **alt-h** | Alt+H help overlay |

---

## (a) App shell

The shell wraps every route. Regions top to bottom: **header**, **tab strip**, **banner** (only when one applies), **main pane**, **composer**, **hint line**. Only the main pane and the composer textarea scroll.

### (a) 768 × 1024

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆ bot-lobby (⎇ main)                                                          │  56 px
│ ● T-2026-03-04-1200 implementing        ⟳ AUTO   ● 2 waiting · Alt+O   Alt+H keys│  header
├──────────────────────────────────────────────────────────────────────────────┤
│ (1)Lobby  2 Tasks  3 Plan  4 Quick fix  6 Metrics  7 Git  8 Knowledge  9 Excal… │  48 px
│                                                                              │  strip
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ Pi is asking something in the terminal — answer it there; this page waits.  │  banner
│   (or) ● Reconnecting…  /  ✗ Connection lost — retrying every 2 s. Retry now  │  (one at a time)
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                              │
│                          main pane (the active tab)                          │  flex: 1
│                                                                              │  scroll: only here
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌ message the oracle────────────────────────────────────────────┐   [Send]   │  composer
│ │ Type a request, or / for commands…                            │            │  72 px min
│ └───────────────────────────────────────────────────────────────┘            │
├──────────────────────────────────────────────────────────────────────────────┤
│ TYPE  enter send · esc browse · alt+l hide                   ⠋ 1 agent working│  hint
└──────────────────────────────────────────────────────────────────────────────┘
```

**shadcn:** `separator` (header/strip/pane/composer rules), `badge` (AUTO, waiting, connection), `button` (Send), `textarea` (composer), `tooltip` (connection + key hints), `kbd` (hint line and tooltips), `spinner` (connection + working agents), `sonner` (Phase 3: notices from the `notices` topic).

**TUI wording reused (verbatim):**

- `◆ bot-lobby (⎇ main)` — title, `src/lobby/view.ts` `titles()`.
- `● T-2026-03-04-1200 implementing`, `⟳ AUTO`, `● 2 waiting · Alt+O`, `Alt+H keys` — status, `view.ts` `tabBar()`.
- `no task in this session` — `view.ts` `tabBar()` (no-task state; shown dim).
- `Pi is asking something in the terminal` — `src/lobby/prompts.ts` `PI_ASKING_IN_TERMINAL` (the constant is lower-case; the UI sentence-cases it).
- `TYPE` / `BROWSE` mode badge and the hint chips — `view.ts` `hintLine()` / `hintChips()`.
- `enter send` / `esc browse` / `alt+l hide` — `view.ts` `hintChips()`.
- `the window is too narrow to show the lobby` — `src/lobby/prompts.ts` `NARROW_WINDOW` (shown instead of the whole shell when `< 768 px`).

**Deviation:** the header leads with the workspace/branch and keeps the task status on its own line at 768 px; the terminal packs them on one line — **none** (reflow only, same content and order).
**Deviation:** a connection state (connected / reconnecting / lost) is shown; the terminal has no connection concept — **states**.
**Deviation:** the terminal-dialog banner is a persistent line; the terminal just steps aside — **states**.
**Deviation:** toasts from `notices` — the terminal shows a 6-second notice line (`view.ts` `hintLine()`, `NOTICE_MS = 6000`) — **states** + `sonner`.
**Deviation:** clicks focus the pane; hover raises a pill — **mouse**.

### (a) 1440 × 900

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ bot-lobby (⎇ main)  ● T-2026-03-04-1200 implementing   ⟳ AUTO   ● 2 waiting · Alt+O            Alt+H keys  │  56 px
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1 Lobby   2 Tasks   3 Plan   4 Quick fix   6 Metrics   7 Git   8 Knowledge   9 Excalidraw                      │  48 px
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                              │
│                                                                                                              │
│                                        main pane (the active tab)                                            │  flex: 1
│                                                                                                              │
│                                                                                                              │
│                                                                                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ message the oracle──────────────────────────────────────────────────────────────────────────┐   [Stop] [Send]│  composer
│ │ Type a request, or / for commands…                                                          │                │
│ └─────────────────────────────────────────────────────────────────────────────────────────────┘                │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TYPE  enter steer · esc stop the oracle · alt+l hide                                          ⠋ DESIGN editing 2m · DEV running 40s│
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Same parts as 768 px; only the reflow changes (one header line, one strip line, wider composer). **Deviation: none** beyond the 768 px list above (the 1440 header packs title + status on one line, exactly as the terminal).

---

## (b) Tab strip in all overflow states

Pills in `visibleTabs` order (`src/lobby/prompts.ts`): **Lobby, Tasks, Plan, Quick fix, [Issues], Metrics, Git, Knowledge, Excalidraw**. Labels verbatim from `TAB_LABELS`. The pill body shows the label; the `Alt+N` hint lives in the tooltip and in `aria-keyshortcuts`. Issues is the fifth pill and only exists when `lobby.issues` is on (then `Alt+9` reaches Excalidraw).

**shadcn:** `tabs` (Phase 3, WAI-ARIA tabs pattern), `badge` (counts, spinner, question badge), `button` (chevrons), `tooltip` (label + `Alt+N`), `kbd` (the shortcut inside the tooltip), `separator` (strip rule).

**TUI wording reused (verbatim):** tab labels `Lobby`, `Tasks`, `Plan`, `Quick fix`, `Issues`, `Metrics`, `Git`, `Knowledge`, `Excalidraw` — `src/lobby/prompts.ts` `TAB_LABELS`; badge forms from `view.ts` `tabBar()` (e.g. `3` tasks, `2?` planner, `⠋` running, `5` issues/pulls, `2` excalidraw).

### (b1) 768 × 1024 — fits (8 tabs, `lobby.issues` off)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ▐1 Lobby▌   2 Tasks [3]   3 Plan   4 Quick fix   6 Metrics   7 Git [5]   8 Knowledge   9 Excalidraw│
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
  1 char ≈ 8 px   ·   pills 44 px tall   ·   active = filled --primary + ring --ring
```

All eight pills fit at 768 px with compact pills (border `--border`, radius `--radius-lg`, `px-3`). `1 Lobby` is the active pill (filled `--primary`, `--primary-foreground`). Tasks carries a count badge `3`, Git a count badge `5`.

### (b2) 768 × 1024 — fits, active far right

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  1 Lobby   2 Tasks   3 Plan   4 Quick fix   6 Metrics   7 Git   8 Knowledge   ▐9 Excalidraw▌      │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### (b3) 768 × 1024 — overflows, right chevron only (9 tabs with Issues, scrolled to start)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ▐1 Lobby▌  2 Tasks  3 Plan  4 Quick fix  5 Issues  6 Metrics  7 Git  8 Know…  ›│
│   └──── fade ──────────────────────────────────────────────────────── fade ────┘│
└──────────────────────────────────────────────────────────────────────────────┘
   › = 40 px chevron button, not in the Tab order, aria-hidden, title "More tabs"
```

### (b4) 768 × 1024 — overflows, both chevrons (scrolled to the middle)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ‹  3 Plan  4 Quick fix  5 Issues  6 Metrics  7 Git ▐8 Knowledge▌  9 Excalidraw ›│
│  └ fade ──────────────────────────────────────────────────────────── fade ────┘│
└──────────────────────────────────────────────────────────────────────────────┘
   ‹ › both shown · the active pill always scrolls fully into view (P3-02)
```

### (b5) 768 × 1024 — overflows, left chevron only (scrolled to the end)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ‹  5 Issues  6 Metrics  7 Git   8 Knowledge   ▐9 Excalidraw▌                   │
│  └ fade ──────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

### (b6) Tab strip — hover / focus / tooltip

```
   mouse over "3 Plan"                 keyboard focus (Tab onto strip)
┌───────────────────────────┐        ┌───────────────────────────┐
│   3 Plan                  │        │   3 Plan ╷                │  ← 2 px --ring outline,
│   ┌───────────────────┐   │        │          0 of 3 seats     │    inset so no layout shift
│   │ Alt+3 · Plan      │   │        └───────────────────────────┘
│   │ Plan a task with  │   │         aria-keyshortcuts="Alt+3"
│   │ the whole panel.  │   │
│   └───────────────────┘   │
└───────────────────────────┘
    tooltip = label + Alt+N; a badge pill shows its count next to the label
```

`aria-keyshortcuts`: `Alt+1` Lobby, `Alt+2` Tasks, `Alt+3` Plan, `Alt+4` Quick fix, `Alt+5` Issues *(when on)*, `Alt+6` Metrics, `Alt+7` Git, `Alt+8` Knowledge, `Alt+9` Excalidraw *(when Issues on)*. `nextTab`/`prevTab` use `webKeyMap` defaults `Alt+]` / `Alt+[` (overridable by `lobby.keys`). A waiting question shows a `badge` on any pill other than the one whose prompt it is (`view.ts` tab badges + D-09/P3-02).

### (b7) 1440 × 900 — all eight fit on one line

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ▐1 Lobby▌   2 Tasks [3]   3 Plan   4 Quick fix   6 Metrics   7 Git [5]   8 Knowledge   9 Excalidraw          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
  active = ▐1 Lobby▌ · pills right-sized · no chevrons, no fade, no scrollbar
```

All eight (and all nine with Issues) fit at 1440 px, so no chevrons and no fade show (P3-02 "all eight pills fit on one line at 1024 px and up").

**TUI wording reused (verbatim):** the tab cell is ` <number> <label>[ badge] `, active shown reverse-video, in `view.ts` `tabBar()`: `` `${number} ${name}${badge}` `` with `` `${index + 1}` `` and `TAB_LABELS[tab]`.

**Deviations (for the whole section):**
- **Deviation:** the shortcut number is not printed inside the pill; it is in the tooltip and `aria-keyshortcuts` — **pills**.
- **Deviation:** the active tab is a filled pill rather than reverse video — **pills** + **mouse**.
- **Deviation:** chevrons + edge fade replace the terminal's truncation (`fit(left, width)`) — **pills**.
- **Deviation:** badges are real count bubbles; the terminal prints the count inline — **pills**.
- **Deviation:** hover and `:focus-visible` states are drawn; the terminal has neither — **mouse** (and the 40 px+ target rule, D-09).
- **Deviation:** clicking a pill switches tabs (mouse) — **mouse**.

---

## (c) Lobby tab

Contents, top to bottom, as the TUI's `renderHome` + P3-05: **task header** (task, state, track, plan progress, current step, budget), **runs strip** (live agents), then the panes **Conversation**, **Activity**, **Thinking**, and the composer. At < 1024 px the panes stack; at ≥ 1024 px conversation and activity sit side by side (the TUI's `HOME_COLUMNS_MIN = 100` breakpoint). Pane toggles (`alt+c`, `alt+a`, `alt+k`) sit in a toolbar; search is `ctrl+f`.

**shadcn:** `card` (task header, runs strip, each pane), `badge` (state, track, AUTO, counts), `scroll-area` (every pane, the conversation, the activity list), `separator`, `empty` (no task / no activity / no thought), `spinner` (busy, pending activity, live thought), `button` (jump-to-latest, toggles, Stop/Send), `textarea` (composer), `tooltip` (pane titles show their key, e.g. `Alt+C`), `kbd` (hint line), `sonner` (notices).

### (c1) 768 × 1024 — task running, conversation and activity stacked

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ T-2026-03-04-1200  Give the lobby a search bar                                │  task header
│ implementing · owner: this window · started 12m ago                           │  (card)
│ T-2026-03-04-1200 · fast track (2) · DEV, QA                                  │
│ ⎇ feature-search · from main                                                  │
│ ▓▓▓▓▓▓▓▓░░░░░░ 5 of 8 steps        current: 6. wire the search key ◂ now       │
│ ⧗ Time budget: 90m · 34m used · 46m left (8m kept for the QA gate).           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Runs  ⠋ DESIGN editing 2m · DEV running 40s                                    │  runs strip
├──────────────────────────────────────────────────────────────────────────────┤
│ Conversation                                              Alt+C        ↓ 12   │  pane
│ ◆ Oracle                                                    12:04             │  (scroll-area)
│    I'll add the search bar to the Lobby tab and wire ctrl+f.                  │
│                                                                              │
│                                                   12:07  You ●                │
│                                             Can it highlight matches?         │
│                                                                              │
│ ◆ Oracle                                                ⠋ writing             │
│    Yes — every match is highlighted in the panes, and the pane              │
│    header shows the count:                                                    │
│    **3 matches**                                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│ Activity                                            Alt+A                    │  pane
│ 12:04 MASTER      · scouting the repo for search code                        │
│ 12:05 DEV         ✓ added search to tabs/home.ts                             │
│ 12:06 QA          ! no test yet for filterFeed                               │
│ 12:07 DESIGN      ⠋ editing the pane header…                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Thinking                        DESIGN · thinking      Alt+K                 │  pane
│   DESIGN  **Highlighting** — reuse the pane's existing markdown renderer.     │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌ message the oracle · enter steers the running turn──────────────────────┐   │  composer
│ │ Type a request, or / for commands…                                      │   │
│ └──────────────────────────────────────────────────────────────────────────┘   │
│ TYPE  enter steer · esc stop the oracle · alt+l hide                          │  hint
└──────────────────────────────────────────────────────────────────────────────┘
```

### (c2) 1440 × 900 — conversation beside activity, thinking under both

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ T-2026-03-04-1200  Give the lobby a search bar        implementing · started 12m ago                          │  task header
│ T-2026-03-04-1200 · full workflow (3) · DEV, DESIGN, QA        ▓▓▓▓▓▓▓▓░░░░░░ 5 of 8 steps · 6. wire the search ◂ now │
│ ⎇ feature-search · from main                              ⧗ Time budget: 90m · 34m used · 46m left (8m kept for QA)│
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Runs  ⠋ DESIGN editing 2m · DEV running 40s                                                                  │  runs strip
├───────────────────────────────────────────────┬──────────────────────────────────────────────────────────────┤
│ Conversation                      Alt+C  ↓12  │ Activity                              Alt+A                  │
│ ◆ Oracle                          12:04        │ 12:04 MASTER   · scouting the repo for search code           │
│    I'll add the search bar and wire ctrl+f.    │ 12:05 DEV      ✓ added search to tabs/home.ts                │
│                                                │ 12:06 QA       ! no test yet for filterFeed                  │
│                                       12:07 You ●                                             (scroll-area)      │
│                                 Can it highlight?│ 12:07 DESIGN   ⠋ editing the pane header…                 │
│ ◆ Oracle                      ⠋ writing         │                                                              │
│    Yes — matches are highlighted: **3 matches**│                                                              │
├───────────────────────────────────────────────┴──────────────────────────────────────────────────────────────┤
│ Thinking                                  DESIGN · thinking                                             Alt+K  │
│   DESIGN  **Highlighting** — reuse the pane's existing markdown renderer.                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ message the oracle · enter steers the running turn─────────────────────────────────────────────┐  [Stop] [Send]│
│ │ Type a request, or / for commands…                                                             │               │
│ └─────────────────────────────────────────────────────────────────────────────────────────────────┘               │
│ TYPE  enter steer · esc stop the oracle · alt+l hide                                        ⠋ DESIGN editing 2m│
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### (c3) States of the Lobby tab

**Empty (no task):**

```
│ Conversation                                                  Alt+C           │
│ No task is running in this session.                                           │
│                                                                              │
│ Type a request below and press enter to start one: the oracle scouts,         │
│ proposes, plans and delegates.                                                │
│ Or plan it first with the whole planning panel in 3 Plan, or make a direct    │
│ change in 4 Quick fix.                                                        │
│ 1 task is running in other sessions — see 2 Tasks.                            │
```

**Empty (task, nothing said):** `Nothing said yet. Type below to talk to the oracle about this task.`

**Empty activity:** `No activity yet.`

**Empty thinking:** `Thoughts from the oracle and every agent appear here, and only here.`

**Loading (first paint, before `hello`):** three skeleton cards in the pane (conversation, activity, thinking) with a `spinner` labelled `Connecting…` in the header badge. No wording from the TUI; a page-only state.

**Busy / streaming:** the oracle header reads `⠋ working…`, then `⠋ writing`; a pending activity row spins `⠋`; the composer label becomes `message the oracle · enter steers the running turn` and the button set becomes `[Stop] [Send]`.

**Error (a topic failed to load):** an `empty`-style card inside the pane: `Could not load the conversation. Retry`, with wording kept neutral (the terminal surfaces failures through notices instead).

**Reconnecting:** the strip badge reads `● Reconnecting…`; after 3 failures, `✗ Connection lost — retrying every 2 s. Retry now`. The panes keep their last data.

**Scrolled back:** the pane right-note gains `↓12` (lines back from newest) before the key label; a `[Jump to latest]` button floats at the pane's bottom-right; the top shows the TUI's note `↑ earlier messages load as you scroll up` while more history exists.

**Search in force (`ctrl+f` / `/`):** right-notes become match counts (`3 matches`), the hint line switches to `SEARCH enter keep · esc clear · ↑↓ results · alt+] next tab`, and empty panes read `Nothing in the conversation matches "<query>".` / `No activity matches "<query>".` / `No thought matches "<query>".`

**All panes hidden:** `Every pane is hidden — Alt+C conversation · Alt+A activity · Alt+K thinking` (verbatim shape from `home.ts` `hiddenHint`, `keys` filled with the user's map).

**TUI wording reused (verbatim):**
- Pane titles `Conversation`, `Activity`, `Thinking`; `Conversation · <session name>` when another session is in view — `home.ts` `renderHome`.
- Right-note key labels (`Alt+C`/`Alt+A`/`Alt+K`) and `↓12` — `home.ts` `rightNote`.
- `No activity yet.` — `home.ts` `activity()`.
- `Thoughts from the oracle and every agent appear here, and only here.` — `home.ts` `thinkingContent()`.
- `No task is running in this session.` / `Type a request below and press enter to start one: the oracle scouts, proposes, plans and delegates.` / `Or plan it first with the whole planning panel in 3 Plan, or make a direct change in 4 Quick fix.` / `Nothing said yet. Type below to talk to the oracle about this task.` — `home.ts` `emptyChat`.
- `↑ earlier messages load as you scroll up` — `view.ts` `OLDER_NOTE`.
- Speaker marks `◆ Oracle`, `12:04  You ●`, streaming `⠋ writing`, busy `⠋ working…` — `home.ts` `speakerLine`, `chatTail`.
- Activity line shape `12:04 MASTER · scouting…`, marks `⠋ ✓ ! · ✗` — `home.ts` `activityLine`.
- `message the oracle`, `message the oracle · enter steers the running turn`, `describe a task to start · enter starts it`, `new task — it starts in its own session, named after it` — `view.ts` `promptLabel`.
- Hint chips `enter steer`, `esc stop the oracle`, `alt+l hide` — `view.ts` `hintChips`.
- Plan progress `5 of 8 steps`, current step `◂ now`, track `fast track (2)` / `full workflow (3)`, `⎇ feature-search · from main` — `src/lobby/tabs/tasks.ts` `taskDetailLines`.
- Budget `Time budget: 90m · 34m used · 46m left (8m kept for the QA gate).` — `src/state/budget.ts` `budgetLine` (the `granted`/reserve parts appear when present).
- Runs `⠋ DESIGN editing 2m · DEV running 40s`, or `DESIGN · DEV`, or `2 agents working` — `src/lobby/mini.ts` `agentsIndicator`.
- Search empties `Nothing in the conversation matches "<query>".` etc. — `home.ts` `emptyChat`/`activity`/`thinkingContent`.

**Deviations:**
- **Deviation:** the task header is a real card with plan pips; the terminal shows the same facts in the Tasks tab's detail pane, not in the Lobby tab — **md** + the "one main pane" layout (D-09). *Content and wording are the same; only the placement is new.*
- **Deviation:** the runs strip is a row of badges above the panes; the terminal shows working agents only in the bottom hint line — **mouse** (a visible target) / layout.
- **Deviation:** real Markdown, highlighted code and inline previews via `marked` + `DOMPurify` (D-10) — **md**.
- **Deviation:** a "jump to latest" button and a scroll-position `↓12`; the terminal scrolls with the keyboard only — **mouse**.
- **Deviation:** explicit empty/loading/error/reconnecting cards — **states**.
- **Deviation:** pane visibility as toggle buttons in a toolbar, remembered in the browser (`lobby.panels` equivalent) — **mouse**.
- **Deviation:** search is a real input in the strip; the terminal shows a `/` line above the prompt — **mouse** (keyboard equivalent `ctrl+f` / `/` kept).
- **Deviation:** at ≥ 1024 px the conversation and activity share a row exactly as the terminal does at ≥ 100 columns; **none** otherwise.

---

## (d) Questionnaire slideout

Docked directly above the composer on every tab; a full sheet on top of the page so it never replaces the view (D-13, D-14). Reused from the terminal: the same chips, question Markdown, numbered options, `(Recommended)` marker, descriptions, own-answer row, preview box and hints.

**shadcn:** `sheet` (the slideout panel), `questionnaire` (existing Radix primitive wrapper — progress/chips/items), `badge` (per-question `✓`, the tab badge elsewhere), `scroll-area` (options list and preview), `separator`, `button` (submit / leave / minimise), `textarea` (own answer), `kbd` (hints), `spinner` (submitting), `tooltip` (minimise/close).

**TUI wording reused (verbatim):**
- Chips `1 header ✓ · 2 header`, single-question case shows the header alone — `ask/view.ts` `chips`.
- Title `Question`, `Question 1 of 3`, or `<from> asks · Question 1 of 3` — `ask/view.ts` `renderAsk`.
- Option rows `› ● 1. Label`, `› ☑ 2. Label`, `○` / `☐`, `(Recommended)` — `ask/view.ts` `optionLines`/`optionLabel`.
- Own answer `✎    Type something.` — `ask/types.ts` `OWN_ANSWER`.
- Preview title `Preview · <label>`, empty preview `No preview for this one.` — `ask/view.ts` `previewBox`.
- Image cases `Image: <path>` and `Image: <name> (the terminal is too small to draw it)` — `ask/view.ts` `imageBlock`.
- Hints `↑↓ move`, `space pick · enter next`, `enter choose`, `1-4 pick`, `←→ questions`, `esc leave`; editing `enter keep it · shift+enter new line · esc back to the options`; leaving `Leave without answering? The oracle will not guess for you. enter leaves · any other key keeps answering` — `ask/view.ts` `hints`.
- Answered elsewhere `already answered in the terminal` — `src/lobby/prompts.ts` `ANSWERED_IN_TERMINAL`.

### (d1) 768 × 1024 — first question, single-choice

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    Lobby tab behind (dimmed)                                  │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Question                                                                   ⌄  │  slideout
│ ──────────────────────────────────────────────────────────────────────────── │  (sheet, docked
│ Which search behaviour do you want?                                          │   above composer,
│                                                                              │   ~55% height)
│ › ● 1. Highlight every match                        (Recommended)            │  options
│     Marks each hit in the panes; the header shows **3 matches**.             │  (scroll-area)
│   ○ 2. Filter rows as you type                                               │
│     Hides everything that does not match.                                   │
│   ✎    Type something.                                                        │  own answer
│                                                                              │
│ ↑↓ move · enter choose · 1-2 pick · esc leave                                │  hints
│                                                       [Cancel]  [Answer]      │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌ message the oracle──────────────────────────────────────────────────────┐    │  composer
│ │                                                                          │    │  (never covered)
│ └──────────────────────────────────────────────────────────────────────────┘    │
│  1 question open · Esc minimises                                              │  hint chip
└──────────────────────────────────────────────────────────────────────────────┘
```

### (d2) 768 × 1024 — 1 of N (chips) and multi-select

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1 Storage ✓   ·   2 Search   ·   3 Rollout                                    │  chips (queued)
│ ──────────────────────────────────────────────────────────────────────────── │
│ Question 2 of 3                                                              │
│                                                                              │
│ Which panes should search cover?                                             │
│                                                                              │
│ › ☑ 1. Conversation                                                          │
│   ☑ 2. Activity                                                              │
│   ☐ 3. Thinking                                                              │
│   ☐ 4. Metrics                                                               │
│   ✎    Type something.                                                        │
│                                                                              │
│ ↑↓ move · space pick · enter next · 1-4 pick · ←→ questions · esc leave      │
│                                                       [Cancel]  [Next]        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### (d3) 768 × 1024 — free-text answer being typed

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Question 1 of 1                                                              │
│ ──────────────────────────────────────────────────────────────────────────── │
│ What should the empty state say?                                             │
│                                                                              │
│   ○ 1. Nothing yet                                                           │
│ › ✎    No search matches for “login” — try another word.▏                     │  editing
│        (a second line shows when Shift+Enter is pressed)                     │
│                                                                              │
│ enter keep it · shift+enter new line · esc back to the options               │
│                                                       [Cancel]  [Answer]      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### (d4) 768 × 1024 — image preview, stacked below the options

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Question 1 of 1                                                              │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Which mockup should we build?                                                │
│                                                                              │
│ › ● 1. Compact pills                                                         │
│   ○ 2. Side rail                                                             │
│   ✎    Type something.                                                        │
│                                                                              │
│ ┌ Preview · Compact pills────────────────────────────── 4 more lines ──────┐ │
│ │ [ image: /files/preview/T-2026-03-04-1200/pills.png ]                     │ │
│ │ The pill strip scrolls with chevrons; the active pill is filled.          │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ↑↓ move · enter choose · 1-2 pick · esc leave                                │
│                                                       [Cancel]  [Answer]      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### (d5) 768 × 1024 — minimised chip (Esc) and answered-in-terminal

```
── minimised ─────────────────────────────────────────────────────────────────┐
│ ┌ message the oracle──────────────────────────────────────────────────────┐   │
│ │                                                                          │   │
│ └──────────────────────────────────────────────────────────────────────────┘   │
│ ⧉ 1 question · 2 of 3 · Compact pills                              [Reopen]    │
└──────────────────────────────────────────────────────────────────────────────┘

── answered in the terminal ───────────────────────────────────────────────────┐
│ ┌ message the oracle──────────────────────────────────────────────────────┐   │
│ │                                                                          │   │
│ └──────────────────────────────────────────────────────────────────────────┘   │
│ ✓ already answered in the terminal                             (auto-dismiss) │
└──────────────────────────────────────────────────────────────────────────────┘
```

`Esc` while not editing minimises (does not discard): the sheet collapses to the chip, keeping all answers; the chip shows the progress (`2 of 3`) and a `[Reopen]` button. The terminal's second-key leave-confirmation (`Leave without answering? …`) is used by the explicit `[Cancel]`/`, not by `Esc`, because minimising is reversible.

### (d6) 1440 × 900 — preview beside the options, chips on one line

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Question                                                                                                  ⌄  │
│ ──────────────────────────────────────────────────────────────────────────────────────────────────────────── │
│ Which search behaviour do you want?                                                                          │
│                                                                                                              │
│  › ● 1. Highlight every match        (Recommended)   │ Preview · Highlight every match   3 more lines       │
│      Marks each hit; header shows 3 matches.         │ ┌───────────────────────────────────────────────┐   │
│    ○ 2. Filter rows as you type                      │ │ [ image: …/highlight.png ]                    │   │
│      Hides rows that do not match.                   │ │ Every hit is marked in the pane body.         │   │
│    ✎    Type something.                              │ └───────────────────────────────────────────────┘   │
│                                                       │                                                     │
│ ↑↓ move · enter choose · 1-2 pick · esc leave                                                               │
│                                                                                     [Cancel]  [Answer]      │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ message the oracle──────────────────────────────────────────────────────────────────────────────┐         │
│ │ Type a request, or / for commands…                                                               │         │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────┘         │
│  1 question open · Esc minimises                                                                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

At ≥ 1024 px the preview sits beside the option list (the TUI's `SIDE_BY_SIDE_MIN = 96`), the slideout is ~40% height, and chips for all questions stay on one line. At < 1024 px it stacks below (d4). Dark theme: the sheet uses `--popover`/`--popover-foreground` (light: `oklch(1 0 0)` surface; dark: the raised neutral), the overlay scrim is `--foreground` at low alpha; option focus uses `--ring`; the recommended marker uses `--primary`, never a colour alone (it also reads `(Recommended)`).

**Deviations:**
- **Deviation:** the questionnaire is a bottom slideout above the composer rather than a centred overlay — **slideout**.
- **Deviation:** a badge on the affected tab + a persistent chip when minimised — **slideout**.
- **Deviation:** the leave confirmation is on explicit Cancel; `Esc` minimises — **slideout** (`Esc` in the terminal asks "Leave without answering? …").
- **Deviation:** clicking an option picks it (the terminal needs `1-4` or arrows+enter) — **mouse**.
- **Deviation:** real Markdown and a real image element in the preview (from `/files/preview`) — **md**.
- **Deviation:** "already answered in the terminal" auto-dismisses the sheet — **states**.
- **Deviation:** preview beside/below driven by width, matching the terminal's `SIDE_BY_SIDE_MIN`; **none** otherwise.

---

## (e) Alt+H help overlay

Opened by `Alt+H` (default `lobby.keys.help`), or `?` in browsing mode as in the terminal. A modal sheet over the whole page; closes on any key or `Esc`. Lists the **web** key map (`webKeyMap` from `src/lobby/keys.ts`: `nextTab` `Alt+]`, `prevTab` `Alt+[`), then the terminal's `Everywhere` / `Typing` / `Browsing` / tab sections.

**shadcn:** `sheet` (the overlay), `kbd` (every key), `separator` (sections), `scroll-area` (the list), `button` (Close), `tooltip` (rebind note).

**TUI wording reused (verbatim):**
- Section titles `Everywhere`, `Typing`, `Browsing`, `<Tab> tab` (e.g. `Lobby tab`) — `view.ts` `helpBody`.
- Every action help line from `LOBBY_ACTIONS`, e.g. `hide the lobby (back to pi)`, `show or hide these keys`, `bot-lobby settings: each agent's model and thinking, the lobby`, `search the current tab`, `save the plan being made in the Plan tab to the pending tasks`, `browse sessions: view one, message it, or switch this window to it`, `start a task in a new session, named after it`, `auto mode: the oracle drives the task to completion without asking`, `next tab`, `previous tab`, `show or hide the conversation`, `show or hide the activity log`, `show or hide thinking`, `scroll up a page`, `scroll down a page` — `src/lobby/keys.ts` `LOBBY_ACTIONS`.
- `Alt+1…8 jump to a tab`, `Ctrl+C clear the prompt, or hide the lobby`, the `click` and `wheel` lines — `view.ts` `helpBody`.
- `Enter send`, `Shift+Enter new line`, `Esc stop typing and browse`, `i type`, `/ search this tab (esc clears)`, `? these keys` — `view.ts` `helpBody`.
- Footer `Rebind any shortcut under lobby.keys in the bot-lobby config, e.g. { "toggleThinking": "alt+t" }. Hidden panes stay hidden next time (lobby.panels); lobby.mouse turns clicks off.` — `view.ts` `helpBody` (the web keeps the first sentences; `lobby.mouse` is a terminal setting).

### (e) 768 × 1024 — one column, scrollable

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Keys                                                                   [×]   │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Everywhere                                                                   │
│   Alt+L        hide the lobby (back to pi)                                   │
│   Alt+H        show or hide these keys                                       │
│   Alt+S        bot-lobby settings: each agent's model and thinking, the lobby│
│   Ctrl+F       search the current tab                                        │
│   Ctrl+S       save the plan being made in the Plan tab to the pending tasks │
│   Alt+O        browse sessions: view one, message it, or switch this window  │
│   Alt+N        start a task in a new session, named after it                 │
│   Alt+G        auto mode: the oracle drives the task to completion           │
│   Alt+] / Alt+[  next tab / previous tab                                     │
│   Alt+C        show or hide the conversation                                 │
│   Alt+A        show or hide the activity log                                 │
│   Alt+K        show or hide thinking                                         │
│   PageUp / PageDown  scroll up a page / scroll down a page                   │
│   Alt+1…8      jump to a tab                                                 │
│   Ctrl+C       clear the prompt, or hide the lobby                           │
│   click        a tab, a pane, a draft line                                   │
│   wheel        scroll the pane under the pointer                             │
│                                                                              │
│ Typing                                                                       │
│   Enter        send                                                          │
│   Shift+Enter  new line                                                      │
│   Esc          stop typing and browse                                        │
│                                                                              │
│ Browsing          (scroll: more sections below)                              │
│   i  type   /  search this tab (esc clears)   ?  these keys                  │
│                                                                              │
│ Lobby tab                                                                    │
│   type         talk to the oracle of the session in view                     │
│   enter        on an empty prompt: answer a background session's question    │
│   s            run the session in view in this window                        │
│   ↑ ↓          scroll the focused pane (PageUp/PageDown a page)              │
│   ← →          move between the conversation, activity log and thinking      │
│   Home End     the oldest lines, or back to the newest                       │
│   c            comment on this task's plan                                   │
│   esc          stop the oracle while it works                                │
│                                                                              │
│ Rebind any shortcut under lobby.keys in the bot-lobby config, e.g.           │
│ { "toggleThinking": "alt+t" }.                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

At 768 px the sheet is full-screen with one scrolling column; the terminal's key-name column is 13 characters wide (`helpBody`: `keyWidth = 13`).

### (e) 1440 × 900 — two columns

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Keys                                                                                                     [×] │
│ ──────────────────────────────────────────────────────────────────────────────────────────────────────────── │
│ Everywhere                                        │ Typing                                               │
│   Alt+L        hide the lobby (back to pi)         │   Enter        send                                 │
│   Alt+H        show or hide these keys             │   Shift+Enter  new line                             │
│   Alt+S        bot-lobby settings…                 │   Esc          stop typing and browse               │
│   Ctrl+F       search the current tab              │                                                      │
│   Ctrl+S       save the plan being made…            │ Browsing                                             │
│   Alt+O        browse sessions…                    │   i  type   /  search this tab (esc clears)   ?  keys│
│   Alt+N        start a task in a new session…       │                                                      │
│   Alt+G        auto mode…                          │ Lobby tab                                            │
│   Alt+] / Alt+[  next tab / previous tab            │   type         talk to the oracle of the session…    │
│   Alt+C/A/K    conversation / activity / thinking  │   enter        on an empty prompt: answer a question │
│   PageUp/PageDown  scroll up/down a page           │   s            run the session in view in this window│
│   Alt+1…8      jump to a tab                        │   ↑ ↓          scroll the focused pane               │
│   Ctrl+C       clear the prompt, or hide the lobby  │   ← →          move between the conversation, …      │
│   click        a tab, a pane, a draft line          │   Home End     the oldest lines, or back to newest   │
│   wheel        scroll the pane under the pointer    │   c            comment on this task's plan           │
│                                                     │   esc          stop the oracle while it works        │
│                                                     │                                                      │
│                                                     │ Rebind any shortcut under lobby.keys…                │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
   columns split like the terminal at ≥ 100 columns: Everywhere | Typing/Browsing/this tab (helpBody)
```

Dark theme: the sheet is `--popover` / `--popover-foreground`; key names use `--primary`; section titles use `--foreground`; group rules use `--border`. Light theme uses the shadcn defaults (white popover, neutral text).

**Deviations:**
- **Deviation:** the help is a modal overlay instead of replacing the body — **alt-h** (`sheet` / **sheet**).
- **Deviation:** it is scrollable and clickable (`[×]` closes) — **mouse**.
- **Deviation:** the web key map adds `Alt+]` / `Alt+[` for next/previous tab, as in `webKeyMap`; the terminal's help lists `Tab` / `Shift+Tab` — this is a browser keybinding change approved in the plan (`keys.ts`).
- **Deviation:** `lobby.mouse turns clicks off` is dropped from the footer (mouse is native) — **mouse**.
- **Deviation:** key names are real `kbd` chips — **alt-h**.

---

## Deviations from the TUI, collected

Every difference below is one of D-14's approved improvements; anything not listed must be treated as a parity bug (D-14).

| # | Where | Difference | Approved improvement |
| --- | --- | --- | --- |
| 1 | Shell | workspace/branch leads with task state on a second line at 768 px | none (reflow) |
| 2 | Shell | connection + reconnecting states and terminal-dialog banner | states |
| 3 | Shell | notices as toasts | states |
| 4 | Shell | click/hover on tabs, panes, rows | mouse |
| 5 | Tab strip | shortcut number in tooltip + `aria-keyshortcuts`, not printed in the pill | pills |
| 6 | Tab strip | filled active pill; chevrons + fade overflow | pills, mouse |
| 7 | Tab strip | `Alt+]` / `Alt+[` for next/previous | keys.ts `webKeyMap` |
| 8 | Lobby | task header card with plan pips, current step and budget | md, layout (D-09) |
| 9 | Lobby | runs strip above the panes | mouse/layout |
| 10 | Lobby | real Markdown, code, inline previews | md |
| 11 | Lobby | jump-to-latest + scroll position | mouse |
| 12 | Lobby | explicit empty/loading/error/reconnecting states | states |
| 13 | Lobby | pane toggles as toolbar buttons | mouse |
| 14 | Lobby | search as an input | mouse |
| 15 | Questionnaire | bottom slideout above the composer + tab badge | slideout |
| 16 | Questionnaire | `Esc` minimises to a chip; Cancel asks to leave | slideout |
| 17 | Questionnaire | click-to-pick; real Markdown/image preview | mouse, md |
| 18 | Questionnaire | auto-dismiss on "already answered in the terminal" | states |
| 19 | Alt+H | modal, scrollable, clickable overlay; `kbd` chips | alt-h, mouse |
| 20 | Everywhere | details open in a side `Sheet` in later batches | sheet |

## Gaps

- **Terminal screenshots as content.** P0-07.7 says to use `docs/*.png` and the README's tab descriptions as the content. Those images are binary and were not embedded here; the ASCII drawings use the wording from the source files instead. If the user wants the screenshots pasted in, that is a follow-up edit to this document.
- **No static HTML pages / screenshots.** P0-07.1 asks for static HTML wireframes rendered with the real shadcn tokens plus screenshots. This brief asked for monospace ASCII drawings in `docs/web-ui/design/batch-1.md` and said "do not edit `webui/`"; so this batch is ASCII only. A token-accurate HTML gallery is the Phase 3 `#/gallery` (P3-01) and was not built here.
- **Below-768 px drawing.** The `NARROW_WINDOW` notice is described (shown in (a)) but not drawn as a separate full-screen state; phones are out of scope.
- **Phase 3 risk (not a wireframe gap).** Scout flagged that a strict `style-src 'self'` CSP breaks Radix's inline styles and the theme-provider's injected `<style>`; the entry's `nonce.ts` reads the `csp-nonce` meta but the meta is absent from `webui/index.html` today. Batch 1 assumes the CSP nonce reaches every injected `<style>` (C3); Phase 0 must finish that plumbing before Phase 3, or the wireframes above cannot render as drawn.
