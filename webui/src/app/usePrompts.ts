/**
 * The pending questions, read from the `prompts` topic and kept fresh by the
 * event stream (the hub bumps the topic on open, answer and withdraw). Answers
 * and dismissals go through the typed API; a late answer throws `ApiError`
 * with code `question_withdrawn`, which the slideout turns into the
 * "already answered in the terminal" notice.
 */
import { useCallback } from "react"
import { call } from "@/lib/api"
import type { WebPrompt } from "@protocol"
import { useTopic } from "./hooks"

export interface PromptsController {
  prompts: WebPrompt[]
  loading: boolean
  error?: string
  answer: (id: string, value: unknown) => Promise<void>
  dismiss: (id: string) => Promise<void>
}

export function usePrompts(): PromptsController {
  const record = useTopic<{ prompts: WebPrompt[] }>("prompts")
  const answer = useCallback(async (id: string, value: unknown) => {
    await call("prompts.answer", { id, answer: value })
  }, [])
  const dismiss = useCallback(async (id: string) => {
    await call("prompts.dismiss", { id })
  }, [])
  return { prompts: record.data?.prompts ?? [], loading: record.loading, error: record.error, answer, dismiss }
}
