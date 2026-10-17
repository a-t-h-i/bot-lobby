/**
 * The controls for one lobby question, inside the question pop-up: per-question
 * chips, numbered options with Markdown descriptions and `(Recommended)`
 * markers, the own answer field and the focused option's preview (beside the
 * options on wide windows, below them on narrow ones). Every mockup expands
 * (its button, or E) into the mockup viewer, where the user scrolls through
 * every option's mockup and can choose from there. `choose`, `confirm`, `text`
 * and `sessionDialog` reuse the same surface with their own controls and
 * answer shapes.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react"
import { animate, type AnimationPlaybackControls, type ValueAnimationTransition } from "motion/react"
import { Check, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KeyHint } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { projectUrl } from "@/lib/project"
import { Markdown } from "@/ui/Markdown"
import { StaticPreview } from "./StaticPreview"
import { hasMockup, MockupViewer } from "./MockupViewer"
import { horizontalStep, isTyping, moveNav, verticalStep } from "./nav"
import type { AskAnswer, AskQuestion, AskResult, AskOption, PromptView, SessionDialog } from "./payload"
import { RichAnswer, type RichAnswerHandle } from "./RichAnswer"

interface CardProps {
  view: PromptView
  submitting: boolean
  onAnswer: (value: unknown) => void
  onCancel: () => void
  /** The mockup viewer is open (the pop-up widens for it and Esc closes it first). */
  expanded?: boolean
  onExpand?: (expanded: boolean) => void
  /** How much room the question in view wants: the pop-up widens for long questions and mockups. */
  onSize?: (size: QuestionSize) => void
}

export type QuestionSize = "md" | "lg" | "xl"

/** Mockups get the widest pop-up; a long question or many options a wider one. */
export function sizeFor(question: AskQuestion | undefined): QuestionSize {
  if (!question) return "md"
  if (question.options.some(hasMockup)) return "xl"
  const words = question.question.length + question.options.reduce((sum, option) => sum + option.label.length + (option.description?.length ?? 0), 0)
  return words > 700 || question.options.length > 6 ? "lg" : "md"
}

const RECOMMENDED = /\s*\(recommended\)\s*$/i
/** The page width a mockup is laid out at before it is scaled into the preview. */
const MOCKUP_WIDTH = 1200
const OWN_ANSWER = "Type something."

function splitRecommended(label: string): { text: string; recommended: boolean } {
  return { text: label.replace(RECOMMENDED, ""), recommended: RECOMMENDED.test(label) }
}

function OptionLabel({ label }: { label: string }) {
  const { text, recommended } = splitRecommended(label)
  return (
    <span className="leading-snug break-words">
      {text}
      {recommended ? <span className="ms-1 font-medium text-primary">(Recommended)</span> : null}
    </span>
  )
}

function CheckMark({ multi, on }: { multi: boolean; on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative mt-0.5 flex size-4 shrink-0 items-center justify-center border",
        multi ? "rounded-lg" : "rounded-full",
        on ? "border-primary bg-primary text-primary-foreground" : "border-input"
      )}
    >
      {on ? <Check className={cn(multi ? "size-3" : "hidden")} /> : null}
      {on && !multi ? <span className="size-2 rounded-full bg-primary-foreground" /> : null}
    </span>
  )
}

function OptionRow({
  option,
  index,
  multi,
  name,
  selected,
  onToggle,
  onFocusOption,
}: {
  option: AskOption
  index: number
  multi: boolean
  name?: string
  selected: boolean
  onToggle: () => void
  onFocusOption?: () => void
}) {
  return (
    <div className="grid gap-1">
    <label
      className={cn(
        "flex min-h-9 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-start text-sm transition-[background-color,border-color,transform] duration-150 ease-snap active:scale-[0.99]",
        selected ? "border-primary/50 bg-accent" : "border-input bg-background hover:bg-accent/60",
        "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/30"
      )}
    >
      <input type={multi ? "checkbox" : "radio"} name={name} data-nav="" data-option={index} className="sr-only" checked={selected} onChange={onToggle} onFocus={onFocusOption} />
      <CheckMark multi={multi} on={selected} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex gap-1.5">
          <span aria-hidden="true" className="text-muted-foreground tabular-nums">{index + 1}.</span>
          <OptionLabel label={option.label} />
        </span>
      </span>
    </label>
    {option.description ? <Markdown text={option.description} className="px-3 text-muted-foreground" /> : null}
    </div>
  )
}

