/**
 * Where Jev is called and where its key lives. Every host speaks the same
 * System One API; only the URL, the default model and the key differ. Keys
 * are pi's: bot-lobby registers a `typesafe` provider so `/login typesafe`
 * (Use an API key) stores the key in pi's auth.json next to the others, and
 * OpenRouter and Vercel AI Gateway keys are the ones pi already holds.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ClassifierConfig, JevHostName } from "../schemas/configuration.ts";

export interface JevHost {
  name: JevHostName;
  label: string;
  /** pi's provider id holding the key (`/login <id>`). */
  piProvider: string;
  /** The environment variable pi falls back to for that provider. */
  env: string;
  baseUrl: string;
  model: string;
  headers?: Readonly<Record<string, string>>;
}

export const JEV_HOST_TABLE: Readonly<Record<JevHostName, JevHost>> = Object.freeze({
  typesafe: { name: "typesafe", label: "TypeSafe", piProvider: "typesafe", env: "TYPESAFE_API_KEY", baseUrl: "https://api.typesafe.ai", model: "jev-latest" },
  openrouter: { name: "openrouter", label: "OpenRouter", piProvider: "openrouter", env: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api", model: "jev-latest", headers: { "HTTP-Referer": "https://github.com/a-t-h-i/bot-lobby", "X-Title": "bot-lobby" } },
  vercel: { name: "vercel", label: "Vercel AI Gateway", piProvider: "vercel-ai-gateway", env: "AI_GATEWAY_API_KEY", baseUrl: "https://ai-gateway.vercel.sh/typesafe", model: "typesafe-ai/jev" },
});

/** The host, URL and model a config calls. */
export function jevEndpoint(config: ClassifierConfig): { host: JevHost; baseUrl: string; model: string } {
  const host = JEV_HOST_TABLE[config.provider];
  return { host, baseUrl: config.baseUrl || host.baseUrl, model: config.model || host.model };
}

/** Resolves a pi provider's API key (stored credential, then its environment variable). */
export type KeySource = (piProvider: string) => Promise<string | undefined>;

/** Where a provider's key comes from, without the key: pi's own auth status. */
export interface KeyStatus {
  configured: boolean;
  source?: string;
  label?: string;
}

/** Resolve the key for a host: pi's key store first, then the host's environment variable. */
export async function resolveKey(host: JevHost, source: KeySource | undefined, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  let key: string | undefined;
  try {
    key = (await source?.(host.piProvider))?.trim();
  } catch {
    key = undefined;
  }
  return key || env[host.env]?.trim() || undefined;
}

/** `ts_ab…cd`: enough to recognise which key is loaded, never the key. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** One line on where the key comes from, for settings and `/bot-lobby config`. */
export function describeKey(host: JevHost, status: KeyStatus | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (status?.configured) {
    if (status.source === "stored") return `stored in pi (/login ${host.piProvider})`;
    if (status.source === "environment") return `from ${status.label ?? host.env}`;
    return `configured (${status.label ?? status.source ?? "pi"})`;
  }
  if (env[host.env]?.trim()) return `from ${host.env}`;
  return `missing: /login ${host.piProvider} → Use an API key, or set ${host.env}`;
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
    pi.registerProvider(host.piProvider, { name: "TypeSafe (Jev classifier)", baseUrl: host.baseUrl, apiKey: `$${host.env}`, models: [] });
    return true;
  } catch {
    return false;
  }
}
