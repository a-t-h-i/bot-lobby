/**
 * The questionnaire drawer, after the user's design (docs/web-ui/composer-surface): the pending questions as a menu
 * pane on top of the composer, on every page, whether they came from the Lobby, a task or planning. It shows who
 * asks and from where, "n of N", the question in large type, then numbered option rows; options with mockups show
 * as thumbnails that expand into a lightbox. Typing a reply uses the composer itself (Enter sends it and moves on),
 * so there is no text box in the drawer. A questionnaire's questions are answered one after another and sent
 * together when the last is answered.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react"
import type { WebPrompt } from "@protocol"
import { ApiError } from "@/lib/api"
import { projectUrl } from "@/lib/project"
import { toast } from "@/lib/toast"
import { agentColor, AgentIcon } from "@/ui/AgentIcon"
import { Markdown } from "@/ui/Markdown"
import { hasMockup, plainLabel, type MockupOption } from "./MockupViewer"
import { parsePrompt, type AskAnswer, type AskQuestion, type PromptView } from "./payload"
import { StaticPreview } from "./StaticPreview"

const ANSWERED_ELSEWHERE = "That question was already answered in the terminal."

interface Option extends MockupOption {
  /** What choosing it sends. */
  value: unknown
}

/** One question in view: its prompt, which of a questionnaire's questions it is, and how it is answered. */
export interface DrawerStep {
  prompt: WebPrompt
  view: PromptView
  /** The questionnaire question in view. */
  index: number
  question: string
  header?: string
  options: Option[]
  multi: boolean
  /** Whether a typed reply answers it, and what it sends. */
  typed?: (text: string) => unknown
  placeholder: string
}

/** Who asks, as an agent's source name, from the prompt's `from`. */
function askerOf(prompt: WebPrompt): string {
  const from = prompt.from.trim()
  if (/panel|plann/i.test(from)) return "PLANNER"
  if (/oracle|master|lobby/i.test(from) || !from) return "MASTER"
  return from.split(/\s+/)[0]!.toUpperCase()
}

/** Who asks this question: a panel question names its seat in its header (`qa`, `dev`, …), so that agent asks it. */
function whoAsks(prompt: WebPrompt, header?: string): string {
  const asker = askerOf(prompt)
  if (asker === "PLANNER" && header && agentColor(header) !== "var(--muted-foreground)") return header.toUpperCase()
  return asker
}

/** The asker's name as the drawer shows it. */
function askerName(prompt: WebPrompt, header?: string): string {
  const who = whoAsks(prompt, header)
  if (who !== askerOf(prompt)) return who === "DEV" || who === "BACKEND" ? "Dev" : who === "QA" ? "QA" : who.charAt(0) + who.slice(1).toLowerCase()
  const asker = askerOf(prompt)
  if (asker === "PLANNER") return "Panel"
  if (asker === "MASTER") return "Oracle"
  const from = prompt.from.trim().split(/\s+/)[0] ?? "Agent"
  return from.charAt(0).toUpperCase() + from.slice(1)
}

/** Where the question comes from: planning, a task or the Lobby. */
function sourceOf(prompt: WebPrompt, header?: string): string {
  const { round, limit } = (prompt.payload ?? {}) as { round?: number; limit?: number }
  const planning = round ? `From planning · round ${limit ? `${Math.min(round, limit)}/${limit}` : round}` : "From planning"
  const where = askerOf(prompt) === "PLANNER" ? planning : prompt.taskId ? `From task ${prompt.taskId}` : "From the Lobby"
  return header && header !== "Question" && whoAsks(prompt, header) === askerOf(prompt) ? `${where} · ${header}` : where
}

