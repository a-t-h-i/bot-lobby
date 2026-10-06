/**
 * What the floating composer can address beyond the route: the task a Tasks
 * tab has open, and the session a Sessions page has picked. The tab says
 * which one is chosen (the route alone does not, when the first row is chosen
 * for you) and clears it when it goes.
 */
import { useSyncExternalStore } from "react"

export interface ComposerSession {
  name: string
  address: { key: string } | { sessionId: string }
}

interface Context {
  taskId?: string
  session?: ComposerSession
}

let context: Context = {}
const listeners = new Set<() => void>()

function update(next: Context): void {
  context = next
  for (const listener of [...listeners]) listener()
}

export function setComposerTask(taskId: string | undefined): void {
  if (context.taskId === taskId) return
  update({ ...context, taskId })
}

export function setComposerSession(session: ComposerSession | undefined): void {
  const same = context.session?.name === session?.name && JSON.stringify(context.session?.address) === JSON.stringify(session?.address)
  if (same) return
  update({ ...context, session })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useComposerContext(): Context {
  return useSyncExternalStore(subscribe, () => context, () => context)
}
