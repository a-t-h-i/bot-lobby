/**
 * The Thinking orb and its pane on every page, not only the Lobby: what the
 * agents last thought, and whether any of them is at work (the oracle, a run,
 * a session in the background). Hidden when `lobby.panels.thinking` is off.
 */
import type { LobbySnapshot, StatusInfo } from "@protocol"
import { useCollapsed } from "@/lib/collapsed"
import { busyAgents } from "@/tabs/lobby/busy"
import { Thoughts } from "@/tabs/lobby/Thoughts"
import { runsOf } from "@/tabs/lobby/types"
import { useApiRead } from "./useApiRead"

export function Thinking({ status, lobby }: { status?: StatusInfo; lobby?: LobbySnapshot }) {
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
