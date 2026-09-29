/**
 * The master runs in your own Pi session, on the session's model. When that
 * model runs out of usage mid-task (a subscription limit, no credit) the turn
 * ends with an error and the task would stall. With a fallback model set for
 * the master, the session switches to it and the oracle carries on.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { looksUnavailable, markUnavailable } from "../execution/fallback.ts";
import { fallbackOf } from "../schemas/configuration.ts";
import { loadConfig } from "../state/project.ts";
import { modelRef } from "./model-support.ts";
import { modelLookup } from "./tools.ts";
import { isSubagentProcess } from "./quiet.ts";

/** The provider's error when the last thing in the turn was a failed assistant message that says the model is out of usage or unavailable. */
export function usageFailure(messages: readonly unknown[]): string | undefined {
  const last = messages.at(-1) as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
  if (last?.role !== "assistant" || last.stopReason !== "error") return undefined;
  return looksUnavailable(last.errorMessage) ? last.errorMessage : undefined;
}

/** What the oracle is told after the switch. */
export function switchedMessage(from: string, to: string): string {
  return `bot-lobby: your last turn failed because ${from} is out of usage or unavailable, so this session switched to ${to}. Carry on with the task from where you left off; do not repeat work that is already done.`;
}

export function registerMasterFallback(pi: ExtensionAPI): void {
  if (isSubagentProcess()) return;
  let failure: string | undefined;
  pi.on("agent_end", (event) => {
    failure = usageFailure(event.messages);
  });
  pi.on("agent_settled", async (_event, ctx: ExtensionContext) => {
    if (!failure) return;
    failure = undefined;
    await switchMaster(pi, ctx);
  });
}

async function switchMaster(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const fallback = fallbackOf(loadConfig().master);
  if (!fallback) return;
  const current = ctx.model ? modelRef(ctx.model) : "the session model";
  if (current === fallback.model) {
    ctx.ui.notify(`bot-lobby: ${current} (the master's fallback) is out of usage too — pick another model or wait.`, "warning");
    return;
  }
  const model = modelLookup(ctx)(fallback.model);
  if (!model) {
    ctx.ui.notify(`bot-lobby: the master's fallback model "${fallback.model}" is not known to Pi.`, "warning");
    return;
  }
  if (!(await pi.setModel(model))) {
    ctx.ui.notify(`bot-lobby: no auth for the master's fallback model ${fallback.model}.`, "warning");
    return;
  }
  pi.setThinkingLevel(fallback.thinking as Parameters<ExtensionAPI["setThinkingLevel"]>[0]);
  if (ctx.model) markUnavailable(current);
  ctx.ui.notify(`bot-lobby: ${current} ran out of usage; the master now runs on ${fallback.model} (${fallback.thinking}). Switch back with /model when it is available again.`, "warning");
  await pi.sendUserMessage(switchedMessage(current, fallback.model));
}
