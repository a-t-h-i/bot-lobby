import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { detectProjectRoot, loadConfig } from "../state/project.ts";

/**
 * Session lifecycle wiring. Kept side-effect free: startup only resolves the
 * project root and validates config; all heavier resources are opened by the
 * phases that need them and cleaned up here on shutdown.
 */
export function registerLifecycle(pi: ExtensionAPI, configDir: string): void {
  pi.on("session_start", (_event, ctx) => {
    const root = detectProjectRoot(ctx.cwd, configDir);
    try {
      loadConfig(root, configDir);
    } catch (err) {
      ctx.ui.notify(`dev-house: failed to load config (${(err as Error).message})`, "error");
    }
  });

  pi.on("session_shutdown", () => {
    // Subprocess cleanup and scratchpad flushing are added by later phases.
  });
}
