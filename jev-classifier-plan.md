# Jev classifier in bot-lobby — implementation plan

Status: agreed design, implemented phase by phase (one PR per phase).
Branch `claude/dev-lobby-jev-classifier-g4neej`.

## Progress

- Phase 1 — round limiter: merged (#7).
- Phase 2 — classifier core: merged (#8).
- Phase 3 — planning seats (per round, pins) and obvious answers (confident
  and the recommended option; one automatic round when every question is
  settled).

## Phase 0 findings (spike)

Checked against pi 0.87 by running a throwaway extension in a real `pi --mode
rpc` process:

- **Path A works.** `pi.registerProvider("typesafe", { name, apiKey:
  "$TYPESAFE_API_KEY", baseUrl, models: [] })` is accepted (an empty model
  list passes validation, so nothing appears in `/model`). `/login` lists every
  provider with API-key auth, so `/login typesafe` → *Use an API key* stores
  `{ "type": "api_key", "key": "…" }` in `~/.pi/agent/auth.json` under pi's
  own lock.
- **Key resolution is pi's.** `ctx.modelRegistry.getApiKeyForProvider("typesafe")`
  returns the stored key first, then `$TYPESAFE_API_KEY`, and resolves `!command`
  and `$ENV` references inside a stored key. The env reference must be written
  `$TYPESAFE_API_KEY` (a bare name is taken literally).
  `getProviderAuthStatus` reports `stored` / `environment` / not configured
  without exposing the key. So bot-lobby writes no key file of its own (path B
  is not needed), and subagents, which load bot-lobby too, resolve the key the
  same way.
- **`PI_OFFLINE` does not block `fetch`.** It only skips model-catalog
  refresh and the package manager's network checks.
- **Not verified here:** a live `POST /v1/systemone`. This cloud
  environment's network policy blocks `api.typesafe.ai`, so the client is
  built to the shapes in `jev-code`'s client and tested against a fake API; a
  live check sits behind `BOT_LOBBY_JEV_E2E=1`.

## Goal

Spend fewer tokens and less wall-clock time on choices that do not need a
large model. A fast classifier (Jev) makes or suggests the obvious decisions:
which planning seats run, which files an agent should open, how big a task is,
which answer to an obvious question is right, and how much model a simple step
needs. A round limiter caps planning. Every classifier decision is visible,
reversible and optional, and anything that goes wrong falls back to today's
behaviour.

The rule stays: **LLMs make decisions; the engine enforces the rules.** Jev
output is either an automatic decision gated by a confidence threshold, or a
hint that an LLM may ignore. It never becomes a workflow rule.

## What Jev is (research summary)

- **TypeSafe AI's "System One" model.** It does not generate text. You send a
  `state` (the evidence to judge) and a map of typed questions; every question
  is answered in parallel in one call, each with calibrated probabilities.
- **Three question types:**
  - `noul` — yes/no; returns the probability of yes.
  - `choice` — one of 2–255 labelled options; returns the pick, a distribution
    and a confidence.
  - `score` — a position on ordered, described levels; returns a
    probability-weighted score and a confidence.
- **One endpoint:** `POST {base}/v1/systemone`, `Authorization: Bearer <key>`,
  body `{ model, state, questions }`, response `{ model, answers, usage }`.
  Hosts:
  - TypeSafe direct: `https://api.typesafe.ai`, key prefix `ts_`, model
    `jev-latest`.
  - OpenRouter: `https://openrouter.ai/api`, key prefix `sk-or-`.
  - Vercel AI Gateway: `https://ai-gateway.vercel.sh/typesafe`, key prefix
    `vck_`.
- **Limits:** about 32K tokens of context (~120K characters of request). Keep
  each item to about 4K characters.
- **Latency and cost:** latency is reported at 70–500 ms. Pricing reports
  conflict and could not be checked against a primary source from this
  environment, so bot-lobby records the `usage` tokens of every call in its
  metrics.
- **Proven patterns we reuse:**
  - **Rank:** one `noul` per candidate ("does this file help with the
    query?") plus an `any_relevant` check. This comes from the `jev-code`
    package, which already ships a Pi integration.
  - **Confidence-gated routing:** act automatically above a threshold,
    otherwise defer.
  - **Speculative fan-out:** ask every question that might matter in one call
    and ignore the branches you do not take.

Sources:

- [jev-code](https://github.com/FrancoisChastel/jev-code): its client,
  limits, host table and question-design guide were read in full.
- [LiteLLM TypeSafe pass-through](https://docs.litellm.ai/docs/pass_through/typesafe)
  and [Pydantic AI TypeSafe docs](https://pydantic.dev/docs/ai/models/typesafe/):
  seen only as search results, because this environment blocks them.
- [TypeSafe docs](https://docs.typesafe.ai/llms.txt): the source of truth,
  but unreachable from here. Phase 0 re-checks the API against them.

## Decisions

| Question | Decision |
| --- | --- |
| What Jev decides in v1 | Planning seats, file hints, task triage, effort routing, auto-answering obvious questions |
| How file hints reach agents | Both: injected into the prompt up front, plus a `find_relevant_files` tool |
| At the planning round limit | The oracle finalizes alone: no questions, open points decided with the recommended option under Assumptions, status READY |
| Default round limit | 5 (0 = unlimited) |
| Seat selection | Re-evaluated every round; pressing 1–4 pins a seat on or off for the session; the oracle always runs |
| Auto-answer | Only when Jev is ≥ 0.9 sure **and** its pick is the asker's recommended option |
| Effort routing | Lower thinking for simple steps and switch trivial steps to a cheaper model set in settings |
| API key | Stored with Pi's other keys in `~/.pi/agent/auth.json` |
| Classifier default | Off; switched on in `/bot-lobby settings` |

## Design

### 1. Classifier core — `src/classifier/`

- **`client.ts`**
  - A small `fetch` client for `POST /v1/systemone`: one request type, typed
    answers, and an injectable `fetch` for tests (like `ProcessRunner` today).
  - A hard timeout (default 4 s) and an `AbortSignal` wired to Esc and session
    shutdown.
  - One retry on 408/429/5xx/timeout, honouring `retry-after`, capped at 2 s.
  - **No new runtime dependency.** The official `@typesafe-ai/sdk` would add a
    dependency for a single POST; the repo keeps its dependency list short.
- **`limits.ts`**
  - Local truncation before sending: 4K characters per item and a request
    budget of ~110K characters.
  - Answers are validated; a malformed answer counts as "no answer".
- **`key.ts`** resolves the key and host in this order:
  1. The configured provider's entry in Pi's `auth.json`, read with Pi's
     exported `readStoredCredential(providerId)`: `typesafe`, `openrouter` or
     `vercel-ai-gateway`.
  2. The matching environment variable (`TYPESAFE_API_KEY` and the others).
     This mirrors Pi's own order.
  3. A masked hint (`ts_ab…cd`) for the settings UI. The key itself is never
     logged or written anywhere else.

  Subagents run as Pi processes against the same agent directory, so they read
  the key the same way. No key is passed through the environment.
- **`classifier.ts`** is the facade every feature calls.
  - `ask(purpose, state, questions)` returns the answers, or `undefined` on any
    failure. It never throws into the workflow.
  - A circuit breaker: after 3 failures in a row the classifier switches off
    for 10 minutes and shows a single warning.
  - Every call writes one activity-log line (source `CLASSIFIER`, with what
    was decided, the probabilities and the latency) and one metrics record
    (new kind `classifier`, with `purpose`, duration and input tokens).

### 2. Storing the key with Pi's keys

The key lives in `~/.pi/agent/auth.json` as
`"typesafe": { "type": "api_key", "key": "ts_…" }`, next to the other
providers.

- **Path A (preferred): let Pi store it.** Register a `typesafe` provider
  through `pi.registerProvider` so that `/login typesafe` → *Use an API key*
  saves it with Pi's own file locking, and `/logout` removes it. The phase 0
  spike checks whether Pi accepts a provider with no chat models. If Pi
  instead lists a "jev" model in `/model` (it cannot chat), use path B.
- **Path B: bot-lobby stores it.** `/bot-lobby settings` → *Classifier* →
  *API key* asks for the key (masked) and writes that one entry into
  `auth.json`:
  - under the same `proper-lockfile` lock Pi uses;
  - keeping every other entry;
  - with file mode 0600.

### 3. Planning round limiter

This works with or without the classifier.

- **Setting:** `lobby.maxPlanningRounds`, default `5`; `0` means unlimited.
  `PlanningSession.turns` already counts rounds.
- **Final round** (the round whose number equals the limit):
  - No seats run.
  - The oracle's closing instruction becomes: *"Final round (5 of 5): ask no
    questions. Decide every open point with its recommended option, list each
    under Assumptions, and set Status READY."*
  - The engine enforces it. In `finishRound`, any questions the oracle still
    wrote are dropped (logged as decided at the limit), and the plan is marked
    READY as long as a draft exists.
- **After the limit:** your replies and line comments still run a round, but
  it is oracle-only and in revise mode: it asks no questions and stays READY.
  `n` starts over and resets the count.
- **UI:**
  - The Plan tab shows `round 3/5`, and `final round` on the last one.
  - `/bot-lobby settings` → *Lobby* gets *Planning rounds*: 2, 3, 5, 8 or
    unlimited.

### 4. Planning: which seats run (every round, toggles pin)

- **Which seats are eligible.** `lobby.planningPanel` stays the eligible set.
  - Pressing 1–4 during a session now pins that seat on or off for the rest of
    the session (`PlanningSession.pins`).
  - Unpinned eligible seats are the classifier's call each round.
  - The oracle always runs.
  - With the classifier off or failing, every eligible seat runs, as today.
- **One Jev call before each round** (except the final round).
  - State: `{ idea, latest, draft, seats }`, where:
    - `idea` is the first message;
    - `latest` is the newest message, answers and line comments;
    - `draft` is the current plan, truncated;
    - `seats` holds each seat's last status and notes.
  - One `noul` per unpinned seat: *"Does `latest` (in round 1: `idea`) raise
    anything that <seat description from `MEMBER_SEATS`> must decide or check
    before the plan is buildable?"*
- **Thresholds.**
  - A seat runs at p ≥ `seatAt` (0.35). The threshold is deliberately
    inclusive: a missing seat risks a wrong plan, while an extra seat only
    costs one run.
  - A seat that was READY last round comes back only at p ≥ `reseatReadyAt`
    (0.6).
  - A round with no seats is valid: `panelSection` already handles
    "planning alone".
- **Visibility.**
  - The roster shows `sat out · 0.07` for skipped seats.
  - The activity log reads, for example: `CLASSIFIER seated DEV, QA · DESIGN
    sat out (0.07) · RESEARCH sat out (0.12) · 210 ms`.

### 5. Auto-answering obvious questions

The rule: auto-answer only at ≥ `autoAnswerAt` (0.9), only when the pick is
the recommended option, and only with a margin ≥ 0.5 over the runner-up.

- **Planning panel.** After the oracle picks a round's questions, one Jev
  call asks one `choice` per question over its options (label → description).
  - State: `{ conversation, draft, asked_by }`, truncated.
  - The recommended option is the one marked `(Recommended)`, otherwise the
    first option (the prompts already put it first).
  - An auto-answered question leaves the dialog. Its answer is recorded, for
    example `[QA] Which browsers must pass? → evergreen only (decided by the
    classifier, 0.94)`, shown in the conversation, and sent with your other
    answers. The oracle then lists it under Assumptions, and a comment on that
    line overrules it.
  - If every question is auto-answered, the next round starts on its own. It
    still counts toward the round limit.
- **Master `clarify`.** When the Master passes `options`:
  - One `choice` call runs over `{ request, task summary }`.
  - Above the threshold, the engine answers without asking you. It returns
    *"Answered by the classifier (0.93): …"* and records the decision.
  - Without options, the question is always asked, because Jev cannot answer
    free text.
  - In auto mode, where nobody is asked anyway, the tool returns the
    classifier's pick as a suggestion so the Master can skip reasoning it out.
  - `master.md` is updated: put your recommended option first and mark it
    `(Recommended)`.
- **Never auto-answered:** proposal approval (approve, amend or decline) and
  dependency, architecture or pushback approvals.

### 6. File hints (injected up front, plus a tool)

- **Index** — `src/classifier/file-index.ts`.
  - Files come from `git ls-files -co --exclude-standard`, falling back to a
    walk that skips `.git`, `node_modules`, `dist` and `build`.
  - Skipped: binaries, lockfiles, minified or generated files, files over
    256 KB, and anything matching `classifier.exclude`.
  - Each file gets an excerpt of at most 400 characters: the leading doc
    comment, imports, and exported, class, function and def signatures.
  - The index is cached in `.pi/bot-lobby/cache/files.json`, keyed by path,
    mtime and size, and refreshed incrementally with `stat` only.
- **Rank** — `rankFiles(query, { topK: 8, relevantAt: 0.5 })`.
  1. A lexical prefilter: query tokens matched in the path (weight 3) and the
     excerpt (weight 1), plus a boost for recently changed files. It keeps the
     top `maxCandidates` (480).
  2. Jev ranks the survivors in parallel batches of ≤ 240 candidates, with one
     `noul` per candidate plus `any_relevant` (the `jev-code` rank pattern).
     Each `noul` is an independent probability, so batches merge by sorting.
  3. The result is the top K at or above `relevantAt`. When `any_relevant`
     is below 0.3, the list is dropped rather than risk misleading the agent.
- **Injection.** A `Likely files` block goes into the run's context:
  - Where: scouts (`scoutContext`), workers (`workerWorkflowContext`), quick
    fixes (task message), and planning seats and the oracle (one ranking per
    round against the latest message).
  - What it says: *"Likely files (classifier hints, not facts): path — 0.94 …
    Open these first; search only for what they do not answer."*
  - Not added for the QA gate (it works from the diff) or the researcher.
  - Ranking waits at most `budgetMs` (1.5 s). If it is not done by then, the
    agent starts without hints.
- **Tool.** `find_relevant_files({ query, top_k? })` is registered in
  bot-lobby's own subagent extension, next to the file desk tools
  (`src/index.ts` → `registerClassifierTools`).
  - It exists only when the classifier is enabled and a key resolves.
  - It uses the same index cache.
  - Its name is added to the scout, worker, planner and quick fix tool lists.
    Pi ignores unknown names in `--tools`, so this is harmless when the tool is
    absent.
- **Prompts.** `scout.md`, `worker.md`, `panel.md` and `quickfix.md` gain one
  line: start from Likely files; call `find_relevant_files` before a broad
  `find`/`grep`.

### 7. Task triage (Master hints and quick fixes)

- **When.** One Jev call when a task is created, persisted as `task.triage` in
  `state.json` so a reload does not ask again. It re-runs after an amendment.
- **State:** `{ request, repo: top-level directories and packages, likely_files }`.
- **Questions**, all sent in one call:
  - `size` (`score`), four levels:
    - trivial: one small edit in one file;
    - small: a few files in one domain;
    - medium: several files or two domains;
    - large: a cross-domain feature, new subsystem or migration.
  - `domain_designer`, `domain_backend`, `domain_qa` (`noul`), using each
    domain's `scoutFocus` text.
  - `needs_research` (`noul`): does the request depend on outside facts such
    as library versions, third-party APIs or standards?
  - `ambiguous` (`noul`): would building the request as written probably
    produce the wrong thing?
  - `kind` (`choice`): feature, bugfix, refactor, tests, docs, chore or
    investigation.
- **Master context.** `describeTask` (`src/pi/events.ts:99`) gets a
  *Classifier triage (hints; you decide)* block, for example: `size small
  (0.91) · domains backend 0.95, qa 0.61, designer 0.04 · research not needed
  (0.06) · clear as written · kind bugfix · likely files … · suggested path:
  single-domain shortcut (skip scouts and the proposal ceremony)`.
- **`master.md`** gets a short *Classifier hints* section:
  - scout only domains ≥ 0.5;
  - skip scouting when the task is trivial or small and likely files exist;
  - skip research below 0.2;
  - clarify only when ambiguous ≥ 0.5.

  The engine does not enforce any of these.
- **Quick fixes.** On submit, one `size` score.
  - If the fix is scored large at confidence ≥ `quickFixLargeAt` (0.8), the job
    is **held** instead of started: `looks like a task (large, 0.86)`.
  - On the Quick fix tab, `r` runs it anyway and `t` starts it as a task in a
    new session.
  - This replaces spending a whole agent run just to learn "this is too big".

### 8. Effort routing (lower thinking, plus a cheaper model)

- **Which runs.**
  - Applies to: workers, scouts, quick fixes and planning seats.
  - Never applies to: the Master, the oracle, the QA gate or reviewer, or the
    researcher.
- **One `score` per run**, on the instruction. It rides in the same Jev call
  as that run's file ranking, so it adds no latency. The levels:
  - trivial: a mechanical edit or lookup, such as a rename, a copy change or
    a one-line fix;
  - simple: a small change that follows an existing pattern in one or two
    files;
  - moderate: new logic or several files, with some judgment;
  - complex: design decisions, cross-cutting changes, concurrency or
    security, or an unclear root cause.
- **What each level does.**
  - moderate or complex: the configured model and thinking, unchanged.
  - simple, confidence ≥ `simpleAt` (0.7): the same model with thinking one
    level lower, never below `low`.
  - trivial, confidence ≥ `trivialAt` (0.8): `classifier.effort.cheapModel`
    at `low` thinking, clamped to what that model supports (existing
    `checkThinking`). If no cheap model is set, thinking drops one level
    instead.
  - Scouts already run at `low` thinking, so for them only the model changes,
    and only on trivial runs.
- **Safety net.** A routed run is re-run once on the configured profile if it:
  - fails, stalls, times out or wraps up early; or
  - returns an unusable result (worker validation issues, or an unusable
    scout).

  The re-run counts as that run's retry. The QA gate is unchanged, so routed
  work is still reviewed at full strength.
- **Visibility.**
  - Receipts show the route: `✓ DEV worker · … · claude-haiku-4-5 (routed:
    trivial 0.88)`.
  - Metrics records gain `routedFrom`. The Metrics tab compares the success
    rate of routed and unrouted runs, which is how the thresholds get tuned.

### 9. Settings and configuration

`/bot-lobby settings` gets a **Classifier (Jev)** entry:

- Enabled: on or off.
- API key: its status (`found in Pi's auth.json · ts_ab…cd`, `found in
  TYPESAFE_API_KEY` or `missing`), plus the action to set it (section 2).
- Provider: typesafe, openrouter or vercel.
- Features: planning seats, auto-answer, file hints, task triage, effort
  routing.
- Cheaper model for trivial steps: the existing searchable model picker.
- Test connection: one tiny request, showing the model and latency.

**Lobby** gets *Planning rounds*. `/bot-lobby config` prints the classifier's
status and never the key. Thresholds are edited in the file only.

```json
{
  "lobby": { "maxPlanningRounds": 5 },
  "classifier": {
    "enabled": false,
    "provider": "typesafe",
    "model": "",
    "baseUrl": "",
    "timeoutMs": 4000,
    "features": { "seats": true, "autoAnswer": true, "fileHints": true, "triage": true, "effort": true },
    "thresholds": {
      "seatAt": 0.35,
      "reseatReadyAt": 0.6,
      "autoAnswerAt": 0.9,
      "fileRelevantAt": 0.5,
      "simpleAt": 0.7,
      "trivialAt": 0.8,
      "quickFixLargeAt": 0.8
    },
    "fileHints": { "topK": 8, "maxCandidates": 480, "budgetMs": 1500 },
    "effort": { "cheapModel": "inherit" },
    "exclude": []
  }
}
```

An empty `model` or `baseUrl` means the host's default. `resolveConfig`
normalizes the section like the others: unknown keys are dropped, thresholds
are clamped to 0–1, and a bad value falls back to its default.

### 10. Observability

- **Activity log:** one `CLASSIFIER` line per decision, with the
  probabilities and the latency.
- **Metrics tab:** a Classifier tile showing calls, p90 latency, seat runs
  skipped, questions auto-answered, runs routed down and their success rate,
  and an estimate of the seat runs saved (skipped seats × the average seat
  cost already in `metrics.jsonl`).

## Files

| File | Change |
| --- | --- |
| `src/classifier/client.ts`, `limits.ts`, `key.ts`, `classifier.ts` | new: client, limits, key resolution, facade and circuit breaker |
| `src/classifier/file-index.ts`, `rank.ts` | new: file index and cache, prefilter and batched ranking |
| `src/classifier/seats.ts`, `answers.ts`, `triage.ts`, `effort.ts` | new: the question builders and the decision policy per feature, as pure functions |
| `src/classifier/tools.ts` | new: `find_relevant_files` inside subagents |
| `src/schemas/configuration.ts` | `classifier` section, `lobby.maxPlanningRounds` |
| `src/schemas/task.ts` | `triage` on the task |
| `src/lobby/planner.ts` | round limit and final/revise modes, pins, seat selection, auto-answer, likely files per round |
| `src/lobby/view.ts`, `src/lobby/tabs/plan.ts` | round counter, `sat out` roster state, pins, auto-answered lines |
| `src/lobby/quickfix.ts`, `src/lobby/tabs/quickfix.ts` | size hold, `r` / `t`, likely files, routing |
| `src/master/master.ts` | likely files in scout and worker context, routing with a re-run on failure |
| `src/execution/agent-runner.ts` | route info on the run, fallback profile for the retry |
| `src/workflow/workflow.ts` | clarify auto-answer, triage at task creation |
| `src/pi/events.ts`, `src/pi/start-task.ts` | triage block in the Master context |
| `src/pi/settings-ui.ts`, `src/pi/commands.ts` | Classifier entry, Planning rounds, config output |
| `src/pi/run-summary.ts`, `src/state/metrics.ts`, `src/lobby/tabs/metrics.ts` | `classifier` metric kind, `routedFrom`, Classifier tile |
| `src/index.ts` | register the subagent classifier tool |
| `src/roles/scout.ts`, `worker.ts`, `src/lobby/planner.ts`, `quickfix.ts` | add `find_relevant_files` to the tool lists |
| `prompts/master.md`, `scout.md`, `worker.md`, `panel.md`, `planner.md`, `quickfix.md` | Likely files, classifier hints, final round, recommended option first |
| `README.md` | Classifier section, round limit, privacy note, settings |

## Order of work

Each phase ships on its own and passes `npm run typecheck` and `npm test`.

0. **Spike (short).**
   - Call the live API once with your key.
   - Check that `pi.registerProvider` gives `/login typesafe` (path A in
     section 2).
   - Confirm that `fetch` works inside a subagent under `PI_OFFLINE=1` (it
     should: that flag only skips catalog refresh and version checks).
   - This container's network policy blocks `api.typesafe.ai`, so either add
     that host to the environment's allowed domains or run this phase locally.
1. **Round limiter** and the config/settings scaffolding. This needs no Jev
   and cuts planning time on its own.
2. **Classifier core:**
   - client, key resolution and storage;
   - the settings entry and Test connection;
   - feed, metrics and circuit breaker.
3. **Planning:** seat selection with pins, and panel auto-answer.
4. **File hints:** index, ranking, injection and the `find_relevant_files`
   tool.
5. **Task triage:** Master hints, `clarify` auto-answer and the quick fix
   hold.
6. **Effort routing:** cheap model, thinking step-down, re-run on failure,
   receipts and metrics.
7. **Docs and polish:** the README, the Metrics tile, and a threshold review
   against real metrics.

## Testing

- **Unit tests** (`node:test`, no network), using a fake `fetch` that returns
  canned System One answers:
  - `test/classifier.test.ts`: client retries and timeouts, the circuit
    breaker, key resolution order and masking.
  - `test/planner-rounds.test.ts`: the limit, the final and revise rounds, and
    dropped questions.
  - `test/seats.test.ts`: thresholds, pins, the READY-seat re-entry rule, and
    the fallback to all seats.
  - `test/auto-answer.test.ts`: the confident-and-recommended rule, and that
    approvals are never auto-answered.
  - `test/file-index.test.ts`: excludes, the cache, the prefilter, and batch
    merging.
  - `test/triage.test.ts`, `test/effort.test.ts`: mapping, clamping, and the
    re-run on failure.
- **Existing tests keep passing with the classifier off.** That is the default
  and must reproduce today's behaviour exactly.
- **Live check** behind `BOT_LOBBY_JEV_E2E=1`, run where the key and the
  network are available, like the existing `BOT_LOBBY_E2E` tests.

## Risks and how they are handled

| Risk | Mitigation |
| --- | --- |
| A seat is skipped that had a real question | Inclusive threshold (0.35), READY seats can come back, pins, `sat out` visible with its probability, one key to re-seat |
| An auto-answer you would have chosen differently | Only ≥ 0.9 **and** matching the recommendation; always listed under Assumptions; a comment overrules it |
| A routed step gets a worse result | Re-run on the configured profile after any failure or unusable result; the QA gate is unchanged; metrics show the success rate of routed runs; the feature has its own switch |
| File hints point the wrong way | Framed as hints; dropped when `any_relevant` is low; agents keep `find`/`grep` |
| Added latency | 70–500 ms per call, a 4 s cap and a 1.5 s budget for hints; ranking and routing share one call; any failure falls back |
| **Privacy:** request text and ≤ 400-character file excerpts go to TypeSafe | Off by default; never whole files; gitignored files never indexed; `classifier.exclude` for sensitive paths; stated in the README |
| A young API (launched September 2026) that may change | Responses validated; the model can be pinned (`classifier.model`); failures fall back |
| Unverified pricing | Usage tokens recorded per call in metrics |

## Not in v1 (follow-ups)

- Rank knowledge sections with Jev instead of the keyword `selectKnowledge`.
- Route a lobby prompt with no task to a quick fix or a task automatically.
- A directory-level first stage for very large monorepos.
- Triage lobby comments (does this comment need a plan change?).
- Detect duplicate knowledge on `action=knowledge`.
