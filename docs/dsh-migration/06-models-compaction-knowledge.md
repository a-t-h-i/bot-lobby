# 06. Models, effort, classifier, compaction, knowledge (3 days)

## Goal

The places where Bot Lobby talks to models directly, or reacts to context size, work on dsh: model and effort for each agent, the classifier, "Compact at", and knowledge learned from the orchestrator's summaries.

## Read first

- `src/classifier/models.ts` (`Registry`, `engineAnswer`, `engineClassifiers`, `splitRef`), `src/classifier/instance.ts` (`bindClassifier`), `src/classifier/hosts.ts` (`KeySource`, `KeyStatus`)
- `src/pi/auto-compaction.ts` (`CHECKPOINT`, `DIGEST_INSTRUCTION`, `learn`, `parseDigest`, `share`)
- `src/pi/model-settings.ts`, `src/pi/model-support.ts` (thinking levels, clamp)
- dsh `packages/llm/llm/src/types.ts`: `GenerateOptions`, `StreamChunk`, `LlmModelInfo`, `LlmResolvedModelInfo` (`context.contextWindow`, `reasoning.efforts`, `reasoning.defaultEffort`)
- dsh `packages/llm/llm/src/index.ts`: `stream`, `listProviders`, `listModels(provider)`, `resolveModelInfo(...)`
- dsh `packages/core/agent/src/runtime-types.ts`: `AgentOptions { provider, model, reasoningEffort, maxTokens }`
- dsh `packages/compaction/compaction-basic/README.md` (config table, "Compaction instruction"), `packages/compaction/command-compact/src/index.ts` (`ctx.compaction.compactNow(agent, signal, commandId)`)

## Step 1. Model refs and effort: `src/plugin/models.ts`

Bot Lobby's config keeps model refs as `provider/model`. Keep that format.

```ts
export function modelOptions(ref: string | undefined, thinking: string | undefined, info?: LlmResolvedModelInfo): AgentOptions
```

