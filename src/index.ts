import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./pi/commands.ts";
import { registerLifecycle } from "./pi/events.ts";
import { registerOrchestrateTool } from "./pi/tools.ts";
import { onTransition } from "./state/task-state.ts";
import { ping } from "./pi/notify.ts";

export default function (pi: ExtensionAPI): void {
  registerLifecycle(pi, CONFIG_DIR_NAME);
  onTransition((task) => ping(task.state, task.title));
  registerCommands(pi, CONFIG_DIR_NAME);
  registerOrchestrateTool(pi, CONFIG_DIR_NAME);
}
