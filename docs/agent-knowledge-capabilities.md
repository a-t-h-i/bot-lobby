# Agent capability comparison: native Pi, existing harness, actual gaps

Status: Step 1 of the *Faster Agents Through Shared Knowledge* plan (capability
verification). Evidence was collected against the installed packages and this
repository on 2026-10-23; each claim names its source. Claims about upstream
behavior are limited to what Pi's shipped docs and exported surface actually
state.

## Verified stable version

| Check | Result | Source |
|---|---|---|
| Latest stable `@earendil-works/pi-coding-agent` on npm at verification time | `1.4.0` | `npm view @earendil-works/pi-coding-agent version` (2026-10-23) |
| Version installed in this repository | `1.4.0` for `pi-ai`, `pi-agent-core`, `pi-codemode`, `pi-coding-agent`, `pi-mcp`, `pi-tui`, `pi-telemetry` | `node_modules/@earendil-works/*/package.json` (re-read 2026-10-23 during recovery) |
| Pi's own runtime version export | `VERSION === "1.4.0"`, `CONFIG_DIR_NAME === ".pi"` | runtime import of `@earendil-works/pi-coding-agent` |
| Manifest peer range | `>=1.4.0 <1.5.0` for `pi-ai`, `pi-coding-agent`, `pi-tui` | `package.json` (devDependencies pinned at `1.4.0`) |
| Compatibility test | `test/pi-compat.test.ts` asserts the peer range, resolves the installed version the way the extension loader does, and checks the exports the harness builds on | `test/pi-compat.test.ts` |

## Capability comparison

Legend: **Pi** = already provided by Pi 1.4.0 · **Harness** = already provided by
this harness · **Gap** = actual gap this plan must implement.

### Prompt assembly and cache stability

| Capability | Where | Class |
|---|---|---|
| System prompt assembly from base instructions plus discovered context files; extensions can add instructions or transform context | Pi docs `how-pi-works.md` ("Context") | **Pi** |
| Read-only effective system prompt (`session.systemPrompt`) and tool-set change announcements before the next request | Pi docs `sdk.md` ("Session lifecycle") | **Pi** |
| Explicit system-prompt replacement per request (`request.systemPrompt` override before `compilePrompt`) | `src/execution/agent-runner.ts:47,176` | **Harness** |
| Layered prompt compiler (global → domain → role → task → knowledge → standards → decisions → scripts → workflow → output contract) | `src/prompts/compiler.ts:33-46` | **Harness** |
| Known ordering defect: the output contract is emitted after dynamic task and knowledge context, so changing task text shifts the contract byte position and defeats prefix reuse | `src/prompts/compiler.ts:33-46`; knowledge.md note | **Gap** (Step 2: move invariant instructions first, keep task text/timestamps/repo maps outside the prefix) |
| Duplicated brief-following / repository-discovery instructions across `prompts/global.md` and `prompts/worker.md` | `prompts/global.md`, `prompts/worker.md` | **Gap** (Step 2 deduplication) |
| Prompt-cache-aware provider configuration: `PI_CACHE_RETENTION=long`, per-provider `promptCache.short/long` warming, extension `cache_warming_decision` hook; summarization requests disable prompt-cache writes | Pi docs `environment-variables.md:88`, `custom-provider.md:147`, `extensions.md:212-234`, `compaction.md:23` | **Pi** (plan treats measured cache reuse as an outcome to validate, not a guarantee) |
| Prompt templates as file-backed `/` commands (disabled in harness child runs) | Pi docs `prompt-templates.md`; `src/execution/pi-runner.ts:326` passes `--no-prompt-templates` | **Pi** (harness deliberately opts out; harness compiles its own layered prompt) |

### Tool definitions

| Capability | Where | Class |
|---|---|---|
| Built-in coding tools and read-only variants: `createCodingTools`, `createReadOnlyTools`, `defineTool`, per-tool factories | runtime exports of `@earendil-works/pi-coding-agent` | **Pi** |
| Tool-set selection per session (`tools`, `noTools`, `excludeTools`, `customTools`) | Pi docs `sdk.md` ("Configuring a session") | **Pi** |
| Deterministic, typed board tools (`post_board`, `read_board`) registered as harness tools with role subscriptions and pushed kinds | `src/desk/board.ts:15-58` (`POST_KINDS`, `BOARD_TOOLS`, `SUBSCRIPTIONS`, `PUSHED_KINDS`, `BOARD_ENV`) | **Harness** |
| Codemode, tool_search and MCP as built-in replaceable extensions (SDK sessions must add them explicitly) | Pi docs `sdk.md` ("Codemode and MCP"); runtime exports `createCodemodeExtension`, `createToolSearchExtension`, `createMcpExtension` | **Pi** |
| Child permission policies per agent (`tools`, `mcpTools`, `readOnly`, `depth` via `AGENT_ENV`) with depth-2 restriction and five-child quota | `src/execution/delegation.ts:21,40-49,101-102` | **Harness** |

