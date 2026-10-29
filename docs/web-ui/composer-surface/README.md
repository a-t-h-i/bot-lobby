# Composer Surface: full web UI redesign handoff

Design reference for restyling the whole web UI (`webui/src`) around the bubble composer.
Nothing here is wired into the app. The `.dc.html` files are interactive Claude Design
prototypes (HTML, CSS and a small state class). **Read them for exact values** (sizes, easing,
colours, copy); this file explains the intent and maps each part to the code to change.

| File | What it shows |
|---|---|
| `surface-light.dc.html`, `surface-dark.dc.html` | The whole app shell: sidebar, top tab navigator, Lobby, Tasks, Plan, Knowledge, Settings, composer and all its menus. **The main reference.** |
| `gates-*.dc.html` | Approval gates board (mirrors the real gates UI) |
| `dialogs-*.dc.html` | Dialogs board: sign-in, error state, folder picker, confirmations |
| `../composer-design/` | Earlier composer-only handoff; the bubble and goo-filter mechanics are explained there and still apply |

They need the Claude Design runtime (`support.js`), so open them from the Claude Design
artifact rather than from disk. In the prototype, state lives in `renderVals()`; handlers and
data there are mock data and are not meant to be ported.

## Principles

1. **Bevel only on buttons, the composer and chat bubbles.** Every page (Tasks, Plan, Knowledge,
   Settings, Previous plans) is flat: cards are `box-shadow: inset 0 0 0 1px var(--edge)` on `--fill`,
   wells are `--sunk`, separators are 1px hairlines. Raised/keycap styling (`.kc` buttons, `.sq`
   rail buttons) is the only place `--rs` / `--ss` bevels appear on pages.
2. **Fluid motion.** Springy easing for things that appear or snap back
   (`cubic-bezier(0.34, 1.4–1.5, 0.5, 1)`), `cubic-bezier(0.22, 1, 0.36, 1)` for everything else.
   Respect `prefers-reduced-motion` (all animations off).
3. **Information-dense but quiet.** Small type, tight rows, ids and branch names hidden behind
   "Details" or tooltips. Icon-only buttons with tooltips where actions repeat.
4. **Colour carries meaning.** Agents have fixed colours, used everywhere (menus, cards, badges):
   Oracle = accent, Design `#c27ad1`, Dev `#4f9fe0`, QA `#e0a43c`, Research `#8b7cf6`, Scout `#3fb892`.
   Dark accent is Claude clay `#D97757`; light accent is `#1B4ED8`. Page/fill/edge tokens are in the
   `:root` blocks of the prototypes (light and dark).

## Shell

- **Sidebar**: collapsed mini rail (chat, new, settings) that expands on hover or pin (Alt+B).
- **Top tab navigator**: four tabs only (Lobby, Tasks, Plan, Knowledge). **Settings is not a tab**;
  it is reached from the sidebar gear or Alt+, . Collapsed it shows only the active tab. It expands
  on hover and on the keyboard shortcuts (Alt+1..4, Alt+[ and Alt+]), **waits 600ms** after the last
  hover/shortcut, then snaps back with a springy bubble morph (about 640ms,
  `cubic-bezier(0.34, 1.5, 0.5, 1)` on width/height; the tab row scales down into the bubble).
