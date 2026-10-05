/**
 * A question's mockups, expanded: one option per slide on a track you scroll
 * or swipe sideways, with the option's name, what it means and its mockup
 * (static HTML in its sandbox, an image, or a Markdown sketch) as large as the
 * window allows. Numbered pills and the arrows step between options, so do
 * ←/→, Home/End and the digits; Enter chooses the option in view when the
 * viewer was opened from a question that can still be answered.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { Check, ChevronLeft, ChevronRight, Minimize2 } from "lucide-react"
import { useReducedMotion } from "motion/react"
import { Button } from "@/components/ui/button"
import { KeyHint } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import { projectUrl } from "@/lib/project"
import type { HtmlPreview } from "@/lib/staticPreview"
import { Markdown } from "@/ui/Markdown"
import { StaticPreview } from "./StaticPreview"

export interface MockupOption {
  label: string
  description?: string
  /** A Markdown sketch: a layout in text, a snippet, a diagram. */
  preview?: string
  /** An image file in the project. */
  image?: string
  htmlPreview?: HtmlPreview
}

const RECOMMENDED = /\s*\(recommended\)\s*$/i
/** Narrower than this, a mockup is laid out at this width and scaled down rather than reflowed. */
const MIN_PAGE_WIDTH = 1024

/** An option's name without its `(Recommended)` marker. */
export const plainLabel = (label: string): string => label.replace(RECOMMENDED, "")

/** Whether an option has anything to look at. */
export function hasMockup(option: MockupOption | undefined): boolean {
  return Boolean(option && (option.htmlPreview || option.image || option.preview))
}

function Mockup({ option }: { option: MockupOption }) {
  const label = plainLabel(option.label)
  if (!hasMockup(option)) return <p className="grid h-full place-items-center p-6 text-sm text-muted-foreground">No mockup for this option.</p>
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {option.htmlPreview ? <StaticPreview preview={option.htmlPreview} label={label} minWidth={MIN_PAGE_WIDTH} className="h-auto min-h-[18rem] flex-1" /> : null}
      {option.image ? <img src={projectUrl(option.image)} alt={`Mockup: ${label}`} className="min-h-0 w-full flex-1 rounded-lg border bg-background object-contain" /> : null}
      {option.preview ? <Markdown text={option.preview} className={cn("overflow-auto rounded-lg border bg-background p-4 text-sm", !option.htmlPreview && !option.image && "flex-1")} /> : null}
    </div>
  )
}

interface ViewerProps {
  options: readonly MockupOption[]
  /** The option shown first. */
  start: number
  /** What the options answer: the question's header or text. */
  title: string
  /** Options already picked (ticked on their pill and slide). */
  picked?: readonly number[]
  multi?: boolean
  /** Choose the option in view (absent where the viewer only shows). */
  onChoose?: (option: number) => void
  /** Close it, told the option in view (the question then focuses that one). */
  onClose: (option: number) => void
  /** Told the option in view as it changes (Esc closes the viewer from outside it). */
  onIndex?: (option: number) => void
}

