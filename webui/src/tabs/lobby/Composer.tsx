/**
 * The composer docked at the bottom of every route. Enter sends with a
 * physical keyboard and Shift+Enter is a newline; on touch the Send button
 * sends. While the oracle is busy the placeholder says so and a Stop button
 * appears (`lobby.send` steers, `lobby.abort` stops). Any notice the server
 * returns becomes a toast.
 */
import { useCallback, useState, type KeyboardEvent } from "react"
import { SendHorizontal, Square } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useTopic } from "@/app/hooks"
import { call } from "@/lib/api"
import type { LobbySnapshot, StatusInfo } from "@protocol"

const PROMPT = "Type a request, or / for commands…"
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
    <div className="shrink-0 border-t bg-background px-4 py-3">
      <div className="flex items-end gap-2">
        <Textarea
          aria-label="Message the oracle"
          placeholder={busy ? STEER : PROMPT}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          className="min-h-11 flex-1 resize-none text-base md:text-base"
        />
        {busy ? (
          <Button type="button" size="lg" variant="outline" className="h-11" onClick={() => void stop()}>
            <Square aria-hidden="true" />
            Stop
          </Button>
        ) : null}
        <Button type="button" size="lg" className="h-11" onClick={() => void send()} disabled={sending}>
          <SendHorizontal aria-hidden="true" />
          Send
        </Button>
      </div>
    </div>
  )
}
