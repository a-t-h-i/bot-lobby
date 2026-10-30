/**
 * The planning panel's open questions as drawer prompts, so "Answer questions" takes them on every page next to
 * the Lobby's own. The panel's latest round asks them; they stay open until the user replies. Picking answers in
 * the drawer sends them together as the reply to the panel, the same as typing it in the Plan tab. Dismissing
 * them puts that round away in this browser tab (the questions still show in the plan).
 */
import { useCallback, useMemo, useState } from "react"
import type { PlannerSnapshot, WebPrompt } from "@protocol"
import { useApiRead } from "@/app/useApiRead"
import { call } from "@/lib/api"
import { sourceLabel } from "@/tabs/lobby/types"
import type { AskAnswer } from "./payload"

const PREFIX = "plan:"
const STORE = "bot-lobby:plan-put-away"

export const isPlanPrompt = (id: string) => id.startsWith(PREFIX)

function putAwayRounds(): number[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORE) ?? "[]")
    return Array.isArray(value) ? value.filter((at): at is number => typeof at === "number") : []
  } catch {
    return []
  }
}

/** The questions of the panel's latest message, while the user has not replied to it yet. */
export function openPlanPrompt(snap: PlannerSnapshot | undefined): WebPrompt | undefined {
  const last = snap?.messages.at(-1)
  if (!snap || snap.busy || last?.role !== "planner" || !last.questions?.length) return undefined
  return {
    id: `${PREFIX}${last.at}`,
    kind: "questionnaire",
    createdAt: last.at,
    from: "planner",
    payload: {
      round: Math.max(snap.round, 1),
      limit: snap.limit,
      questions: last.questions.map((question) => ({
        question: question.text,
        header: question.from,
        options: question.options.map((option) => ({ label: option.label, description: option.description, ...(option.mockup ? { htmlPreview: option.mockup } : {}) })),
      })),
    },
  }
}

/** The reply a set of drawer answers makes: one line per question, who asked it and what was chosen. */
export function replyText(prompt: WebPrompt, value: unknown): string {
  const questions = ((prompt.payload as { questions?: Array<{ header: string }> }).questions ?? [])
  const answers = (value as { answers?: AskAnswer[] }).answers ?? []
  return answers.map((answer) => `${sourceLabel(questions[answer.questionIndex]?.header ?? "")}: ${answer.question} ${answer.answer}`.trim()).join("\n")
}

export function usePlanPrompts(): { prompts: WebPrompt[]; answer: (id: string, value: unknown) => Promise<void>; dismiss: (id: string) => Promise<void> } {
  const read = useApiRead("planner.get", {}, ["planner"])
  const [away, setAway] = useState(putAwayRounds)
  const open = openPlanPrompt(read.data)
  const prompts = useMemo(() => (open && !away.includes(open.createdAt) ? [open] : []), [open?.id, away.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps
  const answer = useCallback(async (id: string, value: unknown) => {
    const prompt = prompts.find((one) => one.id === id)
    if (!prompt) return
    await call("planner.send", { text: replyText(prompt, value) })
    read.reload()
  }, [prompts, read])
  const dismiss = useCallback(async (id: string) => {
    const at = Number(id.slice(PREFIX.length))
    setAway((now) => {
      const next = [...now, at].slice(-20)
      try {
        sessionStorage.setItem(STORE, JSON.stringify(next))
      } catch {
        // Kept for this page only.
      }
      return next
    })
  }, [])
  return { prompts, answer, dismiss }
}