function Preview({ option, onExpand }: { option?: AskOption; onExpand: () => void }) {
  if (!option || !hasMockup(option)) return null
  return (
    <div className="card-flat flex min-w-0 max-w-full flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">Preview · {splitRecommended(option.label).text}</p>
        <Button type="button" variant="ghost" size="xs" onClick={onExpand} aria-keyshortcuts="E" title="Expand · E" className="-my-1 shrink-0">
          <Maximize2 aria-hidden="true" />
          Expand
        </Button>
      </div>
      {option.image ? (
        <img src={projectUrl(option.image)} alt="" loading="lazy" className="max-h-64 w-full rounded-lg border object-contain" />
      ) : null}
      {option.htmlPreview ? <StaticPreview preview={option.htmlPreview} label={splitRecommended(option.label).text} frameWidth={MOCKUP_WIDTH} onOpen={onExpand} className="h-auto aspect-[3/2]" /> : null}
      {option.preview ? <Markdown text={option.preview} className="text-xs" /> : null}
    </div>
  )
}

/**
 * The options as dots on a dotted line down the left, the one in view ringed and joined to the panel by a short
 * line. Switching works like the tab bar's straw: a drop of colour runs down (or up) the dotted line from the old
 * dot to the new, the old ring drains away, and where it lands the new ring springs open, its line shoots out to
 * the panel and the panel takes a little knock the way the colour was going. Under reduced motion the ring just
 * moves. Each dot's name shows beside it on hover and focus, and the panel names the one in view.
 */
function DotOption({ option, index, multi, name, selected, active, onToggle, onFocusOption }: {
  option: AskOption
  index: number
  multi: boolean
  name: string
  selected: boolean
  active: boolean
  onToggle: () => void
  onFocusOption: () => void
}) {
  const { text, recommended } = splitRecommended(option.label)
  const full = recommended ? `${text} (Recommended)` : text
  return (
    <label data-active={active || undefined} data-picked={selected || undefined} className="q-dot group relative flex h-11 w-full shrink-0 cursor-pointer items-center justify-center outline-none">
      <input type={multi ? "checkbox" : "radio"} name={name} data-nav="" data-option={index} aria-label={full} className="sr-only" checked={selected} onChange={onToggle} onFocus={onFocusOption} />
      <span aria-hidden="true" className={cn("q-dot-mark relative z-10 flex size-5 items-center justify-center rounded-full text-[0.625rem] font-semibold tabular-nums transition-[background-color,color,scale] duration-200 ease-snap group-hover:scale-110", recommended && "q-dot-star")}>{index + 1}</span>
      <span aria-hidden="true" className="q-dot-tag pointer-events-none absolute top-1/2 left-[calc(100%+0.5rem)] z-30 -translate-y-1/2 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap opacity-0 transition-[opacity,translate] duration-150 ease-snap group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 group-data-[active]:!opacity-0">
        {index + 1}. {full}
      </span>
    </label>
  )
}

const DROP_HEAD: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.2, bounce: 0.12 }
const DROP_TAIL: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.2, bounce: 0.04, delay: 0.06 }
const RING_OPEN: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.28, bounce: 0.55 }
const LINE_OUT: ValueAnimationTransition<number> = { type: "spring", visualDuration: 0.2, bounce: 0 }
const KNOCK: ValueAnimationTransition<number> = { type: "spring", stiffness: 900, damping: 18, velocity: 50, restDelta: 0.02, restSpeed: 1 }

/** Where the rail hands over to the own-answer field: `active` is this when the field has the focus. */
const OWN = -1

/**
 * The ring on the dot in view, its line to the panel, the dotted line from the first dot to the last, and the drop
 * that runs between dots on a switch. With the own-answer field in focus (`active` is OWN) the ring drains and the
 * drop runs on past the last dot into the field, where `onOwnLand` lights it up; leaving the field pours it back.
 */
