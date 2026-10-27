// Adapted from T3 Code (MIT), apps/web/src/components/chat/ComposerCommandMenu.tsx, ComposerBanner.tsx
/**
 * The drawer of suggestions that rises out of the composer's top edge while
 * you type a `/command` or an `@agent` at the start of a message, as the
 * coding harness draws its own: a glass sheet tucked under the box's rim, one
 * row per suggestion with its name and what it does, the active row filled.
 * The text box keeps focus and drives it (a combobox: Up and Down move, Enter
 * or Tab takes the row, Esc closes); a pointer picks a row too. The harness's
 * file and pull request rows, and its menu primitive, are left out.
 */
import { memo, useLayoutEffect, useRef } from "react"
import type { StatusInfo } from "@protocol"
import { cn } from "@/lib/utils"
import { AgentIcon } from "@/ui/AgentIcon"
import { CHAT_AGENT_SOURCES, CHAT_MENTIONS, LOBBY_COMMANDS, type ChatAgent } from "@shared"
import { ListChecks, Route } from "lucide-react"

export type ComposerTriggerKind = "slash-command" | "mention"

export interface ComposerCommandItem {
  id: string
  /** What the row inserts at the start of the message, with a space after it. */
  insert: string
  label: string
  description: string
  agent?: ChatAgent
}

/** The `/` or `@` word being typed at the start of the message, when the caret is still in it. */
export function composerTrigger(text: string, caret: number): { kind: ComposerTriggerKind; query: string } | undefined {
  const match = /^\s*([/@])([a-z0-9:_.-]*)$/i.exec(text.slice(0, caret))
  if (!match || /\S/.test(text.slice(caret, caret + 1))) return undefined
  return { kind: match[1] === "/" ? "slash-command" : "mention", query: match[2]!.toLowerCase() }
}

function slashItems(commands: NonNullable<StatusInfo["commands"]>): ComposerCommandItem[] {
  const lobby = LOBBY_COMMANDS.map((command) => ({
    name: command.name, description: `${command.hint} · /${command.name} ${command.args}`,
  }))
  return [...lobby, ...commands].map((command) => ({
    id: `/${command.name}`, insert: `/${command.name}`, label: `/${command.name}`,
    description: command.description + ("terminal" in command && command.terminal ? " · continue in Pi terminal" : ""),
  }))
}

/** The rows for a trigger, those whose name starts with what is typed first. */
export function composerItems(trigger: { kind: ComposerTriggerKind; query: string }, commands: StatusInfo["commands"] = []): ComposerCommandItem[] {
  const rows: ComposerCommandItem[] = trigger.kind === "slash-command"
    ? slashItems(commands)
    : CHAT_MENTIONS.map((mention) => ({ id: `@${mention.name}`, insert: `@${mention.name}`, label: `@${mention.name}`, description: mention.hint, agent: mention.agent }))
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

function ItemIcon({ item }: { item: ComposerCommandItem }) {
  if (item.agent) return <AgentIcon source={CHAT_AGENT_SOURCES[item.agent]} strokeWidth={2} className="size-4 shrink-0 text-muted-foreground" />
  const Icon = item.id === "/plan" ? Route : ListChecks
  return <Icon aria-hidden="true" strokeWidth={2} className="size-4 shrink-0 text-muted-foreground" />
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

  return (
    <div
      ref={listRef}
      data-composer-command-drawer="true"
      className={cn(
        "composer-command-drawer relative isolate flex min-h-0 w-full flex-col overflow-hidden pb-[calc(1rem+1px)]",
        "before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-t-2xl before:border before:border-(--chat-composer-outline)",
        "before:bg-(--chat-composer-glass-surface)/(--glass-opacity) before:backdrop-blur-(--glass-blur) before:backdrop-saturate-(--glass-saturation)",
        "before:mask-t-from-transparent before:mask-t-from-4 before:mask-t-to-black before:mask-t-to-4 before:shadow-composer dark:before:shadow-none",
        "not-supports-[((backdrop-filter:blur(1px))_or_(-webkit-backdrop-filter:blur(1px)))]:before:bg-(--chat-composer-glass-surface)"
      )}
    >
      <div id={props.listId} role="listbox" aria-label={LISTBOX_LABEL_BY_TRIGGER[props.triggerKind]} className="max-h-72 min-h-0 overflow-y-auto p-2">
        {props.items.map((item) => {
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
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none",
                active && "bg-accent text-accent-foreground"
              )}
            >
              <ItemIcon item={item} />
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 max-w-[45%] shrink-0 truncate font-sans text-xs font-medium">{item.label}</span>
                <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">{item.description}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
})