- Split `ref` on the first `/` (reuse `splitRef` from `src/classifier/models.ts`). No ref → `{}` (the preset's default model).
- Effort: map Bot Lobby levels to the model's own efforts. `info.reasoning.efforts` is ordered from least to most.

  | Bot Lobby level | dsh effort |
  |---|---|
  | `off` | first effort whose `id` or `name` is `none` / `off`; else leave unset |
  | `minimal`, `low` | first effort (index 0) |
  | `medium` | middle effort (`Math.floor((n - 1) / 2)`) |
  | `high` | second to last (or last when n ≤ 2) |
  | `xhigh` | last effort |
  | unset or unknown | leave unset (dsh uses `defaultEffort`) |

  If an effort's `id` equals the Bot Lobby level word, use it directly before the table.
- `levelsFor(info)` returns the Bot Lobby levels this model can take (for the Settings effort slider, phase 08): `off` only if a none/off effort exists; all others if `efforts.length > 0`; none if the model has no `reasoning`.
- Model info: `await ctx.llm.resolveModelInfo(...)` (check its parameters with inspect). Cache by ref for 60 seconds.

Use `modelOptions` in phase 05 step 5 (`agentOptions`) and for the orchestrator: when the user picks a model in Bot Lobby settings for the orchestrator, do **not** fight dsh's own model picker. The orchestrator uses whatever model the dsh session has. Only subagents get models from Bot Lobby's agent settings.

Model list for Settings: `listProviders()` then `listModels(provider)` for each, mapped to `{ ref: "provider/id", name, provider }`. Write it as `availableModels(ctx)` in the same file.

## Step 2. Classifier on `ctx.llm`

`src/classifier/models.ts` takes a pi `Registry` with `find`, `findOfType`, `classify`, `streamSimple`, `getAvailableOfType`. On dsh there are no "classifier type" models and no `classify` call, so only the chat model path stays.

1. Replace `Registry` with a small interface the engine owns:
   ```ts
   export interface ModelCaller {
     has(ref: string): Promise<boolean>;
     complete(ref: string, system: string, user: string, options: { maxTokens: number; signal?: AbortSignal; thinking?: string }): Promise<{ text: string; usage?: { input: number; output: number } }>;
   }
   ```
2. `engineAnswer(caller)`: drop the `findOfType("classifier")` / `classifyWith` branch. Keep the chat model branch (the JSON answer prompt and parser stay the same), calling `caller.complete`.
3. `engineClassifiers()` returns `[]` (no classifier type models on dsh). In Settings → Classifier, the "engine" picker lists chat models only.
4. The remote classifier (`systemOne` over HTTP in `client.ts`, `KeySource`) stays as it is. It does not use pi.
5. dsh implementation in `src/plugin/model-caller.ts`:
   ```ts
   complete: async (ref, system, user, o) => {
     const { provider, id } = splitRef(ref)!;
     let text = ""; let usage;
     for await (const chunk of ctx.llm.stream({ provider, model: id, system, maxTokens: o.maxTokens, signal: o.signal,
         reasoningEffort: effortFor(ref, o.thinking), purpose: "bot-lobby-classifier",
         messages: [userInput(user)] })) {
       if (chunk.type === "text-delta") text += chunk.text;
       if (chunk.type === "usage") usage = { input: chunk.usage.input, output: chunk.usage.output };
     }
     return { text, usage };
   }
   ```
   Check the user input message shape (`RequestMessage` with role user, identity-free) and the `purpose` field type with inspect; use `createRequestUserInput` or whatever helper `dsh-llm` exports for one-shot calls. Check the usage field names (`TokenUsage`).
6. `bindClassifier` today takes an `ExtensionAPI` and reads `ctx.modelRegistry`. Change it to take `{ cwd, root, caller, keys, notify }`. Call it from phase 03's `onAgent` for the orchestrator with `sessionInfo(agent)`, `caller` from step 5, `keys` returning a status that says "dsh handles model keys" (the classifier only checks that a key exists: return `{ ok: true }` when `has(ref)` is true).
7. Remove `isSubagentProcess()` checks from the classifier: there are no subagent processes. A subagent's tools get the classifier through `RunSettings` like other per-agent values.

## Step 3. Compaction

dsh's `dsh-compaction-basic` is in the `bot-lobby` and `bot-lobby-agent` presets (phase 03). `bot-lobby-agent-nocompact` has no compaction rows, so agents with auto compaction off never compact. Add on top:

### 3a. "Compact at" tokens

`dsh-compaction-basic` triggers on a window ratio for the whole preset. Bot Lobby sets a token count per agent. Register, in phase 03's `agent/created` hook, for each agent whose `RunSettings.compactAt` is a positive number:

```ts
agent.ctx.on("agent/pre-step", async (event, next) => {
  const used = await contextTokens(agent);          // see below
  if (used >= compactAt && !compacting) {
    compacting = true;
    try { await ctx.compaction.compactNow(agent, event.signal, undefined); } finally { compacting = false; }
  }
  return next();
});
```

- Check the hook shape (`agent/pre-step` is serial; check its arguments and whether it has a `signal`) and `compactNow`'s third parameter with inspect.
- `contextTokens(agent)`: the token count of the last request. Find it with inspect (`Service tokenMeter`, or the last `assistant/message` usage `input` value in the session). Use the cheapest reliable one; write which in `STATUS.md`.
- Do not compact twice in one step. If `compactNow` throws because a compaction already runs, ignore it.
- The orchestrator's "Compact at" (Settings → Agents → Orchestrator) uses the same code, read from Bot Lobby's master settings.

### 3b. Checkpoint wording

dsh's compaction instruction is fixed (README, "Compaction instruction"). Accept dsh's summary for all agents. Bot Lobby's `CHECKPOINT` text is not used any more. Write in `STATUS.md`: "Compaction summaries are dsh's; Bot Lobby CHECKPOINT dropped."

### 3c. Knowledge from the orchestrator's summaries

Today the orchestrator's checkpoint had a digest appended (`DIGEST_INSTRUCTION`), and `learn()` parsed it into knowledge entries. dsh's summary has no digest, so make it in a second call:

1. Listen for session event `compaction/summary` where the session is an orchestrator session (from phase 03's agent registry).
2. Call `caller.complete(model, DIGEST_SYSTEM, summaryText, { maxTokens: 2000 })`, where `DIGEST_SYSTEM` is `DIGEST_INSTRUCTION` reworded as "From this conversation summary, list the facts worth keeping ..." (keep the output format `parseDigest` reads). `model` is the classifier model if one is set, else the orchestrator's model.
3. `parseDigest(text)` → `share(items, ...)` → `notify("Knowledge updated: ...")`, exactly as `learn()` does.
4. Errors: `notify(..., "warning")` and go on. Never block the agent.

Move `parseDigest`, `share` and `DIGEST_INSTRUCTION` out of `src/pi/auto-compaction.ts` into `src/knowledge/digest.ts` (no pi imports) so phase 09 can delete the pi file. `src/plugin/knowledge.ts` holds the listener.

### 3d. Events

`compaction/start` / `compaction/end` already map to `compaction` / `compaction_end` in phase 05's event table.

## Step 4. Usage cost

Phase 05 sums usage per run. For cost, check whether dsh has a price table (inspect `Service tokenMeter` and `LlmProviderInfo`). If yes, use it. If not, report `cost: 0` and hide cost in the UI (phase 08). Note which in `STATUS.md`.

## Tests

- `test/plugin-models.test.ts`: `modelOptions` splits refs; effort table for models with 1, 2, 3, 5 efforts and with none; `levelsFor`.
- `test/classifier-caller.test.ts`: a fake `ModelCaller` gives `engineAnswer` the joined text; the existing classifier tests pass with a fake caller instead of a fake registry (change only the fake, not the assertions).
- `test/plugin-compaction.test.ts`: a fake agent crossing `compactAt` calls `compactNow` once per crossing; below it, never; a `compaction/summary` for an orchestrator calls the digest once and `share` with the parsed items; for a worker, not at all.

## Done when

- [ ] Typecheck, build, tests pass.
- [ ] A worker set to a model and effort in Bot Lobby settings runs on that model (check the child session's `assistant/message` model).
- [ ] With file hints on, a worker's `find_relevant_files` returns files (classifier works).
- [ ] A worker with "Compact at" 20000 compacts during a long task and keeps working.
- [ ] After the orchestrator compacts, a knowledge entry appears.

Commit: `dsh port: phase 06 models, compaction, knowledge`.
