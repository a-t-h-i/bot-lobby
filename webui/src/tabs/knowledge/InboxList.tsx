/**
 * The Knowledge Inbox: notes finished work proposed, waiting for the user.
 * Each shows who it is for, where it came from, how sure the proposer was
 * ("confident" at 85 and above) and the note it would replace, with Accept,
 * Edit first and Dismiss. "Accept N confident" takes the sure ones at once.
 */
import { useState, type CSSProperties } from "react"
import { Check, Pencil, X } from "lucide-react"
import type { KnowledgeProposalInfo } from "@protocol"
import { act } from "@/lib/act"
import { NoteEditor } from "./NoteCard"
import { AGENT_COLORS, ago, initial } from "./notes"
import { AGENT_LABELS } from "./words"

const CONFIDENT = 85

export function InboxList({ proposals, onChanged }: { proposals: KnowledgeProposalInfo[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string>()
  const [busy, setBusy] = useState(false)
  const sure = proposals.filter((proposal) => (proposal.confidence ?? 0) >= CONFIDENT)
  const run = async (writes: Array<() => Promise<unknown>>) => {
    setBusy(true)
    let done = true
    for (const write of writes) done = (await write()) !== undefined && done
    setBusy(false)
    onChanged()
    return done
  }
  return (
    <div>
      <div className="cs-kih">
        <p>{proposals.length ? `${proposals.length} ${proposals.length === 1 ? "proposal" : "proposals"} from finished work, waiting for you` : "Nothing waiting"}</p>
        {sure.length ? (
          <button type="button" className="cs-kc cs-sm cs-pri" disabled={busy} onClick={() => void run(sure.map((proposal) => () => act("knowledge.accept", { id: proposal.id })))}>
            <Check aria-hidden="true" className="size-3.5" />Accept {sure.length} confident
          </button>
        ) : null}
      </div>
      {proposals.length ? (
        <div className="cs-kib">
          {proposals.map((proposal) => {
            const confident = (proposal.confidence ?? 0) >= CONFIDENT
            return (
              <article key={proposal.id} className="cs-kir" style={{ "--c": AGENT_COLORS[proposal.agent] } as CSSProperties} aria-label={`Proposal for ${AGENT_LABELS[proposal.agent]}`}>
                <span className="cs-kat" aria-hidden="true">{initial(proposal.agent)}</span>
                <div className="min-w-0">
                  {editing === proposal.id ? (
                    <div className="cs-edi">
                      <NoteEditor initial={proposal.text} label="Edit before accepting" action="Accept" onSave={(text) => run([() => act("knowledge.accept", { id: proposal.id, text })])} onCancel={() => setEditing(undefined)} />
                    </div>
                  ) : <p className="cs-tx">{proposal.text}</p>}
                  <div className="cs-mt">
                    <b style={{ color: AGENT_COLORS[proposal.agent], fontWeight: 600 }}>{AGENT_LABELS[proposal.agent]}</b>
                    <span>· {proposal.source}{proposal.at ? ` · ${ago(proposal.at)}` : ""}</span>
                    {proposal.confidence !== undefined ? <span className="cs-kcf" data-k={confident ? "ok" : "chk"}>· {proposal.confidence}% {confident ? "confident" : "worth a look"}</span> : null}
                  </div>
                  {proposal.replaces ? <p className="cs-rp"><b>Replaces</b><s>{proposal.replaces}</s></p> : null}
                </div>
                <div className="cs-ac">
                  <button type="button" className="cs-kc cs-sm cs-pri" disabled={busy || editing === proposal.id} onClick={() => void run([() => act("knowledge.accept", { id: proposal.id })])}><Check aria-hidden="true" className="size-3.5" />Accept</button>
                  <button type="button" className="cs-kc cs-sm cs-ib cs-tip cs-b" data-tip="Edit first" aria-label="Edit first" disabled={busy} onClick={() => setEditing(proposal.id)}><Pencil aria-hidden="true" className="size-3.5" /></button>
                  <button type="button" className="cs-kc cs-sm cs-ib cs-tip cs-b" data-tip="Dismiss" aria-label="Dismiss" disabled={busy} onClick={() => void run([() => act("knowledge.dismiss", { id: proposal.id })])}><X aria-hidden="true" className="size-3.5" /></button>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="cs-knempty"><b>Inbox is clear</b>New proposals from finished work land here for your review.</div>
      )}
    </div>
  )
}
