/**
 * Read one API call and read it again whenever a lobby topic it depends on
 * changes. The store only bumps versions for topics the stream announces, so
 * this works for tabs whose topic the shell does not pre-read. Old data stays
 * on screen while a reread is under way.
 */
import { useCallback, useEffect, useState } from "react"
import { call } from "@/lib/api"
import { lobbyStore } from "@/lib/store"
import type { Api, ApiName, LobbyTopic } from "@protocol"
import { useStoreVersion } from "./hooks.ts"

export interface ApiRead<T> {
  data: T | undefined
  error: string | undefined
  loading: boolean
  reload: () => void
}

export function useApiRead<Name extends ApiName>(
  name: Name,
  body: Api[Name]["request"],
  topics: LobbyTopic[],
  enabled = true
): ApiRead<Api[Name]["result"]> {
  useStoreVersion()
  const [state, setState] = useState<{ data?: Api[Name]["result"]; error?: string; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  // A reconnect rereads too: changes announced while the stream was down were missed.
  const versions = [lobbyStore.status().connection, ...topics.map((topic) => lobbyStore.get(topic).version)].join(",")
  const key = JSON.stringify(body)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    setState((now) => ({ ...now, loading: true }))
    call(name, JSON.parse(key) as Api[Name]["request"]).then(
      (data) => alive && setState({ data, loading: false }),
      (error: unknown) => alive && setState((now) => ({ ...now, error: error instanceof Error ? error.message : String(error), loading: false }))
    )
    return () => {
      alive = false
    }
  }, [name, key, versions, tick, enabled])

  const reload = useCallback(() => setTick((count) => count + 1), [])
  return { data: state.data, error: state.error, loading: state.loading, reload }
}
