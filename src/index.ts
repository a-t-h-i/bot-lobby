import { registerAgentPermissions, registerDelegation } from "./pi/delegation.ts";
import { registerAutoCompaction } from "./pi/auto-compaction.ts";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./pi/commands.ts";
import { registerLifecycle } from "./pi/events.ts";
import { registerOrchestrateTool } from "./pi/tools.ts";
import { registerRouteTool } from "./pi/route.ts";
import { onTransition } from "./state/task-state.ts";
import { releaseAttachments } from "./state/attachments.ts";
import { detectProjectRoot } from "./state/project.ts";
import { TERMINAL_STATES } from "./schemas/task.ts";
import { pingTransition } from "./pi/notify.ts";
import { isSubagentProcess } from "./pi/quiet.ts";
import { registerDeskClient } from "./desk/client-extension.ts";
import { registerBoardClient } from "./desk/board-client.ts";
import { registerLobbyEvents } from "./lobby/runtime.ts";
import { registerOwner } from "./pi/owner.ts";
import { registerClassifier } from "./classifier/instance.ts";
import { registerClassifierTools } from "./classifier/tools.ts";
import { registerFreshContext } from "./pi/fresh-context.ts";
import { registerAskTool } from "./ask/tool.ts";
import { registerWebTools } from "./web/tools.ts";
import { registerToolBudget } from "./pi/tool-budget.ts";
import { bindGrants } from "./pi/grants.ts";
import { registerHarnessProviders } from "./harness/bridge/provider.ts";
import { loadConfig } from "./state/project.ts";

export default function (pi: ExtensionAPI): void {
  registerAgentPermissions(pi);
  registerDelegation(pi);
  registerAutoCompaction(pi);
  // Settings lists this session's MCP tools and skills to grant, and agents find their granted skills through it.
  if (!isSubagentProcess()) bindGrants(pi);
  let root = detectProjectRoot(process.cwd(), CONFIG_DIR_NAME);
  let cwd = process.cwd();
  // Each third-party harness as a pi model provider, so the oracle and the planner can think on one (models typed into settings show up on the next session).
  const harnessHost = { config: loadConfig, cwd: () => cwd };
  registerHarnessProviders(pi, harnessHost);
  pi.on("session_start", (_event, ctx) => {
    root = detectProjectRoot(ctx.cwd, CONFIG_DIR_NAME);
    cwd = ctx.cwd;
    registerHarnessProviders(pi, harnessHost);
  });
  // First, so every session_start handler below finds the classifier bound to this session's keys.
  registerClassifier(pi, CONFIG_DIR_NAME);
  // Before the lifecycle, so a task that ended while the oracle was idle is closed before it builds the next turn's prompt.
  registerFreshContext(pi, CONFIG_DIR_NAME);
  registerLifecycle(pi, CONFIG_DIR_NAME);
  // After the lifecycle, so the lobby opens over a task the status already knows.
  registerLobbyEvents(pi, CONFIG_DIR_NAME);
  registerOwner(pi, CONFIG_DIR_NAME);
  // A finished task takes the files attached during it along.
  onTransition((task) => {
    pingTransition(task);
    if (TERMINAL_STATES.includes(task.state)) releaseAttachments(task.id, root);
  });
  registerCommands(pi, CONFIG_DIR_NAME);
  registerOrchestrateTool(pi, CONFIG_DIR_NAME);
  // A new request one agent can do alone: the oracle confirms, and the lobby hands it to the quick-fix agent.
  registerRouteTool(pi, CONFIG_DIR_NAME);
  // The questionnaire the oracle (and pi without a task) asks the user with; no other extension is needed for it.
  registerAskTool(pi, undefined, CONFIG_DIR_NAME);
  // The web tools, for the researcher and for pi without a task (the oracle leaves them to the researcher).
  registerWebTools(pi);
  // Parallel workers share files through the master's file desk.
  if (isSubagentProcess()) registerDeskClient(pi);
  // Workers on a task post contracts, decisions and blockers to its board and read the others'.
  if (isSubagentProcess()) registerBoardClient(pi);
  // Subagents look files up with the classifier (the engine allows the tool only while file hints are on).
  if (isSubagentProcess()) registerClassifierTools(pi);
  // A subagent given a tool budget (scouts) is warned, then refused, so it reports instead of searching on.
  if (isSubagentProcess()) registerToolBudget(pi);
}
