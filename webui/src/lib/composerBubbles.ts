/**
 * What the bubbles above the composer can do that only a page knows: the Plan tab says how to open its draft
 * ("View plan") while it has one. A page sets it while mounted and clears it on the way out.
 */
import { useEffect, useSyncExternalStore } from "react"

let viewPlan: (() => void) | undefined
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The Plan tab's way to its draft, while it has one. */
export function useViewPlan(): (() => void) | undefined {
  return useSyncExternalStore(subscribe, () => viewPlan, () => undefined)
}

/** Offer "View plan" above the composer while `open` is given. */
export function useOfferViewPlan(open: (() => void) | undefined): void {
  useEffect(() => {
    viewPlan = open
    for (const listener of [...listeners]) listener()
    return () => {
      if (viewPlan !== open) return
      viewPlan = undefined
      for (const listener of [...listeners]) listener()
    }
  }, [open])
}

/** Said on the window when the knowledge was asked something from the composer, with the question. */
export const KNOWLEDGE_ASKED = "bot-lobby:knowledge-asked"
