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
import { fileHinter, type FileHinter, type FileScope } from "./files.ts";
import { knowledgePicker, type KnowledgePicker } from "./knowledge.ts";
import { lobbyFeed } from "../lobby/feed.ts";
import { triageLine, triageWithContext } from "./triage.ts";
import type { TaskTriage } from "../schemas/task.ts";
import { effortRouter, type EffortRouter } from "./effort.ts";

interface Binding {
  cwd: string;
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

/** Likely files for agents working in a tree, with what was found logged to the lobby's activity feed. */
export function hintsFor(scope: FileScope): FileHinter {
  return fileHinter(classifier(), scope, (text) => lobbyFeed.log("CLASSIFIER", text, "info"));
}

/** Relevant knowledge for agents, with what Jev kept of each long file logged to the lobby's activity feed. */
export function knowledgeFor(): KnowledgePicker {
  return knowledgePicker(classifier(), (text) => lobbyFeed.log("CLASSIFIER", text, "info"));
}

/** Triage a request for a task in a tree, logged to the lobby's activity feed; undefined when triage is off or fails. */
export async function triageFor(scope: FileScope, request: string, signal?: AbortSignal): Promise<TaskTriage | undefined> {
  const triage = await triageWithContext(classifier(), scope, request, signal);
  if (triage) lobbyFeed.log("CLASSIFIER", triageLine(triage), "info");
  return triage;
}

/**
 * Effort routing for the process's classifier; `clamp` fits a thinking level
 * to what a model supports. Routes are logged to the lobby's activity feed.
 */
export function effortFor(clamp?: (model: string, thinking: string) => string): EffortRouter {
  return effortRouter(classifier(), { ...(clamp ? { clamp } : {}), log: (text) => lobbyFeed.log("CLASSIFIER", text, "info") });
}

/** The tree this process's session works in, once it has started. */
export function sessionScope(): FileScope | undefined {
  return binding ? { cwd: binding.cwd, root: binding.root, configDir: binding.configDir } : undefined;
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
      cwd: ctx.cwd,
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