### Sessions, compaction, continuity

| Capability | Where | Class |
|---|---|---|
| Tree-structured JSONL sessions with branches, forking, cloning, resume | Pi docs `sessions.md`, `session-format.md` | **Pi** |
| Ephemeral runs (`--no-session`) — used for every harness child run, so worker transcripts are not persisted by Pi | Pi docs `sessions.md`; `src/execution/pi-runner.ts:326` | **Pi** (harness relies on its own ledger instead) |
| Auto-compaction at `contextTokens > window − reserveTokens` (default reserve 16384), cut-point rules, overflow recovery, extension hooks `session_before_compact` / `session_before_tree` | Pi docs `compaction.md`; runtime exports `compact`, `findCutPoint`, `estimateTokens`, `DEFAULT_COMPACTION_SETTINGS` | **Pi** |
| Harness compaction scheduling below Pi's threshold, with checkpoint instruction and `keepRecentTokens` clamping | `src/pi/auto-compaction.ts:8,45-84` | **Harness** |
| Window recovery records (`writeWindow`, `stoppedWindows`) so the next pi process can carry on after a restart/crash | `src/state/recovery.ts` | **Harness** |
| Change ledger recording every file each reply/run touched (basis for source-change invalidation) | `src/state/changes.ts` (`appendChange`, `ChangeRecord`) | **Harness** |

### Output handling

| Capability | Where | Class |
|---|---|---|
| Streaming event model: `message_end` carries the authoritative completed message; `agent_end` does not imply the run is finished; `agent_settled` does | Pi docs `sdk.md` ("Subscribing to events") | **Pi** |
| RPC mode (JSONL on stdin/stdout) — the transport the harness drives children with | Pi docs `rpc.md`; `src/execution/pi-runner.ts:326` (`--mode rpc`) | **Pi** |
| JSON stream collection that retains assistant `message_end` lines instead of buffering full tool transcripts (protects reports from output limits) | `src/execution/pi-runner.ts` (knowledge.md: "JSON stream collection retains assistant message_end lines"); decision record | **Harness** |

### Knowledge sharing (glossary / board / bookmarks)

| Capability | Where | Class |
|---|---|---|
| Bounded repository map (file ranking, layout line, char/time budgets) replacing first-turn discovery | `src/knowledge/repo-map.ts:26-28,142-155` | **Harness** |
| Scout file notes with source content hashes; notes are valid only while the hash matches | `src/knowledge/file-notes.ts:62-99` | **Harness** |
| Oracle compaction digest: parse "Knowledge to share" from summaries and write it into per-agent knowledge stores | `src/knowledge/oracle-digest.ts:11-63` | **Harness** |
| Classifier knowledge injection: per-slice 4000-char budget, relevance-ranked section selection per file | `src/classifier/knowledge.ts:22,139-145` | **Harness** |
| Typed task board with per-role subscriptions and push of `contract`/`blocker` posts | `src/desk/board.ts` | **Harness** |
| Searchable cross-role glossary/index of all recorded knowledge (book-index model: pointers with locations instead of full-file dumps) | — | **Gap** (Step 3) |
| Task-specific bookmarks delivered to each agent/child, managed by classifier and oracle, with stale-reference semantics and permission revalidation | — | **Gap** (Step 4) |
| Passage identity that survives unrelated insertions, duplicate-heading disambiguation, and atomic concurrent catalogue updates | — | **Gap** (Steps 3-4; the change ledger and file-note hashing are the foundations to build on) |

## Summary of actual gaps

1. Prompt prefix stability (Step 2): invariant-first ordering in
   `src/prompts/compiler.ts:33-46` (the output contract is the last layer,
   `spec?.contract ?? ""`, after dynamic task/knowledge text), deduplication
   across `prompts/global.md` and `prompts/worker.md` (both carry
   brief-following and repository-discovery instructions).
2. Shared glossary index (Step 3) derived from existing knowledge files.
3. Classifier/oracle bookmark delivery with identity, freshness and access
   rules (Step 4).

The claim that "everything beyond Steps 2–4 is already supplied" is **not**
supported and is retracted. What is verified is the narrower statement: for the
prompt/tool/session/output capabilities compared above, Pi 1.4.0 and the
existing harness mechanisms cover the Step-1 comparison scope. Beyond that,
plan Steps 5–6 depend on four capability areas that have **foundations here but
no implementation**; the foundations must not be read as guarantees:

- **Targeted durable board delivery.** `src/desk/board.ts:55` pushes only
  `contract`/`blocker` posts (`PUSHED_KINDS`); there is no durable
  per-recipient delivery state, no stable event IDs or replay cursors, no
  dedup across retries/restarts, and no distinction between delivered and
  handled. Roles poll subscriptions (`board.ts:46-52`); that is the entire
  delivery mechanism.
