/**
 * `settings.get` / `settings.set`: the effective bot-lobby config (never a
 * secret) and the models Pi offers. A set merges the patch over the current
 * config, normalises it through `resolveConfig` and saves it; everything the
 * normaliser clamps or drops, so no unknown field is ever written.
 */
import { resolveConfig, type BotLobbyConfig } from "../../schemas/configuration.ts";
import { loadConfig, saveConfig } from "../../state/project.ts";
import { lobbyTopics } from "../../lobby/topics.ts";
import { prefillModels } from "../../pi/model-settings.ts";
import { kindLabel } from "../../pi/model-support.ts";
import { pushNotice } from "../notices.ts";
import type { SettingsInfo, SettingsLinter } from "../protocol.ts";
import type { ApiContext } from "./index.ts";
import { fail } from "./index.ts";

const SECRET_KEY = /^(api[-_]?key|auth[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization)$/i;

/** A deep copy of `value` with secret-looking fields removed at every depth. */
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => stripSecrets(entry)) as unknown as T;
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!SECRET_KEY.test(key)) out[key] = stripSecrets(entry);
  }
  return out as T;
}

/** Merge `patch` over `base`; nested plain objects merge, everything else replaces. */
export function mergeConfig(base: unknown, patch: unknown): unknown {
  if (!isPlain(base) || !isPlain(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlain(value) && isPlain(out[key]) ? mergeConfig(out[key], value) : value;
  }
  return out;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readConfig(ctx: ApiContext): BotLobbyConfig {
  return ctx.service.config?.() ?? loadConfig();
}

function writeConfig(ctx: ApiContext, config: BotLobbyConfig): void {
  if (ctx.service.saveConfig) ctx.service.saveConfig(config);
  else saveConfig(config);
}

/** Reject a port that is not 0 or 1-65535, . */
function checkPort(patch: Record<string, unknown>): void {
  const lobby = isPlain(patch.lobby) ? patch.lobby : undefined;
  const web = lobby && isPlain(lobby.web) ? lobby.web : undefined;
  const port = web?.port;
  if (port === undefined) return;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65535) {
    fail(400, "bad_request", `"${String(port)}" is not a port (0, or 1-65535).`);
  }
}

function agentEntries(patch: Record<string, unknown>): unknown[] {
  const agents = isPlain(patch.agents) ? Object.values(patch.agents) : [];
  return [patch.master, ...agents, patch.researcher, patch.quickFix, patch.planner, patch.scout];
}

/** Reject a time limit that is not a positive number, . */
function checkTimeouts(patch: Record<string, unknown>): void {
  for (const entry of agentEntries(patch)) {
    const timeout = isPlain(entry) ? entry.timeoutMs : undefined;
    if (timeout === undefined) continue;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
      fail(400, "bad_request", `"${String(timeout)}" is not a positive number of minutes.`);
    }
  }
}

/**
 * The page's first settings call. Subagents never inherit a model silently:
 * any whose model is still unset is pinned to the session's model and saved,
 * so the page always shows what each agent runs on.
 */
export function settingsGet(ctx: ApiContext): SettingsInfo {
  let config = readConfig(ctx);
  const prefilled = prefillModels(config, ctx.service.sessionModel?.());
  if (prefilled.filled.length > 0) {
    writeConfig(ctx, prefilled.config);
    config = prefilled.config;
    pushNotice(`${prefilled.filled.map(kindLabel).join(", ")} now run on the session model; change them here any time.`);
  }
  return { config: stripSecrets(config), models: ctx.service.models?.() ?? [] };
}

/** The linters the project configures (its top and a few folders below), and whether each is installed. */
export function settingsLinters(ctx: ApiContext): { linters: SettingsLinter[] } {
  return { linters: ctx.service.linters?.() ?? [] };
}

/** Merge, normalise and save the patch; the lobby rereads the config. */
export function settingsSet(body: { patch: Record<string, unknown> }, ctx: ApiContext): { config: BotLobbyConfig } {
  checkPort(body.patch);
  checkTimeouts(body.patch);
  const config = stripSecrets(resolveConfig(mergeConfig(readConfig(ctx), body.patch)));
  writeConfig(ctx, config);
  ctx.service.configChanged?.();
  lobbyTopics.bump("status");
  return { config };
}