function useDotRail(rail: RefObject<HTMLDivElement | null>, panel: RefObject<HTMLDivElement | null>, own: RefObject<RichAnswerHandle | null>, active: number, view: string, onOwnLand: () => void) {
  const track = useRef<HTMLSpanElement>(null)
  const ring = useRef<HTMLSpanElement>(null)
  const line = useRef<HTMLSpanElement>(null)
  const drop = useRef<HTMLSpanElement>(null)
  const was = useRef<number | undefined>(undefined)
  const runs = useRef<AnimationPlaybackControls[]>([])

  const landOwn = useRef(onOwnLand)
  landOwn.current = onOwnLand

  const centre = useCallback((index: number) => {
    if (index === OWN) {
      const field = own.current?.element
      const box = rail.current
      return field && box ? field.getBoundingClientRect().top - box.getBoundingClientRect().top + 6 : undefined
    }
    const dot = rail.current?.querySelectorAll<HTMLElement>(".q-dot")[index]
    return dot ? dot.offsetTop + dot.offsetHeight / 2 : undefined
  }, [rail, own])

  // The dotted line runs from the first dot to the last, no further.
  const seat = useCallback(() => {
    const line = track.current
    const dots = rail.current?.querySelectorAll<HTMLElement>(".q-dot")
    if (!line || !dots || dots.length === 0) return
    const first = dots[0]!
    const last = dots[dots.length - 1]!
    const top = first.offsetTop + first.offsetHeight / 2
    line.style.top = `${top}px`
    line.style.height = `${Math.max(0, last.offsetTop + last.offsetHeight / 2 - top)}px`
  }, [rail])

  const place = useCallback((y: number | undefined, open = 1, reach = 1) => {
    const ringEl = ring.current
    const lineEl = line.current
    if (!ringEl || !lineEl) return
    if (y === undefined) {
      ringEl.style.opacity = "0"
      lineEl.style.opacity = "0"
      return
    }
    ringEl.style.opacity = String(Math.min(1, open * 3))
    ringEl.style.transform = `translate(-50%, ${y}px) translateY(-50%) scale(${Math.max(0, open)})`
    lineEl.style.opacity = reach > 0.02 ? "1" : "0"
    lineEl.style.transform = `translateY(${y}px) scaleX(${Math.max(0, Math.min(1, reach))})`
  }, [])

  // A new question, or the rail back from the mockup viewer: the ring is placed, not poured.
  const seen = useRef(view)
  useLayoutEffect(() => {
    if (seen.current !== view) {
      seen.current = view
      was.current = undefined
    }
    seat()
    for (const run of runs.current) run.stop()
    runs.current = []
    if (panel.current) panel.current.style.translate = ""
    const from = was.current
    was.current = active
    const to = centre(active)
    const start = from === undefined ? undefined : centre(from)
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const dropEl = drop.current
    if (dropEl) dropEl.style.opacity = "0"
    if (to === undefined || start === undefined || from === active || reduced || !dropEl) {
      place(active === OWN ? undefined : to)
      if (active === OWN && from !== active && from !== undefined) landOwn.current()
      return
    }
    const dir = to > start ? 1 : -1
    const now = { head: 0, tail: 0 }
    let landed = false
    const spring = (from: number, to: number, transition: ValueAnimationTransition<number>, onUpdate: (value: number) => void) => {
      const run = animate(from, to, { ...transition, onUpdate })
      runs.current.push(run)
      return run
    }
    const drawDrop = () => {
      const head = start + (to - start) * now.head
      const tail = start + (to - start) * now.tail
      dropEl.style.opacity = Math.abs(head - tail) > 1 ? "1" : "0"
      dropEl.style.transform = `translateY(${Math.min(head, tail)}px)`
      dropEl.style.height = `${Math.abs(head - tail)}px`
    }
    const land = () => {
      if (landed) return
      landed = true
      if (active === OWN) {
        place(undefined)
        landOwn.current()
        return
      }
      // Placed where the dot is now, not where it was when the drop left: the layout can shift on the way.
      const state = { open: 0, reach: 0 }
      const here = () => centre(active) ?? to
      spring(0, 1, RING_OPEN, (value) => { state.open = value; place(here(), state.open, state.reach) })
      spring(0, 1, { ...LINE_OUT, delay: 0.05 }, (value) => { state.reach = value; place(here(), state.open, state.reach) })
      const box = panel.current
      if (box) spring(0, 0, { ...KNOCK, delay: 0.1 }, (value) => { box.style.translate = Math.abs(value) > 0.01 ? `0 ${(dir * value).toFixed(2)}px` : "" })
    }
    // The old ring drains as the drop leaves it.
    spring(1, 0, { type: "spring", visualDuration: 0.12, bounce: 0 }, (value) => { if (!landed) place(from === OWN ? undefined : start, value, value) })
    spring(0, 1, DROP_HEAD, (value) => { now.head = value; drawDrop(); if (value > 0.85) land() })
    spring(0, 1, DROP_TAIL, (value) => { now.tail = value; drawDrop() })
    return () => {
      for (const run of runs.current) run.stop()
    }
  }, [active, view, centre, panel, place, seat])

  // Anything that moves the dots (the window, the pop-up widening, the panel or the own-answer field growing) puts
  // the ring back onto the active dot without animating.
  useEffect(() => {
    const el = rail.current
    if (!el || typeof ResizeObserver === "undefined") return
    let frame = 0
    const reseat = () => {
      frame = 0
      seat()
      // A ring still springing open follows the dot by itself; otherwise it is put there now.
      if (!runs.current.some((run) => run.state === "running")) place(was.current === OWN ? undefined : centre(was.current ?? 0))
    }
    const observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(reseat) })
    observer.observe(el)
    if (panel.current) observer.observe(panel.current)
    const field = own.current?.element
    if (field) observer.observe(field)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [rail, panel, own, centre, place, seat])

  return { track, ring, line, drop }
}

