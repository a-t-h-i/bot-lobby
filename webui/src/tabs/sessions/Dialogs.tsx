/**
 * The questions a background session waits on, answered inline: pick one of
 * the options, confirm or decline, or type an answer — or put the question
 * away. Each sends `sessions.answer`; the session's list rereads after.
 */
import { useId, useState } from "react"
import type { DialogAnswer, SessionDialog } from "@protocol"
import { ArrowUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ActionButton } from "@/ui/Actions"
import { Textarea } from "@/components/ui/textarea"
import { act } from "@/lib/act"
import { waitingText } from "./words"

type Send = (answer: DialogAnswer) => Promise<void>

function Options({ options, send }: { options: string[]; send: Send }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button key={option} variant="outline" onClick={() => void send({ value: option })}>
          {option}
        </Button>
      ))}
    </div>
  )
}

function Typed({ dialog, send }: { dialog: SessionDialog; send: Send }) {
  const id = useId()
  const [text, setText] = useState(dialog.prefill ?? "")
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {dialog.title}
      </label>
      <Textarea id={id} rows={dialog.method === "editor" ? 4 : 2} value={text} placeholder={dialog.placeholder} onChange={(event) => setText(event.target.value)} />
      <div className="flex self-end">
        <ActionButton label="Send the answer" text="Send" icon={ArrowUp} tone="primary" disabled={!text.trim()} onClick={() => void send({ value: text.trim() })} />
      </div>
    </div>
  )
}

function Answer({ dialog, send }: { dialog: SessionDialog; send: Send }) {
  if (dialog.method === "select") return <Options options={dialog.options ?? []} send={send} />
  if (dialog.method === "confirm") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void send({ confirmed: true })}>Yes</Button>
        <Button variant="outline" onClick={() => void send({ confirmed: false })}>No</Button>
      </div>
    )
  }
  return <Typed dialog={dialog} send={send} />
}

function Card({ sessionKey, dialog, onAnswered }: { sessionKey: string; dialog: SessionDialog; onAnswered: () => void }) {
  const send: Send = async (answer) => {
    if (await act("sessions.answer", { key: sessionKey, dialogId: dialog.id, answer })) onAnswered()
  }
  return (
    <div className="card-raised flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{dialog.title}</p>
        {dialog.message ? <p className="text-sm text-muted-foreground">{dialog.message}</p> : null}
      </div>
      <Answer dialog={dialog} send={send} />
      <div className="flex self-start">
        <ActionButton label="Put it away" text="Put away" icon={X} onClick={() => void send({ cancelled: true })} />
      </div>
    </div>
  )
}

export function Dialogs({ sessionKey, dialogs, onAnswered }: { sessionKey: string; dialogs: SessionDialog[]; onAnswered: () => void }) {
  if (dialogs.length === 0) return null
  return (
    <section aria-label="Questions waiting" className="flex flex-col gap-2">
      <p role="status" className="text-sm font-medium text-foreground">
        {waitingText(dialogs.length)}
      </p>
      {dialogs.map((dialog) => (
        <Card key={dialog.id} sessionKey={sessionKey} dialog={dialog} onAnswered={onAnswered} />
      ))}
    </section>
  )
}
