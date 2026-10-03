/**
 * Action buttons are icons with a tooltip that says what they do (and the
 * accessible name), and they live in a bar that stays at the top of whatever
 * scrolls, so they are always in reach. Left and Right move between them.
 */
import type { ComponentProps, KeyboardEvent, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Keys } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type Tone = "neutral" | "primary" | "danger"

const TONES: Record<Tone, string> = {
  neutral: "text-muted-foreground hover:text-foreground",
  primary: "",
  danger: "text-destructive hover:bg-destructive/10 hover:text-destructive",
}

export interface ActionButtonProps extends Omit<ComponentProps<typeof Button>, "children" | "size" | "variant" | "asChild"> {
  /** What it does: the tooltip and the accessible name. */
  label: string
  icon: LucideIcon
  tone?: Tone
  /** Printed beside the label in the tooltip, e.g. `Ctrl+S`. */
  shortcut?: string
  /** Makes it a link (it opens in a new tab). */
  href?: string
  pressed?: boolean
}

export function ActionButton({ label, icon: Icon, tone = "neutral", shortcut, href, pressed, className, ...props }: ActionButtonProps) {
  const look = cn(TONES[tone], className)
  const icon = <Icon aria-hidden="true" />
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Button asChild variant={tone === "primary" ? "default" : "ghost"} size="icon" className={look}>
            <a href={href} target="_blank" rel="noreferrer noopener" aria-label={label}>
              {icon}
            </a>
          </Button>
        ) : (
          <Button type="button" variant={tone === "primary" ? "default" : "ghost"} size="icon" aria-label={label} aria-pressed={pressed} className={look} {...props}>
            {icon}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? <Keys chord={shortcut} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** The bar of a detail pane: pinned to its top edge while the pane scrolls. */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (!step) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")]
    const at = buttons.indexOf(event.target as HTMLElement)
    if (at < 0) return
    event.preventDefault()
    // The pane's own Left/Right (back to the list) must not also fire.
    event.stopPropagation()
    buttons[Math.max(0, Math.min(buttons.length - 1, at + step))]?.focus()
  }
  return (
    <div
      role="toolbar"
      aria-label="Actions"
      onKeyDown={onKeyDown}
      className={cn("sticky -top-4 z-10 -mx-4 -mt-4 flex min-h-10 flex-wrap items-center gap-0.5 border-b border-border bg-card/90 px-3 py-1 backdrop-blur-sm", className)}
    >
      {children}
    </div>
  )
}
