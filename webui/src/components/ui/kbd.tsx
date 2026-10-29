// Adapted from T3 Code (MIT), apps/web/src/components/ui/kbd.tsx
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** The look of one key cap: a quiet muted fill with no edge, as in the harnesses. It reads on a button, in a tooltip and on the page. */
export const KBD_CLASS = cn(
  "pointer-events-none inline-flex h-[1.125rem] min-w-[1.125rem] w-fit items-center justify-center gap-1 rounded-[4px] border border-[var(--edge)] bg-[var(--hover)] px-[5px] font-sans text-[11px] leading-none font-medium text-muted-foreground select-none",
  "in-data-[variant=default]:bg-primary-foreground/16 in-data-[variant=default]:text-primary-foreground",
  "in-data-[variant=destructive]:bg-white/16 in-data-[variant=destructive]:text-current",
  "[&_svg:not([class*='size-'])]:size-3"
)

/** A single key cap. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return <kbd data-slot="kbd" className={cn(KBD_CLASS, className)} {...props} />
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-0.5", className)}
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
  delete: "Del",
  backspace: "⌫",
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
        <span key={position} className="inline-flex items-center gap-0.5">
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
    <span className={cn("kbd-hint inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground", className)}>
      <Keys chord={chord} />
      {children}
    </span>
  )
}

export { Kbd, KbdGroup, KeyHint, Keys }
