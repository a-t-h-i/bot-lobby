/**
 * Action buttons say what they do and which key does it: an icon, a short
 * word and the key cap (`Archive  E`, `Delete  Del`). A bare key is bound for
 * as long as the button is on the page (see `lib/hotkeys.ts`), so the whole
 * detail pane works from the keyboard. They live in a bar that stays at the
 * top of whatever scrolls, so they are always in reach; Left and Right move
 * between them. Tools that sit inside a row or a form can be `iconOnly`, with
 * the word in a tooltip.
 */
import { useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Keys } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isHotkey, useHotkey } from "@/lib/hotkeys"
import { cn } from "@/lib/utils"

type Tone = "neutral" | "primary" | "danger"

const TONES: Record<Tone, string> = {
  neutral: "text-foreground",
  primary: "",
  danger: "text-destructive hover:text-destructive",
}

export interface ActionButtonProps extends Omit<ComponentProps<typeof Button>, "children" | "size" | "variant" | "asChild"> {
  /** What it does: the accessible name (and the tooltip of an icon-only button). */
  label: string
  icon: LucideIcon
  tone?: Tone
  /** The key that does it: `E`, `Delete`, `Ctrl+S`. A bare key is bound; a chord is only printed. */
  shortcut?: string
  /** Makes it a link (it opens in a new tab). */
  href?: string
  pressed?: boolean
  /** The word printed on the button, when shorter than `label`. */
  text?: string
  /** Just the icon, the word in a tooltip. */
  iconOnly?: boolean
}

export function ActionButton({ label, icon: Icon, tone = "neutral", shortcut, href, pressed, text, iconOnly, className, disabled, ...props }: ActionButtonProps) {
  const node = useRef<HTMLButtonElement & HTMLAnchorElement>(null)
  const bound = isHotkey(shortcut)
  useHotkey(bound ? shortcut : undefined, () => node.current?.click(), { enabled: bound && !disabled })

  const icon = <Icon aria-hidden="true" />
  // The main action is filled in the accent, as in the harnesses; the rest are outlined, or bare when only an icon.
  const variant = tone === "primary" ? "default" : iconOnly ? "ghost" : "outline"
  const look = cn(
    !iconOnly && "px-2.5",
    TONES[tone],
    className,
  )
  const size = iconOnly ? "icon" : "default"
  const body = iconOnly ? (
    icon
  ) : (
    <>
      {icon}
      <span>{text ?? label}</span>
      {shortcut ? <Keys chord={shortcut} className="kbd-hint ml-1" /> : null}
    </>
  )
  const button = href ? (
    <Button asChild ref={node} variant={variant} size={size} data-tone={tone} className={look}>
      <a href={href} target="_blank" rel="noreferrer noopener" aria-label={label} aria-keyshortcuts={bound ? shortcut : undefined}>
        {body}
      </a>
    </Button>
  ) : (
    <Button
      ref={node}
      type="button"
      variant={variant}
      size={size}
      data-tone={tone}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={bound ? shortcut : undefined}
      disabled={disabled}
      className={look}
      {...props}
    >
      {body}
    </Button>
  )
  if (!iconOnly) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>
        {label}
        <Keys chord={shortcut ?? (href ? "Enter" : "Enter / Space")} />
      </TooltipContent>
    </Tooltip>
  )
}

/** The bar of a detail: a row of keycaps at the top of its slide-over, beside the close button. */
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
      className={cn("cs-ab", className)}
    >
      {children}
    </div>
  )
}