export function MockupViewer({ options, start, title, picked = [], multi = false, onChoose, onClose, onIndex }: ViewerProps) {
  const reduceMotion = useReducedMotion()
  const track = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(() => Math.min(Math.max(0, start), options.length - 1))
  const option = options[index]
  const last = options.length - 1
  useEffect(() => onIndex?.(index), [index, onIndex])

  // Open on the option asked for, without an animated scroll from the first.
  useLayoutEffect(() => {
    const element = track.current
    if (element) element.scrollLeft = index * element.clientWidth
    root.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = useCallback((to: number) => {
    const next = Math.min(Math.max(0, to), last)
    const element = track.current
    setIndex(next)
    element?.scrollTo({ left: next * element.clientWidth, behavior: reduceMotion ? "auto" : "smooth" })
  }, [last, reduceMotion])

  // A resized window keeps the option in view.
  useEffect(() => {
    const element = track.current
    if (!element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => { element.scrollLeft = index * element.clientWidth })
    observer.observe(element)
    return () => observer.disconnect()
  }, [index])

  function onScroll() {
    const element = track.current
    if (!element || element.clientWidth === 0) return
    const at = Math.round(element.scrollLeft / element.clientWidth)
    if (at !== index && at >= 0 && at <= last) setIndex(at)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement
    if (target.closest("input, textarea, [contenteditable='true']")) return
    const step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -1, PageDown: 1 }[event.key]
    if (step) {
      event.preventDefault()
      go(index + step)
      return
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      go(event.key === "Home" ? 0 : last)
      return
    }
    const digit = Number(event.key)
    if (Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
      event.preventDefault()
      go(digit - 1)
      return
    }
    if (event.key === "Enter" && onChoose && !(target instanceof HTMLButtonElement)) {
      event.preventDefault()
      onChoose(index)
    }
  }

  const on = picked.includes(index)
  return (
    <div ref={root} tabIndex={-1} data-autofocus="" onKeyDown={onKeyDown} className="mockup-viewer flex h-full min-h-0 flex-col outline-none" role="region" aria-label={`Mockups: ${title}`} aria-roledescription="carousel">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to the question" title="Back · Esc" onClick={() => onClose(index)}>
          <Minimize2 aria-hidden="true" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
        <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {index + 1} of {options.length}
        </span>
        <div role="tablist" aria-label="Options" className="flex w-full flex-wrap gap-1.5 sm:w-auto">
          {options.map((entry, position) => (
            <button
              key={position}
              type="button"
              role="tab"
              aria-selected={position === index}
              aria-controls={`mockup-slide-${position}`}
              data-compact=""
              onClick={() => go(position)}
              className={cn(
                "inline-flex h-7 max-w-48 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                position === index ? "border-primary/50 bg-accent text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <span className="tabular-nums text-muted-foreground">{position + 1}</span>
              <span className="truncate">{plainLabel(entry.label)}</span>
              {picked.includes(position) ? <Check aria-label="picked" className="size-3 text-primary" /> : null}
            </button>
          ))}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={track} onScroll={onScroll} className="mockup-track flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain">
          {options.map((entry, position) => (
            <section
              key={position}
              id={`mockup-slide-${position}`}
              role="tabpanel"
              aria-roledescription="slide"
              aria-label={`${position + 1} of ${options.length}: ${plainLabel(entry.label)}`}
              aria-hidden={position !== index}
              className="flex h-full w-full shrink-0 snap-center snap-always flex-col gap-2 px-4 py-4 sm:px-14"
            >
              <div className="flex items-baseline gap-2 text-sm">
                <span className="text-muted-foreground tabular-nums">{position + 1}.</span>
                <span className="font-medium">{plainLabel(entry.label)}</span>
                {RECOMMENDED.test(entry.label) ? <span className="text-xs font-medium text-primary">Recommended</span> : null}
                {picked.includes(position) ? <span className="inline-flex items-center gap-1 text-xs text-primary"><Check aria-hidden="true" className="size-3" />picked</span> : null}
              </div>
              {entry.description ? <Markdown text={entry.description} className="text-sm text-muted-foreground" /> : null}
              <div className="min-h-0 flex-1">
                <Mockup option={entry} />
              </div>
            </section>
          ))}
        </div>
        {index > 0 ? (
          <Button type="button" variant="outline" size="icon" aria-label="Previous option" title="Previous · ←" onClick={() => go(index - 1)} className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full max-sm:hidden">
            <ChevronLeft aria-hidden="true" />
          </Button>
        ) : null}
        {index < last ? (
          <Button type="button" variant="outline" size="icon" aria-label="Next option" title="Next · →" onClick={() => go(index + 1)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full max-sm:hidden">
            <ChevronRight aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-3 sm:px-5">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <KeyHint chord="←→">option</KeyHint>
          {onChoose ? <KeyHint chord="Enter">{multi ? (on ? "unpick" : "pick") : "choose"}</KeyHint> : null}
          <KeyHint chord="Esc">back</KeyHint>
        </p>
        {onChoose && option ? (
          <Button type="button" onClick={() => onChoose(index)} className="max-w-full">
            {multi && on ? "Unpick" : multi ? "Pick" : "Choose"}
            <span className="truncate">{plainLabel(option.label)}</span>
          </Button>
        ) : null}
      </footer>
    </div>
  )
}
