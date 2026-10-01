/**
 * The composer docked at the bottom of every route. Step 10b keeps it a
 * placeholder: the textarea and Send are present and correctly sized, but no
 * message is sent until the Lobby tab wires `lobby.send` (Step 11).
 */
import { SendHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function Composer() {
  return (
    <div className="shrink-0 border-t bg-background px-4 py-3">
      <div className="flex items-end gap-2">
        <Textarea
          aria-label="Message the oracle"
          placeholder="Type a request, or / for commands…"
          rows={1}
          disabled
          className="min-h-11 flex-1 resize-none"
        />
        <Button size="lg" className="h-11" disabled>
          <SendHorizontal aria-hidden="true" />
          Send
        </Button>
      </div>
    </div>
  )
}
