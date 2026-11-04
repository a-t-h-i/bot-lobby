# 11. Plan

Goal: the Plan page: the planning panel's seating, its conversation, the draft plan in a slide-over with line comments, and previous plans.

## Read first

- `webui/src/tabs/plan/*` (all), `webui/src/prompts/planQuestions.ts`.
- `src/webui/api/planner.ts`, `src/webui/protocol.ts` (`PlannerSnapshot`, `PanelMember`, `MemberState`, `PlannerMessage`, `PanelQuestion`, `PanelNote`).

## Steps

1. **Seating** (no session yet): seats from `planner.get` → `seats`; toggles per seat (`planner.toggleSeat`); "Start planning" sends the first message through the composer (`planner.new` / `planner.send`, check `PlanTab.tsx`).
2. **Conversation**: the same message parts as the Lobby (reuse `views/lobby/conversation.js` row builders with a `planner` source). Edit your own message (`planner.editMessage`). Retry (`planner.retry`). Each seat's state shows with the working mark and its role word while it works.
3. **Rail** on the right (≥ 1100 px): round "n of m", seats and what each did, actions Save as task (`planner.save`), Answer questions (`planner.answer`), New plan.
4. **Plan sheet**: "View plan" pill above the composer (key `v` via `nextCommand`) opens the draft. A herdr `window` overlay cannot dock to an edge, so use the page's own right column instead: when open, the Plan view splits into conversation | draft (draft 55%), with a close button, so nothing floats over the chat. Draft = `TextView.markdown` per paragraph so each line can take a comment.
5. **Line comments**: hover a paragraph shows a "+" at its left; click opens an `Input` right under it; Enter sends `planner.commentLine { line, text }` (check the body shape).
6. **Previous plans**: a "Previous" pill in the page header lists `planner.previous` (archived behind a toggle), opening one with `planner.previousGet` in the same split; actions open / archive / delete (`planner.previousOpen`, `previousArchive`, `previousDelete`).
7. Panel questions arrive as prompts (phase 09), already handled.

## Done when

- `herdr-app check` passes.
- A full planning round runs from herdr: seats, messages, draft opens with `v`, a line comment lands, Save as task creates the task (visible on Tasks).
