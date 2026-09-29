import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./pi/commands.ts";
import { registerLifecycle } from "./pi/events.ts";
import { registerOrchestrateTool } from "./pi/tools.ts";
import { registerRouteTool } from "./pi/route.ts";
import { onTransition } from "./state/task-state.ts";
import { pingTransition } from "./pi/notify.ts";
import { isSubagentProcess } from "./pi/quiet.ts";
import { registerDeskClient } from "./desk/client-extension.ts";
import { registerLobbyEvents } from "./lobby/runtime.ts";
import { registerOwner } from "./pi/owner.ts";
import { registerClassifier } from "./classifier/instance.ts";
import { registerClassifierTools } from "./classifier/tools.ts";
import { registerFreshContext } from "./pi/fresh-context.ts";
import { registerAskTool } from "./ask/tool.ts";
import { registerWebTools } from "./web/tools.ts";

export default function (pi: ExtensionAPI): void {
  // First, so every session_start handler below finds the classifier bound to this session's keys.
  registerClassifier(pi, CONFIG_DIR_NAME);
  // Before the lifecycle, so a task that ended while the oracle was idle is closed before it builds the next turn's prompt.
  registerFreshContext(pi, CONFIG_DIR_NAME);
  registerLifecycle(pi, CONFIG_DIR_NAME);
  // After the lifecycle, so the lobby opens over a task the status already knows.
  registerLobbyEvents(pi, CONFIG_DIR_NAME);
  registerOwner(pi, CONFIG_DIR_NAME);
  onTransition((task) => pingTransition(task));
  registerCommands(pi, CONFIG_DIR_NAME);
  registerOrchestrateTool(pi, CONFIG_DIR_NAME);
  // A new request one agent can do alone: the oracle confirms, and the lobby hands it to the quick-fix agent.
  registerRouteTool(pi, CONFIG_DIR_NAME);
  // The questionnaire the oracle (and pi without a task) asks the user with; no other extension is needed for it.
  registerAskTool(pi);
  // The web tools, for the researcher and for pi without a task (the oracle leaves them to the researcher).
  registerWebTools(pi);
  // Parallel workers share files through the master's file desk.
  if (isSubagentProcess()) registerDeskClient(pi);
  // Subagents look files up with the classifier (the engine allows the tool only while file hints are on).
  if (isSubagentProcess()) registerClassifierTools(pi);
}
