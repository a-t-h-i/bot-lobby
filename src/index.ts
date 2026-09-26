import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./pi/commands.ts";
import { registerLifecycle } from "./pi/events.ts";
import { registerOrchestrateTool } from "./pi/tools.ts";
import { onTransition } from "./state/task-state.ts";
import { ping } from "./pi/notify.ts";
import { isSubagentProcess } from "./pi/quiet.ts";
import { registerDeskClient } from "./desk/client-extension.ts";
import { registerLobbyEvents } from "./lobby/runtime.ts";

export default function (pi: ExtensionAPI): void {
  registerLifecycle(pi, CONFIG_DIR_NAME);
  // After the lifecycle, so the lobby opens over a task the widget state already knows.
  registerLobbyEvents(pi, CONFIG_DIR_NAME);
  onTransition((task) => ping(task.state, task.title));
  registerCommands(pi, CONFIG_DIR_NAME);
  registerOrchestrateTool(pi, CONFIG_DIR_NAME);
  // Parallel workers share files through the master's file desk.
  if (isSubagentProcess()) registerDeskClient(pi);
}
