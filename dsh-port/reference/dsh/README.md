# Vendored DSH documentation

A snapshot of DeepSeek Harness's own documentation, taken from the published npm packages at **0.2.0-rc.2** on 2026-09-30, so the swarm can read it offline and grep it. The installed DSH is always the authority: DSH is pre-release, and these files will go stale (R-18).

## Licence

Every file here comes from a package licensed MIT:
- **DSH packages:** © 2026 DeepSeek; see [LICENSE](LICENSE).
- **`@deepseek-ai/cordis`:** © 2021-present Shigma; see [LICENSE-cordis](LICENSE-cordis).

Keep these notices with any copy.

**Nothing here was edited.** Links inside the READMEs point into the DSH monorepo (`github.com/deepseek-ai/deepseek-harness`) and do not resolve in this folder.

## Skills: DSH's own guidance for plugin authors

These ship in `@deepseek-ai/dsh-agent-preset` (`skills/`) and are what DSH's agents read when asked to build a plugin.

| Path | What it is |
| --- | --- |
| ★ [skills/cordis-plugin-development/SKILL.md](skills/cordis-plugin-development/SKILL.md) | How to build, install and verify a Harness plugin; where to find API truth (`cordis_inspect_query`) |
| ★ […/references/practices.md](skills/cordis-plugin-development/references/practices.md) | **The rules**: the session log as truth, effects, the weakest mechanism, stability, performance, UI |
| ★ […/references/host-plugin.md](skills/cordis-plugin-development/references/host-plugin.md) | Bundle manifest, display metadata and icon, export forms, install/enable semantics |
| ★ […/references/ui-plugin.md](skills/cordis-plugin-development/references/ui-plugin.md) | Client manifest, module loader, slot registration |
| ★ […/references/user-actions.md](skills/cordis-plugin-development/references/user-actions.md) | One operation shared by a UI action and an agent tool |
| […/references/verification.md](skills/cordis-plugin-development/references/verification.md) | Verifying without browser control |
| […/references/mcp-bundle.md](skills/cordis-plugin-development/references/mcp-bundle.md) | Connecting an MCP server through a bundle |
| […/templates/decoration/](skills/cordis-plugin-development/templates/decoration) | DSH's minimal UI-plugin template (four files) |
| […/templates/mcp/](skills/cordis-plugin-development/templates/mcp) | DSH's MCP bundle template |
| ★ [skills/cordis-composition-reference/references/packages.md](skills/cordis-composition-reference/references/packages.md) | Every loadable DSH package, one line each, grouped by area |
| [skills/cordis-composition-reference/SKILL.md](skills/cordis-composition-reference/SKILL.md) | The Loader patch dialect |
| [skills/editing-cordis-compositions/SKILL.md](skills/editing-cordis-compositions/SKILL.md) | Editing profile compositions and agent presets |
| [skills/agent-experience/SKILL.md](skills/agent-experience/SKILL.md) | How DSH judges what the model experiences |

## Package READMEs

★ marks the ones the port relies on; read those first. Descriptions are each README's own summary.

