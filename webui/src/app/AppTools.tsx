/**
 * The app's own switches: desktop notifications, full screen, the key list, light or dark and the prompt
 * sounds, things you reach for while working, so they live on the sidebar's rail. The look (mode, colour
 * theme and typeface) is chosen in Settings, under Appearance.
 * They sit at the foot of the sidebar, and in the bar only on the sign-in and
 * loading pages, which have no sidebar. Each takes the look of where it sits.
 */
import { Bell, BellOff, Keyboard, Maximize, Minimize, Moon, Sun, Volume2, VolumeX } from "lucide-react"
import { toast } from "@/lib/toast"
import { useFullscreen } from "./install"
import { disableNotifications, enableNotifications, useNotificationsEnabled } from "./notify"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Keys } from "@/components/ui/kbd"
import { useTheme } from "@/components/theme-provider"
import { setSoundMuted, useSoundMuted } from "./sound"

type Side = "top" | "right" | "bottom"

const ICON = "size-[1.05rem]"

export function HelpButton({ hint, onHelp, className, side = "top" }: { hint: string; onHelp: () => void; className: string; side?: Side }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Keyboard shortcuts" aria-haspopup="dialog" aria-keyshortcuts={hint} aria-describedby="focused-action-help" onClick={onHelp} className={className}>
          <Keyboard aria-hidden="true" className={ICON} />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>
        Keyboard shortcuts <Keys chord={hint} />
      </TooltipContent>
    </Tooltip>
  )
}

export function SoundToggle({ className, side = "top" }: { className: string; side?: Side }) {
  const muted = useSoundMuted()
  const label = muted ? "Unmute prompt sounds" : "Mute prompt sounds"
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label={label} aria-pressed={muted} aria-describedby="focused-action-help" className={className} onClick={() => setSoundMuted(!muted)}>
            {muted ? <VolumeX aria-hidden="true" className={ICON} /> : <Volume2 aria-hidden="true" className={ICON} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </>
  )
}

export function ThemeToggle({ className, side = "top" }: { className: string; side?: Side }) {
  const { theme, setTheme } = useTheme()
  const dark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          aria-keyshortcuts="D"
          aria-describedby="focused-action-help"
          onClick={() => setTheme(dark ? "light" : "dark")}
          className={className}
        >
          {dark ? <Sun aria-hidden="true" className={ICON} /> : <Moon aria-hidden="true" className={ICON} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>
        {dark ? "Light mode" : "Dark mode"} <Keys chord="D" />
      </TooltipContent>
    </Tooltip>
  )
}

export function NotifyToggle({ className, side = "top" }: { className: string; side?: Side }) {
  const enabled = useNotificationsEnabled()
  const label = enabled ? "Turn off desktop notifications" : "Turn on desktop notifications"
  const change = async () => {
    if (enabled) return disableNotifications()
    const result = await enableNotifications()
    if (result === "granted") toast.success("Desktop notifications are on.")
    else toast.error(result === "unsupported" ? "This browser cannot show notifications." : "Notifications are blocked for this page in the browser's settings.")
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} aria-pressed={enabled} className={className} onClick={() => void change()}>
          {enabled ? <Bell aria-hidden="true" className={ICON} /> : <BellOff aria-hidden="true" className={ICON} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

export function FullscreenToggle({ className, side = "top" }: { className: string; side?: Side }) {
  const fullscreen = useFullscreen()
  if (!fullscreen.supported) return null
  const label = fullscreen.on ? "Leave full screen" : "Full screen"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} aria-pressed={fullscreen.on} className={className} onClick={() => void fullscreen.toggle()}>
          {fullscreen.on ? <Minimize aria-hidden="true" className={ICON} /> : <Maximize aria-hidden="true" className={ICON} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
