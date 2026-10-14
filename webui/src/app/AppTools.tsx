/**
 * The app's own switches: the look (mode, colour theme and typeface in one pop-over), desktop notifications,
 * full screen, the key list, light or dark and the prompt sounds. Those were buried in Settings; they are
 * things you reach for while working, so they live on the sidebar's rail.
 * They sit at the foot of the sidebar (as icons on its folded rail, beside
 * Settings in the phone's sheet), and in the bar only on the sign-in and
 * loading pages, which have no sidebar. Each takes the look of where it sits.
 */
import { Bell, BellOff, Keyboard, Maximize, Minimize, Moon, Palette, Sun, Volume2, VolumeX } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/reui/popover"
import { toast } from "@/lib/toast"
import { Segmented } from "@/ui/Segmented"
import { TypefacePicker } from "@/ui/TypefacePicker"
import { ThemePicker } from "@/tabs/settings/ThemeGroup"
import { useFullscreen } from "./install"
import { disableNotifications, enableNotifications, useNotificationsEnabled } from "./notify"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Keys } from "@/components/ui/kbd"
import { useTheme } from "@/components/theme-provider"
import { useMediaQuery } from "./hooks.ts"
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
  const phone = useMediaQuery("(max-width: 767.98px)")
  const label = phone ? "App sounds" : muted ? "Unmute prompt sounds" : "Mute prompt sounds"
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label={label} aria-pressed={muted} aria-describedby={phone ? "app-sounds-help focused-action-help" : "focused-action-help"} className={className} onClick={() => setSoundMuted(!muted)}>
            {muted ? <VolumeX aria-hidden="true" className={ICON} /> : <Volume2 aria-hidden="true" className={ICON} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
      {phone ? (
        <span id="app-sounds-help" className="sr-only">
          App sounds controls prompt tones and navigation ticks.
        </span>
      ) : null}
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
        {dark ? "Light mode" : "Dark mode"} <span className="max-md:hidden"><Keys chord="D" /></span>
      </TooltipContent>
    </Tooltip>
  )
}

const MODES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
] as const

/** The look in one place: light, dark or the system's, the colour theme, and the typeface. */
export function AppearanceButton({ className, side = "top" }: { className: string; side?: Side }) {
  const { theme, setTheme } = useTheme()
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Appearance" className={className}>
              <Palette aria-hidden="true" className={ICON} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={side}>Appearance</TooltipContent>
      </Tooltip>
      <PopoverContent side={side === "right" ? "right" : "top"} align={side === "right" ? "start" : "center"} sideOffset={10} collisionPadding={12} aria-label="Appearance" onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).focus({ preventScroll: true }) }} tabIndex={-1} className="glass-pop flex max-h-[85svh] w-[26rem] max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto rounded-2xl p-3">
        <Segmented label="Mode" items={MODES} value={theme} onChange={(mode) => setTheme(mode)} className="w-full [&>button]:flex-1" />
        <div className="grid gap-1.5">
          <p className="px-0.5 text-xs font-medium text-muted-foreground">Colour theme</p>
          <div className="[&_[role=radiogroup]]:!grid-cols-3 [&_[role=radiogroup]]:gap-1.5">
            <ThemePicker />
          </div>
        </div>
        <div className="grid gap-1.5">
          <p className="px-0.5 text-xs font-medium text-muted-foreground">Typeface</p>
          <TypefacePicker kind="font" dense />
        </div>
        <a href="#/settings" className="px-0.5 text-xs text-link underline-offset-2 hover:underline">More in Settings</a>
      </PopoverContent>
    </Popover>
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
