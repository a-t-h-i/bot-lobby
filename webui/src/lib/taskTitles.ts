/** Each task's title by its id, from the task list, for lines that name a task ("Retries for uploads" rather than T-148). */
import { useMemo } from "react"
import { useApiRead } from "@/app/useApiRead"

export function useTaskTitles(): Record<string, string> {
  const tasks = useApiRead("tasks.list", {}, ["tasks"])
  return useMemo(() => Object.fromEntries((tasks.data?.rows ?? []).map((row) => [row.id, row.title])), [tasks.data])
}
