# 06. Questionnaire

Goal: when an agent asks (`ask_user_question`, a choose/text prompt, a session dialog), the question shows in place of the composer on every page, as today: who asks and from where, "n of N", the question large, numbered options, mockups, notes, put away and reopen.

## Read first

- `webui/src/prompts/*` (all), `webui/src/app/usePrompts.ts`, `webui/src/lib/promptSeen.ts`.
- `src/ask/types.ts` (option fields: `label`, `description`, `preview` Markdown, `htmlPreview { html, css }`, `image`), `src/lobby/prompt-hub.ts` (`WebPrompt`), `src/webui/api/prompts.ts` (`prompts.list`, `prompts.answer`, `prompts.dismiss`), `src/webui/api/sessions.ts` (`sessions.answer` for background session dialogs), `planner.answer` for the planning panel's questions.

## Step 1. Data

- `prompts.list` on the `prompts` topic. Narrow each `WebPrompt.payload` with the same rules as `webui/src/prompts/payload.ts` (port it to `lib/payload.js`, or reuse it through `shared.js` if it has no React import).
- A prompt is shown on every page that has a composer (Lobby, Tasks, Plan, Knowledge). Keep "seen" and "put away" ids in `setShared("bot-herdr/prompts", …)` so all pages agree.

## Step 2. The drawer (`lib/question.js`)

Takes the composer's place, same width, radius 12, `popover` background, 1 px `border`.

- Top line: "<Agent> asks · from <Lobby | task title | Plan>" in `dim`, "n of N" on the right, a put-away button (chevron down).
- Question: 18 px, `foreground`, wraps.
- Options: numbered rows 40 px+, number keycap on the left, label, description in `muted` under it. Hover `hover`, picked: accent outline 1 px + `selected` fill. Multi-select shows a real bordered checkbox per row. Keys 1 to 9 pick, Enter confirms, ←/→ move between questions.
- Free reply: the drawer has no text box. Under the options, a slim "Type your own answer" field (an `Input`) that sends on Enter. (Today the composer itself is used; herdr's composer is hidden while the drawer shows, so the field lives here.)
- Notes: a "Add a note" link opens a small `Textarea` under the picked option; the note goes with the answer (`answer` shape as in `payload.ts`).
- Answers for a questionnaire are collected and sent together after the last question (`prompts.answer { id, answer }`), as today.
- Put away: the composer comes back with a "1 question waiting" pill above it; click to reopen. A put-away prompt still marks the Orchestrator as blocked in herdr (phase 03).
- Dismiss (×) → `prompts.dismiss { id }`, asks first.

## Step 3. Mockups

Options may carry three kinds of preview:

| Kind | In bot-herdr |
|---|---|
| `preview` (Markdown sketch) | `TextView.markdown` in a card under the option; expanded view in a herdr `window` overlay |
| `image` | copied into the app home and shown with `image()` (phase 05 part G); click opens the image window |
| `htmlPreview { html, css }` | herdr cannot render HTML+CSS. Show a thumbnail card with the option name and **Open mockup**. Open writes `appHome()/data/bot-herdr/mockups/<prompt>-<n>.html` with the html, the css in a `<style>`, and `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` (no scripts, no network, like today's `sandbox=""` iframe), then opens it in the system browser (`open` / `xdg-open` / `start`). If spike check 9 showed `TextView.html` handles simple markup, also draw `TextView.html` of the html (without CSS) as a rough inline thumbnail |

The expanded viewer (one option per slide, ←/→, digits, Enter chooses) is a `window` overlay with one option at a time and pills to step.

## Done when

- `herdr-app check` passes.
- Ask a questionnaire with three questions (one multi-select, one with Markdown previews, one with an HTML mockup) from pi: the drawer replaces the composer on every page, keys work, the HTML mockup opens in the browser with no scripts running, answers arrive in one go, put away / reopen works.
