/**
 * After pi stopped unexpectedly, the window that came back says once what it
 * carried on (the planning session, quick fixes, tasks). Each carry-on is
 * announced once per tab, even across a reload.
 */
import { useEffect } from "react"
import type { StatusInfo } from "@protocol"
import { toast } from "@/lib/toast"

const KEY = "bot-lobby.recoveredAt"
let seen: number | undefined

/** Whether this carry-on is new to this tab (and remember it). */
export function firstSighting(at: number, store: Pick<Storage, "getItem" | "setItem"> | undefined = tabStorage()): boolean {
  try { if (seen === undefined) seen = Number(store?.getItem(KEY) ?? 0) } catch { seen = seen ?? 0 }
  if (seen !== undefined && at <= seen) return false
  seen = at
  try { store?.setItem(KEY, String(at)) } catch { /* Memory is enough. */ }
  return true
}

function tabStorage(): Storage | undefined {
  try { return (globalThis as { sessionStorage?: Storage }).sessionStorage } catch { return undefined }
}

export function useRecoveredNotice(status: StatusInfo | undefined): void {
  const at = status?.recovered?.at
  const text = status?.recovered?.text
  useEffect(() => {
    if (at === undefined || !text || !firstSighting(at)) return
    toast.success(text)
  }, [at, text])
}
