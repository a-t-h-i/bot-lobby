/**
 * The shell that wraps every route: the rail on the left (Settings and the
 * app's switches) and beside it, top to bottom, the
 * top bar with the tabs, the page of the route lying flat beside the rail
 * (it eases in when the tab changes) and the composer under it. The composer
 * sits in the flow, so a tall message gives the page less room instead of
 * covering it; the page behind it never scrolls, only its panes do. Pop-ups
 * (the question, the key help) and toasts sit above everything, one at a
 * time. Clicking a tab or pressing a shortcut moves the hash route.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion } from "motion/react"
import { lobbyStore } from "@/lib/store"
import { act } from "@/lib/act"
import type { ConnectionState } from "@/lib/events"
import type { LobbySnapshot, StatusInfo } from "@protocol"
import type { TabId } from "@shared"
import { AltH } from "./AltH.tsx"
import { SoundToggle, ThemeToggle } from "./AppTools.tsx"
import { Composer } from "./Composer.tsx"
import { ProjectNotice, useProjects } from "./ProjectSwitcher.tsx"
import { cycleSession, toggleSidebarPin, useSidebar } from "./Sidebar.tsx"
import { RightBay, ShellFilters, useTabNavigator } from "./Bays.tsx"
import { TerminalDrawer, TerminalToggle } from "./TerminalDrawer.tsx"
import { toggleTerminal } from "./terminalStore.ts"
import { CodeToggle, CodeViewer } from "./code/CodeViewer.tsx"
import { toggleCode } from "./code/codeStore.ts"
import { SignIn } from "./SignIn.tsx"
import { ErrorState, LoadingState, ReconnectingState } from "./States.tsx"
import { useDrawer } from "@/prompts/Drawer"
import { isPlanPrompt, usePlanPrompts } from "@/prompts/planQuestions"
import { setPutAway, usePutAway } from "@/prompts/putAway"
import { Lightbox } from "@/ui/Lightbox"
import { useEvents } from "./useEvents.ts"
import { useRecoveredNotice } from "./recovered.ts"
import { syncThemes } from "./palette.ts"
import { useLobbyKeys } from "./useLobbyKeys.ts"
import { useDesktopNotifications } from "./notify.ts"
import { usePrompts } from "./usePrompts.ts"
import { useStatus, useTopic } from "./hooks.ts"
import { go, parseHash, tabHash, useRoute, type Route } from "./router.ts"
import { routeBody } from "@/tabs/registry.tsx"
import { ACTIVITY_OPEN } from "@/tabs/lobby/InlineActivity"
import { focusTab, isTyping, tabWalk } from "@/prompts/nav"
import { toggleCollapsed } from "@/lib/collapsed"

function handleAction(action: string, route: Route, toggleHelp: () => void, cycle: (delta: number) => void, toggleSidebar: () => void): void {
  if (action === "search") (document.querySelector<HTMLElement>("#main input[type='search']") ?? document.getElementById("composer-text"))?.focus()
  else if (action === "help") toggleHelp()
  else if (action === "settings") go("#/settings")
  else if (action === "thinking") {
    // Thinking sits inline in the Lobby: there the key opens or folds it, elsewhere it takes you there first.
    if (route.kind === "tab" && route.tab === "lobby") toggleCollapsed("lobby.thinking")
    else go(tabHash("lobby"))
  } else if (action === "nextSession" || action === "prevSession") void cycleSession(action === "nextSession" ? 1 : -1)
  else if (action === "sidebar") toggleSidebar()
  else if (action === "terminal") toggleTerminal()
  else if (action === "code") toggleCode()
  else if (action === "activity") {
    // Activity is the steps between the Lobby's messages: there the key opens or folds them all, elsewhere it takes you there first.
    if (route.kind === "tab" && route.tab === "lobby") toggleCollapsed(ACTIVITY_OPEN)
    else go(tabHash("lobby"))
  } else if (action === "nextTab") cycle(1)
  else if (action === "prevTab") cycle(-1)
  else if (action === "savePlan" && route.kind === "tab" && route.tab === "plan") void act("planner.save", {})
}

/** A button in the top right bay. */
const BAY_TOOL = "cs-iconbtn cs-sq10"

