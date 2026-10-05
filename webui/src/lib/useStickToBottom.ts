import { useCallback, useLayoutEffect, useRef, useState } from "react"

/**
 * Keep a scroller on its newest entry. Scroll events capture whether the
 * reader is following before the next content update; a resize of the pane (the
 * window, a growing message box) or of what is in it keeps a following reader
 * at the bottom instead of leaving the newest lines out of sight.
 */
export function useStickToBottom(revision: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const observer = useRef<ResizeObserver | undefined>(undefined)
  const content = useRef<Element | null>(null)
  const stick = useCallback(() => {
    pinned.current = true
    setAtBottom(true)
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])
  useLayoutEffect(() => { if (pinned.current) stick() }, [revision, stick])
  // One observer for the pane's life: it watches the pane and its content.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const follow = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight
    }
    const watcher = new ResizeObserver(follow)
    watcher.observe(el)
    observer.current = watcher
    return () => {
      watcher.disconnect()
      observer.current = undefined
      content.current = null
    }
  }, [])
  // The content can be swapped (a list for an empty note): watch whatever is in there now.
  useLayoutEffect(() => {
    const watcher = observer.current
    const next = ref.current?.firstElementChild ?? null
    if (!watcher || next === content.current) return
    if (content.current) watcher.unobserve(content.current)
    if (next) watcher.observe(next)
    content.current = next
  }, [revision])
  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setAtBottom(pinned.current)
  }, [])
  return { ref, atBottom, stick, onScroll }
}
