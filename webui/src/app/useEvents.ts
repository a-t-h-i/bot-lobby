/**
 * Follow `GET /api/events` and feed every event into the store. Returns a
 * `retry` that drops the current stream and opens a fresh one (the "Retry now"
 * button); the browser's own EventSource reconnect still runs in between.
 */
import { useCallback, useEffect, useRef } from "react"
import { openEvents } from "@/lib/events"
import { lobbyStore } from "@/lib/store"
import { toast } from "@/lib/toast"

export function useEvents(): () => void {
  const closeRef = useRef<(() => void) | undefined>(undefined)
  const connect = useCallback(() => {
    closeRef.current?.()
    closeRef.current = openEvents({
      onHello: (versions) => lobbyStore.onHello(versions),
      onChanged: (topic, version) => lobbyStore.onChanged(topic, version),
      onFeed: (delta) => lobbyStore.onFeedDelta(delta),
      onReply: (text) => lobbyStore.onReplyDelta(text),
      onNotice: (text, level) => toast[level](text),
      onConnection: (connection) => lobbyStore.onStatus({ connection }),
    })
  }, [])
  useEffect(() => {
    connect()
    return () => closeRef.current?.()
  }, [connect])
  return connect
}
