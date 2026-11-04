# 04. Workers, planner, classifier, knowledge: harnesses only

Goal: everything that ran a pi process or made a pi model call now runs on an installed harness.

## Read first

- `src/execution/pi-runner.ts` (`runPiAgent`, `spawnPiProcess`, the assigned-execution refusal for harnesses near line 687), `src/execution/agent-runner.ts`, `src/execution/delegation.ts`, `src/execution/assigned-session.ts`.
- `src/lobby/planner.ts`, `src/lobby/sessions.ts` (background sessions launch pi), `src/lobby/chat-agents.ts`.
- `src/classifier/*`, `src/pi/model-settings.ts`, `src/pi/model-support.ts`, `src/pi/auto-compaction.ts`, `src/knowledge/*` (digest calls), `src/pi/task-title.ts`.
- `src/schemas/configuration.ts` (per-agent `harness`, `model`, `effort`).

## Step 1. Workers (Dev, QA, Design, Research, scouts, reviewers)

- `runPiAgent` already routes to `runHarnessAgent` when `profile.harness` is set. Make the harness **required**: an agent without one gets the Orchestrator's harness (phase 03 step 4). Delete the pi branch in phase 05.
- Give workers Bot Lobby's worker tools over MCP (phase 03 step 1) with their role's allowlist (today ACP passes `mcpServers: []` and Claude uses `--strict-mcp-config` with nothing). Which tools workers get today: the pi tool lists in `src/agents/*` and `src/roles`.
- **Assigned execution** (structured assignments with a sanitized conversation and a tool inventory attestation) is refused on harnesses today. Options, pick with the owner (write the choice in `STATUS.md`):
  1. Allow it on harnesses with a weaker guarantee: the daemon writes the sanitized conversation into the prompt and checks tool use from the harness's stream instead of an attested inventory.
  2. Drop assigned execution and use plain delegation.
  Recommended: 1, because the workflow relies on it.
- Background sessions (`src/lobby/sessions.ts`): each is a second `OrchestratorSession` (phase 03) with its own harness session, not a pi process.

## Step 2. Planning panel

`src/lobby/planner.ts` seats run as worker runs on their seat's harness (the panel already allows mixing). The planner's own turn (the oracle that writes the draft) runs on the Orchestrator's harness.

## Step 3. One-shot model calls (`Host.complete`)

Used by the classifier, task titles, knowledge digest, synthesis. Implement in `DaemonHost` as a harness run with no tools, no session, JSON output when asked:

- Claude: SDK `query` with `allowedTools: []`, `maxTurns: 1`, a small model (the cheapest in `harnessModels`).
- Codex: `codex exec --json` with tools off and a small model.
- ACP: a throwaway session.

A harness start costs seconds, which is slow for the classifier on every Lobby message. So:

- **Classifier**: keep the remote classifier option (already in Settings → Classifier). Add a fast local fallback: the rule-based routing the classifier falls back to today when no model answers (find it in `src/classifier`). Use the harness one-shot only when the person picks it.
- **Titles, digest, synthesis**: harness one-shot is fine (not on the typing path).

## Step 4. Models and effort

- pi's model registry goes. Models per agent come from `harnessModels(id, settings)` (catalog plus the installed harness's own list, e.g. Codex `model-manifest.json`, ACP session options).
- Effort maps through `harnessEffort` (exists).
- API keys: none in Bot Lobby. Each harness uses its own sign-in. Settings → Harnesses shows sign-in state.

## Step 5. Web tools

`src/web/tools.ts` (`web_search`, `fetch_content`, which block private addresses) stay Bot Lobby tools served over MCP. Turn the harness's own web fetch off where the role's access says `web: false`, so private-address blocking is not bypassed.

## Done when

- A full task (plan → Dev → QA → review → deliver) runs on Claude Code only; then on Codex only; then mixed (Dev on Codex, QA on Claude Code).
- The planning panel runs a round with two different harnesses.
- Classifier works with the remote classifier and with the rule fallback.
- `npm run typecheck`, `npm test` pass.
