/**
 * Where Jev is called and where its key lives. Every host speaks the same
 * System One API; only the URL, the default model and the key differ, and
 * every key is one pi already stores:
 *
 * - OpenCode Zen serves Jev with the OpenCode key pi uses for Zen and Go
 *   (`/login opencode` or `opencode-go`, or OPENCODE_API_KEY), on the free
 *   `jev-1.13-free` model while OpenCode offers it.
 * - TypeSafe direct: bot-lobby registers a `typesafe` provider so `/login
 *   typesafe` stores the key in pi's auth.json.
 * - OpenRouter and Vercel AI Gateway use the key pi holds for them.
 *
 * `auto` (the default) takes OpenCode when pi holds an OpenCode key, else
 * TypeSafe.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ClassifierConfig, JevHostName } from "../schemas/configuration.ts";

export type JevHostId = Exclude<JevHostName, "auto">;

export interface JevHost {
  name: JevHostId;
  label: string;
  /** pi's provider ids that hold this host's key, in the order they are tried; the first is the one to `/login`. */
  piProviders: readonly string[];
  /** The environment variable pi falls back to for that key. */
  env: string;
  baseUrl: string;
  model: string;
  headers?: Readonly<Record<string, string>>;
}

export const JEV_HOST_TABLE: Readonly<Record<JevHostId, JevHost>> = Object.freeze({
  opencode: { name: "opencode", label: "OpenCode Zen", piProviders: ["opencode", "opencode-go"], env: "OPENCODE_API_KEY", baseUrl: "https://opencode.ai/zen", model: "jev-1.13-free" },
  typesafe: { name: "typesafe", label: "TypeSafe", piProviders: ["typesafe"], env: "TYPESAFE_API_KEY", baseUrl: "https://api.typesafe.ai", model: "jev-latest" },
  openrouter: { name: "openrouter", label: "OpenRouter", piProviders: ["openrouter"], env: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api", model: "jev-latest", headers: { "HTTP-Referer": "https://github.com/a-t-h-i/bot-lobby", "X-Title": "bot-lobby" } },
  vercel: { name: "vercel", label: "Vercel AI Gateway", piProviders: ["vercel-ai-gateway"], env: "AI_GATEWAY_API_KEY", baseUrl: "https://ai-gateway.vercel.sh/typesafe", model: "typesafe-ai/jev" },
});

/** The hosts `auto` tries, in order: OpenCode's free Jev first. */
export const AUTO_ORDER: readonly JevHostId[] = ["opencode", "typesafe"];

/** Resolves a pi provider's API key (stored credential, then its environment variable). */
export type KeySource = (piProvider: string) => Promise<string | undefined>;

/** Where a provider's key comes from, without the key: pi's own auth status. */
export interface KeyStatus {
  configured: boolean;
  source?: string;
  label?: string;
}

export type StatusSource = (piProvider: string) => KeyStatus | undefined;

/** The first of a host's pi providers holding a key, with its status. */
function configuredProvider(host: JevHost, status: StatusSource | undefined): { provider: string; status: KeyStatus } | undefined {
  for (const provider of host.piProviders) {
    const found = status?.(provider);
    if (found?.configured) return { provider, status: found };
  }
  return undefined;
}

/** Whether pi (or the environment) holds a key for a host, without reading it. */
export function hostConfigured(host: JevHost, status: StatusSource | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(configuredProvider(host, status) || env[host.env]?.trim());
}

/** The host a config calls, judged by which keys pi holds; `auto` falls back to TypeSafe when none does. */
export function chooseHost(config: Pick<ClassifierConfig, "provider">, status?: StatusSource, env: NodeJS.ProcessEnv = process.env): JevHost {
  if (config.provider !== "auto") return JEV_HOST_TABLE[config.provider];
  return JEV_HOST_TABLE[AUTO_ORDER.find((name) => hostConfigured(JEV_HOST_TABLE[name], status, env)) ?? "typesafe"];
}

/** The URL and model for a host, with the config's overrides. */
export function endpointFor(host: JevHost, config: Pick<ClassifierConfig, "baseUrl" | "model">): { host: JevHost; baseUrl: string; model: string } {
  return { host, baseUrl: config.baseUrl || host.baseUrl, model: config.model || host.model };
}

/** The host, URL and model a config calls (for display; the classifier resolves keys itself). */
export function jevEndpoint(config: ClassifierConfig, status?: StatusSource, env: NodeJS.ProcessEnv = process.env): { host: JevHost; baseUrl: string; model: string } {
  return endpointFor(chooseHost(config, status, env), config);
}

/** A host's key: each of its pi providers in turn, then its environment variable. */
export async function resolveKey(host: JevHost, source: KeySource | undefined, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  for (const provider of host.piProviders) {
    try {
      const key = (await source?.(provider))?.trim();
      if (key) return key;
    } catch {
      // Try the next provider.
    }
  }
  return env[host.env]?.trim() || undefined;
}

/**
 * The host and key a config calls with. `auto` takes the first host in
 * `AUTO_ORDER` that has a key; undefined `key` means none was found.
 */
export async function resolveTarget(config: ClassifierConfig, source: KeySource | undefined, env: NodeJS.ProcessEnv = process.env): Promise<{ host: JevHost; baseUrl: string; model: string; key?: string }> {
  const hosts = config.provider === "auto" ? AUTO_ORDER.map((name) => JEV_HOST_TABLE[name]) : [JEV_HOST_TABLE[config.provider]];
  for (const host of hosts) {
    const key = await resolveKey(host, source, env);
    if (key) return { ...endpointFor(host, config), key };
  }
  return endpointFor(hosts[0]!, config);
}

/** How to give bot-lobby a key for this config, in one sentence. */
export function keyHint(config: Pick<ClassifierConfig, "provider">): string {
  const opencode = JEV_HOST_TABLE.opencode;
  const typesafe = JEV_HOST_TABLE.typesafe;
  const how = (host: JevHost) => (host.name === "typesafe" ? `/login typesafe (Use an API key) or set ${host.env}` : `/login ${host.piProviders[0]} or set ${host.env}`);
  if (config.provider === "auto") return `sign in to OpenCode for its free Jev (${how(opencode)}), or ${how(typesafe)}`;
  return how(JEV_HOST_TABLE[config.provider]);
}

/** One line on where a host's key comes from, for settings and `/bot-lobby config`. */
export function describeKey(host: JevHost, status: StatusSource | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const found = configuredProvider(host, status);
  if (found) {
    if (found.status.source === "stored") return `stored in pi (/login ${found.provider})`;
    if (found.status.source === "environment") return `from ${found.status.label ?? host.env}`;
    return `configured (${found.status.label ?? found.status.source ?? "pi"})`;
  }
  if (env[host.env]?.trim()) return `from ${host.env}`;
  return `missing: ${host.name === "typesafe" ? "/login typesafe → Use an API key" : `/login ${host.piProviders[0]}`}, or set ${host.env}`;
}

/**
 * Register TypeSafe as a pi provider with no chat models, so `/login
 * typesafe` stores the Jev key with pi's own locking and `/logout` removes
 * it. Nothing is added to `/model`. A pi that refuses the registration only
 * loses the login entry: the environment variable still works.
 */
export function registerJevProvider(pi: ExtensionAPI): boolean {
  const host = JEV_HOST_TABLE.typesafe;
  try {
    pi.registerProvider(host.piProviders[0]!, { name: "TypeSafe (Jev classifier)", baseUrl: host.baseUrl, apiKey: `$${host.env}`, models: [] });
    return true;
  } catch {
    return false;
  }
}
