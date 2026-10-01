/**
 * The page's first moves: trade a `#token=` for the session cookie, then tell
 * the store which topics the shell uses and how to read them. Runs once; the
 * event stream starts separately in `useEvents`.
 */
import { useEffect, useState } from "react"
import { signIn } from "@/lib/api"
import { lobbyStore } from "@/lib/store"
import type { LobbyTopic } from "@protocol"
import { readTopic } from "./readTopic.ts"

/** Topics the shell reads on every route. */
const SHELL_TOPICS: LobbyTopic[] = ["status", "lobby", "prompts"]

/** `true` once sign-in has been attempted and the store is following topics. */
export function useBootstrap(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    void (async () => {
      await signIn()
      if (!alive) return
      lobbyStore.markUsed(SHELL_TOPICS, readTopic)
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [])
  return ready
}
