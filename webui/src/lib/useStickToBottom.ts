import { useCallback, useLayoutEffect, useRef, useState } from "react"

/** Scroll events capture following state before the next content update. */
export function useStickToBottom(revision: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const stick = useCallback(() => {
    pinned.current = true
    setAtBottom(true)
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])
  useLayoutEffect(() => { if (pinned.current) stick() }, [revision, stick])
  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setAtBottom(pinned.current)
  }, [])
  return { ref, atBottom, stick, onScroll }
}
