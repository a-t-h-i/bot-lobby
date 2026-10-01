/**
 * The shell that wraps every route (batch-1 §a): header, pill tab strip, an
 * optional banner, one scrolling main pane, the docked composer and the hint
 * line. Clicking a pill or pressing a shortcut moves the hash route; the
 * Alt+H overlay lists the key map.
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
      <div role="status" className="shrink-0 border-b bg-muted px-4 py-2 text-sm">
        {sentence(PI_ASKING_IN_TERMINAL)} — answer it there; this page waits.
      </div>
    )
  }
  if (connection === "offline") return <ReconnectingState onRetry={onRetry} />
  if (connection === "connecting") {
    return <div className="shrink-0 border-b bg-muted px-4 py-2 text-sm text-muted-foreground">Reconnecting…</div>
  }
  return null
}

function HintLine() {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Kbd>Alt+]</Kbd> next tab
      </span>
      <span className="flex items-center gap-1">
        <Kbd>Alt+[</Kbd> previous tab
      </span>
      <span className="flex items-center gap-1">
        <Kbd>Alt+H</Kbd> keys
      </span>
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
      className="flex h-svh flex-col overflow-hidden bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      <Header status={status} task={lobbyRecord.data?.task} connection={connection} />
      <TabStrip tabs={tabs} activeId={activeId} questionCount={prompts.length} onSelect={select} />
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
      <HintLine />
      <AltH open={help} onOpenChange={setHelp} keys={keys} tabs={tabs} />
    </div>
  )
}
