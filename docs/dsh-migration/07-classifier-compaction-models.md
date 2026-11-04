# 07. Classifier, compaction, models and effort (3 days)

## Goal

The three places where Bot Lobby talks to models directly, not through an agent, work on dsh: the classifier, compaction, and the model / effort pickers in Settings and the composer.

## Read first

- `src/classifier/instance.ts`, `src/classifier/models.ts` (uses `HostContext.models` from phase 02, row 6)
- `src/host/pi/auto-compaction.ts` (moved there in phase 02)
- `src/pi/model-settings.ts`, `src/pi/model-support.ts`, `src/lobby/service.ts` `models()` / `sessionModel()`
- dsh `packages/llm/llm/src/types.ts` (`GenerateOptions`, `StreamChunk`), `packages/llm/llm/src/index.ts` (`stream`)
- dsh `packages/compaction/compaction-basic/README.md` (config table), `docs/subsystems/compaction.md`

## Part A. Classifier model calls

Phase 02 gave `HostContext` an optional `models` with three methods. Implement them in `dsh/src/host/models.ts`:

| `HostModels` method | dsh |
|---|---|
| `getAvailable()` | the model catalog from `ctx.llm` (inspect `Service llm` for the list method; dsh-llm-pi-ai fills it from pi-ai catalogs). Map each to `{ provider, id, name, contextWindow, reasoning }` |
| `getApiKeyForProvider(provider)` | return `"dsh"` when dsh can call that provider (credentials are dsh's job), `undefined` otherwise. The classifier only checks that a key exists |
| `streamSimple(model, context, options)` | `ctx.llm.stream({ provider: model.provider, model: model.id, system: context.systemPrompt, messages: toRequestMessages(context.messages), maxTokens: options?.maxTokens, signal: options?.signal })` and adapt the chunks to the pi-ai event shape the classifier reads (read `src/classifier/instance.ts`: usually it only needs the final text and usage) |

Keep the adapter small: only the fields the classifier reads.

Test (`dsh/test/models.test.ts`): a fake `ctx.llm.stream` yielding `text-delta` and `usage` chunks gives the classifier the joined text and the usage.

## Part B. Compaction

On pi, `src/host/pi/auto-compaction.ts` compacts at the agent's "Compact at" token count and writes a Bot Lobby checkpoint summary, then `learn()`s from it into the knowledge base.

On dsh, use dsh's compaction (`dsh-compaction-basic`, already in the `bot-lobby` preset from phase 05) and add only what Bot Lobby needs on top:

1. **Turn off per agent.** Agents with auto-compaction off (`AUTO_COMPACT_ENV=0`, or the orchestrator's `master.autoCompact === false`) use a second preset `bot-lobby-nocompact`: a copy of `bot-lobby` without the compaction rows. Pick the preset in phase 05 step 4 and phase 06 step 4 from the setting.
2. **"Compact at" tokens.** `dsh-compaction-basic` triggers on a window ratio (`thresholdRatio`, default 0.8), not on tokens. For each agent with a `compactAt`, compute `thresholdRatio = clamp(compactAt / contextWindow, 0.1, 0.95)` from the agent's model. Because the ratio is per preset, not per agent, register the agent's own trigger instead: an `agent/pre-step` listener on `agent.ctx` that, when the session's token count passes `compactAt`, calls the compaction service for that agent, then returns `next()`. Find the service method and the token count with `cordis_inspect_query` (`Service compaction`, `Service tokenMeter` or the session projection that holds context tokens).
3. **Learn from summaries.** Listen to session event `compaction/summary` for Bot Lobby agents and call the same `learn(summary, ctx)` that `auto-compaction.ts` calls.
4. **Checkpoint wording.** dsh writes its own summary. Bot Lobby's `CHECKPOINT` text (requirements, decisions, files, failed approaches, next action) is better for workers. If `dsh-compaction-basic` lets you set the summary instructions (check its Config with `Config.listConfigs`), set them to `CHECKPOINT`. If not, accept dsh's summary for now and note it in `STATUS.md`.
5. `PiStreamEvent` `compaction` / `compaction_end` already come from phase 06's event table.

Test: a fake session that crosses `compactAt` triggers exactly one compaction call; `compaction/summary` calls `learn` once.

## Part C. Models and effort

1. `Host.setModel`, `getThinkingLevel`, `setThinkingLevel`, `thinkingLevels`, `clampThinking` are done in phase 05. Here, check that Settings → Agents shows dsh's models: `LobbyService.models()` reads `HostModels.getAvailable()`.
2. Effort levels: Bot Lobby's effort slider uses pi thinking levels (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, check `src/pi/model-support.ts`). dsh uses `ReasoningEffortId` values per model. Put one table in `dsh/src/host/thinking.ts` mapping each Bot Lobby level to the nearest dsh value the model supports, and back. Unknown → leave the model's default.
3. Model ids: pi writes `provider/model`. Keep that format in Bot Lobby's config. Split on the first `/` when building dsh `{ provider, model }`.

## Done when

- [ ] Tests pass; `npx tsc --noEmit -p dsh`; pi checks pass.
- [ ] With file hints on, a worker's `find_relevant_files` returns files (classifier works on dsh).
- [ ] An agent with "Compact at" set low (for example 20000) compacts during a long task, and a knowledge entry appears afterwards.
- [ ] Changing the Lobby model and effort in the composer changes the next reply's model (check the session's `assistant/message` model field).

Commit: `dsh port: phase 07 classifier, compaction, models`.
