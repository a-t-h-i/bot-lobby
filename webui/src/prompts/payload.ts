/**
 * The page's view of one lobby question. `WebPrompt.payload` is `unknown`
 * across the wire (the server carries whatever the asking code built), so it
 * is narrowed here once into the shapes the controls render. The shapes mirror
 * `src/ask/types.ts` (questionnaire), `src/pi/tools.ts` (choose/text) and
 * `src/lobby/sessions.ts` (`SessionDialog`).
 */
import type { WebPrompt } from "@protocol"
import { previewPayload, type HtmlPreview } from "../lib/staticPreview.ts"

export interface AskOption {
  label: string
  description?: string
  preview?: string
  htmlPreview?: HtmlPreview
  image?: string
}

export interface AskQuestion {
  question: string
  header: string
  options: AskOption[]
  multiSelect?: boolean
}

export interface AskAnswer {
  questionIndex: number
  question: string
  kind: "option" | "custom" | "multi"
  answer: string | null
  selected?: string[]
}

export interface AskResult {
  answers: AskAnswer[]
  cancelled: boolean
}

export interface SessionDialog {
  id: string
  method: "select" | "confirm" | "input" | "editor"
  title: string
  message?: string
  options?: string[]
  placeholder?: string
  prefill?: string
}

export type PromptView =
  | { kind: "questionnaire"; questions: AskQuestion[] }
  | { kind: "choose"; title: string; options: string[] }
  | { kind: "confirm"; question: string; detail?: string }
  | { kind: "text"; question: string; placeholder?: string }
  | { kind: "sessionDialog"; dialog: SessionDialog }

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function optionOf(value: unknown): AskOption | undefined {
  const option = record(value)
  const label = str(option.label)
  if (!label) return undefined
  const description = str(option.description)
  const preview = str(option.preview)
  const image = str(option.image)
  const htmlPreview = previewPayload(option.htmlPreview)
  return {
    label,
    ...(description ? { description } : {}),
    ...(preview ? { preview } : {}),
    ...(image ? { image } : {}),
    ...(htmlPreview ? { htmlPreview } : {}),
  }
}

function questionOf(value: unknown): AskQuestion | undefined {
  const question = record(value)
  const text = str(question.question)
  if (!text) return undefined
  const options = (Array.isArray(question.options) ? question.options : [])
    .map(optionOf)
    .filter((option): option is AskOption => Boolean(option))
  return {
    question: text,
    header: str(question.header) || "Question",
    options,
    ...(question.multiSelect === true ? { multiSelect: true } : {}),
  }
}

function dialogOf(value: unknown): SessionDialog | undefined {
  const dialog = record(value)
  const method = str(dialog.method)
  if (method !== "select" && method !== "confirm" && method !== "input" && method !== "editor") return undefined
  const message = str(dialog.message)
  const options = strArray(dialog.options)
  const placeholder = str(dialog.placeholder)
  const prefill = str(dialog.prefill)
  return {
    id: str(dialog.id),
    method,
    title: str(dialog.title) || "Answer",
    ...(message ? { message } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(prefill ? { prefill } : {}),
  }
}

function questionnaireView(payload: Record<string, unknown>): PromptView | undefined {
  const questions = (Array.isArray(payload.questions) ? payload.questions : [])
    .map(questionOf)
    .filter((question): question is AskQuestion => Boolean(question))
  return questions.length > 0 ? { kind: "questionnaire", questions } : undefined
}

function chooseView(payload: Record<string, unknown>): PromptView {
  return { kind: "choose", title: str(payload.title) || "Choose an option", options: strArray(payload.options) }
}

function confirmView(payload: Record<string, unknown>): PromptView {
  const question = str(payload.question) || str(payload.title) || "Continue?"
  const detail = str(payload.detail) || str(payload.message)
  return { kind: "confirm", question, ...(detail ? { detail } : {}) }
}

function textView(payload: Record<string, unknown>): PromptView {
  const question = str(payload.question) || str(payload.title) || "Type an answer"
  const placeholder = str(payload.placeholder)
  return { kind: "text", question, ...(placeholder ? { placeholder } : {}) }
}

/** The prompt narrowed to what a control renders, or `undefined` when malformed. */
export function parsePrompt(prompt: WebPrompt): PromptView | undefined {
  const payload = record(prompt.payload)
  if (prompt.kind === "questionnaire") return questionnaireView(payload)
  if (prompt.kind === "choose") return chooseView(payload)
  if (prompt.kind === "confirm") return confirmView(payload)
  if (prompt.kind === "text") return textView(payload)
  const dialog = dialogOf(payload.dialog)
  return dialog ? { kind: "sessionDialog", dialog } : undefined
}

/** A short line naming the active prompt, for the minimised chip. */
export function promptSummary(view: PromptView): string {
  switch (view.kind) {
    case "questionnaire":
      return view.questions[0]?.header ?? "Questionnaire"
    case "choose":
      return view.title
    case "confirm":
      return view.question
    case "text":
      return view.question
    case "sessionDialog":
      return view.dialog.title
  }
}