function OptionPanel({ option, position, count, chosen, onExpand, panel, dim }: { option?: AskOption; position: number; count: number; chosen: boolean; onExpand: () => void; panel: RefObject<HTMLDivElement | null>; dim?: boolean }) {
  if (!option) return null
  const { text, recommended } = splitRecommended(option.label)
  const mockup = hasMockup(option)
  return (
    <div ref={panel} data-dim={dim || undefined} data-chosen={chosen || undefined} className="q-panel min-w-0 rounded-2xl p-4 transition-opacity duration-300 data-[dim]:opacity-55">
      <div key={position} aria-live="polite" className={cn("q-panel-body grid min-w-0 gap-4", mockup ? "grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]" : "")}>
        <div className="flex min-w-0 flex-col gap-2.5 py-0.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <span aria-hidden="true" className="q-panel-number mt-px flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums">{position + 1}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">Option {position + 1} of {count}</p>
              <p className="text-base font-semibold break-words">
                {text}
                {recommended ? <span className="q-recommended ms-2 inline-flex translate-y-[-1px] items-center rounded-md px-1.5 py-0.5 align-middle text-2xs font-medium">Recommended</span> : null}
              </p>
            </div>
            {chosen ? (
              <span className="q-chosen inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium">
                <Check aria-hidden="true" className="size-3.5" />
                Chosen
              </span>
            ) : null}
          </div>
          {option.description ? <Markdown text={option.description} className="q-panel-text min-w-0 text-sm leading-relaxed" /> : <span className="text-sm text-muted-foreground">No further detail.</span>}
        </div>
        {mockup ? <Preview option={option} onExpand={onExpand} /> : null}
      </div>
    </div>
  )
}

function CardFooter({
  primary,
  primaryLabel,
  disabled,
  submitting,
  onCancel,
  intent,
}: {
  primary: "submit" | "button"
  primaryLabel: string
  disabled: boolean
  submitting: boolean
  onCancel: () => void
  /** What the primary button will send, in words: "You choose: Node 22". */
  intent?: { lead: string; text: string; empty?: boolean }
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      {intent ? (
        <p role="status" aria-live="polite" data-empty={intent.empty || undefined} className="q-intent flex min-w-0 flex-1 items-center justify-end gap-1.5 text-sm">
          <span key={`${intent.lead}${intent.text}`} className="q-intent-text flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-muted-foreground">{intent.lead}</span>
            {intent.empty ? null : <span className="truncate font-medium">{intent.text}</span>}
          </span>
        </p>
      ) : null}
      <Button type={primary} disabled={disabled || submitting}>
        {submitting ? "Sending…" : primaryLabel}
      </Button>
    </div>
  )
}

/** The footer's line on what the answer will be. */
function intentOf(answer: AskAnswer | undefined): { lead: string; text: string; empty?: boolean } {
  if (!answer?.answer) return { lead: "Nothing chosen yet", text: "", empty: true }
  if (answer.kind === "custom") {
    const plain = answer.answer.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim()
    return { lead: "You answer:", text: `“${plain.length > 80 ? `${plain.slice(0, 79)}…` : plain}”` }
  }
  return { lead: "You choose:", text: (answer.selected ?? [answer.answer]).map((label) => splitRecommended(label).text).join(", ") }
}

function answerFor(questions: AskQuestion[], picks: Record<number, number[]>, own: Record<number, string>, index: number): AskAnswer | undefined {
  const question = questions[index]
  if (!question) return undefined
  const text = own[index]?.trim()
  if (text) return { questionIndex: index, question: question.question, kind: "custom", answer: text }
  const labels = (picks[index] ?? []).map((option) => question.options[option]?.label).filter((label): label is string => Boolean(label))
  if (labels.length === 0) return undefined
  if (question.multiSelect) return { questionIndex: index, question: question.question, kind: "multi", answer: labels.join(", "), selected: labels }
  return { questionIndex: index, question: question.question, kind: "option", answer: labels[0] ?? null }
}