| README | Summary |
| --- | --- |
| ★ [`cordis`](packages/cordis.md) | The Cordis plugin framework DSH is built on (published by DSH as `@deepseek-ai/cordis`): contexts, services, `inject`, effects, config schemas, loader. |
| [`dsh-agent-instructions`](packages/dsh-agent-instructions.md) | Workspace-instruction context for users and maintainers enabling, sizing, or debugging AGENTS.md/CLAUDE.md loading and refresh. |
| [`dsh-agent-loop`](packages/dsh-agent-loop.md) | The default agent driver for users and maintainers choosing, configuring, or debugging how agents are created and how turns and steps run. |
| [`dsh-agent-preset-registry`](packages/dsh-agent-preset-registry.md) | Choose an Agent’s tools, prompt sections and skills through declarative presets. One process can run several compositions. Failed definitions remain visible, while exis |
| [`dsh-agent-preset`](packages/dsh-agent-preset.md) | Define an Agent’s child plugins in ordinary Cordis YAML. Declare several presets and let sessions select one. Definitions load eagerly, and edits affect subsequently cr |
| ★ [`dsh-agent`](packages/dsh-agent.md) | The Agent handle, live registry, process-local initiator scope, and agent/* event vocabulary for plugins, UI, and orchestrators building or extending agents. |
| [`dsh-api-gateway`](packages/dsh-api-gateway.md) | Typed Client-to-Host calls and streams: dispatch, validation, cancellation, reconnection, and forwarded Host events. |
| [`dsh-api-remotes`](packages/dsh-api-remotes.md) | Application Remote assembly: selects typed Host capabilities and forwarded events for Client consumers. |
| [`dsh-base`](packages/dsh-base.md) | The shared dsh core: model access, tools, durable sessions, and safety defaults for every dsh --profile surface, for users composing or customizing a profile. |
| ★ [`dsh-client-connection`](packages/dsh-client-connection.md) | Browser-host wire layer for the web GUI: Remote RPC, event-stream delivery with reconnect, exact Fetch routes, the /api HTTP bridge, and the browser-trust fence. |
| ★ [`dsh-client-locale`](packages/dsh-client-locale.md) | Localization for the web GUI: the zh/en preference, browser-derived fallback, typed namespace dictionaries, and the framework translation seat, for users and plugin autho |
| ★ [`dsh-client-runtime`](packages/dsh-client-runtime.md) | Client boot and React-free services: the slot registry, the session runtime (sessions, event window, history paging, projections) and the workspace runtime. |
| [`dsh-client-store`](packages/dsh-client-store.md) | Observable browser state stores with explicit snapshots, subscriptions, and lifecycle ownership. |
| [`dsh-client-ui-commands`](packages/dsh-client-ui-commands.md) | Client command API for the Web GUI: the / command source, three dispatch kinds, the per-session command directory, and popupSelect and action registration for business pa |
| ★ [`dsh-client-ui-conversation`](packages/dsh-client-ui-conversation.md) | Target-neutral conversation assembly and browser shell: event and view registries, per-session bindings, input state, slots, and temporary composer takeovers. |
| ★ [`dsh-client-ui-layout`](packages/dsh-client-ui-layout.md) | Shell layout for the Web GUI: the three-column AppFrame whose right column is a track for an edge-anchored panel, the panel-geometry service, and theme presentation; for  |
| [`dsh-client-ui-plan`](packages/dsh-client-ui-plan.md) | Plan-mode status chip for the Web GUI: the composer control that shows plan mode is on and turns it off; for users and maintainers of plan mode. |
| [`dsh-client-ui-plugin-manager`](packages/dsh-client-ui-plugin-manager.md) | Manage the profile's plugin bundles, their rows, and the plugins' configuration from the Web sidebar. |
| [`dsh-client-ui-renderer`](packages/dsh-client-ui-renderer.md) | Browser UI renderer: React bindings for ordinary Slots and reusable Component Factories, ctx.uiRenderer, and the assembled dsh web application root. |
| [`dsh-client-ui-settings-models`](packages/dsh-client-ui-settings-models.md) | Models settings and product-onboarding plugin for the dsh web client: provider rows, API-key management, model lists, and the DeepSeek first-run dialogs. |
| [`dsh-client-ui-settings-subagent`](packages/dsh-client-ui-settings-subagent.md) | The Subagent settings page on the dsh web client's Plugins page: delegation depth and capacity over the subagent namespace, and the models agents may choose over subagent |
| ★ [`dsh-client-ui-sidebar-right`](packages/dsh-client-ui-sidebar-right.md) | The right Sidebar of the dsh web client: one docking surface per session, two presentations, the navigation controller ctx.sidebarRight, the tab-type registry ctx.sidebar |
| ★ [`dsh-client-ui-sidebar`](packages/dsh-client-ui-sidebar.md) | Sidebar shell plugin for the dsh web client: brand row, New Session action, collapse control, scroll-aware region seat, and bottom-pinned Settings seat. |
| ★ [`dsh-client-ui-slots`](packages/dsh-client-ui-slots.md) | Slot registry pure core for the dsh web client: ordinary extension slots, reusable Component Factories, derived props types, store seats, and the renderer install contrac |
| [`dsh-client-ui-subagent`](packages/dsh-client-ui-subagent.md) | Subagent conversation catalog, continuation routing UI, and '@' reference source for the dsh web client. |
| ★ [`dsh-client-ui-user-questions`](packages/dsh-client-ui-user-questions.md) | Web ask_user_question feature for the dsh web client: the attached question card, timed wait, drafts, late replies, and the plan-review approval card. |
| [`dsh-client-ui-workflow-run`](packages/dsh-client-ui-workflow-run.md) | Durable workflow-run Conversation Node for the dsh web client: reconstructs top-level workflow runs as independent chat nodes with nested member disclosure. |
| ★ [`dsh-commands`](packages/dsh-commands.md) | Human slash-command registry for interactive UIs: plugin-owned commands that run directly against an agent without creating a model message, for users and maintainers com |
| [`dsh-cordis-client-runner`](packages/dsh-cordis-client-runner.md) | Browser half of dynamic Cordis packages for users and maintainers choosing, composing, or debugging how a page answers run requests and loads browser-half code. |
| [`dsh-cordis-host-runner`](packages/dsh-cordis-host-runner.md) | Host half of dynamic Cordis packages for agents and maintainers choosing, composing, or debugging the registry, sandbox, and run round trip. |
| ★ [`dsh-credentials`](packages/dsh-credentials.md) | The credential seam for users and maintainers resolving, describing, or storing credentials — reference values and durable records — without putting secret values in  |
| [`dsh-experimental-agent-team`](packages/dsh-experimental-agent-team.md) | Run a small team of named agents in one session: durable messages between members and a shared task board, for deployments composing the experimental Team plugins. |
| [`dsh-experimental-tool-agent-team`](packages/dsh-experimental-tool-agent-team.md) | Nine tools that let the model create, message, and coordinate teammates, for compositions mounting the experimental Team plugins. |
| [`dsh-goal`](packages/dsh-goal.md) | The persisted same-session goal service for users and maintainers choosing, configuring, or debugging one durable completion objective per session. |
| [`dsh-headless`](packages/dsh-headless.md) | One-shot task mode for dsh: run a single task from the command line and get the final answer printed, for users scripting or automating dsh. |
| [`dsh-hook-protocol`](packages/dsh-hook-protocol.md) | The shared hook rules behind the Claude Code and Codex bridges — what a hook can do and what happens when it runs — for users and maintainers of the hooks subsystem. |
| ★ [`dsh-host-webserver`](packages/dsh-host-webserver.md) | The web GUI host's HTTP server: named-route and upgrade registration, index transforms, and the single fallback seat that serves the Web shell's SPA dist. |
| [`dsh-jobs`](packages/dsh-jobs.md) | The background-job registry contract for users and maintainers composing, implementing, or debugging background work: ids, ownership, lifecycle, the output ring, and the  |
| ★ [`dsh-llm`](packages/dsh-llm.md) | The provider-neutral model-call service for users and maintainers streaming requests, registering provider adapters, or resolving model metadata. |
| [`dsh-mcp-client`](packages/dsh-mcp-client.md) | MCP client bridge for deployments and maintainers choosing, configuring, or debugging connections to external MCP servers whose tools register on ctx.tools. |
| [`dsh-package-manifest`](packages/dsh-package-manifest.md) | Shared TypeScript declarations for package identity, runtime requirements, and DSH plugin metadata. |
| [`dsh-persona`](packages/dsh-persona.md) | The composable persona row presets mount to give one agent its own system-prompt persona, for users and maintainers configuring or debugging it. |
| [`dsh-plan-mode`](packages/dsh-plan-mode.md) | Plan mode for users and maintainers choosing, configuring, or debugging the per-agent planning feature with deployment guidance, a /plan command, and a user-reviewed exit |
| ★ [`dsh-plugin-manager`](packages/dsh-plugin-manager.md) | Enable profile plugins and install, remove or select bundles from the Web sidebar or an agent. |
| [`dsh-schedule`](packages/dsh-schedule.md) | Host-wide durable reminders and shared Session-bound task management. |
| [`dsh-sdk-app`](packages/dsh-sdk-app.md) | SDK stdio application profile for users and maintainers launching a JSON-RPC harness runtime. |
| ★ [`dsh-session-projection`](packages/dsh-session-projection.md) | The session-projection registry for developers serving whole current values of log-derived per-session state to client carriers, and for maintainers of the drive contract |
| [`dsh-session`](packages/dsh-session.md) | The event-sourced session log and in-memory store for users and maintainers building, inspecting, or extending the durable record behind every agent interaction. |
| ★ [`dsh-settings`](packages/dsh-settings.md) | Inspect and edit live plugin configuration through Config-derived forms. |
| ★ [`dsh-storage-domain`](packages/dsh-storage-domain.md) | Domain data form (ctx.storageDomain) for hosts and maintainers choosing, mounting, or debugging schema-validated, change-emitting KV domains over storage backends. |
| ★ [`dsh-storage`](packages/dsh-storage.md) | Storage hub (ctx.storage) for compositions and maintainers choosing, mounting, or debugging named storage backends and data-form facilities. |
| ★ [`dsh-subagent-spawn-in-process`](packages/dsh-subagent-spawn-in-process.md) | In-process spawn subagent backend for users and maintainers choosing, configuring, or debugging fresh-child delegation. |
| ★ [`dsh-subagent`](packages/dsh-subagent.md) | The subagent delegation seam for users and maintainers choosing a provider backend, composing delegation tools, or debugging child-agent runs. |
| ★ [`dsh-system-prompt`](packages/dsh-system-prompt.md) | System-prompt assembly for users and maintainers adding prompt sections, variables, tool-schema sources, or configuring the model-facing prompt. |
| ★ [`dsh-tool-ask-user`](packages/dsh-tool-ask-user.md) | The model-facing ask_user_question tool over the user-questions seam, for users and maintainers composing or debugging interactive agent surfaces. |
| [`dsh-tool-cordis`](packages/dsh-tool-cordis.md) | Read-only runtime API discovery for agents developing and configuring installed Harness plugins. |
| ★ [`dsh-tool-subagent`](packages/dsh-tool-subagent.md) | Model-facing subagent delegation tool for users and maintainers configuring, composing, or debugging delegation over a subagent provider. |
| [`dsh-tool-todo`](packages/dsh-tool-todo.md) | The model-facing todo_write tool over the DeepSeek Harness session log: whole-list replacement, per-session ownership, and the todos projection, for users and maintainers |
| ★ [`dsh-tool-web`](packages/dsh-tool-web.md) | The model-facing web tools (web_search, web_fetch) over ctx.web: how deployments enable, configure, and observe the search and fetch tools the model sees. |
| [`dsh-tool-workflow`](packages/dsh-tool-workflow.md) | The model-facing workflow tool: run a JavaScript orchestration script that fans out subagents, for users and maintainers choosing or configuring model-driven orchestratio |
| ★ [`dsh-tools`](packages/dsh-tools.md) | The tool registry and execution pipeline for tool authors and maintainers registering, restricting, presenting, or debugging model-facing tools. |
| ★ [`dsh-user-questions`](packages/dsh-user-questions.md) | Waterfall-based question and answer service for tools, permission plugins, local answerers, and Agent-scoped Web interactions. |
| [`dsh-web-app`](packages/dsh-web-app.md) | The browser GUI for dsh: interactive chat, model and settings management, and session history, for users running the dsh web surface. |
| [`dsh-web`](packages/dsh-web.md) | The web access service (ctx.web): how deployments and plugin authors search the web and fetch URLs through interchangeable providers, with one selection policy and error  |
| [`dsh-webhook-github`](packages/dsh-webhook-github.md) | Signed GitHub webhook adapter for deployments routing authenticated JSON events into the webhook runtime. |
| [`dsh-workflow`](packages/dsh-workflow.md) | The workflow orchestration capability: run a model-written script that fans out subagents, for users and maintainers choosing or building on ctx.workflowEngine. |
| ★ [`dsh-workspace`](packages/dsh-workspace.md) | Workspace entity registry (ctx.workspaceRegistry) for hosts choosing, mounting, or debugging durable workspace records and header-validated session membership. |
| ★ [`dsh`](packages/dsh.md) | The `dsh` launcher: profiles, `dsh web`, `dsh plugin` (pnpm in the profile), config dumps, the reserved `desktop` profile. |
