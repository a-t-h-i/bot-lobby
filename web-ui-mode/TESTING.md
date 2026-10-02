# Testing

## 1. Levels

| Level | Where | Runs with | Needs | When |
| --- | --- | --- | --- | --- |
| **Service and models** | `test/lobby-service.test.ts`, `test/lobby-models-*.test.ts`, `test/lobby-prompts.test.ts` | `node --test` | nothing | every PR |
| **Server** | `test/webui-*.test.ts` | `node --test`, real `node:http` on port 0 | nothing | every PR |
| **Page logic** | `test/webui-page-*.test.ts` (the store, the API client, formatting) | `node --test` with fake `fetch` and `EventSource` | nothing | every PR |
| **UI checks** | `test/web/*.mjs` | Playwright (`playwright-core`) against the mock server (P2-09) | a Chromium (`CHROMIUM_PATH`) | every page PR; every PR once CI has a Chromium |
| **Walkthroughs** | `docs/web-ui/verification/phase{2,3,4,5}.md` | a person or an agent with real Pi | a model key; for phone steps, an Android device | at each phase's end |

`npm run check` runs the first three levels plus the typechecks and the `dist/` freshness test. `npm run web:check` runs the UI checks.

## 2. The terminal must not change (Phase 1)

- Phase 1 moves code without changing behaviour. Its proof is that **every existing test passes with its assertions untouched**.
- **If a test has to change:** its setup may change, for example to build a service. Its assertions may not. An assertion that changes is a behaviour change, which the card must name.
- **P1-X adds a manual terminal pass** on a real task (PLAN, P1-X).

## 3. Server tests

**Start from `web-ui-mode/starter/test/server.test.ts`.** It already sends raw requests with exact headers (`node:http` `request`, not `fetch`, which sets its own `Host` and `Origin`).

**Rules:**
- **A test per fence** in D-12 and ARCHITECTURE §9. The starter has 1–6.
- **A test per call** in ARCHITECTURE §5:
  - reads use a real service over a temporary project (the helpers used by `lobby-runtime` and `lobby-sessions`);
  - actions also check their effect on disk or in the store, and the notice text.
- **The secret scan:** one test calls every read with fixtures that contain an Excalidraw link, and checks that no response contains the room key. It also checks for the `web.json` secret and the link token.
- **The stdout/stderr spy:** start and use the server with `process.stdout.write` and `process.stderr.write` replaced. Any call fails the test.
- **The stream:** read it with `http.request` and split on blank lines (the starter's helper). Check hello, changed per topic, coalescing, deltas without gaps, the heartbeat and the stream cap.

## 4. UI checks

**Start from `web-ui-mode/starter/test/ui-check.mjs`**, which ran 146 checks green (VERIFIED-FACTS 3).

**Sizes:** every page task runs its checks at these sizes, in **light and dark**:

| Name | Viewport | Touch |
| --- | --- | --- |
| phone | 360×780 | yes |
| phone-large | 412×915 | yes |
| tablet-portrait | 800×1280 | yes |
| tablet-landscape | 1280×800 | yes |
| desktop | 1440×900 | no |

**Check on every screen:**
1. it renders (a `data-testid`) in its loading, empty, error and full states, using mock scenarios;
2. its main action round-trips, and the notice shows in the key line;
3. **no sideways page scroll:** `max(scrollWidth, innerWidth) − the device's width ≤ 0`, at rest and while something is running (mobile Chrome widens `innerWidth` to fit overflow, AGENT-GUIDE §4);
4. **touch targets** are at least 44 px tall and wide on touch sizes (the starter checks 36; P3-01 raises it);
5. **no console errors** and no page errors;
6. **untrusted text stays inert:** Markdown with `<img onerror>`, `<script>`, `javascript:` links and remote images renders inert, with no dialog, no request off-origin, and remote images stripped;
7. **keyboard:** the main action is reachable with Tab and works with Enter or Space;
8. **contrast:** text meets 4.5:1 in both themes. The starter's UI check has a computed-style check (`lowContrastText`); axe-core joins it from P5-04;
9. **screenshots:** one per size and theme, kept as CI artifacts, not committed. The four in `reference/screenshots/` are the exception: they are the starter's reference.

**Rules for writing the checks:**
- **The mock server is shared.** Wait for *this* run's change (count before and after), never "the last item" (AGENT-GUIDE §4).
- **Use the mock's scenarios** (`?scenario=`) instead of building state by clicking through.
- **Don't sleep.** Use Playwright's waits on a test id or a function.

## 5. Walkthroughs

Each phase ends with a written walkthrough by a person or an agent, with real Pi and a model. Record the steps, the model, screenshots and the outcome in `docs/web-ui/verification/phase<N>.md`.

| Phase | Covers |
| --- | --- |
| 2 | `/bot-lobby web`, the link, `curl` through every read and action with the cookie, a session switch with a stream open, `stop`, `reset` |
| 3 | A real task from a phone (Termux + Chrome) **and** a desktop browser: start it, approve the proposal in the page, answer a questionnaire in the page while the terminal shows it too (the terminal's copy closes), steer, stop, a background session's question, a reload mid-reply |
| 4 | Every FEATURE-INVENTORY row on a phone and a desktop |
| 5 | Settings round-trip, notifications, install as an app on Android, a keyboard-only pass |

## 6. What must have a test, whatever the task

- Every fence (D-12, ARCHITECTURE §9).
- "With no page connected, nothing changes": no polling, and questions only in the terminal (ARCHITECTURE §9.6).
- A session switch with a page connected (ARCHITECTURE §9.7).
- Every view model moved in P1-03: the terminal's output is unchanged, and the model has its own test.
