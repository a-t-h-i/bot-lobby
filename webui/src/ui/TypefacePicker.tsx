/**
 * The typeface choice: a tile per face with a sample drawn in it, as a radio group (arrow keys move and pick).
 * `dense` is the sidebar's version: one line per face.
 */
import { useRef, type KeyboardEvent } from "react"
import { Check } from "lucide-react"
import { CODE_FACES, FACE_STACKS, TEXT_FACES, setTypeface, useTypeface } from "@/app/typeface"
import { cn } from "@/lib/utils"

export function TypefacePicker({ kind, dense = false }: { kind: "font" | "mono"; dense?: boolean }) {
  const faces = kind === "font" ? TEXT_FACES : CODE_FACES
  const current = useTypeface(kind)
  const group = useRef<HTMLDivElement>(null)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
    if (!step) return
    event.preventDefault()
    event.stopPropagation()
    const index = Math.max(0, faces.findIndex((face) => face.id === current))
    const next = faces[(index + step + faces.length) % faces.length]!
    setTypeface(kind, next.id)
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-face="${next.id}"]`)?.focus())
  }

  return (
    <div ref={group} role="radiogroup" aria-label={kind === "font" ? "Typeface" : "Code typeface"} onKeyDown={onKeyDown}
      className={dense ? "flex flex-col gap-0.5" : "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"}>
      {faces.map((face) => {
        const on = face.id === current
        const stack = FACE_STACKS[face.id]
        return (
          <button key={face.id} type="button" role="radio" aria-checked={on} data-face={face.id} tabIndex={on ? 0 : -1} onClick={() => setTypeface(kind, face.id)}
            className={cn(
              "outline-none transition-[background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              dense
                ? "flex min-h-8 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-accent max-md:min-h-11"
                : cn("grid gap-1 rounded-xl border p-2.5 text-left", on ? "border-primary bg-accent shadow-[0_0_0_1px_var(--primary)]" : "border-[var(--glass-edge)] hover:bg-accent/50")
            )}>
            <span aria-hidden="true" className={cn("leading-none", dense ? "w-7 text-base" : "text-2xl")} style={stack ? { fontFamily: stack } : kind === "mono" ? { fontFamily: "var(--app-font-mono, ui-monospace, monospace)" } : undefined}>
              {kind === "font" ? "Aa" : "{ }"}
            </span>
            <span className={cn("flex min-w-0 items-center justify-between gap-2", dense && "flex-1")}>
              <span className="min-w-0">
                <span className="block truncate text-[0.8125rem] font-medium">{face.label}</span>
                {dense ? null : <span className="block truncate text-xs text-muted-foreground">{face.help}</span>}
              </span>
              {on ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" /> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
