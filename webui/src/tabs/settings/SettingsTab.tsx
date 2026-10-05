/**
 * The Settings route (`#/settings`): read `settings.get`, keep the returned
 * config as the form's source of truth, and hand changes back to it. The
 * form saves each change as its own patch; a refused one leaves the field
 * showing the config the server last returned.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import type { BotLobbyConfig } from "@protocol"
import { SettingsForm } from "./SettingsForm"
import { PAGE } from "./words"

function Skeleton() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-5 sm:p-8" role="status" aria-label={PAGE.loading}>
      {[0, 1, 2, 3].map((card) => (
        <div key={card} className="h-48 rounded-lg bg-muted motion-safe:animate-pulse" />
      ))}
    </div>
  )
}

export function SettingsTab() {
  const read = useApiRead("settings.get", {}, ["status"])
  const [config, setConfig] = useState<BotLobbyConfig>()
  // A save's reply is the config as it stands after that save. A re-read that was asked for before the reply can
  // land after it with older values, and must not put them back (the sliders would jump to where they were).
  const answeredAt = useRef(0)
  const saved = useCallback((next: BotLobbyConfig) => {
    answeredAt.current = performance.now()
    setConfig(next)
  }, [])
  useEffect(() => {
    if (read.data && read.requestedAt > answeredAt.current) setConfig(read.data.config)
  }, [read.data, read.requestedAt])
  if (!config && read.error) return <ErrorState message={`${PAGE.loadFailed} ${read.error}`} onRetry={read.reload} />
  if (!config) return <Skeleton />
  return <SettingsForm config={config} models={read.data?.models ?? []} onConfig={saved} />
}
