import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 w-fit items-center justify-center gap-1 rounded-lg border border-border border-b-2 bg-muted px-1.5 font-sans text-[0.7rem] leading-none font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:border-background/30 in-data-[slot=tooltip-content]:bg-transparent in-data-[slot=tooltip-content]:text-background [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

const MAC_MODIFIERS: Record<string, string> = { alt: "⌥", ctrl: "⌃", shift: "⇧", meta: "⌘", cmd: "⌘" }
const NAMED: Record<string, string> = {
  enter: "↵",
  esc: "Esc",
  escape: "Esc",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  space: "Space",
}

/** `Alt+Shift+K` as the caps to print: `⌥ ⇧ K` on a Mac, `Alt Shift K` elsewhere; `Enter` is `↵`. */
export function chordParts(chord: string): string[] {
  return chord.split("+").map((part) => {
    const lower = part.toLowerCase()
    if (MAC && MAC_MODIFIERS[lower]) return MAC_MODIFIERS[lower]!
    return NAMED[lower] ?? (part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1))
  })
}

/** A key chord as separate caps, `Alt` `H`; screen readers get the words with a plus between. */
function Keys({ chord, className }: { chord: string; className?: string }) {
  const parts = chordParts(chord)
  return (
    <KbdGroup className={className}>
      {parts.map((part, position) => (
        <span key={position} className="inline-flex items-center gap-1">
          {position > 0 ? <span className="sr-only">plus</span> : null}
          <Kbd>{part}</Kbd>
        </span>
      ))}
    </KbdGroup>
  )
}

/** A quiet one-line hint: the caps, then what they do. */
function KeyHint({ chord, children, className }: { chord: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground", className)}>
      <Keys chord={chord} />
      {children}
    </span>
  )
}

export { Kbd, KbdGroup, KeyHint, Keys }