function Chips({ questions, picks, own, index, onGo }: { questions: AskQuestion[]; picks: Record<number, number[]>; own: Record<number, string>; index: number; onGo: (index: number) => void }) {
  if (questions.length === 1) return <p className="text-xs text-muted-foreground">{questions[0]?.header}</p>
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {questions.map((question, position) => {
        const answered = Boolean(own[position]?.trim()) || (picks[position]?.length ?? 0) > 0
        return (
          <button aria-keyshortcuts="Enter Space" aria-description="When focused, press Enter or Space to open this question."
            key={position}
            type="button"
            onClick={() => onGo(position)}
            aria-current={position === index}
            className={cn(
              "inline-flex min-h-8 min-w-0 items-center gap-1 rounded-lg border px-3 text-xs font-medium transition-colors",
              position === index ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            <span className="min-w-0 break-words text-start">{position + 1} {question.header}</span>
            {answered ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}

function QuestionnaireCard({ questions, submitting, onAnswer, onCancel, expanded: shown, onExpand, onSize }: { questions: AskQuestion[] } & Omit<CardProps, "view">) {
  const [index, setIndex] = useState(0)
  // Open or closed from the pop-up when it holds the state (Esc closes the viewer first), here otherwise.
  const [ownExpanded, setOwnExpanded] = useState(false)
  const expanded = shown ?? ownExpanded
  const expand = (on: boolean) => (onExpand ? onExpand(on) : setOwnExpanded(on))
  const [viewing, setViewing] = useState(0)
  // The option in view in the viewer, and whether it was open, so closing it (Esc included) lands on that option.
  const inView = useRef(0)
  const wasExpanded = useRef(false)
  const [picks, setPicks] = useState<Record<number, number[]>>({})
  const [own, setOwn] = useState<Record<number, string>>({})
  const [ownHtml, setOwnHtml] = useState<Record<number, string>>({})
  const [ownFocused, setOwnFocused] = useState(false)
  const [landed, setLanded] = useState(false)
  const ownField = useRef<RichAnswerHandle>(null)
  const [focused, setFocused] = useState<Record<number, number>>({})
  const form = useRef<HTMLFormElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const question = questions[index]
  const picked = picks[index] ?? []
  const ownText = own[index] ?? ""
  const previewOption = question?.options[focused[index] ?? picked[0] ?? 0]
  const current = answerFor(questions, picks, own, index)
  const multi = question?.multiSelect === true
  const panelAt = Math.max(0, question?.options.indexOf(previewOption!) ?? 0)
  // The field in focus, or an answer of the user's own, takes the ring off the dots.
  const ownMode = ownFocused || ownText.trim() !== ""
  const activeAt = ownMode ? OWN : panelAt
  const dots = useDotRail(rail, panelRef, ownField, activeAt, `${index}:${expanded}`, () => setLanded(true))

  useEffect(() => {
    if (!landed) return
    const timer = window.setTimeout(() => setLanded(false), 700)
    return () => window.clearTimeout(timer)
  }, [landed])

  useEffect(() => onSize?.(sizeFor(question)), [question, onSize])

  // Each question opens with focus on its first option (or the one already picked).
  useEffect(() => {
    const root = form.current
    if (!root) return
    const first = root.querySelector<HTMLElement>(`[data-option="${picks[index]?.[0] ?? 0}"]`) ?? root.querySelector<HTMLElement>("[data-nav]")
    first?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  // Back from the viewer, focus is on the option last in view.
  useEffect(() => {
    const closed = wasExpanded.current && !expanded
    wasExpanded.current = expanded
    if (!closed) return
    setFocused((now) => ({ ...now, [index]: inView.current }))
    form.current?.querySelector<HTMLElement>(`[data-option="${inView.current}"]`)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  if (!question) return null
  const mockups = question.options.some(hasMockup)

  function openViewer(option: number) {
    setViewing(Math.max(0, option))
    inView.current = Math.max(0, option)
    expand(true)
  }

  function closeViewer(option: number) {
    inView.current = option
    expand(false)
  }

  if (expanded && mockups) {
    return (
      <MockupViewer
        key={index}
        options={question.options}
        start={viewing}
        title={question.header || question.question}
        picked={picked}
        multi={multi}
        onChoose={(option) => {
          toggle(option)
          if (!multi) closeViewer(option)
        }}
        onClose={closeViewer}
        onIndex={(option) => { inView.current = option }}
      />
    )
  }

  function toggle(option: number) {
    const next = multi ? (picked.includes(option) ? picked.filter((i) => i !== option) : [...picked, option]) : [option]
    setPicks({ ...picks, [index]: next })
    if (!multi) {
      setOwn({ ...own, [index]: "" })
      setOwnHtml({ ...ownHtml, [index]: "" })
    }
    setFocused({ ...focused, [index]: option })
  }

  /** Explicit browsing (arrows) in a single-answer question picks the option in view; multi only previews. */
  function browse(element: Element | null) {
    const option = element instanceof HTMLInputElement && element.dataset.option !== undefined ? Number(element.dataset.option) : -1
    if (option >= 0 && !multi) toggle(option)
  }

  /** Go on with these answers: the next question, or send them all. */
  function proceed(nextPicks: Record<number, number[]>, nextOwn: Record<number, string>) {
    if (!answerFor(questions, nextPicks, nextOwn, index)) return
    if (index < questions.length - 1) {
      setIndex(index + 1)
      return
    }
    const answers = questions.map((_, position) => answerFor(questions, nextPicks, nextOwn, position)).filter((answer): answer is AskAnswer => Boolean(answer))
    onAnswer({ answers, cancelled: false } satisfies AskResult)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!submitting) proceed(picks, own)
  }

  function go(to: number) {
    if (to >= 0 && to < questions.length) setIndex(to)
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement
    const root = form.current
    if (!root || event.altKey) return
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (!submitting) proceed(picks, own)
      return
    }
    // The own-answer field handles its own keys (Enter answers, Up at the start goes back to the options).
    if (isTyping(target)) return
    const step = verticalStep(event.key)
    if (step || event.key === "Home" || event.key === "End") {
      event.preventDefault()
      moveNav(root, target, step || (event.key === "Home" ? "first" : "last"))
      browse(document.activeElement)
      return
    }
    const across = horizontalStep(event.key)
    if (across && !(target instanceof HTMLButtonElement)) {
      event.preventDefault()
      go(index + across)
      return
    }
    const option = target instanceof HTMLInputElement && target.dataset.option !== undefined ? Number(target.dataset.option) : -1
    if (event.key === "Enter" && option >= 0) {
      event.preventDefault()
      if (multi) {
        // Several answers: Enter on a picked option goes on, otherwise it picks.
        if (picked.length > 0 && picked.includes(option)) proceed(picks, own)
        else toggle(option)
      } else {
        const nextPicks = { ...picks, [index]: [option] }
        const nextOwn = { ...own, [index]: "" }
        setPicks(nextPicks)
        setOwn(nextOwn)
        setOwnHtml({ ...ownHtml, [index]: "" })
        proceed(nextPicks, nextOwn)
      }
      return
    }
    if (event.key === " " && option >= 0) {
      event.preventDefault()
      toggle(option)
      return
    }
    const digit = Number(event.key)
    if (Number.isInteger(digit) && digit >= 1 && digit <= question.options.length) {
      event.preventDefault()
      toggle(digit - 1)
      root.querySelector<HTMLElement>(`[data-option="${digit - 1}"]`)?.focus()
      return
    }
    if (event.key.toLowerCase() === "e" && mockups && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      openViewer(option >= 0 ? option : focused[index] ?? picked[0] ?? 0)
    }
  }

  return (
    <form ref={form} className="flex min-w-0 flex-col gap-3" onSubmit={submit} onKeyDown={onKeyDown}>
      <Chips questions={questions} picks={picks} own={own} index={index} onGo={setIndex} />
      <div className="text-center">
        <p className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
          {questions.length > 1 ? `Question ${index + 1} of ${questions.length}` : "Question"}
        </p>
        <Markdown text={question.question} className="mt-1 text-base font-medium" />
      </div>
      <div className="relative grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3">
        <div ref={rail} role={multi ? "group" : "radiogroup"} aria-label="Options" className="q-rail relative flex min-w-0 flex-col justify-evenly py-2">
          <span ref={dots.track} aria-hidden="true" className="q-rail-line pointer-events-none absolute top-0 left-1/2 h-0 -translate-x-1/2" />
          <span ref={dots.drop} aria-hidden="true" className="q-drop pointer-events-none absolute top-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full opacity-0" />
          <span ref={dots.ring} aria-hidden="true" className="q-ring pointer-events-none absolute top-0 left-1/2 z-20 size-7 rounded-full opacity-0" />
          <span ref={dots.line} aria-hidden="true" className="q-line pointer-events-none absolute top-0 left-[calc(50%+0.875rem)] z-10 h-px w-[calc(50%-0.875rem+0.75rem)] origin-left opacity-0" />
          {question.options.map((option, position) => (
            <DotOption
              key={position}
              option={option}
              index={position}
              multi={multi}
              name={`question-${index}`}
              selected={picked.includes(position)}
              active={activeAt === position}
              onToggle={() => toggle(position)}
              onFocusOption={() => setFocused({ ...focused, [index]: position })}
            />
          ))}
        </div>
        <OptionPanel panel={panelRef} option={previewOption} position={panelAt} count={question.options.length} chosen={!ownMode && picked.includes(panelAt)} dim={ownMode} onExpand={() => openViewer(panelAt)} />
      </div>
      <div className="q-own-wrap mx-auto w-full">
        <RichAnswer
          key={index}
          ref={ownField}
          html={ownHtml[index] ?? ""}
          placeholder="Type something else…"
          label="Your own answer"
          landed={landed}
          onChange={(markdown, html) => {
            setOwn((now) => ({ ...now, [index]: markdown }))
            setOwnHtml((now) => ({ ...now, [index]: html }))
            if (markdown) setPicks((now) => ({ ...now, [index]: [] }))
          }}
          onFocusChange={setOwnFocused}
          onSubmit={() => { if (!submitting) proceed(picks, own) }}
          onUp={() => { const root = form.current; if (root) moveNav(root, ownField.current?.element ?? null, -1) }}
        />
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span>{multi ? "Pick several" : "Pick one"}</span>
        <KeyHint chord="↑↓">move</KeyHint>
        <KeyHint chord={multi ? "Space" : "Enter"}>{multi ? "pick" : "choose"}</KeyHint>
        {multi ? <KeyHint chord="Enter">next</KeyHint> : null}
        {questions.length > 1 ? <KeyHint chord="←→">question</KeyHint> : null}
        {mockups ? <KeyHint chord="E">expand mockups</KeyHint> : null}
        <KeyHint chord="Esc">later</KeyHint>
      </p>
      <CardFooter
        primary="submit"
        primaryLabel={index < questions.length - 1 ? "Next" : "Answer"}
        disabled={!current}
        submitting={submitting}
        onCancel={onCancel}
        intent={intentOf(current)}
      />
    </form>
  )
}

/** Up/Down (or j/k) move between the options, Space or a digit picks, Enter picks and answers. */
function optionKeys(event: KeyboardEvent<HTMLElement>, count: number, pick: (option: number, answer: boolean) => void) {
  const root = event.currentTarget
  const target = event.target as HTMLElement
  if (event.altKey || isTyping(target)) return
  const step = verticalStep(event.key)
  if (step) {
    event.preventDefault()
    moveNav(root, target, step)
    return
  }
  const option = target instanceof HTMLInputElement && target.dataset.option !== undefined ? Number(target.dataset.option) : -1
  if ((event.key === "Enter" || event.key === " ") && option >= 0) {
    event.preventDefault()
    pick(option, event.key === "Enter")
    return
  }
  const digit = Number(event.key)
  if (Number.isInteger(digit) && digit >= 1 && digit <= count) {
    event.preventDefault()
    pick(digit - 1, false)
    root.querySelector<HTMLElement>(`[data-option="${digit - 1}"]`)?.focus()
  }
}

function ChoiceCard({ view, submitting, onAnswer, onCancel }: CardProps & { view: Extract<PromptView, { kind: "choose" }> }) {
  const [value, setValue] = useState("")
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    form.current?.querySelector<HTMLElement>("[data-nav]")?.focus()
  }, [])
  return (
    <form
      ref={form}
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (value) onAnswer(value)
      }}
      onKeyDown={(event) =>
        optionKeys(event, view.options.length, (option, answer) => {
          const label = view.options[option]
          if (label === undefined) return
          setValue(label)
          if (answer && !submitting) onAnswer(label)
        })
      }
    >
      <Markdown text={view.title} className="text-base" />
      <div className="flex flex-col gap-2">
        {view.options.map((option, position) => (
          <OptionRow key={option} option={{ label: option }} index={position} multi={false} name="choice" selected={value === option} onToggle={() => setValue(option)} />
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <KeyHint chord="↑↓">move</KeyHint>
        <KeyHint chord="Enter">choose</KeyHint>
        <KeyHint chord="Esc">later</KeyHint>
      </p>
      <CardFooter primary="submit" primaryLabel="Choose" disabled={!value} submitting={submitting} onCancel={onCancel} />
    </form>
  )
}

function ConfirmCard({ view, submitting, onAnswer }: CardProps & { view: Extract<PromptView, { kind: "confirm" }> }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), [])
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || submitting) return
    const key = event.key.toLowerCase()
    if (key === "y") onAnswer(true)
    else if (key === "n") onAnswer(false)
  }
  return (
    <div ref={box} tabIndex={-1} data-autofocus="" onKeyDown={onKeyDown} className="flex min-w-0 flex-col gap-3 outline-none">
      <div>
        <Markdown text={view.question} className="text-base" />
        {view.detail ? <Markdown text={view.detail} className="mt-1 text-muted-foreground" /> : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-x-4 text-xs text-muted-foreground">
          <KeyHint chord="Y">yes</KeyHint>
          <KeyHint chord="N">no</KeyHint>
          <KeyHint chord="Esc">later</KeyHint>
        </p>
        <span className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onAnswer(false)}>
            No
          </Button>
          <Button type="button" disabled={submitting} onClick={() => onAnswer(true)}>
            {submitting ? "Sending…" : "Yes"}
          </Button>
        </span>
      </div>
    </div>
  )
}

function TextCard({ view, submitting, onAnswer, onCancel }: CardProps & { view: Extract<PromptView, { kind: "text" }> }) {
  const [text, setText] = useState("")
  return (
    <form
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim()) onAnswer(text.trim())
      }}
    >
      <Markdown text={view.question} className="text-base" />
      <Textarea
        autoFocus
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={view.placeholder ?? OWN_ANSWER}
        aria-label={view.question}
        rows={3}
        className="min-h-9 resize-none text-sm"
      />
      <p className="flex items-center gap-x-4 text-xs text-muted-foreground">
        <KeyHint chord="Enter">answer</KeyHint>
        <KeyHint chord="Shift+Enter">new line</KeyHint>
        <KeyHint chord="Esc">later</KeyHint>
      </p>
      <CardFooter primary="submit" primaryLabel="Answer" disabled={!text.trim()} submitting={submitting} onCancel={onCancel} />
    </form>
  )
}

function SessionDialogCard({ dialog, submitting, onAnswer }: CardProps & { dialog: SessionDialog }) {
  const [value, setValue] = useState(dialog.method === "editor" ? (dialog.prefill ?? "") : "")
  const [selected, setSelected] = useState("")
  const options = dialog.options ?? []
  const ready = dialog.method === "select" ? selected !== "" : value.trim() !== ""
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    form.current?.querySelector<HTMLElement>("[data-nav], textarea")?.focus()
  }, [])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (dialog.method === "select") onAnswer({ value: selected })
    else if (dialog.method === "confirm") onAnswer({ confirmed: true })
    else if (dialog.method === "input" || dialog.method === "editor") onAnswer({ value: value.trim() })
  }

  return (
    <form
      ref={form}
      className="flex min-w-0 flex-col gap-3"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (dialog.method !== "select") return
        optionKeys(event, options.length, (option, answer) => {
          const label = options[option]
          if (label === undefined) return
          setSelected(label)
          if (answer && !submitting) onAnswer({ value: label })
        })
      }}
    >
      <div>
        <p className="text-xs text-muted-foreground">{dialog.title}</p>
        {dialog.message ? <Markdown text={dialog.message} className="mt-1 text-base" /> : null}
      </div>
      {dialog.method === "select" ? (
        <div className="flex flex-col gap-2">
          {options.map((option, index) => (
            <OptionRow key={option} option={{ label: option }} index={index} multi={false} name="dialog" selected={selected === option} onToggle={() => setSelected(option)} />
          ))}
        </div>
      ) : null}
      {dialog.method === "input" || dialog.method === "editor" ? (
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={dialog.placeholder ?? OWN_ANSWER}
          aria-label={dialog.title}
          rows={dialog.method === "editor" ? 4 : 2}
          className="min-h-9 resize-none text-sm"
        />
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" disabled={submitting} onClick={() => onAnswer({ cancelled: true })}>
          Cancel
        </Button>
        {dialog.method === "confirm" ? (
          <>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onAnswer({ confirmed: false })}>
              No
            </Button>
            <Button type="button" disabled={submitting} onClick={() => onAnswer({ confirmed: true })}>
              {submitting ? "Sending…" : "Yes"}
            </Button>
          </>
        ) : (
          <Button type="submit" disabled={!ready || submitting}>
            {submitting ? "Sending…" : "Answer"}
          </Button>
        )}
      </div>
    </form>
  )
}

export function QuestionCard(props: CardProps) {
  const { view } = props
  if (view.kind === "questionnaire") return <QuestionnaireCard questions={view.questions} submitting={props.submitting} onAnswer={props.onAnswer} onCancel={props.onCancel} onSize={props.onSize} {...(props.onExpand ? { expanded: props.expanded ?? false, onExpand: props.onExpand } : {})} />
  if (view.kind === "choose") return <ChoiceCard {...props} view={view} />
  if (view.kind === "confirm") return <ConfirmCard {...props} view={view} />
  if (view.kind === "text") return <TextCard {...props} view={view} />
  return <SessionDialogCard {...props} dialog={view.dialog} />
}
