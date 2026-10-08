export function taskRoute(rest: string[]) {
  const board = rest[0] === "board"
  const raw = rest[board ? 1 : 0]
  try { return { board, id: raw ? decodeURIComponent(raw) : undefined } }
  catch { return { board, id: raw } }
}
