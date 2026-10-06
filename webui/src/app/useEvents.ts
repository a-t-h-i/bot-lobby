/**
 * Follow `GET /api/events` and feed every event into the store. Returns a
 * `retry` that drops the current stream and opens a fresh one (the "Retry now"
 * button); the browser's own EventSource reconnect still runs in between.
 *
 * A stream the browser gives up on (pi stopped, or the project behind the
 * entry answers no more) is opened again every few seconds until pi is back.
 * A project whose pi came back under a new id is found again by its folder,
 * in place: nothing on the page is reset by the outage.
 */
import { useCallback, useEffect, useRef } from "react"
import type { ProjectInfo } from "@protocol"
import { call } from "@/lib/api"
import { openEvents } from "@/lib/events"
import { lobbyStore } from "@/lib/store"
import { toast } from "@/lib/toast"
import { projectFolder, rememberProjects, relinkProject, selectedProject } from "@/lib/project"

/** How long a closed stream waits before it is opened again. */
export const RETRY_MS = 2000

const listProjects = () => call<{ projects: ProjectInfo[] }>("projects.list", {})

/** Learn the folder of the project the page looks at, once, so it can be found again after its pi restarts. */
async function learnFolder(): Promise<void> {
  let id: string | undefined
  try { id = selectedProject() } catch { return }
  if (!id || projectFolder(id)) return
  try { rememberProjects((await listProjects()).projects) } catch { /* Learned on the next connect. */ }
}

export function useEvents(): () => void {
  const closeRef = useRef<(() => void) | undefined>(undefined)
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const connect = useCallback(() => {
    clearTimeout(retryRef.current)
    closeRef.current?.()
    try { selectedProject() }
    catch { lobbyStore.onStatus({ connection: "offline" }); return }
    closeRef.current = openEvents({
      onHello: (versions) => {
        lobbyStore.onHello(versions)
        void learnFolder()
      },
      onChanged: (topic, version) => lobbyStore.onChanged(topic, version),
      onFeed: (delta) => lobbyStore.onFeedDelta(delta),
      onReply: (text) => lobbyStore.onReplyDelta(text),
      onNotice: (text, level) => toast[level](text),
      onConnection: (connection) => {
        lobbyStore.onStatus({ connection })
        if (connection !== "offline") return
        clearTimeout(retryRef.current)
        retryRef.current = setTimeout(() => {
          void relinkProject(listProjects).catch(() => false).finally(connect)
        }, RETRY_MS)
      },
    })
  }, [])
  useEffect(() => {
    connect()
    return () => {
      clearTimeout(retryRef.current)
      closeRef.current?.()
    }
  }, [connect])
  return connect
}
