/**
 * The Sessions page (`alt+o`): this window, the background sessions it
 * started and live sessions in other terminals, beside the picked one's
 * conversation (a sheet below 1024 px). The floating box messages the picked
 * session or starts a task in a new one; other windows' web UIs are linked. `#/sessions/<key>` picks
 * one; the list is read again on every `sessions` topic change.
 */
import { useEffect } from "react"
import { go } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useTopic } from "@/app/hooks"
import { useApiRead } from "@/app/useApiRead"
import { setComposerSession } from "@/lib/composerContext"
import type { LobbySnapshot, StatusInfo } from "@protocol"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { Section } from "@/ui/Section"
import { SessionDetail } from "./SessionDetail"
import { SessionList } from "./SessionList"
import { NO_OTHERS, addressOf, buildEntries, type Entry } from "./words"

const close = () => go("#/sessions")
const select = (id: string) => go(`#/sessions/${encodeURIComponent(id)}`)

function Windows({ windows }: { windows: StatusInfo["windows"] }) {
  if (windows.length === 0) return null
  return (
    <div className="px-3 pb-3">
      <Section title="Other windows">
        <ul className="flex flex-col">
          {windows.map((window) => (
            <li key={window.url}>
              <a
                href={window.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-10 items-center rounded-xl px-2 text-sm text-foreground underline underline-offset-4 hover:bg-muted"
              >
                {window.name}
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function Missing() {
  return <p className="text-sm text-muted-foreground">That session is not on the list any more.</p>
}

export function SessionsTab({ id }: { id?: string }) {
  const wide = useWide()
  const status = useTopic<StatusInfo>("status").data
  const lobby = useTopic<LobbySnapshot>("lobby").data
  const asked = useTopic<{ prompts: unknown[] }>("prompts").data?.prompts.length ?? 0
  const read = useApiRead("sessions.list", {}, ["sessions"])
  if (!read.data && read.error) return <ErrorState message={`Could not load sessions. ${read.error}`} onRetry={read.reload} />
  const entries = buildEntries(status, lobby, asked, read.data?.background ?? [], read.data?.live ?? [])
  const chosen = id ?? (wide ? entries[0]?.id : undefined)
  const picked: Entry | undefined = entries.find((entry) => entry.id === chosen)
  // The floating box can message the picked session (this window's own goes to its oracle).
  const address = picked && picked.where !== "this window" && picked.alive ? addressOf(picked) : undefined
  const addressKey = address ? JSON.stringify(address) : ""
  const pickedName = picked?.name
  useEffect(() => {
    setComposerSession(address && pickedName ? { name: pickedName, address } : undefined)
    return () => setComposerSession(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, pickedName])
  const list = (
    <>
      <PaneHeader title="Sessions" count={String(entries.length)} />
      {read.data ? <SessionList entries={entries} selectedId={chosen} onSelect={select} /> : <ListSkeleton />}
      {read.data && entries.length === 1 ? <p className="px-4 pb-3 text-sm text-muted-foreground">{NO_OTHERS}</p> : null}
      <Windows windows={status?.windows ?? []} />
    </>
  )
  const detail = picked ? <SessionDetail key={picked.id} entry={picked} lobby={lobby} onChanged={read.reload} /> : id ? <Missing /> : null
  return <SplitPane wide={wide} list={list} detail={detail} open={Boolean(id)} onClose={close} hint="Select a session to see its conversation." describe="Session detail" />
}
