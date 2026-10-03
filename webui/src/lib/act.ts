/**
 * Run one lobby action and show its answer as a toast: the notice on success
 * (with an Undo when the caller can reverse it), the error text on failure.
 * Resolves to the result, or `undefined` when the call failed.
 */
import { toast } from "@/lib/toast"
import type { Api, ApiName } from "@protocol"
import { call } from "./api.ts"

export interface ActOptions {
  /** Offered on the success toast as "Undo". */
  undo?: () => void
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "That did not work. Try again."
}

export async function act<Name extends ApiName>(
  name: Name,
  body: Api[Name]["request"],
  options: ActOptions = {}
): Promise<Api[Name]["result"] | undefined> {
  try {
    const result = await call(name, body)
    const notice = (result as { notice?: string }).notice
    if (notice) toast(notice, options.undo ? { action: { label: "Undo", onClick: options.undo } } : undefined)
    return result
  } catch (error) {
    toast.error(describe(error))
    return undefined
  }
}
