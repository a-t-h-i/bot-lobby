# 09. Knowledge

Goal: the Knowledge page: notes by agent, tags and filters, the inbox of proposed notes, the note sheet, editors, and asking what the agents know.

## Read first

- `webui/src/tabs/knowledge/*` (all), `webui/src/ui/NoteForm.tsx`.
- `src/webui/api/knowledge.ts`, `src/knowledge/*` types it returns.

## Steps

1. **Header**: mode switch Notes / Inbox (n) / Files (a small segmented control: neutral recess for the chosen one), search `Input`, filter chips Pinned / Stale / Conflicts, sort (pinned first / most used), **New note** (`knowledge.add`).
2. **Notes**: rail of agents on the left (names in their colour, no icons; the picked agent's files under it) and tag chips; cards in two columns (one under 900 px) from `knowledge.files`. Card: note text (Markdown, 6 lines then fade), tags, pin mark, use count. Drag a card onto an agent in the rail to move it: herdr has drag-and-drop only for external files, not between elements. Replace with a "Move to…" menu on the card (`knowledge.move`); note it in `gaps.md`.
3. **Inbox** (`knowledge.ledger`): rows with who it is for, where it came from, how sure ("confident" at 85+), the note it would replace; Accept (`knowledge.accept`), Edit first, Dismiss (`knowledge.dismiss`); "Accept N confident" at the top. Rows are a two-column grid (text | actions), not three (the old agent tile column is gone).
4. **Note sheet**: click a card opens the note in the page's right column (as Plan's sheet, no overlay): who keeps it and in which file; Pin (`knowledge.pin`), Edit (`knowledge.edit`), Comment (`knowledge.comment`), Delete (`knowledge.remove`); comments (take back with `knowledge.unnote` where the web app does); tags; "Where it came from" with restore (`knowledge.restore`); "Used by agents".
5. **Editors**: entry editor = `Textarea` with Save / Cancel (Enter saves, Shift+Enter new line); whole file = herdr `Editor` (`EditorState.new({ language: "markdown", value })`) in a `window` overlay, Save → `knowledge.replaceFile`. Show the archive hint text from `Editors.tsx` beside every save.
6. **Ask**: the composer on this page sends `knowledge.ask { question }`; the answer card (`AnswerCard.tsx`) shows above the cards with the notes it used. `knowledge.open` opens a cited file.

## Done when

- `herdr-app check` passes.
- Add, edit, pin, move, delete a note; accept and dismiss inbox items; ask a question and get an answer card.
