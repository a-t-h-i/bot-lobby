/**
 * The controls for one lobby question, inside the question pop-up: per-question
 * chips, numbered options with Markdown descriptions and `(Recommended)`
 * markers, the own answer field and the focused option's preview (beside the
 * options on wide windows, below them on narrow ones). `choose`, `confirm`, `text` and `sessionDialog` reuse
 * the same surface with their own controls and answer shapes.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KeyHint } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { projectUrl } from "@/lib/project"
import { Markdown } from "@/ui/Markdown"
import { StaticPreview } from "./StaticPreview"
import { horizontalStep, isTyping, moveNav, verticalStep } from "./nav"
import type { AskAnswer, AskQuestion, AskResult, AskOption, PromptView, SessionDialog } from "./payload"

interface CardProps {
  view: PromptView
  submitting: boolean
  onAnswer: (value: unknown) => void
  onCancel: () => void
}

const RECOMMENDED = /\s*\(recommended\)\s*$/i
const OWN_ANSWER = "Type something."

function splitRecommended(label: string): { text: string; recommended: boolean } {
  return { text: label.replace(RECOMMENDED, ""), recommended: RECOMMENDED.test(label) }
}

function OptionLabel({ label }: { label: string }) {
  const { text, recommended } = splitRecommended(label)
  return (
    <span className="leading-snug">
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
        selected ? "border-primary/50 bg-accent" : "border-input bg-card/40 hover:bg-accent/60",
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

function Preview({ option }: { option?: AskOption }) {
  if (!option || (!option.preview && !option.image && !option.htmlPreview)) return null
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">Preview · {splitRecommended(option.label).text}</p>
      {option.image ? (
        <img src={projectUrl(option.image)} alt="" loading="lazy" className="max-h-64 w-full rounded-lg border object-contain" />
      ) : null}
      {option.htmlPreview ? <StaticPreview preview={option.htmlPreview} label={splitRecommended(option.label).text} /> : null}
      {option.preview ? <Markdown text={option.preview} className="text-xs" /> : null}
    </div>
  )
}

function CardFooter({
  primary,
  primaryLabel,
  disabled,
  submitting,
  onCancel,
}: {
  primary: "submit" | "button"
  primaryLabel: string
  disabled: boolean
  submitting: boolean
  onCancel: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type={primary} disabled={disabled || submitting}>
        {submitting ? "Sending…" : primaryLabel}
      </Button>
    </div>
  )
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
              "inline-flex min-h-8 items-center gap-1 rounded-lg border px-3 text-xs font-medium transition-colors",
              position === index ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {position + 1} {question.header}
            {answered ? <Check className="size-3" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}

function QuestionnaireCard({ questions, submitting, onAnswer, onCancel }: { questions: AskQuestion[] } & Omit<CardProps, "view">) {
  const [index, setIndex] = useState(0)
  const [picks, setPicks] = useState<Record<number, number[]>>({})
  const [own, setOwn] = useState<Record<number, string>>({})
  const [focused, setFocused] = useState<Record<number, number>>({})
  const form = useRef<HTMLFormElement>(null)
  const question = questions[index]
  const picked = picks[index] ?? []
  const ownText = own[index] ?? ""
  const previewOption = question?.options[focused[index] ?? picked[0] ?? 0]
  const current = answerFor(questions, picks, own, index)
  const multi = question?.multiSelect === true

  // Each question opens with focus on its first option (or the one already picked).
  useEffect(() => {
    const root = form.current
    if (!root) return
    const first = root.querySelector<HTMLElement>(`[data-option="${picks[index]?.[0] ?? 0}"]`) ?? root.querySelector<HTMLElement>("[data-nav]")
    first?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  if (!question) return null

  function toggle(option: number) {
    const next = multi ? (picked.includes(option) ? picked.filter((i) => i !== option) : [...picked, option]) : [option]
    setPicks({ ...picks, [index]: next })
    if (!multi) setOwn({ ...own, [index]: "" })
    setFocused({ ...focused, [index]: option })
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
    if (target instanceof HTMLTextAreaElement) {
      // In the own-answer box: Enter answers, Shift+Enter is a new line, Up at the top goes back to the options.
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        if (!submitting) proceed(picks, own)
      } else if (event.key === "ArrowUp" && target.selectionStart === 0 && target.selectionEnd === 0) {
        event.preventDefault()
        moveNav(root, target, -1)
      }
      return
    }
    const step = verticalStep(event.key)
    if (step) {
      event.preventDefault()
      moveNav(root, target, step)
      return
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      moveNav(root, target, event.key === "Home" ? "first" : "last")
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
    }
  }

  return (
    <form ref={form} className="flex flex-col gap-3" onSubmit={submit} onKeyDown={onKeyDown}>
      <Chips questions={questions} picks={picks} own={own} index={index} onGo={setIndex} />
      <div>
        <p className="text-xs text-muted-foreground">
          {questions.length > 1 ? `Question ${index + 1} of ${questions.length}` : "Question"}
        </p>
        <Markdown text={question.question} className="mt-1 text-base" />
      </div>
      <div className={cn("grid min-w-0 gap-4", previewOption?.preview || previewOption?.image || previewOption?.htmlPreview ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" : "")}>
        <div className="flex min-w-0 flex-col gap-2">
          {question.options.map((option, position) => (
            <OptionRow
              key={position}
              option={option}
              index={position}
              multi={multi}
              name={`question-${index}`}
              selected={picked.includes(position)}
              onToggle={() => toggle(position)}
              onFocusOption={() => setFocused({ ...focused, [index]: position })}
            />
          ))}
          <label className="flex min-h-9 flex-col gap-1 rounded-lg border border-input px-3 py-1.5 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
            <span className="text-muted-foreground">{OWN_ANSWER}</span>
            <Textarea
              data-nav=""
              value={ownText}
              onChange={(event) => {
                setOwn({ ...own, [index]: event.target.value })
                if (event.target.value) setPicks({ ...picks, [index]: [] })
              }}
              placeholder={OWN_ANSWER}
              aria-label="Your own answer"
              rows={2}
              className="min-h-9 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 md:text-sm"
            />
          </label>
        </div>
        <Preview option={previewOption} />
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span>{multi ? "Pick several" : "Pick one"}</span>
        <KeyHint chord="↑↓">move</KeyHint>
        <KeyHint chord={multi ? "Space" : "Enter"}>{multi ? "pick" : "choose"}</KeyHint>
        {multi ? <KeyHint chord="Enter">next</KeyHint> : null}
        {questions.length > 1 ? <KeyHint chord="←→">question</KeyHint> : null}
        <KeyHint chord="Esc">later</KeyHint>
      </p>
      <CardFooter
        primary="submit"
        primaryLabel={index < questions.length - 1 ? "Next" : "Answer"}
        disabled={!current}
        submitting={submitting}
        onCancel={onCancel}
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
      className="flex flex-col gap-3"
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
    <div ref={box} tabIndex={-1} data-autofocus="" onKeyDown={onKeyDown} className="flex flex-col gap-3 outline-none">
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
      className="flex flex-col gap-3"
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
        className="min-h-9 resize-none text-sm md:text-sm"
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
      className="flex flex-col gap-3"
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
          className="min-h-9 resize-none text-sm md:text-sm"
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
  if (view.kind === "questionnaire") return <QuestionnaireCard questions={view.questions} submitting={props.submitting} onAnswer={props.onAnswer} onCancel={props.onCancel} />
  if (view.kind === "choose") return <ChoiceCard {...props} view={view} />
  if (view.kind === "confirm") return <ConfirmCard {...props} view={view} />
  if (view.kind === "text") return <TextCard {...props} view={view} />
  return <SessionDialogCard {...props} dialog={view.dialog} />
}
