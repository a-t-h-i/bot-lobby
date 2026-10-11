/**
 * The Thinking orb and its pane on every page, not only the Lobby: what the
 * agents last thought, and whether any of them is at work (the oracle, a run,
 * a session in the background). Hidden when `lobby.panels.thinking` is off.
 */
import { useEffect } from "react"
import type { LobbySnapshot, StatusInfo } from "@protocol"
import { useCollapsed } from "@/lib/collapsed"
import { busyAgents } from "@/tabs/lobby/busy"
import { Thoughts } from "@/tabs/lobby/Thoughts"
import { runsOf } from "@/tabs/lobby/types"
import { useApiRead } from "./useApiRead"

const PHONE_QUERY = "(max-width: 767.98px)"
const POPUP_GUTTER = 32

function clearThoughtPane(pane: HTMLElement): void {
  pane.style.removeProperty("max-height")
  pane.removeAttribute("data-phone-fit")
  const log = pane.querySelector<HTMLElement>("[role='log'][data-phone-fit]")
  if (!log) return
  log.style.removeProperty("min-height")
  log.style.removeProperty("overflow-y")
  log.removeAttribute("data-phone-fit")
}

function fitThoughtPane(): void {
  const pane = document.querySelector<HTMLElement>(".thought-pane")
  if (!pane) return
  if (!window.matchMedia(PHONE_QUERY).matches) {
    clearThoughtPane(pane)
    return
  }
  const viewport = window.visualViewport
  const top = viewport?.offsetTop ?? 0
  const bottom = top + (viewport?.height ?? window.innerHeight)
  const dockTop = document.getElementById("app-dock")?.getBoundingClientRect().top ?? bottom
  pane.style.maxHeight = `${Math.max(0, Math.min(bottom, dockTop) - top - POPUP_GUTTER)}px`
  pane.dataset.phoneFit = ""
  const log = pane.querySelector<HTMLElement>("[role='log']")
  if (log) {
    log.style.minHeight = "0"
    log.style.overflowY = "auto"
    log.dataset.phoneFit = ""
  }
}

function useThoughtPaneLayout(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const schedule = () => fitThoughtPane()
    const mutation = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(schedule)
    mutation?.observe(document.body, { childList: true, subtree: true })
    const dock = document.getElementById("app-dock")
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule)
    if (dock) resize?.observe(dock)
    const viewport = window.visualViewport
    window.addEventListener("resize", schedule)
    window.addEventListener("orientationchange", schedule)
    viewport?.addEventListener("resize", schedule)
    schedule()
    return () => {
      mutation?.disconnect()
      resize?.disconnect()
      window.removeEventListener("resize", schedule)
      window.removeEventListener("orientationchange", schedule)
      viewport?.removeEventListener("resize", schedule)
      document.querySelectorAll<HTMLElement>(".thought-pane[data-phone-fit]").forEach(clearThoughtPane)
    }
  }, [enabled])
}

export function Thinking({ status, lobby }: { status?: StatusInfo; lobby?: LobbySnapshot }) {
  const enabled = Boolean(status && status.panels?.thinking !== false)
  useThoughtPaneLayout(enabled)
  const [folded, toggle] = useCollapsed("lobby.thinking")
  const sessions = useApiRead("sessions.list", {}, ["sessions"])
  if (!status || status.panels?.thinking === false) return null
  const busy = busyAgents({
    oracleBusy: status.busy,
    runs: runsOf(lobby),
    activity: lobby?.activity ?? [],
    background: sessions.data?.background ?? [],
  })
  const shortcut = status.keys.find((key) => key.action === "thinking")?.label
  return <Thoughts thoughts={lobby?.thoughts ?? []} collapsed={folded} onToggle={toggle} shortcut={shortcut} busy={busy} />
}
