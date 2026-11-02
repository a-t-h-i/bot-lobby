/**
 * The px sizes in the stylesheets are turned into rem at build time (see
 * vite.config.ts), against a 15px root. The root is smaller on a desktop
 * (index.css), so the whole UI draws a little smaller there. Sizes kept in
 * code, such as a bubble's width or the sidebar's, follow the same scale
 * through these helpers.
 */
export const PX_BASE = 15

/** The root font size over the 15px the sizes were drawn at: 0.9 on a desktop, 1 on a touch screen. */
export function uiScale(): number {
  if (typeof document === "undefined") return 1
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return size > 0 ? size / PX_BASE : 1
}

/** A size drawn at the 15px root, in px at the current scale. */
export function ui(px: number): number {
  return Math.round(px * uiScale())
}

/** A size drawn at the 15px root, as a rem length for a style or CSS variable. */
export function rem(px: number): string {
  return `${Number((px / PX_BASE).toFixed(5))}rem`
}

/** A width and height drawn at the 15px root, at the current scale. */
export function uiSize(size: { w: number; h: number }): { w: number; h: number } {
  const k = uiScale()
  return { w: Math.round(size.w * k), h: Math.round(size.h * k) }
}
