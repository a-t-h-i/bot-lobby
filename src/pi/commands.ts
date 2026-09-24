import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { configPath, dataRoot, detectProjectRoot, loadConfig } from "../state/project.ts";

const HELP = [
  "/dev-house <task>      Start a feature request through the workflow",
  "/dev-house status      Show project and active-task state",
  "/dev-house tasks       List tasks",
  "/dev-house cancel [id] Abandon a task",
  "/dev-house knowledge   Show persistent knowledge state",
  "/dev-house config      Show effective configuration",
].join("\n");

function showStatus(ctx: ExtensionCommandContext, configDir: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const cfg = loadConfig(root, configDir);
  ctx.ui.notify(
    `Project: ${root}\nKnowledge: ${dataRoot(root, configDir)}\n` +
      `Review iterations: ${cfg.workflow.maxReviewIterations}\nNo active task yet.`,
    "info",
  );
}

function showConfig(ctx: ExtensionCommandContext, configDir: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const cfg = loadConfig(root, configDir);
  ctx.ui.notify(`${configPath(root, configDir)}\n${JSON.stringify(cfg, null, 2)}`, "info");
}

export function registerCommands(pi: ExtensionAPI, configDir: string): void {
  pi.registerCommand("dev-house", {
    description: "Structured multi-agent engineering orchestrator",
    handler: async (args, ctx) => {
      const [sub, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      if (!sub) return ctx.ui.notify(HELP, "info");
      if (sub === "status") return showStatus(ctx, configDir);
      if (sub === "config") return showConfig(ctx, configDir);
      // Task workflows (start/tasks/cancel/approve/amend/decline/knowledge)
      // are wired in later phases.
      ctx.ui.notify(`dev-house: task handling lands in a later phase (got: ${sub} ${rest.join(" ")})`, "info");
    },
  });
}
