/**
 * The app's own switches: the key list, light or dark and the prompt sounds.
 * They sit at the foot of the sidebar (as icons on its folded rail, beside
 * Settings in the phone's sheet), and in the bar only on the sign-in and
 * loading pages, which have no sidebar. Each takes the look of where it sits.
 */
import { Keyboard, Moon, Sun, Volume2, VolumeX } from "lucide-react"
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
