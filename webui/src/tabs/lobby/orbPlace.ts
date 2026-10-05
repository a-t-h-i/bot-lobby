/**
 * Where the Thinking orb sits once it has been dragged: its top-left corner
 * as fractions of the Lobby's card, so it stays in the same spot when the
 * window changes size, and is never let off the card. Remembered in this
 * browser only; a blocked store just means it starts in its corner again.
 */

export interface Place {
  fx: number
  fy: number
}

export interface Area {
  left: number
  top: number
  width: number
  height: number
}

/** How far from the card's edges the orb is kept, in pixels. */
const MARGIN = 6
const KEY = "bot-lobby.orb"

const fraction = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1

/** The top-left corner, pulled inside the card. */
export function clampPoint(x: number, y: number, area: Area, size: number): { x: number; y: number } {
  const low = (start: number) => start + MARGIN
  const high = (start: number, span: number) => Math.max(start + MARGIN, start + span - size - MARGIN)
  return {
    x: Math.min(high(area.left, area.width), Math.max(low(area.left), x)),
    y: Math.min(high(area.top, area.height), Math.max(low(area.top), y)),
  }
}

/** A corner in pixels as a place on the card. */
export function toPlace(x: number, y: number, area: Area, size: number): Place {
  const room = (span: number) => Math.max(1, span - size)
  const point = clampPoint(x, y, area, size)
  return { fx: Math.min(1, Math.max(0, (point.x - area.left) / room(area.width))), fy: Math.min(1, Math.max(0, (point.y - area.top) / room(area.height))) }
}

/** A place on the card as a corner in pixels. */
export function toPoint(place: Place, area: Area, size: number): { x: number; y: number } {
  return clampPoint(area.left + place.fx * Math.max(0, area.width - size), area.top + place.fy * Math.max(0, area.height - size), area, size)
}

/** A stored place, or nothing when there is none or it does not read as one. */
export function parsePlace(raw: string | null | undefined): Place | undefined {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as Partial<Place>
    return fraction(value.fx) && fraction(value.fy) ? { fx: value.fx, fy: value.fy } : undefined
  } catch {
    return undefined
  }
}

export function loadPlace(): Place | undefined {
  try {
    return parsePlace(localStorage.getItem(KEY))
  } catch {
    return undefined
  }
}

export function savePlace(place: Place): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(place))
  } catch {
    // It then stays put only until the page reloads.
  }
}