/** How long a stream that was live may be reconnecting before the page says pi is gone. */
const OUTAGE_MS = 2500

/**
 * Whether pi is gone: the stream closed, or a stream that was live has been
 * reconnecting for a few seconds (pi stopped; the browser keeps retrying).
 * A blip of a reconnect says nothing.
 */
function useOutage(connection: ConnectionState): boolean {
  const [long, setLong] = useState(false)
  const wasLive = useRef(false)
  if (connection === "live") wasLive.current = true
  useEffect(() => {
    if (connection !== "connecting" || !wasLive.current) return setLong(false)
    const timer = setTimeout(() => setLong(true), OUTAGE_MS)
    return () => clearTimeout(timer)
  }, [connection])
  return connection === "offline" || (connection === "connecting" && long)
}

function Banner({ connection, onRetry }: { connection: ConnectionState; onRetry: () => void }) {
  return useOutage(connection) ? <ReconnectingState onRetry={onRetry} /> : null
}

/**
 * Whether focus has moved since the address last changed: a click, Esc or a page's own key put it somewhere
 * the user chose, and the cursor going to the message box a frame after a route change must not undo that.
 */
const moments = { tick: 0, route: 0, focus: 0 }
window.addEventListener("hashchange", () => {
  moments.route = ++moments.tick
})
document.addEventListener("focusin", () => {
  moments.focus = ++moments.tick
})
const focusMovedSinceRoute = () => moments.focus > moments.route

/** The page changes with the tab (not with a detail inside it), easing in quickly. */
function routeKey(route: Route): string {
  return route.kind === "tab" ? route.tab : route.kind
}