function stepOf(prompt: WebPrompt, view: PromptView, done: number): DrawerStep | undefined {
  const base = { prompt, view, index: 0, multi: false, placeholder: "Or type your own reply…" }
  if (view.kind === "questionnaire") {
    const question: AskQuestion | undefined = view.questions[done]
    if (!question) return undefined
    return {
      ...base,
      index: done,
      question: question.question,
      header: question.header,
      multi: Boolean(question.multiSelect),
      options: question.options.map((option) => ({ ...option, value: option.label })),
      typed: (text) => text,
    }
  }
  if (view.kind === "choose") return { ...base, question: view.title, options: view.options.map((label) => ({ label, value: label })) }
  if (view.kind === "confirm") return { ...base, question: view.detail ? `${view.question}\n\n${view.detail}` : view.question, options: [{ label: "Yes", value: true }, { label: "No", value: false }] }
  if (view.kind === "text") return { ...base, question: view.question, options: [], typed: (text) => text, placeholder: view.placeholder || "Type your reply…" }
  const dialog = view.dialog
  const question = dialog.message ? `${dialog.title}\n\n${dialog.message}` : dialog.title
  if (dialog.method === "select") return { ...base, question, options: (dialog.options ?? []).map((label) => ({ label, value: { value: label } })) }
  if (dialog.method === "confirm") return { ...base, question, options: [{ label: "Yes", value: { confirmed: true } }, { label: "No", value: { confirmed: false } }] }
  return { ...base, question, options: [], typed: (text) => ({ value: text }), placeholder: dialog.placeholder || "Type your reply…" }
}

/** How many steps a prompt still has. */
function stepsLeft(view: PromptView | undefined, done: number): number {
  if (!view) return 1
  return view.kind === "questionnaire" ? Math.max(0, view.questions.length - done) : 1
}

export interface Drawer {
  step?: DrawerStep
  /** "n of N" over the questions answered since the drawer last emptied. */
  position: number
  total: number
  left: number
  picks: number[]
  busy: boolean
  choose: (option: number) => void
  toggle: (option: number) => void
  submitPicks: () => void
  /** Answers with what was typed in the composer; false when this question cannot take a typed reply. */
  reply: (text: string) => boolean
  dismiss: () => void
}

/** The drawer's state over the pending prompts: the question in view and the ways to answer it. */
export function useDrawer(prompts: WebPrompt[], answer: (id: string, value: unknown) => Promise<void>, dismissPrompt: (id: string) => Promise<void>): Drawer {
  // A questionnaire's answers so far, by prompt id.
  const [partial, setPartial] = useState<Record<string, AskAnswer[]>>({})
  const [picks, setPicks] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [answered, setAnswered] = useState(0)
  const views = useMemo(() => prompts.map((prompt) => ({ prompt, view: parsePrompt(prompt) })), [prompts])
  const first = views[0]
  const step = first?.view ? stepOf(first.prompt, first.view, partial[first.prompt.id]?.length ?? 0) : undefined
  const left = views.reduce((sum, { prompt, view }) => sum + stepsLeft(view, partial[prompt.id]?.length ?? 0), 0)
  // The count starts again once every question is answered.
  useEffect(() => {
    if (prompts.length === 0) {
      setAnswered(0)
      setPartial({})
    }
  }, [prompts.length])
  const stepKey = step ? `${step.prompt.id}:${step.index}` : ""
  useEffect(() => setPicks([]), [stepKey])

  const send = useCallback(async (id: string, value: unknown) => {
    setBusy(true)
    try {
      await answer(id, value)
    } catch (error) {
      if (error instanceof ApiError && error.code === "question_withdrawn") toast(ANSWERED_ELSEWHERE)
      else toast.error(error instanceof Error ? error.message : "Could not send the answer")
    } finally {
      setBusy(false)
    }
  }, [answer])

  /** Takes this question's answer: the next question of the questionnaire, or the prompt's answer. */
  const take = useCallback((value: unknown, kind: AskAnswer["kind"] = "option", selected?: string[]) => {
    if (!step || busy) return
    setAnswered((now) => now + 1)
    if (step.view.kind !== "questionnaire") return void send(step.prompt.id, value)
    const so = [...(partial[step.prompt.id] ?? []), { questionIndex: step.index, question: step.question, kind, answer: String(value), ...(selected ? { selected } : {}) }]
    if (so.length < step.view.questions.length) return setPartial((now) => ({ ...now, [step.prompt.id]: so }))
    void send(step.prompt.id, { answers: so, cancelled: false }).then(() => setPartial((now) => {
      const next = { ...now }
      delete next[step.prompt.id]
      return next
    }))
  }, [busy, partial, send, step])

  const choose = useCallback((option: number) => {
    const chosen = step?.options[option]
    if (!chosen) return
    if (step.multi) return setPicks((now) => (now.includes(option) ? now.filter((at) => at !== option) : [...now, option]))
    take(chosen.value)
  }, [step, take])
  const toggle = choose
  const submitPicks = useCallback(() => {
    if (!step || picks.length === 0) return
    const labels = [...picks].sort((a, b) => a - b).map((at) => step.options[at]!.label)
    take(labels.join(", "), "multi", labels)
  }, [picks, step, take])
  const reply = useCallback((text: string) => {
    if (!step?.typed || !text.trim()) return false
    take(step.typed(text.trim()), "custom")
    return true
  }, [step, take])
  const dismiss = useCallback(() => {
    if (!step) return
    void dismissPrompt(step.prompt.id).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not dismiss the question"))
  }, [dismissPrompt, step])
  return { ...(step ? { step } : {}), position: answered + 1, total: answered + left, left, picks, busy, choose, toggle, submitPicks, reply, dismiss }
}

