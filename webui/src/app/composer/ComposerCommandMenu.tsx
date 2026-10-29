// Adapted from T3 Code (MIT), apps/web/src/components/chat/ComposerCommandMenu.tsx, ComposerBanner.tsx
/**
 * The suggestions that grow out of the composer's top edge, as a bubble of their own, while you type a `/command`
 * or an `@agent` at the start of a message: one 36px row per suggestion, a tile with its first letter (or the
 * agent's icon), its name without the symbol, what it does and a small tag saying where it comes from, all in the
 * row's colour (lobby commands the accent, Pi's the QA colour, skills the Plan colour, agents their own). The text box keeps focus and drives it (a combobox: Up and Down move, Enter
 * or Tab takes the row, Esc closes); a pointer picks a row too. Rows rise from the bottom one after another.
 */
import { memo, useLayoutEffect, useRef, type CSSProperties } from "react"
import type { StatusInfo } from "@protocol"
import { CHAT_MENTIONS, LOBBY_COMMANDS, type ChatAgent } from "@shared"
import { AgentIcon, agentColor } from "@/ui/AgentIcon"

export type ComposerTriggerKind = "slash-command" | "mention"

export interface ComposerCommandItem {
  id: string
  /** What the row inserts at the start of the message, with a space after it. */
  insert: string
  label: string
  description: string
  agent?: ChatAgent
  /** Where a command comes from (the lobby's own, Pi's, a skill) or `agent`: its tag and colour. */
  tag: "lobby" | "pi" | "skill" | "agent"
}

/** A row's colour: lobby commands wear the accent, Pi's the QA colour, skills the Plan colour, agents their own. */
export function itemColor(item: ComposerCommandItem): string {
  if (item.agent) return agentColor(item.agent)
  return item.tag === "lobby" ? "var(--c-orc)" : item.tag === "skill" ? "var(--c-pl)" : "var(--c-qa)"
}

/** The `/` or `@` word being typed at the start of the message, when the caret is still in it. */
export function composerTrigger(text: string, caret: number): { kind: ComposerTriggerKind; query: string } | undefined {
  const match = /^\s*([/@])([a-z0-9:_.-]*)$/i.exec(text.slice(0, caret))
  if (!match || /\S/.test(text.slice(caret, caret + 1))) return undefined
  return { kind: match[1] === "/" ? "slash-command" : "mention", query: match[2]!.toLowerCase() }
}

function slashItems(commands: NonNullable<StatusInfo["commands"]>): ComposerCommandItem[] {
  const lobby: ComposerCommandItem[] = LOBBY_COMMANDS.map((command) => ({
    id: `/${command.name}`, insert: `/${command.name}`, label: `/${command.name}`, description: command.hint, tag: "lobby",
  }))
  return [...lobby, ...commands.map((command): ComposerCommandItem => ({
    id: `/${command.name}`, insert: `/${command.name}`, label: `/${command.name}`,
    description: command.description + (command.terminal ? " · continue in Pi terminal" : ""),
    tag: command.name.startsWith("skill:") ? "skill" : "pi",
  }))]
}

/** The rows for a trigger, those whose name starts with what is typed first. */
export function composerItems(trigger: { kind: ComposerTriggerKind; query: string }, commands: StatusInfo["commands"] = []): ComposerCommandItem[] {
  const rows: ComposerCommandItem[] = trigger.kind === "slash-command"
    ? slashItems(commands)
    : CHAT_MENTIONS.map((mention): ComposerCommandItem => ({ id: `@${mention.name}`, insert: `@${mention.name}`, label: `@${mention.name}`, description: mention.hint, agent: mention.agent, tag: "agent" }))
  const unique = rows.filter((row, index) => rows.findIndex((other) => other.id === row.id) === index)
  const starts = unique.filter((row) => row.label.slice(1).startsWith(trigger.query))
  const contains = unique.filter((row) => !starts.includes(row) && row.label.slice(1).includes(trigger.query))
  return [...starts, ...contains]
}

export function composerSuggestionOptionId(listId: string, itemId: string): string {
  return `${listId}-${encodeURIComponent(itemId)}`
}

const LISTBOX_LABEL_BY_TRIGGER: Record<ComposerTriggerKind, string> = {
  "slash-command": "Commands",
  mention: "Agents",
}

/** At most this many rows show; more scroll. */
export const SUGGESTION_ROWS = 8

/** The bubble's height for these rows: 6px padding above and below, 36px a row. */
export function suggestionHeight(count: number): number {
  return 12 + Math.min(count, SUGGESTION_ROWS) * 36
}

let measurer: CanvasRenderingContext2D | null | undefined

/** The bubble's width for these rows, from their text in the composer's own typeface, between 200 and 640px. */
export function suggestionWidth(items: ComposerCommandItem[], family: string): number {
  let width = 0
  try {
    measurer ??= document.createElement("canvas").getContext("2d")
    if (!measurer) throw new Error("no canvas")
    for (const item of items) {
      measurer.font = `500 14px ${family}`
      const name = measurer.measureText(item.label.slice(1)).width
      measurer.font = `400 13px ${family}`
      width = Math.max(width, name + measurer.measureText(item.description).width)
    }
  } catch {
    for (const item of items) width = Math.max(width, item.label.length * 8 + item.description.length * 6.6)
  }
  return Math.min(Math.max(Math.ceil(width) + 150, 200), 640)
}

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  listId: string
  items: ComposerCommandItem[]
  triggerKind: ComposerTriggerKind
  activeItemId: string | null
  onHighlightedItemChange: (itemId: string | null) => void
  onSelect: (item: ComposerCommandItem) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [props.activeItemId])

  const shown = Math.min(props.items.length, SUGGESTION_ROWS)
  return (
    <div
      ref={listRef}
      id={props.listId}
      role="listbox"
      aria-label={LISTBOX_LABEL_BY_TRIGGER[props.triggerKind]}
      data-composer-command-drawer="true"
      className="bubble-pane bubble-scroll overflow-y-auto p-1.5"
      style={{ height: suggestionHeight(props.items.length) }}
    >
      {props.items.map((item, index) => {
        const active = props.activeItemId === item.id
        return (
          <div
            key={item.id}
            id={composerSuggestionOptionId(props.listId, item.id)}
            role="option"
            aria-selected={active}
            data-composer-item-id={item.id}
            data-active={active || undefined}
            onMouseMove={() => {
              if (!active) props.onHighlightedItemChange(item.id)
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onSelect(item)}
            className="bubble-row"
            style={{ "--delay": `${Math.max(0, shown - 1 - index) * 22}ms` } as CSSProperties}
          >
            <span className="bubble-glyph cs-kg" aria-hidden="true" style={{ "--k": itemColor(item) } as CSSProperties}>
              {item.agent ? <AgentIcon source={item.agent} strokeWidth={2} /> : item.label.charAt(1).toUpperCase()}
            </span>
            <span className="shrink-0 text-sm font-medium text-(--bubble-ink)">{item.label.slice(1)}</span>
            <span className="min-w-0 truncate text-[13px] text-(--bubble-muted)">{item.description}</span>
            <span className="cs-ktag" style={{ "--k": itemColor(item) } as CSSProperties}>{item.tag}</span>
          </div>
        )
      })}
    </div>
  )
})