export function Shell() {
  const route: Route = useRoute()
  const statusRecord = useTopic<StatusInfo>("status")
  // The Lobby topic stays subscribed on every page, so going back to the Lobby is instant.
  useTopic<LobbySnapshot>("lobby")
  const { prompts, loading: promptsLoading, answer, dismiss } = usePrompts()
  // The planning panel's open questions wait in the same drawer, after the Lobby's.
  const plan = usePlanPrompts()
  const allPrompts = useMemo(() => [...prompts, ...plan.prompts], [prompts, plan.prompts])
  const answerAny = useCallback((id: string, value: unknown) => (isPlanPrompt(id) ? plan.answer(id, value) : answer(id, value)), [answer, plan.answer])
  const dismissAny = useCallback((id: string) => (isPlanPrompt(id) ? plan.dismiss(id) : dismiss(id)), [dismiss, plan.dismiss])
  const drawer = useDrawer(allPrompts, answerAny, dismissAny)
  const { connection, signedOut } = useStatus()
  const [help, setHelp] = useState(false)
  const putAway = usePutAway()
  // With every question answered, the next one opens the drawer again.
  useEffect(() => {
    if (allPrompts.length === 0 && !promptsLoading) setPutAway(false)
  }, [allPrompts.length, promptsLoading])
  const rootRef = useRef<HTMLDivElement>(null)
  const retry = useEvents()
  useDesktopNotifications()

  const status = statusRecord.data
  useRecoveredNotice(status)
  // Signed in: the themes pi keeps replace this browser's copy.
  const themed = Boolean(status) && !signedOut
  useEffect(() => {
    if (themed) void syncThemes()
  }, [themed])
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
  const projects = useProjects()
  // The key pins the sidebar open or lets it fold back to its rail.
  const toggleSidebar = useCallback(() => toggleSidebarPin(), [])
  // A tab key opens the tab navigator for a moment, so you see where it took you.
  const flashTabs = useRef<(() => void) | null>(null)
  const onAction = useCallback((action: string) => {
    if ((action === "thinking" || action === "activity") && status?.panels?.[action] === false) return
    if (action === "nextTab" || action === "prevTab") flashTabs.current?.()
    // The route as the address bar has it right now: a key pressed in the frame after a jump must not act on the page just left.
    handleAction(action, parseHash(window.location.hash) ?? route, toggleHelp, cycle, toggleSidebar)
  }, [route, toggleHelp, cycle, toggleSidebar, status?.panels])
  const onTab = useCallback((id: string) => {
    flashTabs.current?.()
    select(id)
  }, [select])
  const insideApp = useCallback(() => {
    const el = document.activeElement
    if (!el || el === document.body || rootRef.current?.contains(el) === true || el.closest(".terminal-pop")) return true
    // A pop-up on its way out still holds focus for a moment; it is no longer in the way.
    return el.closest("[data-state='closed']") !== null
  }, [])
  useLobbyKeys({ enabled: Boolean(status), keys, tabs, insideApp, onAction, onTab })
  const reload = useCallback(() => lobbyStore.onHello({}), [])

  // Switching tabs puts the cursor in the message box, ready to write; Esc leaves it for the tab bar, and Down
  // from there walks into the page. Arrows walking the tab bar stay on the bar. On a touch screen the page takes
  // the keys instead, so the on-screen keyboard does not spring up at every tap of a tab.
  const tab = route.kind === "tab" ? route.tab : route.kind
  const ready = Boolean(status)
  useEffect(() => {
    if (!ready) return
    // Only the tab the arrows walked to keeps focus on the bar; any other route (a jump in the same moment) gets the box.
    const walked = tabWalk.active && tabWalk.to === tab
    tabWalk.active = false
    tabWalk.to = undefined
    if (walked) return
    const frame = requestAnimationFrame(() => {
      if (focusMovedSinceRoute() || document.querySelector("[role='dialog']:not([data-state='closed'])")) return
      const box = document.getElementById("composer-text") as HTMLTextAreaElement | null
      const coarse = window.matchMedia("(pointer: coarse)").matches
      if (!coarse && box && !box.disabled && !box.closest("[inert]")) box.focus({ preventScroll: true })
      else if (document.activeElement?.id !== "composer-text") document.getElementById("main")?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [tab, ready])

  const keyLabels = Object.fromEntries(keys.map((key) => [key.action, key.label]))
  const nav = useTabNavigator({ tabs, activeId, label: { id: "settings", text: "Settings" }, onSelect: select, flashRef: flashTabs })
  const sidebar = useSidebar({ route, keys: keyLabels, onHelp: toggleHelp })
  if (signedOut || !status) return (
    <div ref={rootRef} className="cs-frame">
      <ShellFilters />
      <main id="main" tabIndex={-1} className="cs-main">
        {signedOut ? <SignIn /> : statusRecord.error ? <ErrorState message={statusRecord.error} onRetry={reload} /> : <LoadingState />}
      </main>
      <RightBay>
        <ThemeToggle className={BAY_TOOL} side="bottom" />
        <SoundToggle className={BAY_TOOL} side="bottom" />
      </RightBay>
    </div>
  )
  return (
    // The page lies flat over the whole window; the sidebar, the tabs and the tools are bays on its edges.
    <div ref={rootRef} className="cs-frame" data-sb={sidebar.open ? "open" : "closed"} data-tb={nav.open ? "open" : "closed"}>
      <ShellFilters />
      <div className="cs-body">
        <Banner connection={connection} onRetry={retry} />
        {/* The page and the composer floating over its foot; the terminal drawer, when open, sits under both. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
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
            className="cs-main surface"
          >
            <motion.div
              key={routeKey(route)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {routeBody(route)}
            </motion.div>
          </main>
          <Composer route={route} projects={projects} drawer={drawer} drawerOpen={allPrompts.length > 0 && !putAway} />
        </div>
        <TerminalDrawer toggleKey={keyLabels.terminal ?? "Ctrl+`"} />
      </div>
      {sidebar.ghost}
      {nav.ghost}
      <RightBay>
        <CodeToggle hint={keyLabels.code} className={BAY_TOOL} />
        <TerminalToggle hint={keyLabels.terminal} className={BAY_TOOL} />
      </RightBay>
      {sidebar.bay}
      {nav.bay}
      <ProjectNotice projects={projects} />
      <span id="focused-action-help" className="sr-only">Focused buttons: Enter or Space. Links: Enter. Checkboxes: Space.</span>
      <CodeViewer codeKey={keys.find((key) => key.action === "code")?.key} />
      <Lightbox />
      <AltH open={help} onOpenChange={setHelp} keys={keys} tabs={tabs} />
    </div>
  )
}
