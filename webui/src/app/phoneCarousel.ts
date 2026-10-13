import type { TabInfo } from "@protocol"

/** Phone rules end immediately before the 768px tablet boundary. */
export const PHONE_SETTLE_MS = 120
export const PHONE_COMMIT_MS = 500
export const PHONE_PERIODS = 5
export const PHONE_PERIOD_GAP = 6

function normalizeBeltScroll(scrollLeft: number, periodWidth: number, periods = PHONE_PERIODS): number {
  if (!Number.isFinite(scrollLeft) || !Number.isFinite(periodWidth) || periodWidth <= 0 || periods < 2) return scrollLeft
  const middle = Math.floor(periods / 2)
  const low = (middle - 0.75) * periodWidth
  const high = (middle + 1.75) * periodWidth
  if (scrollLeft < low) return scrollLeft + Math.ceil((low - scrollLeft) / periodWidth) * periodWidth
  if (scrollLeft > high) return scrollLeft - Math.ceil((scrollLeft - high) / periodWidth) * periodWidth
  return scrollLeft
}

/** Keep server key digits unchanged; the final digit is the display number. */
export function tabNumber(key: string): string | undefined {
  return /(\d)$/.exec(key)?.[1]
}

interface CardGeometry {
  id: string
  left: number
  width: number
}

/** Return the canonical id of the nearest visual card, including belt copies. */
export function nearestCard(cards: CardGeometry[], centre: number): string | undefined {
  if (!Number.isFinite(centre)) return undefined
  let nearest: string | undefined
  let distance = Number.POSITIVE_INFINITY
  for (const card of cards) {
    if (!card.id || !Number.isFinite(card.left) || !Number.isFinite(card.width) || card.width < 0) continue
    const nextDistance = Math.abs(card.left + card.width / 2 - centre)
    if (nextDistance < distance) {
      nearest = card.id
      distance = nextDistance
    }
  }
  return nearest
}

/** Rebase user scroll into the middle three periods without changing visuals. */
export function seamScroll(scrollLeft: number, periodWidth: number, periods = PHONE_PERIODS): number {
  return normalizeBeltScroll(scrollLeft, periodWidth, periods)
}

/** Label for a route that is not one of the visible phone tabs. */
export function pageLabel(activeId: string | undefined, tabs: TabInfo[], hash: string): string {
  const active = tabs.find((tab) => tab.id === activeId)
  if (active) return active.label
  const head = hash.replace(/^#\/?/, "").split("/")[0]
  if (head === "settings") return "Settings"
  if (head) return head.charAt(0).toUpperCase() + head.slice(1)
  return "Lobby"
}
