/**
 * React bindings to the framework-agnostic `lobbyStore`: a re-render tick on
 * every change, typed topic reads and a viewport query. The store mutates its
 * records in place, so a listener tick is what tells React to read again.
 */
import { useCallback, useEffect, useReducer, useSyncExternalStore } from "react"
import { lobbyStore, type StoreStatus, type TopicRecord } from "@/lib/store"
import type { LobbyTopic } from "@protocol"

/** A counter that grows on every store notification. */
export function useStoreVersion(): number {
  const [version, bump] = useReducer((count: number) => count + 1, 0)
  useEffect(() => lobbyStore.subscribe(bump), [])
  return version
}

/** The connection and sign-in state. */
export function useStatus(): StoreStatus {
  useStoreVersion()
  return lobbyStore.status()
}

/** One topic's record; rerenders on any store change. */
export function useTopic<T>(topic: LobbyTopic): TopicRecord<T> {
  useStoreVersion()
  return lobbyStore.get(topic) as TopicRecord<T>
}

/** Whether a media query currently matches, and on every change. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    [query]
  )
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, snapshot)
}
