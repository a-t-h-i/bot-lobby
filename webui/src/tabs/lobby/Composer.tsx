/**
 * The composer docked at the bottom of every route, drawn as the terminal's
 * prompt (D-21): a label set into a rule, the text, a rule under it, both
 * rules in the typing colour while you type. Enter sends with a physical
 * keyboard and Shift+Enter is a newline; on touch the send key sends. While
 * the oracle is busy the label says so and a stop key appears (`lobby.send`
 * steers, `lobby.abort` stops). Any notice the server returns becomes a
 * toast.
 */
import { useCallback, useState, type KeyboardEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useTopic } from "@/app/hooks"
import { call } from "@/lib/api"
import type { LobbySnapshot, StatusInfo } from "@protocol"

const PROMPT = "message the oracle · enter sends · / for commands"
const STEER = "message the oracle · enter steers the running turn"

export function Composer() {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const status = useTopic<StatusInfo>("status")
  const lobby = useTopic<LobbySnapshot>("lobby")
  const busy = (status.data?.busy ?? false) || Boolean(lobby.data?.reply?.trim())

  const send = useCallback(async () => {
    setSending(true)
    try {
      const result = await call("lobby.send", { text })
      if (result.notice) toast(result.notice)
      else setText("")
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not send")
    } finally {
      setSending(false)
    }
  }, [text])

  const stop = useCallback(async () => {
    try {
      await call("lobby.abort", {})
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not stop")
    }
  }, [])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        void send()
      }
    },
    [send]
  )

  return (
    <div className="group/prompt shrink-0 bg-background px-[1ch] pt-1">
      <label htmlFor="composer-text" className="flex items-center gap-[1ch] text-xs text-muted-foreground group-focus-within/prompt:text-primary">
        <span aria-hidden="true" className="w-[2ch] shrink-0 border-t border-border group-focus-within/prompt:border-typing" />
        <span className="truncate">{busy ? STEER : PROMPT}</span>
        <span aria-hidden="true" className="min-w-[2ch] flex-1 border-t border-border group-focus-within/prompt:border-typing" />
      </label>
      <div className="flex items-end gap-[1ch] border-b border-border py-1 group-focus-within/prompt:border-typing">
        <Textarea
          id="composer-text"
          aria-label="Message the oracle"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          className="min-h-10 flex-1 resize-none rounded-none border-0 bg-transparent px-[1ch] text-base caret-primary shadow-none focus-visible:ring-0 md:text-base dark:bg-transparent"
        />
        {busy ? (
          <Button type="button" size="lg" variant="secondary" className="h-10 px-[2ch] text-foreground" onClick={() => void stop()}>
            stop
          </Button>
        ) : null}
        <Button type="button" size="lg" className="h-10 px-[2ch]" onClick={() => void send()} disabled={sending}>
          send
        </Button>
      </div>
    </div>
  )
}
