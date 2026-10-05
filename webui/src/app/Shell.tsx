/**
 * The shell that wraps every route, laid out top to bottom: the top bar with
 * the project and the tabs, one bordered surface for the page of the route
 * (it eases in when the tab changes) and the composer under it. The composer
 * sits in the flow, so a tall message gives the page less room instead of
 * covering it; the page behind it never scrolls, only its panes do. Pop-ups
 * (the question, the key help) and toasts sit above everything, one at a
 * time. Clicking a tab or pressing a shortcut moves the hash route.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import { lobbyStore } from "@/lib/store"
import { act } from "@/lib/act"
import type { ConnectionState } from "@/lib/events"
import type { LobbySnapshot, StatusInfo } from "@protocol"
import type { TabId } from "@shared"
import { AltH } from "./AltH.tsx"
import { Composer } from "./Composer.tsx"
import { Header } from "./Header.tsx"
import { SignIn } from "./SignIn.tsx"
import { ErrorState, LoadingState, ReconnectingState } from "./States.tsx"
import { TabStrip } from "./TabStrip.tsx"
import { QuestionPopup, QuestionsPill } from "@/prompts/QuestionPopup"
import { useEvents } from "./useEvents.ts"
import { useLobbyKeys } from "./useLobbyKeys.ts"
import { useDesktopNotifications } from "./notify.ts"
import { usePrompts } from "./usePrompts.ts"
import { useStatus, useTopic } from "./hooks.ts"
import { go, parseHash, tabHash, useRoute, type Route } from "./router.ts"
import { routeBody } from "@/tabs/registry.tsx"
import { focusTab, isTyping, tabWalk } from "@/prompts/nav"
import { toggleCollapsed } from "@/lib/collapsed"

function handleAction(action: string, route: Route, toggleHelp: () => void, cycle: (delta: number) => void): void {
  if (action === "search") (document.querySelector<HTMLElement>("#main input[type='search']") ?? document.getElementById("composer-text"))?.focus()
  else if (action === "help") toggleHelp()
  else if (action === "settings") go("#/settings")
  else if (action === "sessions") go("#/sessions")
  else if (action === "activity" || action === "thinking") {
    // The cards live on the Lobby: there the key folds or opens one, elsewhere it takes you there first.
    if (route.kind === "tab" && route.tab === "lobby") toggleCollapsed(`lobby.${action}`)
    else go(tabHash("lobby"))
  } else if (action === "nextTab") cycle(1)
  else if (action === "prevTab") cycle(-1)
  else if (action === "savePlan" && route.kind === "tab" && route.tab === "plan") void act("planner.save", {})
}

function Banner({ connection, onRetry }: { connection: ConnectionState; onRetry: () => void }) {
  if (connection === "offline") return <ReconnectingState onRetry={onRetry} />
  return null
}

/** The page changes with the tab (not with a detail inside it), easing in quickly. */
function routeKey(route: Route): string {
  return route.kind === "tab" ? route.tab : route.kind
}

export function Shell() {
  const route: Route = useRoute()
  const statusRecord = useTopic<StatusInfo>("status")
  const lobbyRecord = useTopic<LobbySnapshot>("lobby")
  const { prompts, answer, dismiss } = usePrompts()
  const { connection, signedOut } = useStatus()
  const [help, setHelp] = useState(false)
  const [putAway, setPutAway] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const retry = useEvents()
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
  const onAction = useCallback((action: string) => {
    if ((action === "thinking" || action === "activity") && status?.panels?.[action] === false) return
    // The route as the address bar has it right now: a key pressed in the frame after a jump must not act on the page just left.
    handleAction(action, parseHash(window.location.hash) ?? route, toggleHelp, cycle)
  }, [route, toggleHelp, cycle, status?.panels])
  const insideApp = useCallback(() => {
    const el = document.activeElement
    if (!el || el === document.body || rootRef.current?.contains(el) === true || el.closest(".thinking-bubble")) return true
    // A pop-up on its way out still holds focus for a moment; it is no longer in the way.
    return el.closest("[data-state='closed']") !== null
  }, [])
  useLobbyKeys({ enabled: Boolean(status), keys, tabs, insideApp, onAction, onTab: select })
  const reload = useCallback(() => lobbyStore.onHello({}), [])

  // Switching tabs puts the cursor in the message box, so you can just type (unless the arrows are walking the tab bar).
  const tab = route.kind === "tab" ? route.tab : route.kind
  const ready = Boolean(status)
  useEffect(() => {
    if (!ready) return
    if (tabWalk.active) {
      tabWalk.active = false
      return
    }
    const frame = requestAnimationFrame(() => {
      const box = document.getElementById("composer-text")
      if (box && !box.closest("[inert]") && !document.querySelector("[role='dialog']")) box.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [tab, ready])

  const keyLabels = Object.fromEntries(keys.map((key) => [key.action, key.label]))
  const header = <Header
        status={status}
        task={lobbyRecord.data?.task}
        connection={connection}
        route={route}
        keys={keyLabels}
        onHelp={toggleHelp}
        tabs={<TabStrip tabs={tabs} activeId={activeId} onSelect={select} />}
        extra={putAway && prompts.length > 0 ? <QuestionsPill count={prompts.length} onOpen={() => setPutAway(false)} /> : null}
      />
  if (signedOut || !status) return (
    <div ref={rootRef} className="fixed inset-0 flex flex-col">
      {header}
      <main className="surface mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-y-auto max-sm:mx-0 max-sm:mb-0">
        {signedOut ? <SignIn /> : statusRecord.error ? <ErrorState message={statusRecord.error} onRetry={reload} /> : <LoadingState />}
      </main>
    </div>
  )
  return (
    <div ref={rootRef} className="fixed inset-0 flex flex-col">
      {header}
      <Banner connection={connection} onRetry={retry} />
      <main
        id="main"
        tabIndex={-1}
        onKeyDown={(event) => {
          // Esc from the page goes back up to the tab bar.
          if (event.key !== "Escape" || event.defaultPrevented || isTyping(event.target)) return
          if ((event.target as HTMLElement).closest("[role='dialog'], [role='menu'], [role='listbox']")) return
          if (focusTab()) event.preventDefault()
        }}
        role={activeId ? "tabpanel" : undefined}
        aria-labelledby={activeId ? `tab-${activeId}` : undefined}
        className="surface mx-3 flex min-h-0 flex-1 flex-col overflow-y-auto outline-none max-sm:mx-0"
      >
        <motion.div
          key={routeKey(route)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {routeBody(route)}
        </motion.div>
      </main>
      <Composer route={route} keys={keyLabels} onHelp={toggleHelp} />
      <QuestionPopup prompts={prompts} answer={answer} dismiss={dismiss} minimized={putAway} onMinimize={setPutAway} />
      <AltH open={help} onOpenChange={setHelp} keys={keys} tabs={tabs} />
    </div>
  )
}
