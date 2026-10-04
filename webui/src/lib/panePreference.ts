/** Thinking is a transient modal; stored activity preferences remain durable. */
export function initiallyCollapsed(key: string, stored?: string | null): boolean {
  return key === "lobby.thinking" || stored === "1"
}
