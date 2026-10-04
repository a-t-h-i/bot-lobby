import type { Exec } from "../lobby/issues.ts";

export interface DeliveryContext { exec: Exec; cwd: string }
export async function command(ctx: DeliveryContext, tool: string, args: string[]): Promise<string> {
  const result = await ctx.exec(tool, args, { cwd: ctx.cwd, timeout: 20_000 });
  if (result.code !== 0) throw new Error(`${tool} lookup failed; check remote access and authentication, then refresh review.`);
  return result.stdout.trim();
}
export async function api(ctx: DeliveryContext, endpoint: string): Promise<unknown> {
  const text = await command(ctx, "gh", ["api", endpoint]);
  try { return JSON.parse(text); }
  catch { throw new Error("GitHub returned malformed JSON; refresh review after connectivity recovers."); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed GitHub response; refresh review.");
  return value as Record<string, unknown>;
}
export function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) throw new Error("Malformed required check names.");
  return value as string[];
}
export async function pages(ctx: DeliveryContext, endpoint: string, key?: string): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; page <= 100; page++) {
    const raw = await api(ctx, `${endpoint}?per_page=100&page=${page}`);
    const rows = key ? object(raw)[key] : raw;
    if (!Array.isArray(rows) || rows.length > 100) throw new Error("Malformed GitHub pagination; refresh review.");
    if (key && (!Number.isInteger(object(raw).total_count) || Number(object(raw).total_count) < all.length + rows.length)) throw new Error("Malformed check count.");
    all.push(...rows);
    if (rows.length < 100) {
      if (key && object(raw).total_count !== all.length) throw new Error("Incomplete check pagination; refresh review.");
      return all;
    }
  }
  throw new Error("GitHub pagination exceeds safety limit; review checks manually.");
}