/** A mockup at thumbnail size, or large in the lightbox: static HTML in its sandbox, an image, or a text sketch. */
export function MockupFace({ option, large }: { option: MockupOption; large?: boolean }) {
  const label = plainLabel(option.label)
  if (option.htmlPreview) return <StaticPreview preview={option.htmlPreview} label={label} frameWidth={large ? undefined : 880} minWidth={large ? 1024 : undefined} className="static-thumb h-full" />
  if (option.image) return <img src={projectUrl(option.image)} alt={large ? `Mockup: ${label}` : ""} loading="lazy" />
  if (option.preview) return large ? <div className="cs-mktext"><Markdown text={option.preview} /></div> : <pre className="cs-mktext">{option.preview}</pre>
  return null
}

function Glyph({ color, children }: { color: string; children: ReactNode }) {
  return <span className="bubble-glyph cs-kg" aria-hidden="true" style={{ "--k": color } as CSSProperties}>{children}</span>
}

/** The drawer pane, inside the composer's menu. */
export function DrawerPane({ drawer, onExpand }: { drawer: Drawer; onExpand: (option: number) => void }) {
  const { step } = drawer
  const [confirming, setConfirming] = useState(false)
  useEffect(() => setConfirming(false), [step?.prompt.id])
  if (!step) return <div className="bubble-pane p-3 text-sm text-(--bubble-muted)">No questions are waiting.</div>
  const who = whoAsks(step.prompt, step.header)
  const color = agentColor(who)
  const mockups = step.options.some(hasMockup)
  const rows = step.options.length
  return (
    <div className="bubble-pane p-1.5" role="group" aria-label="Question">
      <div className="cs-askh">
        <div className="cs-asks">
          <Glyph color={color}><AgentIcon source={who} strokeWidth={2.2} className="size-3" /></Glyph>
          <b style={{ color }}>{askerName(step.prompt, step.header)}</b>
          <span className="cs-askf">{sourceOf(step.prompt, step.header)}</span>
          <span className="cs-askn">{drawer.position} of {drawer.total}</span>
          <button type="button" className="cs-askx" data-confirm={confirming || undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => (confirming ? drawer.dismiss() : setConfirming(true))} onBlur={() => setConfirming(false)}>
            {confirming ? "Dismiss it?" : "Dismiss"}
          </button>
        </div>
        <p className="cs-askq" title={step.question}>{step.question}</p>
      </div>
      {mockups ? (
        <div className="cs-askm">
          {step.options.map((option, index) => (
            <button key={option.label} type="button" className="cs-mko" data-on={drawer.picks.includes(index) || undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => drawer.choose(index)} style={{ animationDelay: `${index * 30}ms` }}>
              <div className="cs-mk3">
                <MockupFace option={option} />
                <span className="cs-mxb" role="button" aria-label={`Expand ${plainLabel(option.label)}`} onClick={(event) => {
                  event.stopPropagation()
                  onExpand(index)
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
                </span>
              </div>
              <span className="cs-mkl"><Glyph color={color}>{index + 1}</Glyph><span>{plainLabel(option.label)}</span></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="cs-askopts">
          {step.options.map((option, index) => (
            <button key={option.label} type="button" className="bubble-row" data-active={drawer.picks.includes(index) || undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => drawer.choose(index)} style={{ "--delay": `${(rows - 1 - index) * 22}ms` } as CSSProperties}>
              <Glyph color={color}>{index + 1}</Glyph>
              <span className="shrink-0 text-sm font-medium text-(--bubble-ink)">{plainLabel(option.label)}</span>
              {option.description ? <span className="min-w-0 truncate text-[13px] text-(--bubble-muted)" title={option.description}>{option.description}</span> : null}
              {step.multi ? <span className="cs-cb cs-sm" data-on={drawer.picks.includes(index)}><Check aria-hidden="true" strokeWidth={3} /></span> : null}
            </button>
          ))}
          {rows === 0 ? <div className="flex h-9 items-center px-2.5 text-[13px] text-(--bubble-muted)">Type your reply in the box below, then press Enter.</div> : null}
        </div>
      )}
      {step.multi ? (
        <button type="button" className="bubble-row" disabled={drawer.picks.length === 0} onMouseDown={(event) => event.preventDefault()} onClick={drawer.submitPicks}>
          <span className="text-sm font-medium text-(--bubble-accent)">{drawer.picks.length === 0 ? "Pick one or more" : `Answer with ${drawer.picks.length} picked`}</span>
        </button>
      ) : null}
    </div>
  )
}

/** The mockup lightbox: the large mockup, who asked, "Choose this" and prev/next. */
export function MockupLightbox({ drawer, at, onAt }: { drawer: Drawer; at: number; onAt: (at: number) => void }) {
  const step = drawer.step
  const options = step?.options ?? []
  const open = at >= 0 && at < options.length
  const shown = useRef(at)
  if (open) shown.current = at
  const option = options[shown.current]
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) card.current?.focus({ preventScroll: true })
  }, [open])
  const go = (delta: number) => onAt((shown.current + delta + options.length) % options.length)
  const color = step ? agentColor(whoAsks(step.prompt, step.header)) : "var(--primary)"
  return (
    <div className="cs-mxw" data-open={open} aria-hidden={!open} inert={!open}>
      <div className="cs-shbd" onClick={() => onAt(-1)} />
      <div
        ref={card}
        // Only a dialog while open: a closed one left in the page would hold back every shortcut.
        role={open ? "dialog" : undefined}
        aria-modal={open ? "true" : undefined}
        aria-label={option ? `Mockup: ${plainLabel(option.label)}` : "Mockup"}
        tabIndex={-1}
        className="cs-mxc"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            onAt(-1)
          } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault()
            go(event.key === "ArrowRight" ? 1 : -1)
          } else if (event.key === "Enter" && option) {
            event.preventDefault()
            onAt(-1)
            drawer.choose(shown.current)
          }
        }}
      >
        <div className="cs-mxbig">{option ? <MockupFace option={option} large /> : null}</div>
        {option && step ? (
          <div className="cs-mxf">
            <Glyph color={color}>{shown.current + 1}</Glyph>
            <b>{plainLabel(option.label)}</b>
            <span className="cs-mxwho">{askerName(step.prompt, step.header)} · {step.question}</span>
            {options.length > 1 ? (
              <>
                <button type="button" className="cs-kc cs-sm cs-ib" aria-label="Previous mockup" onClick={() => go(-1)}><ChevronLeft aria-hidden="true" className="size-3.5" /></button>
                <button type="button" className="cs-kc cs-sm cs-ib" aria-label="Next mockup" onClick={() => go(1)}><ChevronRight aria-hidden="true" className="size-3.5" /></button>
              </>
            ) : null}
            <button type="button" className="cs-kc cs-sm cs-pri" onClick={() => {
              onAt(-1)
              drawer.choose(shown.current)
            }}>
              {step.multi ? (drawer.picks.includes(shown.current) ? "Unpick this" : "Pick this") : "Choose this"}
            </button>
            <button type="button" className="cs-kc cs-sm cs-ib" aria-label="Close" onClick={() => onAt(-1)}><X aria-hidden="true" className="size-3.5" /></button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
