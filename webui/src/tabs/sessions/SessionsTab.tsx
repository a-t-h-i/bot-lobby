/**
 * One background session's conversation, opened from a task (`#/sessions/<key>`):
 * there is no list of sessions any more. The floating box messages it; this
 * window's own session is the Lobby, so its key goes there. The session is read
 * again on every `sessions` topic change.
 */
import { useEffect } from "react"
import { go } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useTopic } from "@/app/hooks"
import { useApiRead } from "@/app/useApiRead"
import { setComposerSession } from "@/lib/composerContext"
import type { LobbySnapshot, StatusInfo } from "@protocol"
import { ListSkeleton } from "@/ui/SplitPane"
import { SessionDetail } from "./SessionDetail"
import { addressOf, buildEntries, type Entry } from "./words"

function Missing() {
  return (
    <div className="flex flex-col items-start gap-3 p-6">
      <p className="text-sm text-muted-foreground">That session has ended or is no longer listed.</p>
      <a href="#/tasks" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Back to Tasks</a>
    </div>
  )
}

export function SessionsTab({ id }: { id: string }) {
  const status = useTopic<StatusInfo>("status").data
  const lobby = useTopic<LobbySnapshot>("lobby").data
  const asked = useTopic<{ prompts: unknown[] }>("prompts").data?.prompts.length ?? 0
  const read = useApiRead("sessions.list", {}, ["sessions"])
  const entries = buildEntries(status, lobby, asked, read.data?.background ?? [], read.data?.live ?? [])
  const picked: Entry | undefined = entries.find((entry) => entry.id === id)
  const here = picked?.where === "this window"
  // The floating box messages the session (this window's own goes to its oracle, in the Lobby).
  const address = picked && !here && picked.alive ? addressOf(picked) : undefined
  const addressKey = address ? JSON.stringify(address) : ""
  const pickedName = picked?.name
  useEffect(() => {
    setComposerSession(address && pickedName ? { name: pickedName, address } : undefined)
    return () => setComposerSession(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, pickedName])
  useEffect(() => {
    if (here) go("#/lobby")
  }, [here])
  if (!read.data && read.error) return <ErrorState message={`Could not load the session. ${read.error}`} onRetry={read.reload} />
  if (!read.data) return <ListSkeleton />
  if (!picked || here) return <Missing />
  return (
    <div className="workspace-pane mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-xl border shadow-xs">
      <SessionDetail key={picked.id} entry={picked} lobby={lobby} onChanged={read.reload} />
    </div>
  )
}
