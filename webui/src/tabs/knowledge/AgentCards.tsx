/**
 * The Knowledge page's Agents view: a card per agent that keeps knowledge,
 * with its model, how many notes, files and comments it has, each file it
 * starts every session with as a bar of its size (amber past the compaction
 * threshold, with the warning), and the notes it learned last. Open notes
 * shows the Notes view filtered to it.
 */
import type { CSSProperties } from "react"
import { AGENT_COLORS, initial, type KnowledgeRead } from "./notes"
import { AGENT_LABELS, groupFiles, overWarning, sizeWords, type KnowledgeAgentName } from "./words"

export function AgentCards({ data, onOpen }: { data: KnowledgeRead; onOpen: (agent: KnowledgeAgentName) => void }) {
  const biggest = Math.max(1, ...data.files.map((info) => info.chars))
  return (
    <div className="cs-kag4">
      {groupFiles(data.files).map((group) => {
        const notes = data.notes.filter((note) => note.agent === group.agent)
        const comments = notes.reduce((total, note) => total + note.comments.length, 0)
        const over = group.files.filter((info) => info.over)
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
              <div><b>{group.files.length}</b><span>{group.files.length === 1 ? "file" : "files"}</span></div>
              <div><b>{comments}</b><span>comments</span></div>
            </div>
            <div className="cs-kagl">Starts every session with</div>
            {group.files.map((info) => (
              <div key={info.file} className="cs-kbf" data-over={info.over || undefined}>
                <span className="truncate" title={info.file}>{info.file}</span>
                <span className="cs-kbt" aria-hidden="true"><i style={{ width: `${Math.max(3, Math.round((info.chars / biggest) * 100))}%` }} /></span>
                <span className="cs-v">{sizeWords(info.chars)} chars{info.over ? " · over" : ""}</span>
              </div>
            ))}
            {over.map((info) => <p key={info.file} className="cs-kagw">{overWarning(info.file)}</p>)}
            {notes.length ? (
              <>
                <div className="cs-kagl">Recently learned</div>
                <ul className="cs-kagr">
                  {notes.slice(-3).reverse().map((note) => <li key={note.key}><span title={note.text}>{note.text}</span><i>{note.file}</i></li>)}
                </ul>
              </>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