- Top right: code viewer (Alt+E) and terminal (Ctrl+`).

## Composer and its menus (`webui/src/app/Composer.tsx`, `composer/*`, `index.css`)

- Bubble composer with merged menus as in `../composer-design`.
- **Backdrop blur** while any menu is open (project explorer, `/`, `@`, attach): a scrim with 1.5px
  blur and 8% tint behind the composer, fading in/out. Not on the plan bubbles (see below).
- **No scrollbars** in menus (`scrollbar-width: none`, `::-webkit-scrollbar { display: none }`).
- **`/` commands are colour coded by source**: lobby commands = accent, pi commands = QA colour,
  skills = Plan colour. Each row has a coloured glyph and a small tag (`lobby`, `pi`, `skill`).
- **`@` agents** use the agent colour and an icon per agent type.
- **Bubbles above the composer** (same layout as the `/` list, one line each, never stacked):
  "Answer questions · N left" (any tab while questions are open), "View plan" (Plan tab),
  "Ask the knowledge" (Knowledge tab). They sit in the same merged shape as the menus.
- **Questionnaire drawer** ("Answer questions"): a menu pane on top of the composer, available on
  **every page** whether the question came from the Lobby or from planning. It shows the agent,
  the source ("From the Lobby" / "From planning · round 4/5"), "n of N", the question in large type,
  then numbered option rows. Questions with mockups render the mockups inside the drawer as
  thumbnails. **Mockups are expandable** (corner button): a lightbox with the large mockup, the
  agent, "Choose this" and prev/next.
- **Typing a reply uses the composer itself.** While the drawer is open the composer placeholder
  becomes "Or type your own reply…", the composer is focused, Enter (or the send button) submits
  the reply and advances. There is no separate text input in the drawer.
- **Ask the knowledge**: clicking the bubble puts the composer in ask mode (placeholder
  "Ask what the agents know…", Esc cancels); Enter shows an answer card on the Knowledge page.

## Tasks (`webui/src/tabs/tasks/*`)

- Grouped table: section headers (with counts), rows with status mark, title plus a muted meta
  line, progress pips and fraction, worked time, age.
- Row click opens a **slide-over** (not an inline panel) with the task detail. Ids, branch and
  worktree live behind a "Details" toggle. Action bars use icon buttons.
- **Delivery review**: Create PR, Merge to main, Refresh review, Save for later are an **icon-only
  row at the bottom** with tooltips, plus one explanatory sentence above.
- **Working agents**: quiet inline "N working · time" with pulsing avatars. Agents hang off their
  step on a real branch (trunk plus elbow, sub-agents one level deeper); a pulse in the agent's
  colour flows **from the agent to the step**. Ends at the last agent; off for reduced motion.

## Plan (`webui/src/tabs/plan/*`)

- Single column. The old "Planning ..." header is replaced by a **round counter** (a 34px circle
  showing `4/5`, tooltip "Round 4 of 5 ...") that sits at the **top of the side rail and is always
  visible**.
- **Side rail** (right): panel seat toggles as icon buttons in the seat's colour (crown Oracle,
  code Dev, palette Design, shield QA, globe Research), dashed outline when off, a badge with the
  pending question count, tooltips. Below a hairline gap: Previous plans (H), Save (Ctrl+S),
  New plan (N) as icon buttons with tooltips.
- Questions appear inline as cards with a left rule in the agent colour, options as dotted-underline
  text, mockups as inline thumbnails (expandable).

## Knowledge (`webui/src/tabs/knowledge/*`)

Three modes in a segmented control: **Notes**, **Agents**, **Inbox** (with a count badge).

- **Notes**: filter rail on the left (All notes, agents with counts and an "over threshold" dot,
  the files of the selected agent, top tags). Main area: search (text, tags, agent, source), quick
  filters (Pinned, Stale, Conflicts), sort (Pinned first / Most used), "New note". Notes are cards in
  two columns: agent, file, hover actions (pin, edit, delete), the text with inline code, an
  optional comment line, a stale/conflict flag with an action, tags (click to filter), provenance
  line (source and age) and a usage bar ("14 uses"). Editing is **inline** in the card (every write
  archives the previous version). Cards can be dragged onto an agent in the rail to move them.
- Clicking a card opens a **slide-over**: full text, tags, "Where it came from" timeline (with
  restore on earlier edits), "Used by agents" (30-day bars and the tasks that used it) and "Move to".
- **Agents**: one card per agent: counts, "Starts every session with" file budget bars against the
  compaction threshold (6k), over-threshold warning with "Ask the oracle to compact", recently learned.
- **Inbox**: notes proposed by finished sessions, each with source, confidence ("confident" at
  85 and above), a "Replaces" diff when it supersedes a note, and Accept / Edit / Dismiss. "Accept N
  confident" accepts the confident ones in one click.
- The old Chat | Docs toggle is gone; asking is done through the composer (see above).

## Settings (`webui/src/tabs/settings/*`)

Flat page. Every model/effort/harness selector is the same size (332 x 34). Not in the tab navigator.

## Suggested migration order

1. Tokens and the flat-card rules (`index.css`): the single biggest visual change.
2. Shell: tab navigator behaviour, sidebar, top-right buttons.
3. Composer menus: colour coding, blur scrim, scrollbars, plan bubbles, questionnaire drawer and lightbox.
4. Tasks page, then Plan page, then Knowledge, then Settings.
5. Gates and Dialogs boards.

Keep real data flows and keyboard handling; only the presentation and the interactions listed
above change. Things in the prototype that are mock data: all notes, tasks, questions, the canned
knowledge answer, the 4/5 round, the proposals in the Inbox.
