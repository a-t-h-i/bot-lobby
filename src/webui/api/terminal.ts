/** `terminal.*`: shells in the project's folder for the page's terminal drawer (see `../terminal.ts`). */
import { fail, type ApiContext } from "./index.ts";
import { terminalBackend, terminals, TerminalError } from "../terminal.ts";
import type { TerminalInfo } from "../protocol.ts";

function guard<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof TerminalError) fail(error.missing ? 404 : 409, error.missing ? "not_found" : "conflict", error.message);
    throw error;
  }
}

export async function terminalList(): Promise<{ available: boolean; reason?: string; terminals: TerminalInfo[] }> {
  const backend = await terminalBackend();
  return { available: backend.kind !== "none", ...(backend.kind === "none" ? { reason: backend.reason } : {}), terminals: terminals.list() };
}

export async function terminalOpen(body: { cols: number; rows: number }, ctx: ApiContext): Promise<TerminalInfo> {
  try {
    return await terminals.open(ctx.service.projectRoot?.() ?? process.cwd(), body.cols, body.rows);
  } catch (error) {
    if (error instanceof TerminalError) fail(409, "conflict", error.message);
    throw error;
  }
}

export function terminalInput(body: { id: string; data: string }): Record<string, never> {
  guard(() => terminals.input(body.id, body.data));
  return {};
}

export function terminalResize(body: { id: string; cols: number; rows: number }): Record<string, never> {
  guard(() => terminals.resize(body.id, body.cols, body.rows));
  return {};
}

export function terminalClose(body: { id: string }): Record<string, never> {
  guard(() => terminals.close(body.id));
  return {};
}
