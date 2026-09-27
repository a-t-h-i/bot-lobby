/**
 * The process's classifier. pi's key store and the project are bound at
 * session start; the lobby, the workflow and (inside subagents) the file
 * tools all read the same instance, so the breaker and the one-time notices
 * are shared.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendMetrics } from "../state/metrics.ts";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
import { isSubagentProcess } from "../pi/quiet.ts";
import { Classifier } from "./classifier.ts";
import { registerJevProvider, type KeySource, type KeyStatus } from "./hosts.ts";

interface Binding {
  root: string;
  configDir: string;
  keys: KeySource;
  status: (piProvider: string) => KeyStatus | undefined;
  notify?: (message: string, level: "info" | "warning" | "error") => void;
}

let binding: Binding | undefined;
let instance: Classifier | undefined;

export function classifier(): Classifier {
  instance ??= new Classifier({
    config: () => loadConfig().classifier,
    keys: async (piProvider) => binding?.keys(piProvider),
    metrics: (record) => {
      if (binding) appendMetrics(binding.root, binding.configDir, [record]);
    },
    warn: (message) => binding?.notify?.(message, "warning"),
  });
  return instance;
}

/** Where a pi provider's key comes from (never the key), once a session has started. */
export function keyStatus(piProvider: string): KeyStatus | undefined {
  return binding?.status(piProvider);
}

/** Tests: use this classifier for the process (undefined restores the default). */
export function useClassifier(next: Classifier | undefined): void {
  instance = next;
}

/** Register the `typesafe` login entry and bind the classifier to each session's key store. */
export function registerClassifier(pi: ExtensionAPI, configDir: string): void {
  registerJevProvider(pi);
  pi.on("session_start", (_event, ctx) => {
    binding = {
      root: detectProjectRoot(ctx.cwd, configDir),
      configDir,
      keys: (piProvider) => ctx.modelRegistry.getApiKeyForProvider(piProvider),
      status: (piProvider) => {
        try {
          return ctx.modelRegistry.getProviderAuthStatus(piProvider);
        } catch {
          return undefined;
        }
      },
      // Subagents have nobody to tell; their runs still land in the metrics.
      ...(ctx.hasUI && !isSubagentProcess() ? { notify: (message: string, level: "info" | "warning" | "error") => ctx.ui.notify(message, level) } : {}),
    };
  });
}
