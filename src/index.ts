import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./pi/commands.ts";
import { registerLifecycle } from "./pi/events.ts";

export default function (pi: ExtensionAPI): void {
  registerLifecycle(pi, CONFIG_DIR_NAME);
  registerCommands(pi, CONFIG_DIR_NAME);
}
