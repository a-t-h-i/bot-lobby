/**
 * The shell that wraps every route (batch-1 §a), drawn like the terminal
 * lobby (D-21): the title line with the tabs as its cells, an optional
 * banner, one scrolling main pane, the docked composer and the key line.
 * Clicking a tab or pressing a shortcut moves the hash route; the Alt+H
 * overlay lists the key map.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { PI_ASKING_IN_TERMINAL, type TabId } from "@shared"
import { Kbd } from "@/components/ui/kbd"
import { lobbyStore } from "@/lib/store"
import type { ConnectionState } from "@/lib/events"
import type { LobbySnapshot, StatusInfo } from "@protocol"
import { AltH } from "./AltH.tsx"
import { Composer } from "./Composer.tsx"
import { Header } from "./Header.tsx"
import { SignIn } from "./SignIn.tsx"
import { ErrorState, LoadingState, ReconnectingState, sentence } from "./States.tsx"
import { TabStrip } from "./TabStrip.tsx"
import { PromptSlideout } from "@/prompts/PromptSlideout"
import { useEvents } from "./useEvents.ts"
import { useLobbyKeys } from "./useLobbyKeys.ts"
import { useDesktopNotifications } from "./notify.ts"
import { usePrompts } from "./usePrompts.ts"
import { useStoreVersion, useStatus, useTopic } from "./hooks.ts"
import { go, tabHash, useRoute, type Route } from "./router.ts"
import { routeBody } from "@/tabs/registry.tsx"

function useNotices(): void {
  useStoreVersion()
  const record = lobbyStore.get("notices") as { version: number; data?: { message?: string; text?: string } }
  const last = useRef(record.version)
  useEffect(() => {
    if (record.version <= last.current) return
    last.current = record.version
    toast(record.data?.message ?? record.data?.text ?? "New lobby notice")
  }, [record.version, record.data])
}

function handleAction(action: string, toggleHelp: () => void, cycle: (delta: number) => void): void {
  if (action === "help") toggleHelp()
  else if (action === "settings") go("#/settings")
  else if (action === "sessions") go("#/sessions")
  else if (action === "nextTab") cycle(1)
  else if (action === "prevTab") cycle(-1)
  else if (action === "search") toast("Search arrives with the Lobby tab.")
  else if (action === "savePlan") toast("Saving the plan arrives with the Plan tab.")
}

function Banner({ status, connection, onRetry }: { status?: StatusInfo; connection: ConnectionState; onRetry: () => void }) {
  if (status?.terminalDialog) {
    return (
      <div role="status" className="shrink-0 px-[1ch] py-1 text-sm font-bold text-warning">
        {sentence(PI_ASKING_IN_TERMINAL)} — answer it there; this page waits.
      </div>
    )
  }
  if (connection === "offline") return <ReconnectingState onRetry={onRetry} />
  if (connection === "connecting") {
    return <div className="shrink-0 px-[1ch] py-1 text-sm text-muted-foreground">Reconnecting…</div>
  }
  return null
}

function Hint({ keys, children, typing }: { keys: string; children: string; typing?: boolean }) {
  // Shown while you type in a field (TYPE) or while you do not (BROWSE), as the terminal swaps its key line.
  const when = typing === undefined ? "flex" : typing ? "hidden group-has-[textarea:focus]/shell:flex" : "flex group-has-[textarea:focus]/shell:hidden"
  return (
    <span className={`${when} items-center gap-[1ch]`}>
      <Kbd>{keys}</Kbd> {children}
    </span>
  )
}

/** The terminal's key line: the mode in a lit cell, then each key in the accent colour and what it does. */
function KeyLine({ tabCount }: { tabCount: number }) {
  return (
    <div className="flex shrink-0 items-center gap-x-[2ch] overflow-hidden px-[1ch] py-1 text-xs whitespace-nowrap text-muted-foreground">
      <span className="rounded-md bg-accent px-[1ch] font-bold text-foreground group-has-[textarea:focus]/shell:hidden">BROWSE</span>
      <span className="hidden rounded-md bg-accent px-[1ch] font-bold text-primary group-has-[textarea:focus]/shell:inline">TYPE</span>
      <Hint keys="Enter" typing>
        send
      </Hint>
      <Hint keys="Shift+Enter" typing>
        new line
      </Hint>
      {tabCount > 0 ? (
        <Hint keys={`Alt+1…${tabCount}`} typing={false}>
          tabs
        </Hint>
      ) : null}
      <Hint keys="Alt+]" typing={false}>
        next tab
      </Hint>
      <Hint keys="Alt+[" typing={false}>
        previous tab
      </Hint>
      <Hint keys="Alt+H">keys</Hint>
    </div>
  )
}

export function Shell() {
  const route: Route = useRoute()
  const statusRecord = useTopic<StatusInfo>("status")
  const lobbyRecord = useTopic<LobbySnapshot>("lobby")
  const { prompts, answer, dismiss } = usePrompts()
  const { connection, signedOut } = useStatus()
  const [help, setHelp] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const retry = useEvents()
  useNotices()
  useDesktopNotifications()

  const status = statusRecord.data
  const tabs = status?.tabs ?? []
  const keys = status?.keys ?? []
  const activeId = route.kind === "tab" ? route.tab : undefined

  const select = useCallback((id: string) => go(tabHash(id as TabId)), [])
  const cycle = useCallback(
    (delta: number) => {
      if (tabs.length === 0) return
      const index = Math.max(0, tabs.findIndex((tab) => tab.id === activeId))
      const next = tabs[(index + delta + tabs.length) % tabs.length]
      if (next) go(tabHash(next.id as TabId))
    },
    [tabs, activeId]
  )
  const toggleHelp = useCallback(() => setHelp((open) => !open), [])
  const onAction = useCallback((action: string) => handleAction(action, toggleHelp, cycle), [toggleHelp, cycle])
  const insideApp = useCallback(() => {
    const el = document.activeElement
    return !el || el === document.body || rootRef.current?.contains(el) === true
  }, [])
  useLobbyKeys({ enabled: Boolean(status), keys, tabs, insideApp, onAction, onTab: select })
  const reload = useCallback(() => lobbyStore.onHello({}), [])

  if (signedOut) return <SignIn />
  if (!status && statusRecord.loading) return <LoadingState />
  if (!status && statusRecord.error) return <ErrorState message={statusRecord.error} onRetry={reload} />
  if (!status) return <LoadingState />

  return (
    <div
      ref={rootRef}
      className="group/shell flex h-svh flex-col overflow-hidden bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      <Header
        status={status}
        task={lobbyRecord.data?.task}
        connection={connection}
        tabs={<TabStrip tabs={tabs} activeId={activeId} questionCount={prompts.length} onSelect={select} />}
      />
      <Banner status={status} connection={connection} onRetry={retry} />
      <main
        id="main"
        role={activeId ? "tabpanel" : undefined}
        aria-labelledby={activeId ? `tab-${activeId}` : undefined}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {routeBody(route)}
      </main>
      <PromptSlideout prompts={prompts} answer={answer} dismiss={dismiss} />
      <Composer />
      <KeyLine tabCount={tabs.length} />
      <AltH open={help} onOpenChange={setHelp} keys={keys} tabs={tabs} />
    </div>
  )
}
