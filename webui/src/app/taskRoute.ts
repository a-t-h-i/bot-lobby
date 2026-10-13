export function taskRoute(rest: string[]) {
  const raw = rest[0]
  try { return { id: raw ? decodeURIComponent(raw) : undefined } }
  catch { return { id: raw } }
}
