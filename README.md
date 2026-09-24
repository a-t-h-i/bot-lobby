# Dev-House

A Pi-native TypeScript extension that turns Pi into a structured multi-agent
software engineering orchestrator.

Invoke with `/dev-house`. The system coordinates one Master plus three domain
agents (Designer+Frontend, Backend, QA), each with Scout, Worker, and Reviewer
roles. The Master makes decisions; the orchestration engine enforces the
workflow rules, state transitions, and domain boundaries.

## Install

Project-local (auto-discovered, hot-reloadable):

```bash
mkdir -p .pi/extensions/dev-house
cp -r . .pi/extensions/dev-house/   # or symlink index.ts into a subdirectory
```

Or global: `~/.pi/agent/extensions/dev-house/`.

## Usage

```
/dev-house <task description>   Start a feature request through the workflow
/dev-house status               Show the active task and its state
/dev-house tasks                List tasks
/dev-house cancel [taskId]      Abandon a task
/dev-house approve|amend|decline Approve / amend / decline the current proposal
/dev-house knowledge            Show persistent knowledge state
/dev-house config               Show the effective configuration
```

## Workflow

```
REQUEST → CLARIFY → (CHALLENGE) → SCOUT → SYNTHESIS → PROPOSAL
  → APPROVE/AMEND/DECLINE → PLAN → WORK → REVIEW → (ITERATE)
  → QA GATE → COMPLETE → KNOWLEDGE UPDATE → CLEANUP
```

The Master (the main Pi agent) drives each step by calling the `orchestrate`
tool. The engine enforces the task state machine, role tool restrictions,
approval gates, and completion authority.

## Architecture

```
src/
  index.ts              Extension entry point
  master/               Master decisions and synthesis
  agents/               Domain definitions (designer, backend, qa)
  roles/                Scout / Worker / Reviewer definitions
  workflow/             State machine, transitions, approvals
  execution/            Subagent runner (spawns isolated `pi` processes)
  knowledge/            Persistent knowledge store, selection, compaction
  prompts/              Prompt compiler and loader
  state/                Task state and persistence
  schemas/              Shared types and configuration schema
  pi/                   Commands, events, and UI integration
prompts/                Composable prompt layers (global, master, domain, role)
```

## Configuration

`.pi/dev-house/config.json` (project root) overrides defaults. See
`src/schemas/configuration.ts` for the full schema and defaults.

## Development

```bash
npm install
npm run typecheck
npm test
```

Tests use Node's built-in test runner; no extra test framework is added.

## Security model

- Scouts run with read-only tools (read/grep/find/ls).
- Reviewers run read-only plus bash (to run tests); they never commit.
- Workers get full tools but run sequentially, never in parallel on shared
  files; domain boundaries are prompt-enforced and coordinated by the Master.
- New dependencies and significant architecture changes require Master
  approval.
- Only the Master can declare completion.
