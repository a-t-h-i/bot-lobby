/**
 * Pure display formatting for the page: clock times, elapsed spans and byte
 * sizes. No DOM and no clock reads, so it runs anywhere; every formatter
 * guards non-finite input and renders `0`/`0s` rather than `NaN`.
 */

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** A clock time as `12:04`; `0` when `at` is not a finite number. */
export function formatClock(at: number): string {
  if (!Number.isFinite(at)) return "0"
  const date = new Date(at)
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
}

/** A span as `40s`, `2m` or `1h 05m`; `0s` for a non-finite or negative span. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s"
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${twoDigits(minutes % 60)}m`
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

/** A size as `512 B` or `1.2 KB`; `0` for a non-finite or non-positive size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0"
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

/** How long ago, as `now`, `40s`, `12m`, `3h` or `4d` (mirrors the terminal's `ago`). */
export function formatAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 5_000) return "now"
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

/** `just now` or `12m ago` for a span in milliseconds. */
export function formatSince(ms: number): string {
  const age = formatAgo(ms)
  return age === "now" ? "just now" : `${age} ago`
}