- **Safe contention on board writes.** `src/desk/board.ts:109-147` waits
  `LOCK_WAIT_MS = 2000` for another writer's lock and then appends anyway
  (comment at line 121: "past the wait the post goes in anyway rather than
  being lost"). Under contention this can interleave appends and duplicate or
  reorder sequence allocation; it needs validation and hardening, not
  assumption.
- **Context reconciliation on restart/compaction.** `src/state/recovery.ts`
  persists window records (`writeWindow`, `stoppedWindows`) and the change
  ledger (`src/state/changes.ts`) records file edits, but nothing reconciles an
  assignment checkpoint against current files, permissions, assignments, and
  live ownership after restart or compaction.
- **Bounded artifact access.** Pi's own bash tool saves truncated full output
  to unscoped temp files, and `src/execution/pi-runner.ts:652` uses `mkdtemp`
  for prompt scaffolding, but the harness has no task-scoped, permission-checked
  durable artifact reference with bounded reads and retention through restart
  and final verification (grep for an artifact store across `src/` returns
  nothing).

Feature names are not guarantees: Pi's "sessions"/"compaction" facilities
provide transcript persistence and summarization, not assignment checkpoints;
the board's typed posts provide typed logging, not targeted delivery.

## Provenance of the modified files (read-only, recovery 2026-10-23)

- `git status` at recovery time: `package.json`, `package-lock.json`,
  `test/package.test.ts` modified; `docs/agent-knowledge-capabilities.md` and
  `test/pi-compat.test.ts` untracked. Task baseline (task `state.json`,
  `baseline.head`) is `7714e33`, so all five are Step-1 working-tree changes.
- `package.json` and `package-lock.json` were changed during backend run
  `1827be93` (15:34:14–15:56:14Z), whose instruction explicitly authorized
  "Update existing Pi peer compatibility and existing dev dependency
  pins/lockfile". File mtimes: `package.json` 15:36, `package-lock.json` 15:38.
- The lockfile diff (49 insertions, 35 deletions) touches only
  `@earendil-works/*` entries: versions 1.3.0 → 1.4.0 with registry.npmjs.org
  `resolved` URLs and updated `integrity` hashes. No other package changed.
- The exact generating command is **not directly on record**: npm prunes its
  debug logs to the newest ten (`/root/.npm/_logs/` holds only 15:58 onward,
  and even the 15:57 log disappeared during recovery), so the install log from
  15:36–15:38 no longer exists. The command was `npm install` executed after
  editing `package.json` pins (inference from the diff shape and the run
  window); treat that attribution as inferred, not logged.
- The engine labels the lockfile change unattributed; per the recovery
  constraints it is counted for provenance only and remains unauthorized.

## Prior stall diagnosis

All four prior backend Step-1 runs (`runLog` in
`.pi/bot-lobby/tasks/Task-Faster-Agents-Through-Shared-23-10-2026/state.json`;
runIds `1827be93`, `826d79b6`, `2c927d50`, `3b5a81e8`) ended `status:
"timeout"` with `stalled: no output for 5m while running …`.

- The engine's watchdog kills an agent run after 5 minutes without visible
  output. `npm run typecheck` on this repository runs `tsc` over ~200 files
  silently for **10–11 minutes** per invocation: npm debug logs show
  `run typecheck` starting 16:01:05 / 16:33:33 / 17:08:52 and the log's last
  write 16:12:04 / 16:44:44 / 17:19:22 respectively — each long enough to
  trip the watchdog before the agent could report.
- Despite the stalls, all three typecheck invocations completed with
  **exit 0** (`verbose exit 0` / `info ok` in the npm debug logs), so the
  typecheck itself passes; the failures were run supervision, not code.
- Full `npm test` was attempted in the first run and stalled the same way; no
  complete full-suite result is on record and none is claimed.

## Verification performed in this step

- `timeout -k 3s 30s node --test test/package.test.ts test/pi-compat.test.ts`
  — **exit 0**, 6/6 tests pass, 13.3 s (recovery run, 2026-10-23). This is the
  concrete focused-test evidence the earlier runs failed to capture.
- `npm view @earendil-works/pi-coding-agent version` — `1.4.0` (exit 0),
  matching the installed version; re-verified during recovery.
- Pi doc citations re-checked against the installed docs tree at
  `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/docs/`:
  `PI_CACHE_RETENTION` (`environment-variables.md` ~line 88),
  `promptCache.short/long` (`custom-provider.md` ~line 147),
  `cache_warming_decision` (`extensions.md` ~lines 212-234), and
  "Summarization requests disable prompt-cache writes" (`compaction.md` ~line
  23) all appear as cited.
- Typecheck: three prior invocations exited 0 (npm debug logs above); the
  command itself was **not** re-run in this recovery per its constraints. Full
  `npm test` was not run in this recovery; no complete prior full-suite result
  is on record, so whole-suite verification remains **unverified**.
- Unresolved verification carried forward: whole `npm test` suite, live
  prompt-cache reuse measurement (Steps 2/10), and the Steps 5–6 capabilities
  listed as gaps above (not verifiable until implemented).
