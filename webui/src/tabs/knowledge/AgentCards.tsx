/**
 * The Knowledge page's Agents view: a card per agent that keeps knowledge,
 * with its model, how many notes it has, how many are pinned, how often its
 * knowledge was used this month and how many proposals wait for review; each
 * file it starts every session with as a bar against the compaction threshold
 * (amber past it, with a warning that asks the oracle to compact), and the
 * notes it learned last. Open notes shows the Notes view filtered to it.
 */
import type { CSSProperties } from "react"
import { CircleAlert } from "lucide-react"
import { act } from "@/lib/act"
import { AGENT_COLORS, ago, initial, type KnowledgeRead } from "./notes"
import { AGENT_LABELS, groupFiles, sizeWords, type KnowledgeAgentName } from "./words"

/** The oracle compacts an agent's files that grew past the threshold. */
function askToCompact(agent: KnowledgeAgentName, files: string[]): void {
  void act("knowledge.ask", { text: `${AGENT_LABELS[agent]}'s ${files.join(" and ")} ${files.length === 1 ? "is" : "are"} over the compaction threshold. Compact ${files.length === 1 ? "it" : "them"}: merge duplicates, drop what is out of date, keep every rule and decision.` })
}

export function AgentCards({ data, onOpen }: { data: KnowledgeRead; onOpen: (agent: KnowledgeAgentName) => void }) {
  const limit = data.threshold ?? Math.max(1, ...data.files.map((info) => info.chars))
  const month = Date.now() - 30 * 24 * 3600 * 1000
  return (
    <div className="cs-kag4">
      {groupFiles(data.files).map((group) => {
        const notes = data.notes.filter((note) => note.agent === group.agent)
        const runs = (data.ledger?.runs[group.agent]?.recent ?? []).filter((run) => Date.parse(run.at) >= month).length
        const review = data.proposals.filter((proposal) => proposal.agent === group.agent).length
        const over = group.files.filter((info) => info.over)
        const recent = [...notes].sort((a, b) => Date.parse(b.since ?? "") - Date.parse(a.since ?? "") || b.order - a.order).slice(0, 2)
        return (
          <section key={group.agent} className="cs-kagc" style={{ "--c": AGENT_COLORS[group.agent] } as CSSProperties} aria-label={AGENT_LABELS[group.agent]}>
            <div className="cs-kagh">
              <span className="cs-kat" aria-hidden="true">{initial(group.agent)}</span>
              <div className="min-w-0">
                <h3>{AGENT_LABELS[group.agent]}</h3>
                {data.models[group.agent] ? <p>{data.models[group.agent]}</p> : null}
              </div>
              <button type="button" className="cs-kc cs-sm" onClick={() => onOpen(group.agent)}>Open notes</button>
            </div>
            <div className="cs-kst">
              <div><b>{notes.length}</b><span>notes</span></div>
              <div><b>{notes.filter((note) => note.pinned).length}</b><span>pinned</span></div>
              <div><b>{runs}</b><span>uses this month</span></div>
              <div><b>{review}</b><span>to review</span></div>
            </div>
            <div className="cs-kagl">Starts every session with</div>
            {group.files.map((info) => (
              <div key={info.file} className="cs-kbf" data-over={info.over || undefined}>
                <span className="truncate" title={info.file}>{info.file}</span>
                <span className="cs-kbt" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(3, Math.round((info.chars / limit) * 100)))}%` }} /></span>
                <span className="cs-v">{sizeWords(info.chars)}{data.threshold ? ` / ${sizeWords(data.threshold)}` : " chars"}{info.over ? " · over" : ""}</span>
              </div>
            ))}
            {over.length ? (
              <p className="cs-kagw">
                <CircleAlert aria-hidden="true" className="size-3.5" />Over the compaction threshold
                <button type="button" className="cs-kc cs-sm" onClick={() => askToCompact(group.agent, over.map((info) => info.file))}>Ask the oracle to compact</button>
              </p>
            ) : null}
            {recent.length ? (
              <>
                <div className="cs-kagl">Recently learned</div>
                <ul className="cs-kagr">
                  {recent.map((note) => <li key={note.key}><span title={note.text}>{note.text.replace(/`/g, "")}</span><i>{ago(note.since) || note.file}</i></li>)}
                </ul>
              </>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
