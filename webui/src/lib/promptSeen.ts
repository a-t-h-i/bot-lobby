export interface SeenStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** Each channel seeds quietly; shared persisted identities suppress reload/reconnect replay. */
export class PromptSeen {
  private seen = new Set<string>()
  private initialized = new Set<string>()
  private storage?: SeenStorage
  constructor(storage?: SeenStorage) {
    this.storage = storage
    try { const saved: unknown = JSON.parse(storage?.getItem("bot-lobby.prompt-seen") ?? "[]"); if (Array.isArray(saved)) this.seen = new Set(saved.filter((id): id is string => typeof id === "string")) } catch { /* Storage is optional. */ }
  }
  observe(channel: string, ids: string[], quiet = false): string[] {
    const seeded = this.initialized.has(channel)
    const fresh = seeded && !quiet ? ids.filter((id) => !this.seen.has(id)) : []
    this.initialized.add(channel)
    for (const id of ids) this.seen.add(id)
    try { this.storage?.setItem("bot-lobby.prompt-seen", JSON.stringify([...this.seen])) } catch { /* Keep in-memory deduplication. */ }
    return fresh
  }
}
export function promptIdentity(project: string, id: string): string { return JSON.stringify([project, "prompt", id]) }
export function dialogIdentity(project: string, session: string, dialog: string): string { return JSON.stringify([project, "dialog", session, dialog]) }
export function deliveryIdentity(project: string, task: string, review: string): string { return JSON.stringify([project, "delivery", task, review]) }
